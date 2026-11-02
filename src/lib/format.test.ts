import { describe, expect, it } from 'vitest';
import { formatReserve } from './format';

describe('formatReserve', () => {
  it('renders a finite reserve as a plain number', () => {
    expect(formatReserve(0)).toBe('0');
    expect(formatReserve(56)).toBe('56');
  });

  it('renders an unlimited reserve as the infinity glyph, never "Infinity"', () => {
    expect(formatReserve(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatReserve(Number.NaN)).toBe('∞');
  });
});
