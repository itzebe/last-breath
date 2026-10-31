import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toAppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('error-boundary');

interface Props {
  children: ReactNode;
  /** Rendered instead of the fallback when provided. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures so a single broken panel cannot blank the whole
 * application. The message shown is the safe, user-facing one; the technical
 * detail is logged, never rendered.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('Unhandled render error', {
      message: error.message,
      componentStack: info.componentStack ?? '',
    });
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const appError = toAppError(error);
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <section className="panel panel--hostile" aria-labelledby="crash-title">
            <p className="eyebrow eyebrow--signal">System fault</p>
            <h1 className="auth-card__title" id="crash-title" style={{ marginTop: 'var(--sp-3)' }}>
              Something broke
            </h1>
            <p className="auth-card__sub">{appError.userMessage}</p>
            <div className="alert alert--error" style={{ marginTop: 'var(--sp-5)' }}>
              <span className="alert__icon" aria-hidden="true">
                !
              </span>
              <div>
                <p>
                  The interface hit an unexpected error. Reloading usually clears it; if it keeps
                  happening, the technical detail is in the browser console.
                </p>
              </div>
            </div>
            <div className="cluster gap-3" style={{ marginTop: 'var(--sp-5)' }}>
              <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
                Reload
              </button>
              <button type="button" className="btn btn--ghost" onClick={this.reset}>
                Try again
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }
}
