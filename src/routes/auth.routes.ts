import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';
import { OtpService } from '../services/otp.service';
import { User } from '../models/User';
import { AppError } from '../utils/errors';

const router = Router();
const authService = new AuthService();
const otpService = new OtpService();

// ---------------------------------------------------------------------------
// sendError — uniform error response for the new routes. The legacy
// /register and /login handlers keep their own try/catch shape because
// they throw plain `Error` (not AppError), and we don't want to change
// the response body format that's already in production.
//
// AppError carries a numeric `status` and string `code`, so we map
// directly. Anything else gets a generic 500. We deliberately omit the
// error `message` for non-AppError 500s in production to avoid leaking
// stack-trace details; the dev branch can include it for debugging.
// ---------------------------------------------------------------------------
function sendError(res: any, err: unknown): void {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      error: err.message,
      code: err.code,
    };
    if (err.details) Object.assign(body, err.details);
    res.status(err.status).json(body);
    return;
  }
  // eslint-disable-next-line no-console
  console.error('💥 /auth unexpected error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? undefined : (err as any)?.message,
  });
}

router.post('/register', async (req, res) => {
  try {
    const { phone, pin, fullName } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }

    const result = await authService.register(phone, pin, fullName);
    res.status(201).json(result);
  } catch (error: any) {
    // Temporary diagnostic — log the full error to the Render log so we
    // can see what `error.message` actually contains when register fails
    // with an empty string in the response. Remove once the root cause
    // is identified.
    // eslint-disable-next-line no-console
    console.error('💥 /auth/register error:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    res.status(400).json({ error: error?.message || 'Could not create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }

    const result = await authService.login(phone, pin);
    res.json(result);
  } catch (error: any) {
    // Temporary diagnostic — log the full error to the Render log so we
    // can see what `error.message` actually contains when login fails
    // with an empty string in the response. Remove once the root cause
    // is identified.
    // eslint-disable-next-line no-console
    console.error('💥 /auth/login error:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
    });
    res.status(401).json({ error: error?.message || 'Invalid phone number or PIN' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/otp/request
//   Body: { phone: string }
//   Sends a 6-digit SMS code via OtpService. Always responds with the
//   same shape regardless of whether the user is registered — the OTP
//   service normalizes the phone and applies cooldown / hourly limits
//   per phone and per IP. The 60s cooldown and 5/hr-per-phone cap live
//   inside OtpService; this handler is a thin pass-through.
// ---------------------------------------------------------------------------
router.post('/otp/request', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) {
      return res.status(400).json({ error: 'Phone is required', code: 'MISSING_PHONE' });
    }
    const result = await otpService.requestOtp(phone, req.ip);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
//   Body: { phone, code, newPin }
//   Atomic verify-and-reset:
//     1. validate newPin shape
//     2. otpService.verifyOtp — this marks the code consumed, so a retry
//        with the same code surfaces as OTP_NOT_FOUND (401). That is
//        intentional: it prevents a code being replayed if the user
//        double-clicks "Reset PIN".
//     3. user lookup happens AFTER OTP verify, so an attacker who
//        guesses a phone can't enumerate which phones are registered
//        until they prove possession of the phone.
//     4. inactive-user check rejects suspended accounts (the same
//        gate the /login handler applies).
//     5. patch users.pin_hash with bcrypt 12 rounds — same parameters
//        as authService.register — and bump updated_at.
//
//   Does NOT mint a JWT. The player re-enters their new PIN on the
//   existing login form. This keeps the reset endpoint surface small
//   and avoids duplicating authService.generateToken's signing path.
// ---------------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, code, newPin } = req.body || {};

    if (!phone || !code || !newPin) {
      return res.status(400).json({
        error: 'phone, code and newPin are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (!/^\d{4,6}$/.test(String(newPin))) {
      return res.status(400).json({
        error: 'PIN must be 4-6 digits',
        code: 'INVALID_PIN',
      });
    }

    // Atomic: verifyOtp marks the code consumed on success.
    const verified = await otpService.verifyOtp(phone, code);

    const user = await User.query().findOne({ phone: verified.phone });
    if (!user) {
      return res.status(404).json({
        error: 'No account found for this number',
        code: 'USER_NOT_FOUND',
      });
    }
    if (!user.is_active) {
      return res.status(403).json({
        error: 'Account is deactivated. Contact support.',
        code: 'USER_INACTIVE',
      });
    }

    const pinHash = await bcrypt.hash(newPin, 12);
    await User.query()
      .patch({ pin_hash: pinHash, updated_at: new Date() })
      .where({ id: user.id });

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
