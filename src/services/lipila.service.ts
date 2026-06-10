/**
 * Lipila Payment Gateway Service
 *
 * Integrates with the Lipila API for mobile-money deposits and (future)
 * disbursements. The collections endpoint is:
 *   POST https://api.lipila.dev/api/v1/collections/mobile-money
 *
 * Required environment variables:
 *   LIPILA_API_KEY      — x-api-key header value
 *   LIPILA_BASE_URL     — https://api.lipila.dev (optional override)
 *   APP_URL             — Callback base URL (e.g. https://api.nawina.com)
 */

function uuidv4(): string {
  // Simple RFC4122 v4 UUID generator without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface LipilaConfig {
  apiKey: string;
  baseUrl: string;
  appUrl: string;
}

function getConfig(): LipilaConfig {
  const apiKey = process.env.LIPILA_API_KEY || '';
  // Belt-and-braces: if the env var points at the dashboard/login site instead
  // of the API endpoint, calls will fail with 405. The user explicitly gave us
  // api.lipila.dev — treat that as the canonical API base.
  const envBase = (process.env.LIPILA_BASE_URL || '').replace(/\/$/, '');
  const baseUrl = envBase || 'https://api.lipila.dev';
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  if (!apiKey) {
    console.warn('[Lipila] Missing LIPILA_API_KEY. Live calls will fail.');
  }
  if (baseUrl.includes('dashboard') || baseUrl.includes('lipila.io')) {
    console.error(
      `[Lipila] WARN: base URL looks like the dashboard site (${baseUrl}), not the API endpoint. ` +
      `Lipila collections will fail with 405. Delete LIPILA_BASE_URL from Render env vars ` +
      `or set it to https://api.lipila.dev`
    );
  }

  return { apiKey, baseUrl, appUrl };
}

function getHeaders(config: LipilaConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
  };
}

export class LipilaService {
  /**
   * Initiate a deposit (mobile-money collection) via Lipila.
   *
   * POST /api/v1/collections/mobile-money
   * Body: { referenceId, amount, accountNumber, currency, callbackUrl, redirectUrl, backUrl, email }
   */
  async initiateDeposit(
    amount: number,
    phone: string,
    _userId: string
  ): Promise<{ success: boolean; reference: string; message: string }> {
    const config = getConfig();
    const referenceId = `NWINA-DEP-${uuidv4()}`;

    // Normalize Zambian phone numbers
    // Must start with 260 (e.g. 260979257247). If it starts with 09/07, prepend 260.
    let normalizedPhone = phone.replace(/^\+/, '').trim();
    if (normalizedPhone.match(/^0\d{9}$/)) {
      normalizedPhone = '260' + normalizedPhone.slice(1);
    } else if (!normalizedPhone.startsWith('260') && normalizedPhone.length === 9) {
      normalizedPhone = '260' + normalizedPhone;
    }

    const body = {
      referenceId,
      amount: String(amount),
      accountNumber: normalizedPhone,
      currency: 'ZMW',
      callbackUrl: config.appUrl ? `${config.appUrl}/api/wallet/lipila-callback` : '',
      redirectUrl: config.appUrl ? `${config.appUrl}/wallet/deposit/success` : '',
      backUrl: config.appUrl ? `${config.appUrl}/wallet/deposit` : '',
      email: '', // optional — left empty since we only have phone auth
    };

    try {
      const url = `${config.baseUrl}/api/v1/collections/mobile-money`;
      console.log(`[Lipila] POST ${url} — ref=${referenceId}, amount=${amount}, phone=${normalizedPhone}`);

      const headers = getHeaders(config);
      const apiKeyPresent = !!config.apiKey;
      console.log(`[Lipila] x-api-key present: ${apiKeyPresent} (first 4 chars: ${config.apiKey ? config.apiKey.slice(0, 4) + '...' : 'NONE'})`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.error('[Lipila] initiateDeposit failed:', msg);
        return { success: false, reference: referenceId, message: msg };
      }

      // Lipila may return the reference inside the response; prefer it if present
      const returnedRef = data?.referenceId || data?.reference || referenceId;
      const returnedMsg = data?.message || 'Payment request sent. Please check your phone to approve.';

      return {
        success: true,
        reference: returnedRef,
        message: returnedMsg,
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
   * Check the status of a Lipila collection or payout.
   *
   * GET /api/v1/collections/mobile-money/:referenceId
   * (If Lipila exposes a dedicated status endpoint, swap the URL below.)
   */
  async checkStatus(
    reference: string
  ): Promise<{ status: 'pending' | 'completed' | 'failed'; message?: string }> {
    const config = getConfig();

    try {
      const url = `${config.baseUrl}/api/v1/collections/mobile-money/${encodeURIComponent(reference)}`;
      console.log(`[Lipila] GET ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': config.apiKey,
        },
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.error('[Lipila] checkStatus failed:', msg);
        return { status: 'failed', message: msg };
      }

      // Map Lipila status strings to our internal enum
      const rawStatus = (data?.status || data?.transactionStatus || 'pending').toString().toLowerCase();
      let status: 'pending' | 'completed' | 'failed' = 'pending';

      if (['success', 'completed', 'successful', 'done', 'paid'].includes(rawStatus)) {
        status = 'completed';
      } else if (['failed', 'failure', 'error', 'rejected', 'cancelled'].includes(rawStatus)) {
        status = 'failed';
      }

      return {
        status,
        message: data?.message || data?.description || `Status: ${rawStatus}`,
      };
    } catch (error: any) {
      console.error('[Lipila] checkStatus exception:', error);
      return { status: 'failed', message: error.message || 'Status check failed' };
    }
  }

  /**
   * Initiate a withdrawal (payout / disbursement) via Lipila.
   *
   * TODO: Lipila disbursement endpoint URL is not confirmed yet.
   * Common patterns:
   *   POST /api/v1/disbursements/mobile-money
   *   POST /api/v1/payouts/mobile-money
   *
   * Once confirmed, replace the `url` below and adjust the body shape.
   */
  async initiateWithdrawal(
    amount: number,
    phone: string,
    _userId: string
  ): Promise<{ success: boolean; reference: string; message: string }> {
    const config = getConfig();
    const referenceId = `NWINA-WDR-${uuidv4()}`;
    const normalizedPhone = phone.replace(/^\+/, '').trim();

    const body = {
      referenceId,
      amount: String(amount),
      accountNumber: normalizedPhone,
      currency: 'ZMW',
      callbackUrl: config.appUrl ? `${config.appUrl}/api/wallet/lipila-callback` : '',
      reason: 'Withdrawal from NaWiNa Lotto',
    };

    try {
      // Replace with the confirmed Lipila disbursement URL when available
      const url = `${config.baseUrl}/api/v1/disbursements/mobile-money`;
      console.log(`[Lipila] POST ${url} — ref=${referenceId}, amount=${amount}, phone=${normalizedPhone}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(config),
        body: JSON.stringify(body),
      });

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = data?.message || data?.error || `Lipila HTTP ${response.status}`;
        console.error('[Lipila] initiateWithdrawal failed:', msg);
        return { success: false, reference: referenceId, message: msg };
      }

      const returnedRef = data?.referenceId || data?.reference || referenceId;
      const returnedMsg = data?.message || 'Withdrawal request submitted. Awaiting processing.';

      return {
        success: true,
        reference: returnedRef,
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
