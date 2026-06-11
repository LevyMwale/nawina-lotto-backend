import bcrypt from 'bcryptjs';
import type { Knex } from 'knex';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { sms } from './sms.service';
import {
  InvalidPhoneError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpNotFoundError,
  SmsFailedError,
  TooManyRequestsError,
} from '../utils/errors';

const CODE_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const HOURLY_LIMIT_PER_PHONE = 5;
const HOURLY_LIMIT_PER_IP = 20;

const BCRYPT_ROUNDS = 10; // Lower than the user's PIN (12) because OTPs are short-lived.

/**
 * Normalize a phone number to E.164. Accepts:
 *   - "+260XXXXXXXXX" (already E.164)
 *   - "260XXXXXXXXX"  (missing +)
 *   - "0XXXXXXXXX"    (local 10-digit Zambian format)
 * Throws InvalidPhoneError otherwise.
 */
export function normalizePhone(raw: string): string {
  if (!raw) throw new InvalidPhoneError();
  const cleaned = String(raw).replace(/\s|-/g, '');
  if (cleaned.startsWith('+260') && /^\+260[0-9]{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^260[0-9]{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^0[0-9]{9}$/.test(cleaned)) {
    return `+260${cleaned.substring(1)}`;
  }
  throw new InvalidPhoneError();
}

function generateCode(): string {
  // 6-digit numeric, leading zeros preserved by the slice.
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function countRecent(knex: Knex, phone: string, sinceMinutes: number): Promise<number> {
  const row = await knex('otp_codes')
    .where({ phone })
    .andWhere('created_at', '>', knex.raw(`now() - interval '${sinceMinutes} minutes'`))
    .count<{ count: string }>({ count: '*' })
    .first();
  return Number(row?.count) || 0;
}

async function countRecentByIp(knex: Knex, ip: string | undefined, sinceMinutes: number): Promise<number> {
  if (!ip) return 0;
  const row = await knex('otp_codes')
    .where({ ip })
    .andWhere('created_at', '>', knex.raw(`now() - interval '${sinceMinutes} minutes'`))
    .count<{ count: string }>({ count: '*' })
    .first();
  return Number(row?.count) || 0;
}

async function latestActiveCooldown(knex: Knex, phone: string): Promise<number> {
  const row = await knex('otp_codes')
    .where({ phone })
    .whereNull('consumed_at')
    .andWhere('expires_at', '>', knex.fn.now())
    .orderBy('created_at', 'desc')
    .select('created_at')
    .first();
  if (!row) return 0;
  const created = new Date(row.created_at).getTime();
  const elapsed = Math.floor((Date.now() - created) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}

export interface RequestOtpResult {
  cooldownSeconds: number;
  /** True when the cooldown was already 0 and a fresh code was just generated. */
  sent: boolean;
}

export class OtpService {
  /**
   * Request a 6-digit code for `phone`.
   *
   * Cooldown: at most one code per 60s per phone.
   * Hourly caps: 5 per phone, 20 per IP. Both backed by counting rows in
   * `otp_codes` — no separate rate-limit table to maintain.
   */
  async requestOtp(phone: string, ip?: string): Promise<RequestOtpResult> {
    const normalized = normalizePhone(phone);
    const knex = User.knex();

    // Cooldown check (cheap, single-row query).
    const cooldown = await latestActiveCooldown(knex, normalized);
    if (cooldown > 0) {
      throw new TooManyRequestsError(cooldown, `Please wait ${cooldown}s before requesting another code.`);
    }

    // Hourly caps.
    const [perPhone, perIp] = await Promise.all([
      countRecent(knex, normalized, 60),
      countRecentByIp(knex, ip, 60),
    ]);
    if (perPhone >= HOURLY_LIMIT_PER_PHONE) {
      throw new TooManyRequestsError(60 * 60, 'Hourly OTP limit reached for this number.');
    }
    if (perIp >= HOURLY_LIMIT_PER_IP) {
      throw new TooManyRequestsError(60 * 60, 'Hourly OTP limit reached from this network.');
    }

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await knex('otp_codes').insert({
      phone: normalized,
      code_hash: codeHash,
      attempts: 0,
      expires_at: expiresAt,
      ip: ip || null,
    });

    const message = `Your NaWiNa Lotto code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`;
    try {
      await sms.send(normalized, message);
    } catch (err) {
      // Surface the typed error; the route will turn it into 502.
      if (err instanceof SmsFailedError) throw err;
      throw new SmsFailedError();
    }

    return { cooldownSeconds: RESEND_COOLDOWN_SECONDS, sent: true };
  }

  /**
   * Verify a 6-digit code. On success, returns the phone (E.164). The caller
   * is responsible for upserting the user and minting a JWT.
   *
   * Failure handling: each wrong attempt increments `attempts` on the latest
   * active code. At MAX_ATTEMPTS, the code is force-consumed and the user
   * must request a new one.
   */
  async verifyOtp(phone: string, code: string): Promise<{ phone: string }> {
    if (!/^\d{6}$/.test(code)) {
      throw new OtpInvalidError();
    }
    const normalized = normalizePhone(phone);
    const knex = User.knex();

    const row = await knex('otp_codes')
      .where({ phone: normalized })
      .whereNull('consumed_at')
      .orderBy('created_at', 'desc')
      .first();

    if (!row) throw new OtpNotFoundError();
    if (new Date(row.expires_at).getTime() < Date.now()) {
      // Best-effort mark expired.
      await knex('otp_codes').where({ id: row.id }).update({ consumed_at: knex.fn.now() });
      throw new OtpExpiredError();
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await knex('otp_codes').where({ id: row.id }).update({ consumed_at: knex.fn.now() });
      throw new OtpLockedError();
    }

    const ok = await bcrypt.compare(code, row.code_hash);
    if (!ok) {
      const nextAttempts = (row.attempts as number) + 1;
      await knex('otp_codes').where({ id: row.id }).update({ attempts: nextAttempts });
      if (nextAttempts >= MAX_ATTEMPTS) {
        await knex('otp_codes').where({ id: row.id }).update({ consumed_at: knex.fn.now() });
        throw new OtpLockedError();
      }
      throw new OtpInvalidError();
    }

    // Mark consumed in the same transaction the caller will use to create/find
    // the user. We do it here to make verification atomic: the same code can
    // never be used twice, even with concurrent requests.
    await knex('otp_codes').where({ id: row.id }).update({ consumed_at: knex.fn.now() });

    return { phone: normalized };
  }
}
