import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeChooser } from '@/features/arena/UpgradeChooser';
import { MissionPanel } from '@/features/arena/MissionPanel';
import { UPGRADES } from '@/game/logic/upgrades';
import type { SimulationSnapshot } from '@/game/logic/simulation';

type Mission = NonNullable<SimulationSnapshot['mission']>;

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'last_exit',
    codename: 'LAST EXIT',
    name: 'Operation: Last Exit',
    briefing: 'Reach the relay, hold it, then extract.',
    objectiveIndex: 2,
    objectivesCompleted: 1,
    objectiveTotal: 6,
    objectiveLabel: 'Hold the relay',
    objectiveDetail: 'The relay must stay online while the request uploads.',
    objectiveInstruction: 'Stay inside the ring until the upload completes.',
    objectiveProgress: 0.4,
    phase: 'active',
    extractionRemainingMs: 30_000,
    inExtractionZone: false,
    objectivePosition: { x: 1750, y: 320 },
    objectiveRadius: 170,
    encounterIntro: null,
    holdingPosition: true,
    ...overrides,
  };
}

describe('UpgradeChooser', () => {
  it('renders one actionable card per offered upgrade, with its real description', () => {
    const options = ['hollow_point', 'plating', 'light_boots'] as const;
    render(<UpgradeChooser options={options} taken={[]} onChoose={() => {}} />);

    for (const id of options) {
      const spec = UPGRADES[id];
      // The card is reachable by its accessible name, which includes the effect,
      // so a screen reader hears what taking it will do.
      expect(screen.getByRole('button', { name: new RegExp(spec.name, 'i') })).toBeInTheDocument();
      expect(screen.getByText(spec.description)).toBeInTheDocument();
    }
  });

  it('is a modal dialog, so the choice cannot be missed or tabbed past', () => {
    render(<UpgradeChooser options={['hollow_point', 'plating', 'light_boots']} taken={[]} onChoose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: /choose an upgrade/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('reports the chosen id exactly once per click', async () => {
    const onChoose = vi.fn();
    render(<UpgradeChooser options={['hollow_point', 'plating', 'light_boots']} taken={[]} onChoose={onChoose} />);

    await userEvent.click(screen.getByRole('button', { name: /composite plating/i }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith('plating');
  });

  it('shows how many times an already-owned upgrade has been taken', () => {
    render(
      <UpgradeChooser
        options={['hollow_point', 'plating', 'light_boots']}
        taken={['hollow_point', 'hollow_point']}
        onChoose={() => {}}
      />,
    );
    expect(screen.getByText(/owned ×2/)).toBeInTheDocument();
  });
});

describe('MissionPanel', () => {
  it('states the codename, objective progress and instruction', () => {
    render(<MissionPanel mission={mission()} />);
    expect(screen.getByText(/LAST EXIT · objective 2\/6/)).toBeInTheDocument();
    expect(screen.getByText('Hold the relay')).toBeInTheDocument();
    expect(screen.getByText(/stay inside the ring/i)).toBeInTheDocument();
  });

  it('announces the extraction countdown only while extracting', () => {
    const { rerender } = render(<MissionPanel mission={mission()} />);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    rerender(
      <MissionPanel mission={mission({ phase: 'extraction', inExtractionZone: true, extractionRemainingMs: 12_000 })} />,
    );
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent(/extraction in 12s/i);
    expect(timer).toHaveTextContent(/holding/i);
  });

  it('warns that leaving the extraction zone resets the countdown', () => {
    render(
      <MissionPanel
        mission={mission({ phase: 'extraction', inExtractionZone: false, extractionRemainingMs: 8_400 })}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent(/leave the zone and it resets/i);
  });

  it('reports terminal mission phases in words, not as a stuck progress bar', () => {
    const { rerender } = render(<MissionPanel mission={mission({ phase: 'complete' })} />);
    expect(screen.getByText(/mission complete/i)).toBeInTheDocument();

    rerender(<MissionPanel mission={mission({ phase: 'failed' })} />);
    expect(screen.getByText(/mission failed/i)).toBeInTheDocument();
  });
});
