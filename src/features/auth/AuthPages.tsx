import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Panel } from '@/components/ui';
import { BrandLockup } from '@/components/layout/SiteLayout';
import { useAuth } from '@/app/AuthContext';
import { isUsernameAvailable } from '@/services/profileService';
import {
  collectFieldErrors,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  usernameSchema,
  type FieldErrors,
} from '@/lib/validation';

/* ── Shared chrome ────────────────────────────────────────────────────────── */

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__head">
          <BrandLockup compact />
        </div>
        <Panel ariaLabel={title}>
          <h1 className="auth-card__title">{title}</h1>
          <p className="auth-card__sub">{subtitle}</p>
          <div style={{ marginTop: 'var(--sp-6)' }}>{children}</div>
        </Panel>
      </div>
    </div>
  );
}

/* ── Registration ─────────────────────────────────────────────────────────── */

export function RegisterPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [values, setValues] = useState({ email: '', username: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormError(null);
  };

  // Debounced availability check. Advisory only — the unique constraint in the
  // database is the authority, and a race resolves to a clean sign-up error.
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const candidate = values.username.trim();
    const parsed = usernameSchema.safeParse(candidate);
    if (!candidate || !parsed.success) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    checkTimer.current = setTimeout(() => {
      isUsernameAvailable(candidate)
        .then((available) => setUsernameStatus(available ? 'free' : 'taken'))
        .catch(() => setUsernameStatus('idle'));
    }, 420);
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [values.username]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const parsed = registerSchema.safeParse(values);
      if (!parsed.success) {
        setErrors(collectFieldErrors(parsed.error));
        return;
      }
      setErrors({});

      if (usernameStatus === 'taken') {
        setErrors({ username: 'That callsign is already taken. Choose another.' });
        return;
      }

      setSubmitting(true);
      try {
        const result = await signUp(parsed.data.email, parsed.data.password, parsed.data.username);
        if (result.needsEmailConfirmation) {
          setConfirmationSent(true);
        } else {
          navigate('/dashboard', { replace: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not create your account.';
        setFormError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [values, usernameStatus, signUp, navigate],
  );

  if (confirmationSent) {
    return (
      <AuthShell title="Confirm your email" subtitle="One step left before the arena opens.">
        <Alert tone="success">
          <p>
            We sent a confirmation link to <strong>{values.email}</strong>. Open it to activate your
            operator profile, then log in.
          </p>
        </Alert>
        <div className="auth-form__foot">
          <p>
            Nothing arrived? Check the spam folder, or <Link to="/login">log in</Link> once it lands —
            you can resend the link from the login screen.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Register operator"
      subtitle="Choose a callsign. It appears on the global leaderboard."
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update('email')}
          error={errors.email}
          placeholder="operator@example.com"
        />

        <Field
          label="Callsign"
          name="username"
          autoComplete="username"
          required
          value={values.username}
          onChange={update('username')}
          error={errors.username}
          aria-invalid={errors.username ? true : undefined}
          hint={
            usernameStatus === 'checking'
              ? 'Checking availability…'
              : usernameStatus === 'free'
                ? 'Available.'
                : usernameStatus === 'taken'
                  ? 'Already taken.'
                  : '3–20 characters. Letters, numbers and underscores.'
          }
          placeholder="Vega"
        />

        <Field
          label="Password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={update('password')}
          error={errors.password}
          hint="At least 10 characters, including a letter and a number."
        />

        <Field
          label="Confirm password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={values.confirmPassword}
          onChange={update('confirmPassword')}
          error={errors.confirmPassword}
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting} loadingLabel="Creating account">
          Create account
        </Button>
      </form>

      <div className="auth-form__foot">
        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-4)' }}>
          Passwords are handled by Supabase Auth. LAST BREATH never stores or sees them.
        </p>
      </div>
    </AuthShell>
  );
}

/* ── Login ────────────────────────────────────────────────────────────────── */

export function LoginPage() {
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const { signIn, resendConfirmation } = useAuth();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resent, setResent] = useState(false);

  const update = (key: 'email' | 'password') => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormError(null);
    setNeedsConfirmation(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      navigate(returnPath ?? '/dashboard', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign you in.';
      setFormError(message);
      if (/confirm your email/i.test(message)) setNeedsConfirmation(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendConfirmation(values.email);
      setResent(true);
    } catch {
      setResent(false);
    }
  };

  return (
    <AuthShell title="Log in" subtitle="Return to the arena with your operator profile.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {resent ? <Alert tone="success">Confirmation link sent. Check your inbox.</Alert> : null}

        {needsConfirmation && !resent ? (
          <Button variant="telemetry" block onClick={handleResend}>
            Resend confirmation email
          </Button>
        ) : null}

        <Field
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update('email')}
          error={errors.email}
          placeholder="operator@example.com"
        />

        <Field
          label="Password"
          type="password"
          name="current-password"
          autoComplete="current-password"
          required
          value={values.password}
          onChange={update('password')}
          error={errors.password}
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting} loadingLabel="Authenticating">
          Log in
        </Button>
      </form>

      <div className="auth-form__foot">
        <p>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p>
          No account yet? <Link to="/register">Register</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/** Reads the `from` redirect target stashed by the route guard, so a player who
 * was bounced to /login lands back where they intended. */
function useReturnPath(): string | null {
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  return state?.from ?? null;
}

/* ── Forgot password ──────────────────────────────────────────────────────── */

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await requestPasswordReset(parsed.data.email);
      setSent(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not send the reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="A reset link is on its way.">
        <Alert tone="success">
          <p>
            If an account exists for <strong>{email}</strong>, a password reset link has been sent. The
            link expires shortly, so use it soon.
          </p>
        </Alert>
        <div className="auth-form__foot">
          <p>
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password" subtitle="We will email you a link to set a new password.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setErrors({});
            setFormError(null);
          }}
          error={errors.email}
          placeholder="operator@example.com"
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting} loadingLabel="Sending">
          Send reset link
        </Button>
      </form>
      <div className="auth-form__foot">
        <p>
          Remembered it? <Link to="/login">Log in</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/* ── Reset password (from the email link) ─────────────────────────────────── */

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword, user, initialising } = useAuth();
  const [values, setValues] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await updatePassword(parsed.data.password);
      setDone(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not update your password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (initialising) {
    return (
      <AuthShell title="Verifying link" subtitle="Checking your reset token.">
        <Alert tone="info">Verifying…</Alert>
      </AuthShell>
    );
  }

  // A recovery link signs the user in temporarily. Without that session there is
  // nothing to update, so say so plainly instead of showing a form that will fail.
  if (!user && !done) {
    return (
      <AuthShell title="Link expired" subtitle="This reset link is no longer valid.">
        <Alert tone="warn">
          <p>
            Reset links expire quickly and can only be used once. Request a new one to continue.
          </p>
        </Alert>
        <div className="auth-form__foot">
          <p>
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="Your new password is active.">
        <Alert tone="success">
          <p>You are signed in with the new password. Enter the arena whenever you are ready.</p>
        </Alert>
        <div className="auth-form__foot">
          <Button variant="primary" block onClick={() => navigate('/dashboard', { replace: true })}>
            Go to dashboard
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose something you have not used here before.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={(event) => {
            setValues((current) => ({ ...current, password: event.target.value }));
            setErrors({});
          }}
          error={errors.password}
          hint="At least 10 characters, including a letter and a number."
        />
        <Field
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={values.confirmPassword}
          onChange={(event) => {
            setValues((current) => ({ ...current, confirmPassword: event.target.value }));
            setErrors({});
          }}
          error={errors.confirmPassword}
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting} loadingLabel="Updating">
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

/* ── Email confirmation callback ──────────────────────────────────────────── */

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { user, initialising } = useAuth();
  const [status, setStatus] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState('Confirming your email address…');

  useEffect(() => {
    if (initialising) return;
    if (user) {
      setStatus('ok');
      setMessage('Your email address is confirmed. Welcome to the arena.');
      const timer = setTimeout(() => navigate('/dashboard', { replace: true }), 1400);
      return () => clearTimeout(timer);
    }
    setStatus('failed');
    setMessage(
      'That confirmation link is invalid or has already been used. Try logging in — if your address is confirmed you will go straight through.',
    );
    return undefined;
  }, [initialising, user, navigate]);

  return (
    <AuthShell title="Email confirmation" subtitle="Completing your registration.">
      <Alert tone={status === 'failed' ? 'warn' : status === 'ok' ? 'success' : 'info'}>{message}</Alert>
      <div className="auth-form__foot">
        {status === 'failed' ? (
          <Button variant="primary" block onClick={() => navigate('/login', { replace: true })}>
            Go to log in
          </Button>
        ) : null}
        {status === 'ok' ? (
          <Button variant="telemetry" block onClick={() => navigate('/dashboard', { replace: true })}>
            Continue to dashboard
          </Button>
        ) : null}
      </div>
    </AuthShell>
  );
}
