/**
 * Typed errors used by the OTP authentication flow.
 *
 * Each error carries a stable `code` string (for the API response body) and a
 * numeric `status` (for the HTTP status line). The auth route handler maps
 * these to the wire format; nothing else should need to know HTTP codes.
 */

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class InvalidPhoneError extends AppError {
  constructor(message = 'Invalid phone number. Use Zambian format: +260XXXXXXXXX') {
    super(message, 400, 'INVALID_PHONE');
  }
}

export class TooManyRequestsError extends AppError {
  /** Seconds the client should wait before retrying. */
  public readonly retryAfter: number;
  constructor(retryAfter: number, message = 'Too many OTP requests. Please wait.') {
    super(message, 429, 'RATE_LIMITED', { retryAfter });
    this.retryAfter = retryAfter;
  }
}

export class OtpNotFoundError extends AppError {
  constructor(message = 'No active code. Request a new one.') {
    super(message, 401, 'OTP_NOT_FOUND');
  }
}

export class OtpExpiredError extends AppError {
  constructor(message = 'Code has expired. Request a new one.') {
    super(message, 401, 'OTP_EXPIRED');
  }
}

export class OtpLockedError extends AppError {
  constructor(message = 'Too many incorrect attempts. Request a new code.') {
    super(message, 401, 'OTP_LOCKED');
  }
}

export class OtpInvalidError extends AppError {
  constructor(message = 'Invalid code') {
    super(message, 401, 'OTP_INVALID');
  }
}

export class SmsFailedError extends AppError {
  constructor(message = 'Could not send SMS. Please try again.') {
    super(message, 502, 'SMS_FAILED');
  }
}
