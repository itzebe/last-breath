import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ToastProvider } from './ToastContext';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireAuth, RedirectIfAuthenticated } from '@/components/layout/RouteGuards';
import { LandingPage } from '@/features/landing/LandingPage';
import {
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from '@/features/auth/AuthPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage';
import { ArenaPage } from '@/features/arena/ArenaPage';
import { NotFoundPage } from './NotFoundPage';

/**
 * Application routes.
 *
 * The landing page is public. Everything that touches player data or gameplay is
 * wrapped in `RequireAuth`, which distinguishes "still restoring the session"
 * from "signed out" so a refresh never bounces a signed-in player to the login
 * screen.
 */
export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* ── Public ─────────────────────────────────────────────── */}
            <Route path="/" element={<LandingPage />} />

            {/* ── Auth screens (redirect away when already signed in) ── */}
            <Route element={<RedirectIfAuthenticated />}>
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>

            {/* Password recovery must work while a recovery session exists, so
                it is not behind the "already authenticated" redirect. */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* ── Protected ──────────────────────────────────────────── */}
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/arena" element={<ArenaPage />} />
            </Route>

            {/* Legacy/alias: /play is the same arena. */}
            <Route path="/play" element={<Navigate to="/arena" replace />} />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
