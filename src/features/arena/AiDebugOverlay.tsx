import type { BehaviourTraits } from '@/game/logic/behaviour';
import {
  describeDirective,
  type AdaptationLogEntry,
  type TacticalDirective,
} from '@/game/logic/tacticalDirector';
import { formatClock } from '@/lib/format';

/**
 * The AI debug overlay.
 *
 * Optional, and off by default: the normal player experience should not expose
 * this. It exists so the adaptation is *auditable* — a judge (or a developer)
 * can see exactly what the arena believes about the player, what it decided, and
 * when it decided it.
 *
 * Every number shown here is the same number the enemies act on. Nothing is
 * recomputed for display.
 */

export interface AiDebugOverlayProps {
  traits: BehaviourTraits;
  directive: TacticalDirective;
  history: readonly AdaptationLogEntry[];
  adaptationEnabled: boolean;
  onClose: () => void;
}

interface TraitRow {
  label: string;
  value: number;
  hint: string;
}

function traitRows(traits: BehaviourTraits): TraitRow[] {
  return [
    { label: 'Mobility', value: traits.mobility, hint: 'how much the player moves' },
    { label: 'Stationary', value: traits.stationarity, hint: 'how much the player holds still' },
    { label: 'Aggression', value: traits.aggression, hint: 'closing distance while firing' },
    { label: 'Defensive', value: traits.defensiveness, hint: 'keeping distance, breaking contact' },
    { label: 'Ranged pref', value: traits.rangedPreference, hint: 'engagement distance' },
    { label: 'Fire volume', value: traits.fireVolume, hint: 'shots per second' },
    { label: 'Predictable', value: traits.predictability, hint: 'repeated turn direction' },
    { label: 'Reload rate', value: traits.reloadFrequency, hint: 'reloads per minute' },
  ];
}

export function AiDebugOverlay({
  traits,
  directive,
  history,
  adaptationEnabled,
  onClose,
}: AiDebugOverlayProps) {
  const recent = [...history].slice(-6).reverse();

  return (
    <aside className="ai-debug" aria-label="Adaptive AI debug overlay">
      <header className="ai-debug__head">
        <span>AI debug · {adaptationEnabled ? 'adapting' : 'frozen'}</span>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          style={{ minHeight: 24, width: 24, fontSize: 'var(--fs-sm)' }}
          onClick={onClose}
          aria-label="Close AI debug overlay"
        >
          ×
        </button>
      </header>

      <section className="ai-debug__section">
        <h4>Detected player behaviour · {traits.observedSeconds.toFixed(1)}s observed</h4>
        {traitRows(traits).map((row) => (
          <div className="ai-debug__trait" key={row.label} title={row.hint}>
            <span>{row.label}</span>
            <span className="ai-debug__meter">
              <i style={{ width: `${Math.round(row.value * 100)}%` }} />
            </span>
            <span>{row.value.toFixed(2)}</span>
          </div>
        ))}
      </section>

      <section className="ai-debug__section">
        <h4>Current tactical assessment</h4>
        <p className="ai-debug__reading">
          {directive.profile.name.toUpperCase()} · confidence{' '}
          {(directive.profile.confidence * 100).toFixed(0)}%
        </p>
        <p style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{directive.profile.reading}</p>
      </section>

      <section className="ai-debug__section">
        <h4>Selected enemy strategy</h4>
        <p className="ai-debug__reading">{describeDirective(directive)}</p>
        <div className="ai-debug__trait">
          <span>Range mult</span>
          <span className="ai-debug__meter">
            <i
              style={{
                width: `${Math.min(100, Math.max(0, (directive.rangeMultiplier - 0.6) / 0.8 * 100))}%`,
                background: 'var(--signal)',
              }}
            />
          </span>
          <span>×{directive.rangeMultiplier.toFixed(2)}</span>
        </div>
        <div className="ai-debug__trait">
          <span>Pressure</span>
          <span className="ai-debug__meter">
            <i style={{ width: `${Math.round(directive.pressure * 100)}%`, background: 'var(--hostile)' }} />
          </span>
          <span>{directive.pressure.toFixed(2)}</span>
        </div>
        <div className="ai-debug__trait">
          <span>Coordination</span>
          <span className="ai-debug__meter">
            <i style={{ width: `${Math.round(directive.coordination * 100)}%`, background: 'var(--xp)' }} />
          </span>
          <span>{directive.coordination.toFixed(2)}</span>
        </div>
      </section>

      <section className="ai-debug__section">
        <h4>Adaptation history</h4>
        {recent.length === 0 ? (
          <p style={{ color: 'var(--ink-4)' }}>No change committed yet.</p>
        ) : (
          <ul className="ai-debug__log">
            {recent.map((record, index) => (
              <li key={`${record.atMs}-${index}`}>
                <time>{formatClock(record.atMs)}</time>
                <span>
                  <strong style={{ color: 'var(--signal)' }}>{record.profileName.toUpperCase()}</strong>{' '}
                  — {record.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
