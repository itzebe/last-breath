import { UPGRADES, type UpgradeId } from '@/game/logic/upgrades';

/**
 * The three-card upgrade choice offered between Operations encounters.
 *
 * The arena is paused while this is open, so it can be a real dialog: focus
 * moves into it, each card is a button, and the whole choice is keyboard
 * operable. The cards are rendered from the simulation's own offer, so what is
 * displayed is exactly what taking a card will apply.
 */

export interface UpgradeChooserProps {
  options: readonly UpgradeId[];
  /** Upgrade ids already taken this run, with counts, for the stack readout. */
  taken: readonly UpgradeId[];
  onChoose: (id: UpgradeId) => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  offence: 'Offence',
  defence: 'Defence',
  mobility: 'Mobility',
  utility: 'Utility',
};

export function UpgradeChooser({ options, taken, onChoose }: UpgradeChooserProps) {
  const counts = taken.reduce<Record<string, number>>((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="upgrade-overlay" role="dialog" aria-modal="true" aria-label="Choose an upgrade">
      <div className="upgrade-overlay__inner">
        <header className="upgrade-overlay__head">
          <p className="eyebrow eyebrow--signal">Field requisition</p>
          <h2 className="section-title">Choose one upgrade</h2>
          <p className="text-3">Taken so far: {taken.length === 0 ? 'none' : taken.length}</p>
        </header>

        <div className="upgrade-grid" role="group" aria-label="Upgrade options">
          {options.map((id) => {
            const spec = UPGRADES[id];
            const stack = counts[id] ?? 0;
            return (
              <button
                key={id}
                type="button"
                className="upgrade-card"
                data-rarity={spec.rarity}
                onClick={() => onChoose(id)}
                aria-label={`Take ${spec.name}: ${spec.description}`}
              >
                <span className="upgrade-card__category">{CATEGORY_LABEL[spec.category] ?? spec.category}</span>
                <span className="upgrade-card__name">{spec.name}</span>
                <span className="upgrade-card__desc">{spec.description}</span>
                <span className="upgrade-card__meta">
                  <span className="upgrade-card__rarity">{spec.rarity}</span>
                  {stack > 0 ? <span className="upgrade-card__stack">owned ×{stack}</span> : null}
                  <span className="upgrade-card__max">max {spec.maxStacks}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
