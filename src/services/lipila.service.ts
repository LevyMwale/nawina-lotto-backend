/**
 * Lipila Payment Gateway Service
 *
 * Integrates with the Lipila API for mobile-money collections AND disbursements.
 * Docs: https://docs.lipila.dev
 *
 * Collections (deposits) endpoint:
 *   POST https://blz.lipila.io/api/v1/collections/mobile-money
 *
 * Disbursements (withdrawals) endpoint:
 *   POST https://api.lipila.dev/api/v1/disbursements/mobile-money
 *
 * Required headers:
 *   accept: application/json
 *   Content-Type: application/json
 *   x-api-key: <your_secret_key>
 *   callbackUrl: <optional callback URL>
 *
 * Required environment variables:
 *   LIPILA_API_KEY                 — x-api-key header value
 *   LIPILA_BASE_URL                — https://blz.lipila.io (collections endpoint)
 *   LIPILA_DISBURSEMENT_BASE_URL   — https://api.lipila.dev (disbursements endpoint)
 *   APP_URL                        — Callback base URL
 */

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface LipilaConfig {
  apiKey: string;
  baseUrl: string;
  disbursementBaseUrl: string;
  appUrl: string;
}

function normalizeUrl(envVal: string | undefined, fallback: string): string {
  let url = (envVal || '').replace(/\/$/, '');
  if (url && !url.match(/^https?:\/\//)) {
    url = 'https://' + url;
  }
  return url || fallback;
}

function getConfig(): LipilaConfig {
  // Trim whitespace — common copy-paste issue from dashboards
  const apiKey = (process.env.LIPILA_API_KEY || '').trim();
  const baseUrl = normalizeUrl(process.env.LIPILA_BASE_URL, 'https://blz.lipila.io');
  // Collections and disbursements share the same base URL (Lipila confirmed).
  // Only the path differs: /collections/mobile-money vs /disbursements/mobile-money.
  const disbursementBaseUrl = normalizeUrl(
    process.env.LIPILA_DISBURSEMENT_BASE_URL || process.env.LIPILA_BASE_URL,
    'https://blz.lipila.io',
  );
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  console.log(`[LipilaConfig] baseUrl=${baseUrl} disbursementBaseUrl=${disbursementBaseUrl} appUrl=${appUrl} keyPresent=${!!apiKey}`);

  if (!apiKey) {
    console.warn('[Lipila] Missing LIPILA_API_KEY. Live calls will fail with 401.');
  }
  if (baseUrl.includes('dashboard')) {
    console.error(
      `[Lipila] WARN: base URL looks like the dashboard site (${baseUrl}), not the API endpoint. ` +
      `Delete LIPILA_BASE_URL from Render env vars or set it to https://blz.lipila.io`
    );
  }

  return { apiKey, baseUrl, disbursementBaseUrl, appUrl };
}

/** Try the standard x-api-key header first. On 401, retry with Authorization: Bearer. */
async function lipilaFetch(
  url: string,
  apiKey: string,
  options: { method: string; body?: string; callbackUrl?: string }
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.callbackUrl) {
    baseHeaders.callbackUrl = options.callbackUrl;
  }

  // Attempt 1: x-api-key (documented in Lipila docs)
  const res1 = await fetch(url, {
    method: options.method,
    headers: { ...baseHeaders, 'x-api-key': apiKey },
    body: options.body,
  });

  if (res1.status !== 401) {
    return res1;
  }

  // Attempt 2: Authorization: Bearer (some gateways use this instead)
  console.log('[Lipila] x-api-key returned 401 — retrying with Authorization: Bearer ...');
  const res2 = await fetch(url, {
    method: options.method,
    headers: { ...baseHeaders, Authorization: `Bearer ${apiKey}` },
    body: options.body,
  });
  return res2;
}

export class LipilaService {
  /**
   * Initiate a deposit (mobile-money collection) via Lipila.
   *
   * POST /api/v1/collections/mobile-money
   */
  async initiateDeposit(
    amount: number,
    phone: string,
    _userId: string
  ): Promise<{ success: boolean; reference: string; message: string; lipilaIdentifier?: string }> {
    const config = getConfig();
    const referenceId = `NWINA-DEP-${uuidv4()}`;

    // Normalize Zambian phone numbers to 260xxxxxxxxx
    let normalizedPhone = phone.replace(/^\+/, '').trim();
    if (normalizedPhone.match(/^0\d{9}$/)) {
      normalizedPhone = '260' + normalizedPhone.slice(1);
    } else if (!normalizedPhone.startsWith('260') && normalizedPhone.length === 9) {
      normalizedPhone = '260' + normalizedPhone;
    }

    const body = {
      referenceId,
      amount: Number(amount),
      narration: `NaWiNa deposit — K${amount}`,
      accountNumber: normalizedPhone,
      currency: 'ZMW',
      email: '',
    };

    const callbackUrl = config.appUrl ? `${config.appUrl}/api/wallet/lipila-callback` : undefined;

    try {
      const url = `${config.baseUrl}/api/v1/collections/mobile-money`;
      console.log(`[Lipila] POST ${url} — ref=${referenceId}, amount=${amount}, phone=${normalizedPhone}`);
      console.log(`[Lipila] x-api-key present: ${!!config.apiKey} (length: ${config.apiKey.length}, startsWith: ${config.apiKey.slice(0, 3)})`);

      const response = await lipilaFetch(url, config.apiKey, {
        method: 'POST',
        body: JSON.stringify(body),
        callbackUrl,
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.error('[Lipila] initiateDeposit failed:', msg, 'status:', response.status);
        console.error('[Lipila] FULL RESPONSE BODY:', JSON.stringify(data));
        console.error('[Lipila] REQUEST SENT:', JSON.stringify(body));
        return { success: false, reference: referenceId, message: msg };
      }

      // Lipila returns identifier (LPLXC-...) which is their internal tx id.
      // We use our own referenceId for status polling, but store identifier for support.
      const lipilaIdentifier = data?.identifier || '';
      const returnedMsg = data?.message || 'Payment request sent. Please check your phone to approve.';

      return {
        success: true,
        reference: referenceId,
        message: returnedMsg,
        lipilaIdentifier,
      };
    } catch (error: any) {
      console.error('[Lipila] initiateDeposit exception:', error);
      return {
        success: false,
        reference: referenceId,
        message: error.message || 'Failed to initiate Lipila deposit',
      };
    }
  }

  /**
   * Check the status of a Lipila collection.
   *
   * The docs have a "Collection Status" page; the endpoint pattern is
   * assumed to be GET /api/v1/collections/mobile-money/{referenceId}
   * based on common REST conventions. Update this if the docs specify
   * a different URL.
   *
   * CRITICAL: A 404 on the status endpoint does NOT mean the deposit
   * failed — it may mean Lipila hasn't processed it yet. We treat 404
   * as "still pending" so we don't wrongly mark a valid deposit as failed.
   */
  async checkStatus(
    reference: string
  ): Promise<{ status: 'pending' | 'completed' | 'failed'; message?: string; httpStatus?: number }> {
    const config = getConfig();

    try {
      // Lipila docs show status check as GET /api/v1/collections/check-status?referenceId=...
      const url = `${config.baseUrl}/api/v1/collections/check-status?referenceId=${encodeURIComponent(reference)}`;
      console.log(`[Lipila] GET ${url}`);

      const response = await lipilaFetch(url, config.apiKey, { method: 'GET' });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.warn(`[Lipila] checkStatus HTTP ${response.status} — treating as pending, not failed`);
        // 404 = reference not found yet (not failed)
        // 401 = auth issue (should be fixed, but don't mark txn failed)
        // 5xx = transient server error
        // All of these should keep the transaction as pending so polling
        // can retry later or the webhook can complete it.
        return {
          status: 'pending',
          message: msg,
          httpStatus: response.status,
        };
      }

      // Lipila returns status as "Pending", "Failed", etc.
      const rawStatus = (data?.status || 'pending').toString().toLowerCase();
      let status: 'pending' | 'completed' | 'failed' = 'pending';

      if (['success', 'completed', 'successful', 'done', 'paid'].includes(rawStatus)) {
        status = 'completed';
      } else if (['failed', 'failure', 'error', 'rejected', 'cancelled'].includes(rawStatus)) {
        status = 'failed';
      }

      return {
        status,
        message: data?.message || data?.description || `Status: ${rawStatus}`,
        httpStatus: response.status,
      };
    } catch (error: any) {
      console.error('[Lipila] checkStatus exception:', error);
      // Network / timeout errors keep the deposit pending so polling retries
      return { status: 'pending', message: error.message || 'Status check failed' };
    }
  }

  /**
   * Initiate a withdrawal (payout / disbursement) via Lipila.
   *
   * TODO: Lipila disbursement endpoint URL is not confirmed yet.
   * Common patterns:
   *   POST /api/v1/disbursements/mobile-money
   *   POST /api/v1/payouts/mobile-money
   */
  async initiateWithdrawal(
    amount: number,
    phone: string,
    _userId: string
  ): Promise<{ success: boolean; reference: string; message: string }> {
    const config = getConfig();
    const referenceId = `NWINA-WDR-${uuidv4()}`;

    let normalizedPhone = phone.replace(/^\+/, '').trim();
    if (normalizedPhone.match(/^0\d{9}$/)) {
      normalizedPhone = '260' + normalizedPhone.slice(1);
    } else if (!normalizedPhone.startsWith('260') && normalizedPhone.length === 9) {
      normalizedPhone = '260' + normalizedPhone;
    }

    const body = {
      referenceId,
      amount: Number(amount),
      narration: `NaWiNa withdrawal — K${amount}`,
      accountNumber: normalizedPhone,
      currency: 'ZMW',
      email: '',
    };

    const callbackUrl = config.appUrl ? `${config.appUrl}/api/wallet/lipila-callback` : undefined;

    try {
      const url = `${config.disbursementBaseUrl}/api/v1/disbursements/mobile-money`;
      console.log(`[Lipila] POST ${url} — ref=${referenceId}, amount=${amount}, phone=${normalizedPhone}`);

      const response = await lipilaFetch(url, config.apiKey, {
        method: 'POST',
        body: JSON.stringify(body),
        callbackUrl,
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.error(`[Lipila] initiateWithdrawal failed: ${msg} (url=${url})`);
        if (response.status === 401) {
          return {
            success: false,
            reference: referenceId,
            message:
              'Lipila withdrawal failed (401). Possible causes:\n' +
              '1. Your API key does not have disbursement permissions — contact Lipila support to enable payouts.\n' +
              '2. The server IP is not whitelisted — add 74.220.48.5/32 (or Render outbound IPs) to your Lipila dashboard.\n' +
              '3. You are using a sandbox key on the production endpoint (or vice versa).',
          };
        }
        return { success: false, reference: referenceId, message: msg };
      }

      const returnedMsg = data?.message || 'Withdrawal request submitted. Awaiting processing.';

      return {
        success: true,
        reference: referenceId,
        message: returnedMsg,
      };
    } catch (error: any) {
      console.error('[Lipila] initiateWithdrawal exception:', error);
      return {
        success: false,
        reference: referenceId,
        message: error.message || 'Failed to initiate Lipila withdrawal',
      };
    }
  }
}
