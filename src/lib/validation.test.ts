import { describe, expect, it } from 'vitest';
import {
  collectFieldErrors,
  createUuid,
  forgotPasswordSchema,
  loginSchema,
  matchSubmissionSchema,
  registerSchema,
  RESERVED_USERNAMES,
  resetPasswordSchema,
  usernameSchema,
  uuidSchema,
  validate,
} from '@/lib/validation';

const VALID_REGISTRATION = {
  email: 'operator@example.com',
  username: 'Vega_7',
  password: 'orbital-decay-7',
  confirmPassword: 'orbital-decay-7',
};

describe('username schema', () => {
  it('accepts a normal callsign', () => {
    expect(usernameSchema.safeParse('Vega_7').success).toBe(true);
    expect(usernameSchema.safeParse('abc').success).toBe(true);
    expect(usernameSchema.safeParse('a'.repeat(20)).success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = usernameSchema.safeParse('  Vega  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('Vega');
  });

  it('rejects names that are too short or too long', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });

  it('rejects characters that could confuse or break rendering', () => {
    for (const bad of ['has space', 'has-dash', 'has.dot', 'emoji😀', '<script>', 'quo"te']) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects leading and trailing underscores', () => {
    expect(usernameSchema.safeParse('_vega').success).toBe(false);
    expect(usernameSchema.safeParse('vega_').success).toBe(false);
    expect(usernameSchema.safeParse('ve_ga').success).toBe(true);
  });

  it('rejects reserved names case-insensitively', () => {
    for (const reserved of RESERVED_USERNAMES) {
      expect(usernameSchema.safeParse(reserved).success, reserved).toBe(false);
      expect(usernameSchema.safeParse(reserved.toUpperCase()).success, reserved).toBe(false);
    }
  });

  it('rejects the empty string', () => {
    expect(usernameSchema.safeParse('').success).toBe(false);
  });
});

describe('email schema', () => {
  it('accepts valid addresses', () => {
    for (const email of ['a@b.co', 'operator.name+tag@example.co.uk', 'x@y.io']) {
      expect(loginSchema.safeParse({ email, password: 'x' }).success, email).toBe(true);
    }
  });

  it('rejects malformed addresses', () => {
    for (const email of ['', 'no-at-sign', 'two@@at.com', 'trailing@', '@leading.com', 'space in@mail.com']) {
      expect(loginSchema.safeParse({ email, password: 'x' }).success, email).toBe(false);
    }
  });

  it('rejects an absurdly long address', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(forgotPasswordSchema.safeParse({ email: long }).success).toBe(false);
  });
});

describe('password schema', () => {
  const check = (password: string) =>
    resetPasswordSchema.safeParse({ password, confirmPassword: password }).success;

  it('accepts a long passphrase containing a letter and a number', () => {
    expect(check('orbital-decay-7')).toBe(true);
    expect(check('a1'.repeat(6))).toBe(true);
  });

  it('rejects passwords shorter than 10 characters', () => {
    expect(check('short1')).toBe(false);
  });

  it('rejects passwords longer than 72 characters', () => {
    // 72 is bcrypt's practical input limit.
    expect(check(`a1${'x'.repeat(71)}`)).toBe(false);
    expect(check(`a1${'x'.repeat(70)}`)).toBe(true);
  });

  it('requires at least one letter', () => {
    expect(check('1234567890')).toBe(false);
  });

  it('requires at least one number', () => {
    expect(check('onlyletters')).toBe(false);
  });

  it('accepts passphrases with symbols and spaces', () => {
    expect(check('correct horse 9 battery')).toBe(true);
  });
});

describe('register schema', () => {
  it('accepts a complete, valid registration', () => {
    expect(registerSchema.safeParse(VALID_REGISTRATION).success).toBe(true);
  });

  it('rejects mismatched passwords and points at the confirm field', () => {
    const result = registerSchema.safeParse({
      ...VALID_REGISTRATION,
      confirmPassword: 'different-pass-9',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = collectFieldErrors(result.error);
      expect(errors.confirmPassword).toBe('Passwords do not match.');
    }
  });

  it('reports every invalid field at once, not just the first', () => {
    const result = registerSchema.safeParse({
      email: 'bad',
      username: 'x',
      password: 'short',
      confirmPassword: 'nope',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = collectFieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(
        ['confirmPassword', 'email', 'password', 'username'].sort(),
      );
    }
  });
});

describe('collectFieldErrors', () => {
  it('keeps only the first message per field', () => {
    const result = registerSchema.safeParse({ ...VALID_REGISTRATION, username: 'a' });
    if (result.success) throw new Error('expected failure');
    const errors = collectFieldErrors(result.error);
    expect(typeof errors.username).toBe('string');
    // One message, not a concatenation of every constraint it failed.
    expect(errors.username).toBe('Use at least 3 characters.');
  });
});

describe('validate helper', () => {
  it('returns parsed data on success', () => {
    const outcome = validate(loginSchema, { email: 'a@b.co', password: 'x' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data.email).toBe('a@b.co');
  });

  it('returns field errors on failure without throwing', () => {
    const outcome = validate(loginSchema, { email: 'nope', password: '' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.email).toBeDefined();
      expect(outcome.errors.password).toBeDefined();
    }
  });

  it('handles completely wrong input types', () => {
    expect(validate(loginSchema, null).ok).toBe(false);
    expect(validate(loginSchema, 42).ok).toBe(false);
    expect(validate(loginSchema, 'string').ok).toBe(false);
  });
});

describe('createUuid', () => {
  it('produces a value accepted by uuidSchema', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(uuidSchema.safeParse(createUuid()).success).toBe(true);
    }
  });

  it('produces unique values', () => {
    const seen = new Set(Array.from({ length: 500 }, () => createUuid()));
    expect(seen.size).toBe(500);
  });

  it('sets the version and variant nibbles required by RFC 4122', () => {
    for (let i = 0; i < 20; i += 1) {
      const id = createUuid();
      expect(id[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(id[19].toLowerCase());
    }
  });

  it('falls back to random bytes when crypto.randomUUID is unavailable', () => {
    const real = globalThis.crypto;
    // Simulate an older WebView that exposes getRandomValues but not randomUUID.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) },
    });
    try {
      const id = createUuid();
      expect(uuidSchema.safeParse(id).success).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });
});

describe('matchSubmissionSchema', () => {
  const valid = {
    clientMatchId: '3f1a9c2e-8b47-4d61-9f03-2c5e7a1b8d40',
    mode: 'survival' as const,
    waveReached: 5,
    eliminations: 23,
    deaths: 1,
    damageDealt: 1840,
    shotsFired: 120,
    shotsHit: 78,
    survivalSeconds: 142,
    outcome: 'defeat' as const,
    bossDefeated: false,
    adapted: true,
  };

  it('accepts a well-formed submission', () => {
    expect(matchSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a non-UUID idempotency key', () => {
    // The exact shape the arena used to generate: a composed string.
    const composed = `fb5525e2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = matchSubmissionSchema.safeParse({ ...valid, clientMatchId: composed });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown mode or outcome', () => {
    expect(matchSubmissionSchema.safeParse({ ...valid, mode: 'coop' }).success).toBe(false);
    expect(matchSubmissionSchema.safeParse({ ...valid, outcome: 'maybe' }).success).toBe(false);
  });

  it('rejects negative and non-integer counters', () => {
    expect(matchSubmissionSchema.safeParse({ ...valid, eliminations: -1 }).success).toBe(false);
    expect(matchSubmissionSchema.safeParse({ ...valid, waveReached: 2.5 }).success).toBe(false);
  });

  it('rejects physically impossible survival durations', () => {
    expect(matchSubmissionSchema.safeParse({ ...valid, survivalSeconds: 86_401 }).success).toBe(false);
  });

  it('accepts a victory submission', () => {
    expect(
      matchSubmissionSchema.safeParse({ ...valid, outcome: 'victory', waveReached: 30 }).success,
    ).toBe(true);
  });

  it('requires the two run-level facts the server cannot derive', () => {
    const { bossDefeated: _boss, adapted: _adapted, ...without } = valid;
    expect(matchSubmissionSchema.safeParse(without).success).toBe(false);
  });

  it('accepts a run that defeated the boss and adapted', () => {
    expect(
      matchSubmissionSchema.safeParse({ ...valid, bossDefeated: true, adapted: true }).success,
    ).toBe(true);
  });
});
