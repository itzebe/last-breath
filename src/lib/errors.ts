/** Normalises the many shapes of failure into one predictable type. */

export type ErrorKind =
  | 'config'
  | 'network'
  | 'auth'
  | 'permission'
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'rate_limit'
  | 'unknown';

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly kind: ErrorKind;
  /** Safe to show to a human. Never contains raw provider internals. */
  readonly userMessage: string;

  constructor(kind: ErrorKind, userMessage: string, technical?: string, cause?: unknown) {
    super(technical ?? userMessage, cause === undefined ? undefined : { cause });
    this.kind = kind;
    this.userMessage = userMessage;
  }
}

interface Postgrestish {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password combination is not recognised.',
  email_not_confirmed: 'Confirm your email address first — check your inbox for the link.',
  user_already_exists: 'An account already exists for that email address.',
  email_exists: 'An account already exists for that email address.',
  weak_password: 'Choose a stronger password (at least 10 characters).',
  over_email_send_rate_limit: 'Too many emails requested. Wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a moment and try again.',
  same_password: 'The new password must differ from your current one.',
  session_not_found: 'That link has expired. Request a new one.',
  otp_expired: 'That link has expired. Request a new one.',
  validation_failed: 'Check the highlighted fields and try again.',
};

/**
 * Translates an unknown thrown value into an AppError. Provider error codes are
 * mapped to human sentences; unrecognised codes fall back to a neutral message
 * so we never leak internal detail to the interface.
 */
export function toAppError(error: unknown, fallback = 'Something went wrong. Try again.'): AppError {
  if (error instanceof AppError) return error;

  const candidate = (error ?? {}) as Postgrestish & { status?: number; name?: string };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const rawMessage = typeof candidate.message === 'string' ? candidate.message : '';
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;

  if (code && AUTH_MESSAGES[code]) {
    return new AppError('auth', AUTH_MESSAGES[code], rawMessage, error);
  }

  if (/failed to fetch|networkerror|load failed|network request failed/i.test(rawMessage)) {
    return new AppError('network', 'Cannot reach the server. Check your connection.', rawMessage, error);
  }
  if (status === 401 || code === 'PGRST301' || code === '42501' || /jwt/i.test(code)) {
    return new AppError('auth', 'Your session has expired. Sign in again.', rawMessage, error);
  }
  if (status === 403) {
    return new AppError('permission', 'You do not have access to that.', rawMessage, error);
  }
  if (status === 429) {
    return new AppError('rate_limit', 'Too many requests. Wait a moment.', rawMessage, error);
  }
  if (code === '23505' || code === '23514') {
    return new AppError('conflict', 'That conflicts with an existing record.', rawMessage, error);
  }
  if (code === 'PGRST116') {
    return new AppError('not_found', 'Not found.', rawMessage, error);
  }
  if (code === '23503') {
    return new AppError('validation', 'Related record is missing.', rawMessage, error);
  }

  const technical = rawMessage || (error instanceof Error ? error.message : String(error));
  return new AppError('unknown', fallback, technical, error);
}
