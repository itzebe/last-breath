import { z } from 'zod';

/**
 * Usernames are public identifiers: they appear on the leaderboard and in match
 * history, so they are constrained to a safe, unambiguous character set.
 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(20, 'Use at most 20 characters.')
  .regex(USERNAME_PATTERN, 'Letters, numbers and underscores only.')
  .refine((value) => !/^_|_$/.test(value), 'Cannot start or end with an underscore.')
  .refine(
    (value) => !RESERVED_USERNAMES.has(value.toLowerCase()),
    'That callsign is reserved.',
  );

/** Reserved so they can never be mistaken for system or staff accounts. */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'system', 'lastbreath', 'last_breath', 'root', 'moderator',
  'mod', 'staff', 'support', 'official', 'null', 'undefined', 'anonymous', 'guest',
]);

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.');

/**
 * Length beats complexity: a long passphrase is stronger and easier to type on
 * a phone than a short string with mandatory symbols.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((value) => /[a-zA-Z]/.test(value), 'Include at least one letter.')
  .refine((value) => /[0-9]/.test(value), 'Include at least one number.');

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const usernameUpdateSchema = z.object({ username: usernameSchema });

/**
 * Client-generated idempotency key for a match submission. The database column
 * is `uuid`, so the value must be a real UUID — a free-form string is rejected
 * by Postgres before the function body runs.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidSchema = z.string().regex(UUID_PATTERN, 'Not a valid identifier.');

/**
 * Generates a UUID v4 for idempotency keys, falling back to a random-bytes
 * implementation where `crypto.randomUUID` is unavailable (older WebViews over
 * plain HTTP, which is exactly the Android browser case this game targets).
 */
export function createUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const matchSubmissionSchema = z.object({
  clientMatchId: uuidSchema,
  mode: z.enum(['survival', 'deathmatch', 'operations']),
  waveReached: z.number().int().min(0).max(1000),
  eliminations: z.number().int().min(0).max(100000),
  deaths: z.number().int().min(0).max(1000),
  damageDealt: z.number().int().min(0).max(100_000_000),
  shotsFired: z.number().int().min(0).max(10_000_000),
  shotsHit: z.number().int().min(0).max(10_000_000),
  survivalSeconds: z.number().int().min(0).max(86_400),
  // `extracted` is the Operations outcome. It is accepted here so the mode can
  // report its real result rather than being flattened into `victory`.
  outcome: z.enum(['victory', 'defeat', 'extracted', 'abandoned']),
  bossDefeated: z.boolean(),
  adapted: z.boolean(),
  /** Operations: objectives completed, and whether the player extracted. */
  objectivesCompleted: z.number().int().min(0).max(64).default(0),
  extracted: z.boolean().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export interface FieldErrors {
  [field: string]: string;
}

/** Flattens a ZodError into `{ field: firstMessage }` for form rendering. */
export function collectFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** Runs a schema and returns either data or a field-error map — never throws. */
export function validate<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: collectFieldErrors(parsed.error) };
}
