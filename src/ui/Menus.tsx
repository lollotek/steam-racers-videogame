/**
 * Front-end screens (doc 04 B1–B3): title and setup wizard, Cup briefing, results, standings,
 * workshop, trophy, pause menu. Navigable with keyboard, gamepad and touch (menu-nav.ts).
 */
import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  CUP_NAME,
  CUP_ROUNDS,
  DIFFICULTIES,
  DIFFICULTY,
  MAX_LEVEL,
  UPGRADE_HINTS,
  UPGRADE_LINES,
  UPGRADE_NAMES,
  VEHICLE_IDS,
  VEHICLE_NAMES,
  formatMoney,
  gridFor,
  levelSum,
  standings,
  upgradePrice,
  type Difficulty,
  type VehicleId,
} from '../cup/cup';
import { flowUi, formatTime, ui, type FlowActions, type ResultRow } from './state';
import { useMenuNav, useRefocus } from './menu-nav';
import { Controls } from './Controls';
import { TuningPanel } from './TuningPanel';
import { activeTuning, tuningSummary } from '../tuning/active';

type Mode = 'cup' | 'single';
type Step = 'mode' | 'players' | 'difficulty' | 'vehicle0' | 'vehicle1' | 'track';

const VEHICLE_HINTS: Record<VehicleId, string> = {
  hotrod: 'Light and nimble, rear-wheel drive. Wide start band.',
  tank: 'Heavy, tracked, all-wheel drive. Bigger boiler, wins rams.',
};
const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: 'Slower rivals who misjudge hazards. Prizes × 0.75.',
  normal: 'The Cup as intended.',
  hard: 'Sharp, fast rivals who upgrade well. Prizes × 1.25.',
};

function Option({ label, hint, onPick, testid, autofocus }: { label: string; hint?: string; onPick: () => void; testid?: string; autofocus?: boolean }) {
  return (
    <button class="menu-item" data-nav data-autofocus={autofocus ? '' : undefined} data-testid={testid} onClick={onPick}>
      <span class="menu-label">{label}</span>
      {hint && <span class="menu-hint">{hint}</span>}
    </button>
  );
}

// --- Title + setup wizard -------------------------------------------------------------------------

export function TitleScreen({ actions }: { actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [players, setPlayers] = useState<1 | 2>(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [vehicles, setVehicles] = useState<VehicleId[]>(['hotrod', 'tank']);
  const [tuning, setTuning] = useState(false);
  const saved = flowUi.saved.value;
  const tuned = activeTuning.value;

  const steps: Step[] = ['mode'];
  if (mode) {
    if (flowUi.canSplit.value) steps.push('players');
    steps.push('difficulty', 'vehicle0');
    if (players === 2) steps.push('vehicle1');
    if (mode === 'single') steps.push('track');
  }
  const step = steps[Math.min(stepIdx, steps.length - 1)]!;
  const next = () => setStepIdx((i) => i + 1);
  const back = () => {
    if (tuning) {
      setTuning(false);
      return;
    }
    if (stepIdx === 0) return;
    if (stepIdx === 1) setMode(null);
    setStepIdx((i) => i - 1);
  };
  const finish = (vs: VehicleId[], trackId?: string) => {
    const choice = {
      players,
      difficulty,
      vehicles: vs.slice(0, players),
      trackId,
    };
    if (mode === 'cup') actions.newCup(choice);
    else actions.startSingle(choice);
  };
  const pickVehicle = (p: number, v: VehicleId) => {
    const vs = [...vehicles];
    vs[p] = v;
    setVehicles(vs);
    const last = steps[steps.length - 1] === step;
    if (last) finish(vs);
    else next();
  };
  useMenuNav(root, back);
  // The save is read once the renderer is up: refocus when "Continue Cup" appears.
  const canContinue = !!saved;
  useRefocus(root, `${step}:${canContinue}:${tuning}`);

  let body: ComponentChildren;
  let heading = '';
  switch (step) {
    case 'mode':
      heading = '';
      body = (
        <>
          {canContinue && (
            <Option
              label="Continue Cup"
              hint={`${saved!.stage === 'done' ? 'Final standings and trophy' : `Race ${saved!.round + 1} of ${CUP_ROUNDS.length}`} · ${DIFFICULTY[saved!.difficulty].label}`}
              testid="menu-continue"
              autofocus
              onPick={() => actions.continueCup()}
            />
          )}
          <Option
            label="Grand Prix"
            hint={`${CUP_NAME}: ${CUP_ROUNDS.length} races${canContinue ? ' (replaces the saved Cup)' : ''}`}
            testid="menu-grand-prix"
            onPick={() => {
              setMode('cup');
              next();
            }}
          />
          <Option
            label="Single race"
            hint="One track, random grid, no workshop"
            testid="menu-single"
            onPick={() => {
              setMode('single');
              next();
            }}
          />
          <Option label="Playtest tuning" hint={tuned ? `Active: ${tuningSummary(tuned)}` : 'Load parameters written with an AI assistant'} testid="menu-tuning" onPick={() => setTuning(true)} />
        </>
      );
      break;
    case 'players':
      heading = 'Players';
      body = (
        <>
          <Option label="1 player" testid="menu-players-1" autofocus={players === 1} onPick={() => (setPlayers(1), next())} />
          <Option label="2 players" hint="Split screen: WASD + arrows, or two gamepads" testid="menu-players-2" autofocus={players === 2} onPick={() => (setPlayers(2), next())} />
        </>
      );
      break;
    case 'difficulty':
      heading = 'Difficulty';
      body = DIFFICULTIES.map((d) => (
        <Option key={d} label={DIFFICULTY[d].label} hint={DIFFICULTY_HINTS[d]} testid={`menu-difficulty-${d}`} autofocus={d === difficulty} onPick={() => (setDifficulty(d), next())} />
      ));
      break;
    case 'vehicle0':
    case 'vehicle1': {
      const p = step === 'vehicle0' ? 0 : 1;
      heading = players === 2 ? `Player ${p + 1}: vehicle` : 'Vehicle';
      body = VEHICLE_IDS.map((v) => <Option key={v} label={VEHICLE_NAMES[v]} hint={VEHICLE_HINTS[v]} testid={`menu-vehicle-${v}`} autofocus={vehicles[p] === v} onPick={() => pickVehicle(p, v)} />);
      break;
    }
    case 'track':
      heading = 'Track';
      body = actions.tracks.map((t) => <Option key={t.id} label={t.name} testid={`menu-track-${t.id}`} onPick={() => finish(vehicles, t.id)} />);
      break;
  }

  return (
    <div class="screen title-screen" data-testid="title" ref={root}>
      <div class="menu-card">
        <div class="logo">
          <span class="logo-top">STEAM</span>
          <span class="logo-bottom">RACERS</span>
        </div>
        {tuned && !tuning && (
          <div class="title-tuning-badge" data-testid="title-tuning-badge">
            Playtest tuning: {tuningSummary(tuned)}
          </div>
        )}
        {tuning ? (
          <>
            <h2>Playtest tuning</h2>
            <TuningPanel onBack={back} />
          </>
        ) : (
          <>
            {mode && <div class="menu-crumb">{mode === 'cup' ? 'Grand Prix' : 'Single race'}</div>}
            {heading && <h2>{heading}</h2>}
            <div class="menu-list" key={step} data-testid={`step-${step}`}>
              {body}
            </div>
          </>
        )}
        {!tuning && stepIdx > 0 && (
          <button class="btn ghost" data-nav onClick={back}>
            Back
          </button>
        )}
        <p class="dim menu-help">↑ ↓ / d-pad · Enter / A · Esc / B back</p>
      </div>
    </div>
  );
}

// --- Cup screens ----------------------------------------------------------------------------------

function Swatch({ color }: { color: string }) {
  return <span class="swatch" style={{ background: color }} />;
}

export function BriefingScreen({ actions }: { actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const s = flowUi.season.value;
  useMenuNav(root, () => actions.toTitle());
  if (!s) return null;
  const round = CUP_ROUNDS[s.round]!;
  const grid = gridFor(s);
  const order = s.racers.map((_, i) => i).sort((a, b) => grid[a]! - grid[b]!);
  return (
    <div class="screen" data-testid="briefing" ref={root}>
      <div class="menu-card wide briefing">
        <div class="menu-crumb">
          {CUP_NAME} · race {s.round + 1} of {CUP_ROUNDS.length} · {DIFFICULTY[s.difficulty].label}
        </div>
        <h1>{round.track}</h1>
        <h2 class="world">{round.world}</h2>
        <p>{round.blurb}</p>
        <p class="hazard">
          <b>Hazard</b> {round.hazard}
        </p>
        <div class="grid-list">
          <span class="dim">{s.round === 0 ? 'Grid (draw)' : 'Grid (Cup standings, leader on pole)'}</span>
          <ol>
            {order.map((i) => (
              <li key={i} class={s.racers[i]!.player !== null ? 'me' : ''}>
                <Swatch color={s.racers[i]!.color} />
                {s.racers[i]!.name}
              </li>
            ))}
          </ol>
        </div>
        <div class="menu-row actions">
          <button class="btn" data-nav data-autofocus data-testid="start-race" onClick={() => actions.startRound()}>
            Start race
          </button>
          <button class="btn ghost" data-nav data-testid="to-title" onClick={() => actions.toTitle()}>
            Title
          </button>
        </div>
      </div>
    </div>
  );
}

export function StandingsScreen({ actions }: { actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const s = flowUi.season.value;
  useMenuNav(root);
  if (!s) return null;
  const order = standings(s);
  const done = s.stage === 'done';
  return (
    <div class="screen" data-testid="standings" ref={root}>
      <div class="menu-card wide">
        <div class="menu-crumb">
          {CUP_NAME} · after race {s.round} of {CUP_ROUNDS.length}
        </div>
        <h1>Cup standings</h1>
        <table class="standings-table">
          <thead>
            <tr>
              <th />
              <th />
              {CUP_ROUNDS.map((r, k) => (
                <th key={k} title={r.track}>
                  R{k + 1}
                </th>
              ))}
              <th>This race</th>
              <th>Earned</th>
              <th>Cash</th>
              <th title="Workshop levels">Lv</th>
            </tr>
          </thead>
          <tbody>
            {order.map((i, pos) => {
              const r = s.racers[i]!;
              const rep = s.last?.find((x) => x.racer === i);
              return (
                <tr key={i} class={r.player !== null ? 'me' : ''} data-testid={`standing-${pos + 1}`}>
                  <td>{pos + 1}</td>
                  <td>
                    <Swatch color={r.color} />
                    <span class="name">{r.name}</span>
                  </td>
                  {CUP_ROUNDS.map((_, k) => (
                    <td key={k} class="dim">
                      {k < r.finishes.length ? (r.finishes[k] ?? 'R') : ''}
                    </td>
                  ))}
                  <td class="dim">
                    {rep ? `+${formatMoney(rep.prize + rep.bags)}` : ''}
                    {rep && rep.repair > 0 ? ` −${formatMoney(rep.repair)}` : ''}
                  </td>
                  <td>{formatMoney(r.earned)}</td>
                  <td class="dim">{formatMoney(r.cash)}</td>
                  <td class="dim">{levelSum(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="dim">R = retired. The Cup goes to whoever earns the most; workshop spending does not count against you.</p>
        <div class="menu-row actions">
          <button class="btn" data-nav data-autofocus data-testid="standings-continue" onClick={() => actions.standingsContinue()}>
            {done ? 'Trophy' : 'Workshop'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkshopScreen({ actions }: { actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const s = flowUi.season.value;
  const pi = flowUi.workshopPlayer.value;
  useMenuNav(root);
  useRefocus(root, pi);
  if (!s) return null;
  const humans = s.racers.map((r, i) => ({ r, i })).filter((x) => x.r.player !== null);
  const me = humans[Math.min(pi, humans.length - 1)]!;
  const last = pi + 1 >= humans.length;
  return (
    <div class="screen" data-testid="workshop" ref={root}>
      <div class="menu-card wide">
        <div class="menu-crumb">
          Workshop · before race {s.round + 1} of {CUP_ROUNDS.length}: {CUP_ROUNDS[s.round]!.track}
        </div>
        <h1>{humans.length > 1 ? `${me.r.name}'s workshop` : 'Workshop'}</h1>
        <p class="cash" data-testid="workshop-cash">
          <Swatch color={me.r.color} /> {VEHICLE_NAMES[me.r.vehicle]} · cash <b>{formatMoney(me.r.cash)}</b>
        </p>
        <div class="upgrades">
          {UPGRADE_LINES.map((line) => {
            const lv = me.r.levels[line];
            const price = upgradePrice(lv);
            const afford = price !== null && price <= me.r.cash;
            return (
              <div class="upgrade" key={line}>
                <div class="upgrade-head">
                  <span class="menu-label">{UPGRADE_NAMES[line]}</span>
                  <span class="pips">
                    {Array.from({ length: MAX_LEVEL }, (_, k) => (
                      <i key={k} class={k < lv ? 'on' : ''} />
                    ))}
                  </span>
                </div>
                <span class="menu-hint">{UPGRADE_HINTS[line]}</span>
                <button class="btn small" data-nav data-testid={`buy-${line}`} disabled={!afford} onClick={() => actions.buy(me.i, line)}>
                  {price === null ? 'MAX' : `Buy ${formatMoney(price)}`}
                </button>
              </div>
            );
          })}
        </div>
        <p class="dim">Upgrades last for this Cup. Rivals shop with the same prices.</p>
        <div class="menu-row actions">
          <button class="btn" data-nav data-autofocus data-testid="workshop-done" onClick={() => actions.workshopDone()}>
            {last ? 'Next race' : `Done: ${humans[pi + 1]!.r.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrophyScreen({ actions }: { actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const s = flowUi.season.value;
  useMenuNav(root);
  if (!s) return null;
  const order = standings(s);
  const winner = s.racers[order[0]!]!;
  const best = order.findIndex((i) => s.racers[i]!.player !== null);
  const won = winner.player !== null;
  return (
    <div class="screen" data-testid="trophy" ref={root}>
      <div class="menu-card wide trophy">
        <div class="menu-crumb">
          {CUP_NAME} · {DIFFICULTY[s.difficulty].label}
        </div>
        <div class="cup-icon" aria-hidden="true">
          🏆
        </div>
        <h1>{won ? `${winner.name} wins the Cup!` : `${winner.name} wins the Cup`}</h1>
        <p>{won ? `${formatMoney(winner.earned)} earned over ${CUP_ROUNDS.length} races.` : `Your best: ${ordinal(best + 1)} place.`}</p>
        <ol class="podium">
          {order.slice(0, 3).map((i) => (
            <li key={i} class={s.racers[i]!.player !== null ? 'me' : ''}>
              <Swatch color={s.racers[i]!.color} />
              {s.racers[i]!.name} · {formatMoney(s.racers[i]!.earned)}
            </li>
          ))}
        </ol>
        <div class="menu-row actions">
          <button class="btn" data-nav data-autofocus data-testid="trophy-title" onClick={() => actions.toTitle()}>
            Back to title
          </button>
        </div>
      </div>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// --- In-race overlays -------------------------------------------------------------------------------

export function ResultsPanel({ results, actions }: { results: ResultRow[]; actions: FlowActions }) {
  const root = useRef<HTMLDivElement>(null);
  const mode = flowUi.mode.value;
  // Quick mode keeps the M3 controls (Enter / steam push restart, handled by the game).
  useMenuNav(root, undefined, mode !== 'quick' && !ui.paused.value);
  const cup = mode === 'cup';
  return (
    <div class="overlay" data-testid="results" ref={root}>
      <div class="panel results">
        <h1>Results</h1>
        <table>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.name} class={`${r.isPlayer ? 'me' : ''} ${r.retired ? 'retired' : ''}`} data-testid={`result-${i + 1}`}>
                <td>{r.retired ? '—' : i + 1}</td>
                <td>
                  <span class="swatch" style={{ background: r.color }} />
                  <span class="name">{r.name}</span>
                </td>
                <td>{r.retired ? 'RETIRED' : r.time !== null ? formatTime(r.time) : 'racing…'}</td>
                <td class="dim opt">best {formatTime(r.bestLap)}</td>
                <td class="dim opt">{r.pf} PF</td>
                {cup && <td class="money-cell">{r.prize ? formatMoney(r.prize) : ''}</td>}
                {(cup || r.bags > 0) && <td class="money-cell dim">{r.bags > 0 ? `+${formatMoney(r.bags)} bags` : ''}</td>}
                {cup && <td class="money-cell bad">{r.repair ? `repair −${formatMoney(r.repair)}` : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {cup && <p class="dim">Rivals still racing keep their current position when you continue.</p>}
        <div class="menu-row actions">
          {cup ? (
            <button class="btn" data-nav data-autofocus data-testid="results-continue" onClick={() => actions.resultsContinue()}>
              Continue
            </button>
          ) : (
            <>
              <button class="btn" data-nav data-autofocus data-testid="restart" onClick={() => actions.raceAgain()}>
                Race again
              </button>
              {mode === 'single' && (
                <button class="btn ghost" data-nav data-testid="to-title" onClick={() => actions.toTitle()}>
                  Title
                </button>
              )}
            </>
          )}
        </div>
        {mode === 'quick' && <p class="dim">Enter · Steam push · A</p>}
      </div>
    </div>
  );
}

export function PauseMenu({ actions, split }: { actions: FlowActions; split: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const mode = flowUi.mode.value;
  // No back handler: Esc / P / Start already toggle the pause in the game input (a second
  // handler here would resume and the game would pause again on the same key press).
  useMenuNav(root);
  const finished = ui.results.value !== null;
  return (
    <div
      class="overlay"
      data-testid="pause-overlay"
      ref={root}
      onPointerDown={(e) => {
        // Tap outside the panel resumes (M2 behaviour).
        if (e.target === e.currentTarget) actions.resume();
      }}
    >
      <div class="panel pause">
        <h1>Paused</h1>
        <div class="menu-row">
          <button class="btn" data-nav data-autofocus data-testid="pause-resume" onClick={() => actions.resume()}>
            Resume
          </button>
          {mode !== 'cup' && (
            <button class="btn ghost" data-nav data-testid="pause-restart" onClick={() => actions.restart()}>
              Restart
            </button>
          )}
          {!finished && (
            <button class="btn ghost" data-nav data-testid="pause-retire" onClick={() => actions.retire()}>
              Retire
            </button>
          )}
          <button class="btn ghost" data-nav data-testid="pause-title" onClick={() => actions.toTitle()}>
            {mode === 'cup' ? 'Quit to title (race not counted)' : 'Title'}
          </button>
        </div>
        <Controls split={split} touch={ui.showTouch.value} />
        <p class="dim">Esc / P / Start resumes</p>
      </div>
    </div>
  );
}
