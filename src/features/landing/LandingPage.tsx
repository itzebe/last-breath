import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button } from '@/components/ui';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { useAuth } from '@/app/AuthContext';
import { WEAPONS, burstDamage, roundsPerSecond, sustainedDps } from '@/game/logic/weapons';
import { ENEMY_ARCHETYPES, SPAWNABLE_ARCHETYPES } from '@/game/logic/enemies';
import { formatNumber } from '@/lib/format';

/* ── Hero ─────────────────────────────────────────────────────────────────── */

function RadarPreview() {
  // Static, decorative blips. Positions are authored so the pattern reads as a
  // considered sweep rather than as random scatter.
  const blips = [
    { top: '24%', left: '68%', color: 'var(--hostile)' },
    { top: '62%', left: '30%', color: 'var(--hostile)' },
    { top: '38%', left: '22%', color: 'var(--signal)' },
    { top: '74%', left: '72%', color: 'var(--hostile)' },
    { top: '50%', left: '82%', color: 'var(--ammo)' },
  ];

  return (
    <div className="radar" aria-hidden="true">
      <span className="radar__ring" style={{ width: '30%', height: '30%' }} />
      <span className="radar__ring" style={{ width: '58%', height: '58%' }} />
      <span className="radar__ring" style={{ width: '86%', height: '86%' }} />
      <span className="radar__sweep" />
      {blips.map((blip, index) => (
        <span
          key={index}
          className="radar__blip"
          style={{
            top: blip.top,
            left: blip.left,
            background: blip.color,
            animationDelay: `${index * 0.34}s`,
          }}
        />
      ))}
      <span className="radar__player" />
      <span className="radar__caption">Threat sweep · live</span>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <section className="hero">
      <span className="hero__scanline" aria-hidden="true" />
      <div className="shell hero__grid">
        <div>
          <p className="eyebrow eyebrow--signal">Loadout AI Game Competition · Entry</p>
          <h1 className="hero__wordmark anim-up">
            Last
            <br />
            <span>Breath</span>
          </h1>
          <p className="hero__tagline anim-up d-1">Survive the adaptation</p>
          <p className="lead anim-up d-2">
            A top-down survival shooter with a difference: the arena watches how you fight. Stand
            still and it converges on you. Keep your distance and it closes the gap. Orbit the same
            way twice and it stops chasing you — and starts waiting where you are going.
          </p>

          <div className="hero__actions anim-up d-3">
            {user ? (
              <Button variant="primary" size="lg" onClick={() => navigate('/dashboard')}>
                Enter the arena
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" onClick={() => navigate('/register')}>
                  Register to play
                </Button>
                <Button variant="ghost" size="lg" onClick={() => navigate('/login')}>
                  Log in
                </Button>
              </>
            )}
          </div>

          <div className="hero__proof">
            <span>Four distinct weapons</span>
            <span>Seven enemy doctrines</span>
            <span>Three-phase boss</span>
            <span>Touch controls</span>
          </div>
        </div>

        <RadarPreview />
      </div>
    </section>
  );
}

/* ── Feature grid ─────────────────────────────────────────────────────────── */

interface Feature {
  index: string;
  title: string;
  body: string;
  tone: 'signal' | 'telemetry' | 'hostile' | 'vital' | 'ammo' | 'xp';
}

const FEATURES: Feature[] = [
  {
    index: '01',
    title: 'Adaptive opposition',
    body: 'A behaviour model scores how you move, how far you engage, how often you fire and how often you reload. Enemies act on that reading: refusing the frontal fight, converging from several angles, or intercepting the arc you keep repeating.',
    tone: 'telemetry',
  },
  {
    index: '02',
    title: 'Seven doctrines',
    body: 'Rushers close and trade. Flankers refuse the front line. Marksmen hold sightlines. Bulwarks absorb punishment. Tactical Hunters cut off escape routes and strike when you reload. Overseers coordinate the squad and call reinforcements, and Field Medics revive downed allies. Each reacts to the same order differently.',
    tone: 'hostile',
  },
  {
    index: '03',
    title: 'Four weapons, four answers',
    body: 'A balanced sidearm, a full-auto rifle, an eight-pellet breacher and a single punishing high-velocity round. Damage, spread, magazine and reload all differ — the right choice depends on what the arena is doing.',
    tone: 'ammo',
  },
  {
    index: '04',
    title: 'Survival that escalates',
    body: 'Progressive waves raise enemy count, toughness and arrival rate on a computed curve. Ammunition and health drops keep a run alive. Every tenth wave, the arena stops testing you and sends its overseer.',
    tone: 'signal',
  },
  {
    index: '05',
    title: 'Persistent progression',
    body: 'Experience, levels, weapon unlocks, career statistics and match history are stored against your account and ranked globally. Score and XP are computed by the database, not by the browser.',
    tone: 'xp',
  },
  {
    index: '06',
    title: 'Built for a phone',
    body: 'A left movement stick, a right aiming stick, dedicated reload and weapon controls, and a landscape prompt when you rotate. Touch targets are 44 pixels or larger throughout.',
    tone: 'vital',
  },
];

function FeatureGrid() {
  return (
    <section className="section" id="features">
      <div className="shell">
        <div className="section__head">
          <p className="eyebrow eyebrow--telemetry">Systems</p>
          <h2>Everything in the arena is a system you can learn</h2>
          <p className="lead">
            Nothing here is decoration. Each element below changes what you can do, what the enemy
            does in response, or what survives the run.
          </p>
        </div>

        <div className="card-grid">
          {FEATURES.map((feature) => (
            <article key={feature.index} className={`feature feature--${feature.tone}`}>
              <span className="feature__index">{feature.index}</span>
              <h3 className="feature__title">{feature.title}</h3>
              <p className="feature__body">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Adaptation explainer ─────────────────────────────────────────────────── */

const ADAPTATION_STEPS = [
  {
    title: 'Observe',
    body: 'Speed, engagement distance, fire volume, turn consistency and reload cadence are sampled every frame and smoothed into trait scores.',
  },
  {
    title: 'Assess',
    body: 'Those scores are matched against six play-style readings. The strongest reading wins, but only if it is clearly stronger than the current one.',
  },
  {
    title: 'Commit',
    body: 'A reading must hold for at least five seconds before it can be replaced. Enemies change tactics deliberately — never twitch between behaviours.',
  },
  {
    title: 'Act',
    body: 'Every hostile applies the order through its own doctrine, so a Rusher and a Marksman respond to the same command in visibly different ways.',
  },
];

function AdaptationSection() {
  return (
    <section className="section section--alt" id="adaptation">
      <div className="shell">
        <div className="section__head">
          <p className="eyebrow eyebrow--signal">Primary feature</p>
          <h2>The enemies observe. Then they adapt.</h2>
          <p className="lead">
            Adaptation is not a difficulty slider and not a scripted counter. A behaviour model reads
            what you actually do, a tactical director decides what that means, and every hostile
            carries out the conclusion according to its own doctrine.
          </p>
        </div>

        <div className="steps">
          {ADAPTATION_STEPS.map((step) => (
            <div className="step" key={step.title}>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__body">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="card-grid" style={{ marginTop: 'var(--sp-9)' }}>
          <article className="feature feature--telemetry">
            <span className="feature__index">Reads as</span>
            <h3 className="feature__title">Aggressor</h3>
            <p className="feature__body">
              You close distance and keep firing. Enemies give ground, spread out and set crossfires
              instead of meeting you head-on.
            </p>
          </article>
          <article className="feature feature--telemetry">
            <span className="feature__index">Reads as</span>
            <h3 className="feature__title">Camper</h3>
            <p className="feature__body">
              You hold a position. Enemies converge from several angles so that no single firing lane
              stays safe.
            </p>
          </article>
          <article className="feature feature--telemetry">
            <span className="feature__index">Reads as</span>
            <h3 className="feature__title">Marksman</h3>
            <p className="feature__body">
              You fight at range. Enemies close the gap and reposition to break your sightlines.
            </p>
          </article>
          <article className="feature feature--telemetry">
            <span className="feature__index">Reads as</span>
            <h3 className="feature__title">Predictable orbit</h3>
            <p className="feature__body">
              You circle the same way. Enemies stop chasing and start intercepting the path ahead of
              you.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── Arsenal ──────────────────────────────────────────────────────────────── */

function ArsenalSection() {
  const weapons = Object.values(WEAPONS);

  return (
    <section className="section" id="arsenal">
      <div className="shell">
        <div className="section__head">
          <p className="eyebrow eyebrow--ammo">Arsenal</p>
          <h2>Four weapons with genuinely different answers</h2>
          <p className="lead">
            Each weapon trades something away. The sidearm has no clear weakness, the rifle wins
            sustained output, the breacher wins a corridor and loses a field, and the longshot wins a
            single moment and pays for it in tempo.
          </p>
        </div>

        <div className="weapon-grid">
          {weapons.map((weapon) => (
            <article className="weapon-card" key={weapon.id}>
              <div className="weapon-card__head">
                <h3 className="weapon-card__name">{weapon.name}</h3>
                {weapon.unlockLevel > 1 ? (
                  <Badge tone="xp">Level {weapon.unlockLevel}</Badge>
                ) : (
                  <Badge tone="vital">Standard issue</Badge>
                )}
              </div>
              <p className="weapon-card__role">{weapon.role}</p>
              <p className="text-2" style={{ fontSize: 'var(--fs-sm)' }}>
                {weapon.description}
              </p>
              <dl className="weapon-card__specs">
                <div className="weapon-card__spec">
                  <dt>Damage</dt>
                  <dd>{weapon.damage}</dd>
                </div>
                <div className="weapon-card__spec">
                  <dt>{weapon.pellets > 1 ? 'Per burst' : 'Rate'}</dt>
                  <dd>
                    {weapon.pellets > 1
                      ? `${burstDamage(weapon)} (${weapon.pellets} pellets)`
                      : `${roundsPerSecond(weapon).toFixed(1)}/s`}
                  </dd>
                </div>
                <div className="weapon-card__spec">
                  <dt>Magazine</dt>
                  <dd>{weapon.magazine}</dd>
                </div>
                <div className="weapon-card__spec">
                  <dt>Reload</dt>
                  <dd>{(weapon.reloadMs / 1000).toFixed(2)}s</dd>
                </div>
                <div className="weapon-card__spec">
                  <dt>Spread</dt>
                  <dd>{weapon.spreadDeg}°</dd>
                </div>
                <div className="weapon-card__spec">
                  <dt>Sustained DPS</dt>
                  <dd>{sustainedDps(weapon).toFixed(0)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Enemies ──────────────────────────────────────────────────────────────── */

function EnemySection() {
  const archetypes = SPAWNABLE_ARCHETYPES.map((id) => ENEMY_ARCHETYPES[id]);

  return (
    <section className="section section--alt" id="opposition">
      <div className="shell">
        <div className="section__head">
          <p className="eyebrow eyebrow--hostile">Opposition</p>
          <h2>Seven doctrines, one overseer</h2>
          <p className="lead">
            Every hostile belongs to a doctrine with its own speed, durability, engagement range and
            weapon. The tactical director issues one order to all of them; each carries it out in its
            own way.
          </p>
        </div>

        <div className="scroll-x">
          <table className="data-table" style={{ minWidth: 720 }}>
            <caption>Enemy doctrine comparison — base values before wave scaling</caption>
            <thead>
              <tr>
                <th scope="col">Doctrine</th>
                <th scope="col">Behaviour</th>
                <th scope="col" className="num">
                  Health
                </th>
                <th scope="col" className="num">
                  Speed
                </th>
                <th scope="col" className="num">
                  Range
                </th>
                <th scope="col" className="num">
                  First seen
                </th>
              </tr>
            </thead>
            <tbody>
              {archetypes.map((archetype) => (
                <tr key={archetype.id}>
                  <th scope="row" style={{ textTransform: 'none', color: 'var(--ink)', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-sm)' }}>
                    {archetype.name}
                  </th>
                  <td className="text-2" style={{ whiteSpace: 'normal', minWidth: 260 }}>
                    {archetype.doctrine}
                  </td>
                  <td className="num">{formatNumber(archetype.maxHealth)}</td>
                  <td className="num">{formatNumber(archetype.speed)}</td>
                  <td className="num">{formatNumber(archetype.preferredRange)}</td>
                  <td className="num">Wave {archetype.minWave}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 'var(--sp-7)' }}>
          <article className="feature feature--hostile">
            <span className="feature__index">Boss · wave 10, 20, 30</span>
            <h3 className="feature__title">The Executor</h3>
            <p className="feature__body">
              The arena's overseer fights in three phases that change with its own condition. It
              opens by holding distance and firing volleys, escalates into relentless pursuit once
              its armour is breached, and finishes with radial area bursts and tactical
              repositioning. Its health bar marks exactly where the next escalation begins.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── How to play ──────────────────────────────────────────────────────────── */

const CONTROLS_DESKTOP = [
  ['Move', 'W A S D or arrow keys'],
  ['Aim', 'Mouse position'],
  ['Fire', 'Left mouse button or Space'],
  ['Reload', 'R'],
  ['Switch weapon', 'Q'],
  ['Pause', 'Escape'],
];

const CONTROLS_TOUCH = [
  ['Move', 'Left thumb stick'],
  ['Aim and fire', 'Right thumb stick'],
  ['Reload', 'Reload button'],
  ['Switch weapon', 'Weapon button'],
  ['Pause', 'Pause button'],
];

function HowToPlaySection() {
  return (
    <section className="section" id="how-to-play">
      <div className="shell">
        <div className="section__head">
          <p className="eyebrow eyebrow--vital">Controls</p>
          <h2>Keyboard, mouse or two thumbs</h2>
          <p className="lead">
            Both control schemes are first-class. The arena plays identically on a desktop and on an
            Android phone held in landscape.
          </p>
        </div>

        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          <div className="panel">
            <header className="panel-head">
              <h3 className="panel-head__title">Desktop</h3>
              <Badge tone="telemetry">Keyboard and mouse</Badge>
            </header>
            <dl className="weapon-card__specs" style={{ gridTemplateColumns: '1fr' }}>
              {CONTROLS_DESKTOP.map(([action, keys]) => (
                <div className="weapon-card__spec" key={action} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
                  <dt style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'var(--fs-sm)' }}>{action}</dt>
                  <dd>{keys}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="panel">
            <header className="panel-head">
              <h3 className="panel-head__title">Mobile</h3>
              <Badge tone="ammo">Touch</Badge>
            </header>
            <dl className="weapon-card__specs" style={{ gridTemplateColumns: '1fr' }}>
              {CONTROLS_TOUCH.map(([action, keys]) => (
                <div className="weapon-card__spec" key={action} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
                  <dt style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'var(--fs-sm)' }}>{action}</dt>
                  <dd>{keys}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── CTA ──────────────────────────────────────────────────────────────────── */

function CallToAction() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <section className="section">
      <div className="shell shell--narrow">
        <div className="cta-band">
          <p className="eyebrow eyebrow--signal" style={{ justifyContent: 'center' }}>
            The arena is waiting
          </p>
          <h2>Bring a strategy. The arena will learn it.</h2>
          <p className="lead" style={{ marginInline: 'auto' }}>
            Registering takes an email address and a callsign. Your first match begins the moment you
            press play.
          </p>
          <div className="cta-band__actions">
            {user ? (
              <Button variant="primary" size="lg" onClick={() => navigate('/dashboard')}>
                Go to dashboard
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" onClick={() => navigate('/register')}>
                  Register
                </Button>
                <Button variant="ghost" size="lg" onClick={() => navigate('/login')}>
                  Log in
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function LandingPage() {
  const { misconfigured } = useAuth();

  return (
    <SiteLayout>
      {misconfigured ? (
        <div className="shell" style={{ paddingTop: 'var(--sp-5)' }}>
          <Alert tone="warn">
            This build has no Supabase project configured. The arena works, but accounts, statistics
            and the leaderboard cannot persist. See <code className="mono">.env.example</code>.
          </Alert>
        </div>
      ) : null}

      <Hero />
      <FeatureGrid />
      <AdaptationSection />
      <ArsenalSection />
      <EnemySection />
      <HowToPlaySection />
      <CallToAction />
    </SiteLayout>
  );
}
