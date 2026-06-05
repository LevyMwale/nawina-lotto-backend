import { SmsFailedError } from '../utils/errors';

/**
 * Pluggable SMS provider interface. The OTP service depends on this, not on
 * any specific vendor, so we can swap providers (or run in console mode for
 * dev) without touching the routes.
 */
export interface SmsService {
  /** Returns the provider's message id on success. */
  send(phone: string, message: string): Promise<string>;
}

/**
 * Dev fallback. Logs the message to stdout so a developer running locally
 * with `SMS_PROVIDER=console` can read the code from the server log.
 *
 * Activated automatically when `SMS_PROVIDER` is not set to a real provider.
 */
export class ConsoleSms implements SmsService {
  async send(phone: string, message: string): Promise<string> {
    const codeMatch = message.match(/\b(\d{4,8})\b/);
    const code = codeMatch ? codeMatch[1] : '(no-code)';
    // eslint-disable-next-line no-console
    console.log(`[DEV OTP] phone=${phone} code=${code}`);
    return `console-${Date.now()}`;
  }
}

/**
 * Africa's Talking SMS wrapper.
 *
 * Env vars (all required for this provider):
 *   - AT_API_KEY     : the API key from the AT dashboard
 *   - AT_USERNAME    : the AT account username (use 'sandbox' for the sandbox)
 *   - AT_SENDER_ID   : optional, registered alphanumeric sender id
 *
 * The official SDK is dynamically imported so that `npm install` does not
 * fail in environments that don't need the real provider (and so the
 * `ConsoleSms` path is zero-cost in dev).
 */
export class AfricasTalkingSms implements SmsService {
  private apiKey: string;
  private username: string;
  private senderId?: string;

  constructor() {
    this.apiKey = process.env.AT_API_KEY || '';
    this.username = process.env.AT_USERNAME || 'sandbox';
    this.senderId = process.env.AT_SENDER_ID || undefined;
    if (!this.apiKey) {
      // Don't crash on boot — let the first send fail with a clear error.
      // eslint-disable-next-line no-console
      console.warn('[sms] AT_API_KEY is not set; Africa\'s Talking sends will fail.');
    }
  }

  async send(phone: string, message: string): Promise<string> {
    if (!this.apiKey) {
      throw new SmsFailedError('Africa\'s Talking API key is not configured');
    }
    let AfricasTalking: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      AfricasTalking = require('africastalking');
    } catch (err) {
      throw new SmsFailedError('africastalking package is not installed. Run `npm i africastalking`.');
    }

    const client = AfricasTalking({ apiKey: this.apiKey, username: this.username });
    const sms = client.SMS;

    let response: any;
    try {
      response = await sms.send({
        to: [phone],
        message,
        from: this.senderId,
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[sms] AT send error:', err?.message || err);
      throw new SmsFailedError('SMS provider rejected the request');
    }

    // AT response shape: { SMSMessageData: { Message, Recipients: [{statusCode, number, cost, status, messageId}] } }
    const recipients = response?.SMSMessageData?.Recipients;
    if (!recipients || recipients.length === 0) {
      throw new SmsFailedError('SMS provider returned no recipients');
    }
    const first = recipients[0];

    // statusCode is the source of truth. Per AT docs:
    //   100 Processed | 101 Sent | 102 Queued   → treat as success
    //   401 RiskHold | 402 InvalidSenderId | 403 InvalidPhoneNumber
    //   404 UnsupportedNumberType | 405 InsufficientBalance
    //   406 UserInBlacklist | 407 CouldNotRoute | 409 DoNotDisturbRejection
    //   500 InternalServerError | 501 GatewayError | 502 RejectedByGateway
    const code = Number(first?.statusCode);
    if (![100, 101, 102].includes(code)) {
      // eslint-disable-next-line no-console
      console.error('[sms] AT rejected SMS:', { phone, code, status: first?.status, message: first });
      throw new SmsFailedError(
        this.describeAtStatus(code, first?.status || 'unknown'),
      );
    }
    return String(first?.messageId || response.SMSMessageData?.MessageId || 'at-unknown');
  }

  /**
   * Map AT's statusCode + status string to a human-readable reason. Pulled
   * from the AT docs; kept here so we don't have to re-derive it from
   * a string in the route layer.
   */
  private describeAtStatus(code: number, status: string): string {
    const map: Record<number, string> = {
      401: 'Message held for risk review',
      402: 'Sender ID not registered',
      403: 'Invalid phone number',
      404: 'Unsupported number type',
      405: 'Insufficient AT balance — top up your account',
      406: 'Recipient is on the AT blacklist',
      407: 'AT could not route to that carrier',
      409: 'Recipient opted out of messages',
      500: 'AT internal error',
      501: 'AT gateway error',
      502: 'Rejected by gateway',
    };
    return `SMS not sent (code ${code}: ${map[code] || status})`;
  }
}

/**
 * Default SMS service, picked from `SMS_PROVIDER`. Defaults to `console` so
 * a fresh checkout works locally without configuring Africa's Talking.
 */
export const sms: SmsService = (() => {
  const provider = (process.env.SMS_PROVIDER || 'console').toLowerCase();
  switch (provider) {
    case 'at':
    case 'africastalking':
      return new AfricasTalkingSms();
    case 'console':
    default:
      return new ConsoleSms();
  }
})();
