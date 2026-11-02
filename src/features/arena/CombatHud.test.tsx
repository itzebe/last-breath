import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CombatHud } from '@/features/arena/CombatHud';
import { CombatSimulation } from '@/game/logic/simulation';
import { LAST_EXIT } from '@/game/logic/operations';

/**
 * The top-left HUD panel is mode-specific. The regression this pins: Operations
 * and Deathmatch have no survival waves, so the wave panel used to read
 * "Wave 1 · 0 remaining" for the whole run — a number that is always wrong for
 * those modes. These tests drive the panel from a *real* simulation snapshot, so
 * the mode facts under test are the ones the game actually produces.
 */
function renderHud(snapshot: ReturnType<CombatSimulation['snapshot']>) {
  return render(
    <CombatHud snapshot={snapshot} debugOpen={false} onPause={() => {}} onToggleDebug={() => {}} />,
  );
}

describe('CombatHud — mode-specific top-left panel', () => {
  it('reports the objective, not a wave, in Operations', () => {
    const sim = new CombatSimulation({
      loadout: ['pistol'],
      mode: 'operations',
      missionId: LAST_EXIT.id,
      seed: 7,
    });
    renderHud(sim.snapshot());

    expect(screen.getByText(LAST_EXIT.codename)).toBeInTheDocument();
    expect(screen.getByText(/^Objective 1\//)).toBeInTheDocument();
    expect(screen.getByText(/hostiles in the field/i)).toBeInTheDocument();
    // The survival readout must be gone entirely.
    expect(screen.queryByText(/^Wave \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining$/)).not.toBeInTheDocument();
  });

  it('keeps the wave readout in Survival', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], seed: 7 });
    renderHud(sim.snapshot());

    expect(screen.getByText('Wave 1')).toBeInTheDocument();
    expect(screen.queryByText(/hostiles in the field/i)).not.toBeInTheDocument();
  });

  it('reports the match clock, not a wave, in Deathmatch', () => {
    const sim = new CombatSimulation({ loadout: ['pistol'], mode: 'deathmatch', seed: 7 });
    renderHud(sim.snapshot());

    expect(screen.getByText(/Deathmatch/)).toBeInTheDocument();
    expect(screen.queryByText(/^Wave \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hostiles in the field/i)).not.toBeInTheDocument();
  });
});
