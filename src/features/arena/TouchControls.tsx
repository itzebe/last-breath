import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vec2 } from '@/game/logic/vec';

/**
 * A virtual thumb stick.
 *
 * Reports a vector in the range −1…1 on both axes. Two behaviours matter for
 * playability on a phone:
 *
 *   - the stick tracks the pointer even when it leaves the pad, so a fast thumb
 *     swipe does not silently drop the input mid-fight;
 *   - the knob is clamped to the pad radius, so the vector magnitude stays
 *     meaningful (a full deflection is always exactly 1).
 */
export interface ThumbStickProps {
  label: string;
  variant: 'move' | 'aim';
  /** Called continuously while the stick is held. */
  onChange: (vector: Vec2) => void;
  /** Called when the stick is released, with the final vector. */
  onRelease?: () => void;
  disabled?: boolean;
}

export function ThumbStick({ label, variant, onChange, onRelease, disabled = false }: ThumbStickProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const pointerId = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  const setKnob = useCallback((x: number, y: number) => {
    const knob = knobRef.current;
    if (!knob) return;
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }, []);

  const computeVector = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const zone = zoneRef.current;
      if (!zone) return { x: 0, y: 0 };
      const rect = zone.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const radius = rect.width / 2;

      let dx = clientX - centreX;
      let dy = clientY - centreY;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) {
        dx = (dx / distance) * radius;
        dy = (dy / distance) * radius;
      }
      setKnob(dx, dy);
      // Divide by the radius so a full deflection is 1.0, not the pixel radius.
      return { x: dx / radius, y: dy / radius };
    },
    [setKnob],
  );

  const release = useCallback(() => {
    pointerId.current = null;
    setActive(false);
    setKnob(0, 0);
    onChange({ x: 0, y: 0 });
    onRelease?.();
  }, [onChange, onRelease, setKnob]);

  // Global listeners: the stick keeps working when the thumb slides off the pad.
  useEffect(() => {
    if (!active) return;

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId.current) return;
      event.preventDefault();
      onChange(computeVector(event.clientX, event.clientY));
    };
    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId.current) return;
      release();
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [active, computeVector, onChange, release]);

  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    pointerId.current = event.pointerId;
    setActive(true);
    onChange(computeVector(event.clientX, event.clientY));
  };

  return (
    <div
      ref={zoneRef}
      className={`stick-zone stick-zone--${variant}`}
      onPointerDown={handleDown}
      role="presentation"
      data-active={active}
      aria-label={label}
    >
      <span ref={knobRef} className="stick-zone__knob" aria-hidden="true" />
      <span className="stick-zone__hint">{label}</span>
    </div>
  );
}

/** A touch control that fires on press and repeats while held. */
export interface TouchActionButtonProps {
  label: string;
  glyph: string;
  onPress: () => void;
  /** When true the button repeats while held, at `repeatMs`. */
  repeat?: boolean;
  repeatMs?: number;
  disabled?: boolean;
  tone?: 'default' | 'signal' | 'telemetry';
}

export function TouchActionButton({
  label,
  glyph,
  onPress,
  repeat = false,
  repeatMs = 140,
  disabled = false,
  tone = 'default',
}: TouchActionButtonProps) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    onPress();
    if (repeat) {
      stop();
      timer.current = setInterval(onPress, repeatMs);
    }
  };

  const accent =
    tone === 'signal'
      ? { borderColor: 'var(--signal)', color: 'var(--signal)' }
      : tone === 'telemetry'
        ? { borderColor: 'var(--telemetry)', color: 'var(--telemetry)' }
        : undefined;

  return (
    <button
      type="button"
      className="touch-btn"
      style={accent}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      disabled={disabled}
      aria-label={label}
    >
      <span className="touch-btn__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{label}</span>
    </button>
  );
}
