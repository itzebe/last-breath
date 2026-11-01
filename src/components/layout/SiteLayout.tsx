import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui';
import { initialsFrom } from '@/lib/format';

/**
 * The LAST BREATH mark.
 *
 * A hexagonal containment frame around a descending "breath" waveform: the
 * arena's silhouette and the game's premise in one glyph. Drawn as inline SVG
 * so it stays crisp at any size and costs no request.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="nav__mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="LAST BREATH"
      focusable="false"
    >
      {/* Containment frame */}
      <polygon
        points="20,2 36,11 36,29 20,38 4,29 4,11"
        fill="none"
        stroke="var(--signal)"
        strokeWidth="2"
      />
      {/* Waveform: a decaying breath */}
      <polyline
        points="9,21 13,21 15.5,14 18.5,27 21,17 23.5,23 26,21 31,21"
        fill="none"
        stroke="var(--telemetry)"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="nav__brand" aria-label="LAST BREATH — home">
      <BrandMark size={compact ? 28 : 34} />
      <span>
        <span className="nav__wordmark">Last Breath</span>
        <span className="nav__tagline">Survive the adaptation</span>
      </span>
    </Link>
  );
}

export function AppNav() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="nav">
      <nav className="shell nav__inner" aria-label="Primary">
        <BrandLockup />

        <div className="nav__spacer" />

        <div className="nav__links">
          {user ? (
            <>
              <NavLink to="/dashboard" className="nav__link">
                Dashboard
              </NavLink>
              <NavLink to="/leaderboard" className="nav__link">
                Leaderboard
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end className="nav__link">
                Overview
              </NavLink>
              <a href="/#arsenal" className="nav__link">
                Arsenal
              </a>
              <a href="/#adaptation" className="nav__link">
                Adaptation
              </a>
            </>
          )}
        </div>

        <div className="nav__actions">
          {user ? (
            <>
              <span className="badge badge--telemetry" title="Signed in">
                {initialsFrom(profile?.username ?? 'operator')}
              </span>
              <Button variant="ghost" onClick={handleSignOut} loading={signingOut} loadingLabel="Exiting">
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate('/login')}>
                Log in
              </Button>
              <Button variant="primary" onClick={() => navigate('/register')}>
                Register
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer__grid">
          <div>
            <BrandLockup compact />
            <p className="text-3" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-4)', maxWidth: '46ch' }}>
              A top-down survival shooter where the arena studies how you fight. There is no fixed
              strategy — only the one the enemy has not learned yet.
            </p>
          </div>
          <div>
            <h2 className="footer__title">Play</h2>
            <ul className="footer__list">
              <li>
                <Link to="/register">Create account</Link>
              </li>
              <li>
                <Link to="/login">Log in</Link>
              </li>
              <li>
                <Link to="/dashboard">Dashboard</Link>
              </li>
              <li>
                <Link to="/leaderboard">Leaderboard</Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="footer__title">Systems</h2>
            <ul className="footer__list">
              <li>
                <a href="/#adaptation">Adaptive AI</a>
              </li>
              <li>
                <a href="/#arsenal">Arsenal</a>
              </li>
              <li>
                <a href="/#how-to-play">How to play</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer__legal">
          <span>LAST BREATH — competition build. Original visual identity, procedural art and audio.</span>
          <span className="mono">v0.1.0 · Part 4</span>
        </div>
      </div>
    </footer>
  );
}

/** Standard page frame: nav, main, footer. */
export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppNav />
      <main id="main">{children}</main>
      <AppFooter />
    </div>
  );
}
