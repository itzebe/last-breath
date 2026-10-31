import type { ReactNode } from 'react';

/* ── Button ───────────────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'telemetry' | 'danger';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  /** Text shown while `loading` is true, replacing the children. */
  loadingLabel?: string;
}

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  loading = false,
  loadingLabel,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'lg' ? 'btn--lg' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <span className="btn__spinner" aria-hidden="true" />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export interface PanelProps {
  children: ReactNode;
  title?: ReactNode;
  /** Rendered at the top-right of the panel head, beside the title. */
  action?: ReactNode;
  tone?: 'default' | 'signal' | 'telemetry' | 'hostile';
  flush?: boolean;
  tight?: boolean;
  className?: string;
  /** Accessible name when there is no visible title. */
  ariaLabel?: string;
  id?: string;
}

export function Panel({
  children,
  title,
  action,
  tone = 'default',
  flush = false,
  tight = false,
  className = '',
  ariaLabel,
  id,
}: PanelProps) {
  const classes = [
    'panel',
    tone !== 'default' ? `panel--${tone}` : '',
    flush ? 'panel--flush' : '',
    tight ? 'panel--tight' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const headingId = title && id ? `${id}-title` : undefined;

  return (
    <section className={classes} aria-label={title ? undefined : ariaLabel} aria-labelledby={headingId} id={id}>
      {title ? (
        <header className="panel-head">
          <h2 className="panel-head__title" id={headingId}>
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/* ── Field ────────────────────────────────────────────────────────────────── */

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Renders the label as a machine-readable telemetry label. */
  monoLabel?: boolean;
}

export function Field({ label, error, hint, id, className = '', monoLabel = true, ...rest }: FieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={inputId} style={monoLabel ? undefined : { fontFamily: 'var(--font-body)', fontSize: 'var(--fs-sm)', letterSpacing: 0 }}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className="field__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
      />
      {hint && !error ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ── Alert ────────────────────────────────────────────────────────────────── */

export interface AlertProps {
  tone?: 'error' | 'success' | 'info' | 'warn';
  children: ReactNode;
  /** Rendered as the alert's accessible role. Errors are assertive by default. */
  role?: 'alert' | 'status';
  className?: string;
}

const ALERT_GLYPH: Record<NonNullable<AlertProps['tone']>, string> = {
  error: '!',
  success: '✓',
  info: 'i',
  warn: '!',
};

export function Alert({ tone = 'info', children, role, className = '' }: AlertProps) {
  const resolvedRole = role ?? (tone === 'error' ? 'alert' : 'status');
  return (
    <div className={`alert alert--${tone} ${className}`.trim()} role={resolvedRole}>
      <span className="alert__icon" aria-hidden="true">
        {ALERT_GLYPH[tone]}
      </span>
      <div>{children}</div>
    </div>
  );
}

/* ── Stat ─────────────────────────────────────────────────────────────────── */

export interface StatProps {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: 'default' | 'signal' | 'vital' | 'ammo' | 'xp' | 'telemetry' | 'hostile';
}

export function Stat({ label, value, meta, tone = 'default' }: StatProps) {
  return (
    <div className={`stat ${tone !== 'default' ? `stat--${tone}` : ''}`.trim()}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {meta ? <span className="stat__meta">{meta}</span> : null}
    </div>
  );
}

/* ── Bar ──────────────────────────────────────────────────────────────────── */

export interface BarProps {
  /** 0–1. Values outside the range are clamped. */
  value: number;
  tone?: 'signal' | 'vital' | 'ammo' | 'xp' | 'hostile';
  label: string;
  tall?: boolean;
  /** Rendered to the right of the bar. */
  suffix?: ReactNode;
}

export function Bar({ value, tone = 'signal', label, tall = false, suffix }: BarProps) {
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  return (
    <div className="stack gap-2">
      <div className="between">
        <span className="stat__label">{label}</span>
        {suffix ? <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-2)' }}>{suffix}</span> : null}
      </div>
      <div
        className={`bar ${tall ? 'bar--tall' : ''}`.trim()}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`bar__fill bar__fill--${tone}`} style={{ width: `${clamped * 100}%` }} />
      </div>
    </div>
  );
}

/* ── Badge ────────────────────────────────────────────────────────────────── */

export interface BadgeProps {
  children: ReactNode;
  tone?: 'default' | 'signal' | 'vital' | 'ammo' | 'xp' | 'hostile' | 'telemetry';
  locked?: boolean;
}

export function Badge({ children, tone = 'default', locked = false }: BadgeProps) {
  return (
    <span className={`badge ${tone !== 'default' ? `badge--${tone}` : ''} ${locked ? 'badge--locked' : ''}`.trim()}>
      {children}
    </span>
  );
}

/* ── EmptyState ───────────────────────────────────────────────────────────── */

export interface EmptyStateProps {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */

export function Skeleton({ height = 20, width = '100%' }: { height?: number | string; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/* ── Toggle ───────────────────────────────────────────────────────────────── */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

export function Toggle({ checked, onChange, label, id }: ToggleProps) {
  const inputId = id ?? `toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label className="toggle" htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

/* ── Divider ──────────────────────────────────────────────────────────────── */

export function Divider({ children }: { children?: ReactNode }) {
  return <div className="divider">{children}</div>;
}

/* ── Spinner (page-level loading) ─────────────────────────────────────────── */

export function LoadingScreen({ message = 'Loading' }: { message?: string }) {
  return (
    <div
      className="stack center gap-4"
      style={{ padding: 'var(--sp-11) var(--sp-5)', alignItems: 'center' }}
      role="status"
      aria-live="polite"
    >
      <span className="btn__spinner" style={{ width: 28, height: 28, color: 'var(--signal)' }} aria-hidden="true" />
      <p className="eyebrow eyebrow--signal">{message}</p>
    </div>
  );
}
