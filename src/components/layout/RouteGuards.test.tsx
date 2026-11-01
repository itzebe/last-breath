/**
 * Protected-route behaviour.
 *
 * `RequireAuth` decides whether an unauthenticated visitor reaches `/arena`,
 * `/dashboard` or `/leaderboard`. Getting this wrong either locks players out of
 * their own game or exposes the arena to signed-out visitors, so the three states
 * it distinguishes — restoring, signed out, signed in — are each asserted.
 *
 * The auth context is mocked here on purpose: the guard is pure branching on
 * `useAuth`, and the real provider can only reach the "signed in" state through a
 * live Supabase session. Mocking the context isolates the branch under test
 * without pretending any game behaviour works differently than it does.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth, RedirectIfAuthenticated } from '@/components/layout/RouteGuards';

const authState = {
  user: null as unknown,
  initialising: false,
  misconfigured: false,
};

vi.mock('@/app/AuthContext', () => ({
  useAuth: () => authState,
}));

function renderProtected(initialPath = '/arena') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<p>login screen</p>} />
        <Route element={<RequireAuth />}>
          <Route path="/arena" element={<p>arena screen</p>} />
          <Route path="/dashboard" element={<p>dashboard screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.user = null;
  authState.initialising = false;
  authState.misconfigured = false;
});

describe('RequireAuth', () => {
  it('sends a signed-out visitor to the login screen', () => {
    renderProtected('/arena');
    expect(screen.getByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('arena screen')).not.toBeInTheDocument();
  });

  it('lets a signed-in player into the arena', () => {
    authState.user = { id: 'user-1' };
    renderProtected('/arena');
    expect(screen.getByText('arena screen')).toBeInTheDocument();
  });

  it('shows a restoring screen rather than redirecting while the session loads', () => {
    // Redirecting during restore would bounce a signed-in player to /login on
    // every refresh, so this state must not navigate.
    authState.initialising = true;
    renderProtected('/arena');
    expect(screen.getByText(/restoring session/i)).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  it('reports a missing Supabase configuration instead of a login redirect', () => {
    authState.misconfigured = true;
    renderProtected('/dashboard');
    expect(screen.getByText(/configuration required/i)).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });
});

describe('RedirectIfAuthenticated', () => {
  it('keeps a signed-in player off the auth screens', () => {
    authState.user = { id: 'user-1' };
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/dashboard" element={<p>dashboard screen</p>} />
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<p>login screen</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('dashboard screen')).toBeInTheDocument();
  });
});
