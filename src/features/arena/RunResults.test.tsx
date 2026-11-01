import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RunResults } from '@/features/arena/RunResults';
import { matchScore, type MatchFacts } from '@/services/progression';
import type { SimulationSnapshot } from '@/game/logic/simulation';

type Mission = NonNullable<SimulationSnapshot['mission']>;

/**
 * The end-of-run panel derives its provisional score and XP from the same match
 * facts the submission sends. This test pins the corrected contract: the count
 * of completed objectives — not the 1-based display index — drives the preview,
 * and the preview agrees with the authoritative formula.
 */
function snapshot(mission: Partial<Mission>, overrides: Partial<SimulationSnapshot> = {}): SimulationSnapshot {
  return {
    mode: 'operations',
    outcome: 'defeat',
    elapsedMs: 0,
    waveNumber: 0,
    eliminations: 0,
    damageDealt: 0,
    shotsFired: 0,
    shotsHit: 0,
    deathmatch: null,
    mission: {
      id: 'last_exit',
      codename: 'LAST EXIT',
      name: 'Operation: Last Exit',
      briefing: '',
      phase: 'failed',
      objectiveIndex: 1,
      objectivesCompleted: 0,
      objectiveTotal: 6,
      objectiveLabel: 'Break out of the entry hall',
      objectiveDetail: '',
      objectiveInstruction: '',
      objectiveProgress: 0,
      objectivePosition: null,
      objectiveRadius: null,
      extractionRemainingMs: 0,
      inExtractionZone: false,
      encounterIntro: null,
      holdingPosition: false,
      ...mission,
    },
    ...overrides,
  } as unknown as SimulationSnapshot;
}

function renderResults(snap: SimulationSnapshot) {
  return render(
    <MemoryRouter>
      <RunResults snapshot={snap} submission={{ status: 'pending' }} onPlayAgain={() => {}} />
    </MemoryRouter>,
  );
}

/** Reads the numeric value shown next to a stat label. */
function statValue(label: string): number {
  const labelNode = screen.getByText(label);
  const valueNode = labelNode.parentElement?.querySelector('.stat__value');
  return Number((valueNode?.textContent ?? '').replace(/,/g, ''));
}

describe('RunResults — objectives completed preview', () => {
  it('scores a failed run on the objectives actually completed', () => {
    // Failed while working on the third objective: two are done.
    renderResults(snapshot({ objectiveIndex: 3, objectivesCompleted: 2 }));

    const facts: MatchFacts = {
      mode: 'operations',
      wave: 0,
      eliminations: 0,
      survivalSeconds: 0,
      damageDealt: 0,
      outcome: 'defeat',
      objectivesCompleted: 2,
      extracted: false,
    };
    expect(statValue('Score')).toBe(matchScore(facts));
    // Two completed objectives are worth 1,200 points (2 × 600).
    expect(statValue('Score')).toBe(1200);
  });

  it('does not credit an objective the player never finished', () => {
    // The display index says "objective 3"; the completed count says 2.
    // If the panel used the display index it would show 1,800, not 1,200.
    renderResults(snapshot({ objectiveIndex: 3, objectivesCompleted: 2 }));
    expect(statValue('Score')).not.toBe(1800);
    expect(statValue('Score')).toBe(1200);
  });

  it('shows the display index separately, so the two are not conflated', () => {
    renderResults(snapshot({ objectiveIndex: 3, objectivesCompleted: 2 }));
    // The objective readout stays 1-based and human-readable.
    expect(screen.getByText('Objectives')).toBeInTheDocument();
    expect(statValue('Objectives')).toBeNaN(); // rendered as "3/6", not a number
    expect(screen.getByText('3/6')).toBeInTheDocument();
  });

  it('awards the extraction bonus only on a completed, extracted run', () => {
    renderResults(snapshot({ phase: 'complete', objectiveIndex: 6, objectivesCompleted: 6 }, { outcome: 'victory' }));

    const facts: MatchFacts = {
      mode: 'operations',
      wave: 0,
      eliminations: 0,
      survivalSeconds: 0,
      damageDealt: 0,
      outcome: 'extracted',
      objectivesCompleted: 6,
      extracted: true,
    };
    // 6 × 600 + 9,000 extraction bonus.
    expect(statValue('Score')).toBe(matchScore(facts));
    expect(statValue('Score')).toBe(12_600);
    expect(screen.getByText(/Operation complete/i)).toBeInTheDocument();
  });
});

describe('RunResults — achievement labels', () => {
  it('renders the two Operations achievements by name, not by raw id', () => {
    render(
      <MemoryRouter>
        <RunResults
          snapshot={snapshot({ phase: 'complete', objectiveIndex: 6, objectivesCompleted: 6 })}
          submission={{ status: 'saved', score: 12_600, xp: 2150, achievements: ['extraction_ready', 'objective_focus'] }}
          onPlayAgain={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Extraction Ready/)).toBeInTheDocument();
    expect(screen.getByText(/Objective Focus/)).toBeInTheDocument();
    expect(screen.queryByText(/extraction_ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/objective_focus/)).not.toBeInTheDocument();
  });
});
