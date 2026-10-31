import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { LoadingScreen, Panel, Alert } from '@/components/ui';
import { BrandLockup } from './SiteLayout';

/**
 * Route protection.
 *
 * Three distinct states, deliberately not collapsed into one:
 *   - still restoring the persisted session → show a loader, never redirect
 *     (redirecting here would bounce a signed-in player to /login on refresh)
 *   - no session → redirect to /login, remembering where they were going
 *   - session present → render the protected route
 */
export function RequireAuth() {
  const { user, initialising, misconfigured } = useAuth();
  const location = useLocation();

  if (misconfigured) {
    return <ConfigNotice />;
  }

  if (initialising) {
    return (
      <div className="auth-shell">
        <LoadingScreen message="Restoring session" />
      </div>
    );
  }

  if (!user) {
    // `state.from` lets the login page send the player back where they intended.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

/** Sends already-authenticated players away from the auth screens. */
export function RedirectIfAuthenticated() {
  const { user, initialising, misconfigured } = useAuth();

  if (misconfigured) return <ConfigNotice />;
  if (initialising) {
    return (
      <div className="auth-shell">
        <LoadingScreen message="Restoring session" />
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

/**
 * Shown when the build has no Supabase credentials. This is a configuration
 * fault, not a user error, so it states exactly what is missing rather than
 * failing with a network error later.
 */
export function ConfigNotice() {
  return (
    <div className="auth-shell">
      <Panel tone="hostile" className="auth-card" ariaLabel="Configuration required">
        <BrandLockup compact />
        <h1 className="auth-card__title" style={{ marginTop: 'var(--sp-6)' }}>
          Configuration required
        </h1>
        <p className="auth-card__sub" style={{ marginBottom: 'var(--sp-5)' }}>
          This build has no Supabase project configured, so accounts and gameplay records cannot be
          created. The arena and all game systems are present — they need a database to persist to.
        </p>
        <Alert tone="warn">
          <p style={{ marginBottom: 'var(--sp-3)' }}>
            Create a file named <code className="mono">.env.local</code> in the project root with:
          </p>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 'var(--sp-3)',
              background: 'var(--surface-inset)',
              border: 'var(--border-hair)',
              fontSize: 'var(--fs-xs)',
              overflowX: 'auto',
            }}
          >{`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>`}</pre>
          <p style={{ marginTop: 'var(--sp-3)' }}>
            Then apply the migrations in <code className="mono">supabase/migrations/</code> and restart
            the dev server. See <code className="mono">.env.example</code> and{' '}
            <code className="mono">README.md</code>.
          </p>
        </Alert>
      </Panel>
    </div>
  );
}
