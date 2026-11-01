/**
 * Run upgrades (the roguelite layer).
 *
 * Between encounters the player picks one of three upgrades. Three rules shape
 * this module, and all three are load-bearing:
 *
 *  1. **An upgrade must change a number the simulation actually reads.** Every
 *     modifier below is consumed by `CombatSimulation` — weapon damage, reload
 *     duration, movement speed, damage taken, crit chance, blast radius. There
 *     is no upgrade whose only effect is a line in a list.
 *  2. **Nothing may stack into invincibility.** Every modifier is clamped by a
 *     hard cap. Armour cannot reach 100% reduction; a dodge cooldown cannot
 *     reach zero; crit chance cannot exceed certainty. The caps are exported so
 *     the guarantee is testable rather than aspirational.
 *  3. **A run is reproducible.** Choices are offered deterministically from a
 *     seed and the run's own state, so the same run offers the same options.
 *
 * Only the *progression that belongs in the existing player system* persists —
 * that is, nothing here does. Upgrades are per-run, deliberately: the database
 * stores career XP, unlocks and achievements, and a roguelite bonus is not a
 * career statistic. This keeps `submit_match` and the RLS model untouched.
 */

export type UpgradeId =
  | 'hollow_point'
  | 'quick_hands'
  | 'light_boots'
  | 'plating'
  | 'deadeye'
  | 'frag_rounds'
  | 'adrenaline'
  | 'scavenger'
  | 'blast_radius'
  | 'twin_mag';

export type UpgradeRarity = 'common' | 'uncommon' | 'rare';

/** Which axis an upgrade improves. Used to bias the offer toward variety. */
export type UpgradeCategory = 'offence' | 'defence' | 'mobility' | 'utility';

export interface UpgradeSpec {
  readonly id: UpgradeId;
  readonly name: string;
  readonly description: string;
  readonly category: UpgradeCategory;
  readonly rarity: UpgradeRarity;
  /** Maximum times one run may take this upgrade. */
  readonly maxStacks: number;
}

export const UPGRADES: Readonly<Record<UpgradeId, UpgradeSpec>> = Object.freeze({
  hollow_point: {
    id: 'hollow_point',
    name: 'Hollow Point',
    description: '+12% weapon damage.',
    category: 'offence',
    rarity: 'common',
    maxStacks: 5,
  },
  quick_hands: {
    id: 'quick_hands',
    name: 'Quick Hands',
    description: '−14% reload time.',
    category: 'offence',
    rarity: 'common',
    maxStacks: 4,
  },
  light_boots: {
    id: 'light_boots',
    name: 'Light Boots',
    description: '+8% movement speed.',
    category: 'mobility',
    rarity: 'common',
    maxStacks: 4,
  },
  plating: {
    id: 'plating',
    name: 'Composite Plating',
    description: 'Take 10% less damage.',
    category: 'defence',
    rarity: 'uncommon',
    maxStacks: 5,
  },
  deadeye: {
    id: 'deadeye',
    name: 'Deadeye',
    description: '+8% chance to strike a weak point for triple damage.',
    category: 'offence',
    rarity: 'uncommon',
    maxStacks: 4,
  },
  frag_rounds: {
    id: 'frag_rounds',
    name: 'Frag Rounds',
    description: 'Kills have a chance to detonate in a small blast.',
    category: 'offence',
    rarity: 'rare',
    maxStacks: 3,
  },
  adrenaline: {
    id: 'adrenaline',
    name: 'Adrenaline',
    description: '−20% dodge cooldown and a faster recovery after a roll.',
    category: 'mobility',
    rarity: 'uncommon',
    maxStacks: 3,
  },
  scavenger: {
    id: 'scavenger',
    name: 'Scavenger',
    description: 'Ammunition pickups grant more reserve rounds.',
    category: 'utility',
    rarity: 'common',
    maxStacks: 3,
  },
  blast_radius: {
    id: 'blast_radius',
    name: 'Wide Load',
    description: '+20% grenade blast radius.',
    category: 'utility',
    rarity: 'uncommon',
    maxStacks: 3,
  },
  twin_mag: {
    id: 'twin_mag',
    name: 'Twin Magazine',
    description: '+30% magazine capacity.',
    category: 'offence',
    rarity: 'rare',
    maxStacks: 2,
  },
});

export const ALL_UPGRADE_IDS: readonly UpgradeId[] = Object.keys(UPGRADES) as UpgradeId[];

/**
 * The accumulated effect of every upgrade a run has taken.
 *
 * These are the *only* numbers the simulation reads. Multiplicative modifiers are
 * stored as multipliers (1 = unchanged) so composing them is unambiguous.
 */
export interface RunModifiers {
  /** Multiplies weapon damage. */
  damageMultiplier: number;
  /** Multiplies reload duration (<1 = faster). */
  reloadMultiplier: number;
  /** Multiplies player speed. */
  speedMultiplier: number;
  /** Multiplies incoming damage (<1 = tougher). */
  damageTakenMultiplier: number;
  /** 0–1 chance of a weak-point hit. */
  critChance: number;
  /** Multiplier applied on a crit. */
  critMultiplier: number;
  /** Multiplies grenade blast radius. */
  blastRadiusMultiplier: number;
  /** Extra reserve rounds granted per ammo pickup, as a fraction. */
  ammoBonus: number;
  /** Chance a kill detonates. */
  fragChance: number;
  /** Multiplies the dodge cooldown. */
  dodgeCooldownMultiplier: number;
  /** Multiplies magazine capacity. */
  magazineMultiplier: number;
}

export const BASE_MODIFIERS: Readonly<RunModifiers> = Object.freeze({
  damageMultiplier: 1,
  reloadMultiplier: 1,
  speedMultiplier: 1,
  damageTakenMultiplier: 1,
  critChance: 0,
  critMultiplier: 3,
  blastRadiusMultiplier: 1,
  ammoBonus: 0,
  fragChance: 0,
  dodgeCooldownMultiplier: 1,
  magazineMultiplier: 1,
});

/**
 * Hard caps. These are what stop stacking from trivialising the game, and they
 * are asserted in the tests rather than trusted.
 */
export const MODIFIER_CAPS = Object.freeze({
  /** At most a 2.5× damage increase, however many offence cards are taken. */
  damageMultiplier: 2.5,
  /** Reload can never be faster than a third of its base time. */
  reloadMultiplier: 0.34,
  /** At most +45% movement speed. */
  speedMultiplier: 1.45,
  /** Damage taken can never fall below 35% — armour is never immunity. */
  damageTakenMultiplier: 0.35,
  /** Weak-point chance is capped below certainty. */
  critChance: 0.6,
  blastRadiusMultiplier: 2.2,
  ammoBonus: 1.2,
  fragChance: 0.5,
  /** The dodge cooldown can never fall below 30% of its base. */
  dodgeCooldownMultiplier: 0.3,
  magazineMultiplier: 1.8,
});

function clampModifier(key: keyof typeof MODIFIER_CAPS, value: number): number {
  const cap = MODIFIER_CAPS[key];
  // Multipliers with a floor above 1 are capped from above; multipliers that
  // reduce (reload, damage taken, dodge) are capped from below.
  if (key === 'reloadMultiplier' || key === 'damageTakenMultiplier' || key === 'dodgeCooldownMultiplier') {
    return Math.max(cap, value);
  }
  return Math.min(cap, value);
}

/**
 * Applies one upgrade to a modifier set, returning a new set.
 *
 * Pure: never mutates its input. Every result is passed through the cap for its
 * axis, so the caps hold no matter the order or count of applications.
 */
export function applyUpgrade(modifiers: RunModifiers, id: UpgradeId): RunModifiers {
  const next: RunModifiers = { ...modifiers };
  switch (id) {
    case 'hollow_point':
      next.damageMultiplier = clampModifier('damageMultiplier', next.damageMultiplier * 1.12);
      break;
    case 'quick_hands':
      next.reloadMultiplier = clampModifier('reloadMultiplier', next.reloadMultiplier * 0.86);
      break;
    case 'light_boots':
      next.speedMultiplier = clampModifier('speedMultiplier', next.speedMultiplier * 1.08);
      break;
    case 'plating':
      next.damageTakenMultiplier = clampModifier('damageTakenMultiplier', next.damageTakenMultiplier * 0.9);
      break;
    case 'deadeye':
      next.critChance = clampModifier('critChance', next.critChance + 0.08);
      break;
    case 'frag_rounds':
      next.fragChance = clampModifier('fragChance', next.fragChance + 0.16);
      break;
    case 'adrenaline':
      next.dodgeCooldownMultiplier = clampModifier('dodgeCooldownMultiplier', next.dodgeCooldownMultiplier * 0.8);
      break;
    case 'scavenger':
      next.ammoBonus = clampModifier('ammoBonus', next.ammoBonus + 0.35);
      break;
    case 'blast_radius':
      next.blastRadiusMultiplier = clampModifier('blastRadiusMultiplier', next.blastRadiusMultiplier * 1.2);
      break;
    case 'twin_mag':
      next.magazineMultiplier = clampModifier('magazineMultiplier', next.magazineMultiplier * 1.3);
      break;
  }
  return next;
}

export function modifiersFor(taken: readonly UpgradeId[]): RunModifiers {
  let modifiers: RunModifiers = { ...BASE_MODIFIERS };
  for (const id of taken) modifiers = applyUpgrade(modifiers, id);
  return modifiers;
}

/**
 * The three upgrades to offer.
 *
 * Rules, all deterministic:
 *  - never offer something already at its stack cap;
 *  - never offer the same card twice in one offer;
 *  - bias the offer to cover at least two different categories, so the choice is
 *    between *directions* rather than three flavours of damage;
 *  - prefer the rarer cards when the player is deep into a run, so the run has an
 *    arc.
 *
 * `rng` is the simulation's seeded generator, so a seeded run offers the same
 * cards in the same order.
 */
export function rollUpgradeOffer(
  taken: readonly UpgradeId[],
  encounterIndex: number,
  rng: () => number,
  count = 3,
): UpgradeId[] {
  const counts = new Map<UpgradeId, number>();
  for (const id of taken) counts.set(id, (counts.get(id) ?? 0) + 1);

  const eligible = ALL_UPGRADE_IDS.filter((id) => (counts.get(id) ?? 0) < UPGRADES[id].maxStacks);
  if (eligible.length === 0) return [];

  // Weight by rarity, and let rarity grow with depth so a long run offers
  // stronger cards — but a common is never impossible.
  const depth = Math.min(1, encounterIndex / 8);
  const weightFor = (id: UpgradeId): number => {
    const rarity = UPGRADES[id].rarity;
    if (rarity === 'rare') return 0.6 + depth * 2.4;
    if (rarity === 'uncommon') return 1.6 + depth * 1.2;
    return 3.2 - depth * 1.2;
  };

  const offer: UpgradeId[] = [];
  const categories = new Set<UpgradeCategory>();

  while (offer.length < count) {
    const pool = eligible.filter((id) => !offer.includes(id));
    if (pool.length === 0) break;

    // The first two picks are constrained to *new* categories whenever the pool
    // allows it. That makes the offer a choice between directions rather than
    // three flavours of damage — and it is a guarantee, not a bias: a weighted
    // roll could still land twice in one category, so the constraint is applied
    // to the candidate list itself. The final pick is free.
    const preferNewCategory = offer.length < 2;
    let candidates = pool;
    if (preferNewCategory) {
      const unseen = pool.filter((id) => !categories.has(UPGRADES[id].category));
      if (unseen.length > 0) candidates = unseen;
    }

    const weighted = candidates.map((id) => ({ id, weight: weightFor(id) }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * total;
    let chosen = weighted[weighted.length - 1]!.id;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry.id;
        break;
      }
    }
    offer.push(chosen);
    categories.add(UPGRADES[chosen].category);
  }

  return offer;
}

/** Human-readable summary of a modifier set, for the run-results screen. */
export function summariseModifiers(modifiers: RunModifiers): string[] {
  const lines: string[] = [];
  if (modifiers.damageMultiplier > 1.001) lines.push(`Damage ×${modifiers.damageMultiplier.toFixed(2)}`);
  if (modifiers.reloadMultiplier < 0.999) lines.push(`Reload ×${modifiers.reloadMultiplier.toFixed(2)}`);
  if (modifiers.speedMultiplier > 1.001) lines.push(`Speed ×${modifiers.speedMultiplier.toFixed(2)}`);
  if (modifiers.damageTakenMultiplier < 0.999) {
    lines.push(`Damage taken ×${modifiers.damageTakenMultiplier.toFixed(2)}`);
  }
  if (modifiers.critChance > 0) lines.push(`Weak-point ${Math.round(modifiers.critChance * 100)}%`);
  if (modifiers.blastRadiusMultiplier > 1.001) {
    lines.push(`Blast radius ×${modifiers.blastRadiusMultiplier.toFixed(2)}`);
  }
  if (modifiers.fragChance > 0) lines.push(`Frag detonation ${Math.round(modifiers.fragChance * 100)}%`);
  if (modifiers.ammoBonus > 0) lines.push(`Ammo pickup +${Math.round(modifiers.ammoBonus * 100)}%`);
  if (modifiers.dodgeCooldownMultiplier < 0.999) {
    lines.push(`Dodge cooldown ×${modifiers.dodgeCooldownMultiplier.toFixed(2)}`);
  }
  if (modifiers.magazineMultiplier > 1.001) {
    lines.push(`Magazine ×${modifiers.magazineMultiplier.toFixed(2)}`);
  }
  return lines;
}
