/**
 * Audio.
 *
 * Every sound is synthesised with the Web Audio API — no asset files, and the
 * whole soundtrack costs a few hundred bytes of code. Three rules are enforced
 * here rather than left to callers:
 *
 *   1. Nothing plays before the user has interacted with the page. Browsers
 *      suspend an AudioContext created without a gesture, and a game that fails
 *      silently on first tap is worse than one that waits.
 *   2. The whole system is optional and mutable at runtime (volume, mute).
 *   3. Failure is never fatal: if Web Audio is unavailable or blocked, the game
 *      runs silently instead of throwing.
 */

export type SoundName =
  | 'pistol'
  | 'rifle'
  | 'shotgun'
  | 'sniper'
  | 'reload'
  | 'reload_complete'
  | 'enemy_hit'
  | 'enemy_die'
  | 'player_hit'
  | 'pickup_health'
  | 'pickup_ammo'
  | 'wave_start'
  | 'wave_clear'
  | 'boss_phase'
  | 'boss_attack'
  | 'adaptation'
  | 'explosion'
  | 'match_start'
  | 'kill_confirm'
  | 'dodge'
  | 'grenade_throw'
  | 'critical_hit'
  | 'enemy_alert'
  | 'mission_start'
  | 'objective'
  | 'extraction'
  | 'upgrade'
  | 'victory'
  | 'defeat';

interface SoundSpec {
  /** Oscillator waveform, or 'noise' for a filtered noise burst. */
  source: OscillatorType | 'noise';
  frequency: number;
  /** Frequency at the end of the sweep, when different from the start. */
  endFrequency?: number;
  durationMs: number;
  gain: number;
  /** Optional low-pass cutoff, used to soften noise-based sounds. */
  lowpass?: number;
}

const SOUNDS: Readonly<Record<SoundName, SoundSpec>> = Object.freeze({
  pistol: { source: 'square', frequency: 420, endFrequency: 180, durationMs: 90, gain: 0.16 },
  rifle: { source: 'sawtooth', frequency: 330, endFrequency: 150, durationMs: 60, gain: 0.12 },
  shotgun: { source: 'noise', frequency: 1, durationMs: 220, gain: 0.3, lowpass: 1800 },
  sniper: { source: 'sawtooth', frequency: 180, endFrequency: 60, durationMs: 320, gain: 0.28, lowpass: 2600 },
  reload: { source: 'square', frequency: 220, endFrequency: 300, durationMs: 90, gain: 0.1, lowpass: 1400 },
  reload_complete: { source: 'square', frequency: 520, endFrequency: 700, durationMs: 110, gain: 0.12 },
  enemy_hit: { source: 'noise', frequency: 1, durationMs: 70, gain: 0.12, lowpass: 3200 },
  enemy_die: { source: 'noise', frequency: 1, durationMs: 260, gain: 0.22, lowpass: 1200 },
  player_hit: { source: 'sawtooth', frequency: 140, endFrequency: 70, durationMs: 260, gain: 0.3, lowpass: 900 },
  pickup_health: { source: 'sine', frequency: 620, endFrequency: 980, durationMs: 200, gain: 0.2 },
  pickup_ammo: { source: 'square', frequency: 480, endFrequency: 760, durationMs: 150, gain: 0.15 },
  wave_start: { source: 'sawtooth', frequency: 120, endFrequency: 320, durationMs: 620, gain: 0.22, lowpass: 1600 },
  wave_clear: { source: 'sine', frequency: 400, endFrequency: 900, durationMs: 520, gain: 0.22 },
  boss_phase: { source: 'sawtooth', frequency: 90, endFrequency: 240, durationMs: 900, gain: 0.32, lowpass: 900 },
  boss_attack: { source: 'sawtooth', frequency: 260, endFrequency: 90, durationMs: 340, gain: 0.3, lowpass: 1400 },
  adaptation: { source: 'sine', frequency: 300, endFrequency: 520, durationMs: 380, gain: 0.16 },
  explosion: { source: 'noise', frequency: 1, durationMs: 520, gain: 0.36, lowpass: 900 },
  match_start: { source: 'sawtooth', frequency: 200, endFrequency: 620, durationMs: 700, gain: 0.26, lowpass: 2000 },
  kill_confirm: { source: 'square', frequency: 640, endFrequency: 940, durationMs: 130, gain: 0.16 },
  // A dodge is a cloth-and-boot scuff: filtered noise, short, low.
  dodge: { source: 'noise', frequency: 1, durationMs: 180, gain: 0.14, lowpass: 1400 },
  grenade_throw: { source: 'square', frequency: 300, endFrequency: 520, durationMs: 140, gain: 0.12 },
  // A weak-point hit gets its own brighter confirm so it is audible as well as visible.
  critical_hit: { source: 'sine', frequency: 900, endFrequency: 1500, durationMs: 140, gain: 0.2 },
  // Hostiles calling out: a short, sharp two-tone alert, deliberately unlike any weapon.
  enemy_alert: { source: 'sawtooth', frequency: 520, endFrequency: 380, durationMs: 220, gain: 0.16, lowpass: 2200 },
  mission_start: { source: 'sine', frequency: 260, endFrequency: 640, durationMs: 800, gain: 0.24 },
  objective: { source: 'sine', frequency: 480, endFrequency: 720, durationMs: 260, gain: 0.18 },
  // The extraction beep is the clock: it must cut through gunfire.
  extraction: { source: 'square', frequency: 760, endFrequency: 760, durationMs: 180, gain: 0.2 },
  upgrade: { source: 'sine', frequency: 560, endFrequency: 1080, durationMs: 420, gain: 0.2 },
  victory: { source: 'sine', frequency: 520, endFrequency: 1040, durationMs: 900, gain: 0.28 },
  defeat: { source: 'sine', frequency: 320, endFrequency: 90, durationMs: 1200, gain: 0.3 },
});

export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 0.7,
  musicVolume: 0.35,
  sfxVolume: 0.8,
  muted: false,
};

const STORAGE_KEY = 'last-breath.audio';

/** Persisted so a player's volume choice survives a reload. */
export function loadAudioSettings(): AudioSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      masterVolume: clamp01(parsed.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume),
      musicVolume: clamp01(parsed.musicVolume ?? DEFAULT_AUDIO_SETTINGS.musicVolume),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
      muted: Boolean(parsed.muted),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be full or blocked; the in-memory settings still apply.
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The audio engine. One instance per page, shared by the arena and the app shell
 * so volume controls affect everything.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicNodes: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;
  private settings: AudioSettings = loadAudioSettings();
  private unlocked = false;
  private available: boolean;

  constructor() {
    this.available = typeof window !== 'undefined' && 'AudioContext' in window;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get currentSettings(): AudioSettings {
    return { ...this.settings };
  }

  /**
   * Creates (or resumes) the AudioContext. Must be called from within a user
   * gesture handler — a tap or a click. Safe to call repeatedly.
   */
  unlock(): void {
    if (!this.available) return;
    try {
      if (!this.context) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.available = false;
          return;
        }
        this.context = new Ctor();
        this.masterGain = this.context.createGain();
        this.sfxGain = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.sfxGain.connect(this.masterGain);
        this.musicGain.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);
        this.applySettings();
      }
      if (this.context.state === 'suspended') void this.context.resume();
      this.unlocked = true;
    } catch {
      // Audio is a nicety; never let it break the game.
      this.available = false;
    }
  }

  updateSettings(next: Partial<AudioSettings>): AudioSettings {
    this.settings = {
      masterVolume: clamp01(next.masterVolume ?? this.settings.masterVolume),
      musicVolume: clamp01(next.musicVolume ?? this.settings.musicVolume),
      sfxVolume: clamp01(next.sfxVolume ?? this.settings.sfxVolume),
      muted: next.muted ?? this.settings.muted,
    };
    this.applySettings();
    saveAudioSettings(this.settings);
    return { ...this.settings };
  }

  private applySettings(): void {
    if (!this.context || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const now = this.context.currentTime;
    const master = this.settings.muted ? 0 : this.settings.masterVolume;
    this.masterGain.gain.setTargetAtTime(master, now, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfxVolume, now, 0.02);
    this.musicGain.gain.setTargetAtTime(this.settings.musicVolume, now, 0.02);
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.context) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const seconds = 1;
    const buffer = this.context.createBuffer(1, this.context.sampleRate * seconds, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Plays a one-shot effect. Silently does nothing before `unlock()`. */
  play(name: SoundName): void {
    if (!this.available || !this.unlocked || this.settings.muted) return;
    if (!this.context || !this.sfxGain) return;

    const spec = SOUNDS[name];
    try {
      const now = this.context.currentTime;
      const duration = spec.durationMs / 1000;
      const gain = this.context.createGain();
      gain.connect(this.sfxGain);

      // Percussive envelope: near-instant attack, exponential decay. This is
      // what makes synthesised effects read as impacts rather than as beeps.
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(spec.gain, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      let node: AudioScheduledSourceNode;
      if (spec.source === 'noise') {
        const buffer = this.getNoiseBuffer();
        if (!buffer) return;
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        node = source;
      } else {
        const oscillator = this.context.createOscillator();
        oscillator.type = spec.source;
        oscillator.frequency.setValueAtTime(spec.frequency, now);
        if (spec.endFrequency !== undefined) {
          oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(1, spec.endFrequency),
            now + duration,
          );
        }
        node = oscillator;
      }

      let tail: AudioNode = node;
      if (spec.lowpass !== undefined) {
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = spec.lowpass;
        node.connect(filter);
        tail = filter;
      }
      tail.connect(gain);
      node.start(now);
      node.stop(now + duration + 0.02);
    } catch {
      // A failed effect must never interrupt gameplay.
    }
  }

  /** Starts the ambient bed. Idempotent. */
  startMusic(): void {
    if (!this.available || !this.unlocked || !this.context || !this.musicGain) return;
    if (this.musicNodes) return;

    try {
      const context = this.context;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 3);
      gain.connect(this.musicGain);

      // Two detuned low drones plus a slow tremolo: industrial, unobtrusive, and
      // cheap enough to run on a phone without a measurable frame cost.
      const oscillators: OscillatorNode[] = [];
      for (const [frequency, detune] of [
        [55, 0],
        [82.5, 6],
      ] as const) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;

        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 220;
        filter.Q.value = 4;

        oscillator.connect(filter);
        filter.connect(gain);
        oscillator.start(now);
        oscillators.push(oscillator);
      }

      // Tremolo: a slow LFO on the bus, which keeps the drone from feeling static.
      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 0.22;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start(now);
      oscillators.push(lfo);

      this.musicNodes = { oscillators, gain };
    } catch {
      this.musicNodes = null;
    }
  }

  stopMusic(): void {
    if (!this.musicNodes || !this.context) return;
    const { oscillators, gain } = this.musicNodes;
    const now = this.context.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.4);
      for (const oscillator of oscillators) oscillator.stop(now + 2);
    } catch {
      // Already stopped.
    }
    this.musicNodes = null;
  }

  /** Suspends output, e.g. when the tab is hidden or the game is paused. */
  suspend(): void {
    if (this.context?.state === 'running') void this.context.suspend();
  }

  resume(): void {
    if (this.context?.state === 'suspended' && this.unlocked) void this.context.resume();
  }

  dispose(): void {
    this.stopMusic();
    if (this.context) void this.context.close();
    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.unlocked = false;
  }
}

let engine: AudioEngine | null = null;

/** The shared engine. Created lazily so importing this module has no side effects. */
export function getAudioEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

/** Test-only. */
export function resetAudioEngine(): void {
  engine?.dispose();
  engine = null;
}

/** Maps a weapon id to its firing sound. */
export function weaponSound(weapon: string): SoundName {
  switch (weapon) {
    case 'rifle':
      return 'rifle';
    case 'shotgun':
      return 'shotgun';
    case 'sniper':
      return 'sniper';
    default:
      return 'pistol';
  }
}
