/**
 * Front-end flow (doc 04 B1/B2): title → setup → (Cup: briefing → race → results → standings →
 * workshop → next race … trophy) or (single race → results → again / title).
 * Owns the current Game (one per race) and the Cup season (saved after every change).
 * `?test` / `?quick` skip the menus and boot straight into the M3 race from the URL flags.
 */
import type { Flags } from '../core/flags';
import type { TouchSource } from '../input/touch';
import type { QualityTierName } from '../render/quality';
import type { RendererHandle } from '../render/renderer';
import { makeProceduralSet, type ProceduralSet } from '../render/procedural/textures';
import { Game, quickSetup, type Entrant, type RaceSetup } from '../game/game';
import { TRACKS, getTrack } from '../tracks';
import {
  CUP_ROUNDS,
  DIFFICULTY,
  IDENTITY_COLORS,
  RIVAL_NAMES,
  aiVehicle,
  applyRace,
  buyUpgrade,
  gridFor,
  loadSeason,
  newSeason,
  noLevels,
  playerName,
  racerTune,
  randomGrid,
  reportFor,
  roundTrackId,
  saveSeason,
  toBriefing,
  tuneFor,
  type KeyValueStore,
  type Season,
  type UpgradeLine,
} from '../cup/cup';
import { flowUi, ui, type FlowActions, type ResultRow, type SetupChoice } from '../ui/state';

export interface FlowContext {
  gfx: RendererHandle;
  flags: Flags;
  isMobile: boolean;
  tier: QualityTierName;
  touch: TouchSource;
  store: KeyValueStore | null;
  /** Called when the current race changes (debug panel, test hooks). */
  onGame?: (game: Game | null) => void;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export class Flow implements FlowActions {
  game: Game | null = null;
  readonly tracks = Object.entries(TRACKS).map(([id, t]) => ({ id, name: t.name }));
  private readonly tex: ProceduralSet;
  private season: Season | null = null;
  /** A race is being built (ignore double clicks). */
  private building = false;

  constructor(private readonly ctx: FlowContext) {
    this.tex = makeProceduralSet(ctx.flags.seed);
    flowUi.canSplit.value = !ctx.isMobile;
    flowUi.saved.value = loadSeason(ctx.store);
  }

  /** Menus unless `quick` (tests and dev: `?test`, `?quick`). */
  async boot(): Promise<void> {
    if (this.ctx.flags.quick) {
      await this.runRace(quickSetup(this.ctx.flags, this.ctx.isMobile));
      return;
    }
    flowUi.screen.value = 'title';
    ui.loading.value = false;
  }

  // --- Races -------------------------------------------------------------------------------------

  private async runRace(setup: RaceSetup): Promise<void> {
    if (this.building) return;
    this.building = true;
    try {
      this.endGame();
      flowUi.mode.value = setup.mode;
      flowUi.screen.value = 'race';
      ui.loading.value = true;
      await nextFrame(); // let the loading card paint before the (blocking) world build
      const { gfx, flags, isMobile, tier, touch } = this.ctx;
      const game = new Game(gfx, { flags, isMobile, tier, touch, race: setup, tex: this.tex });
      this.game = game;
      this.ctx.onGame?.(game);
      await game.warmUp();
      ui.loading.value = false;
      game.start();
    } finally {
      this.building = false;
    }
  }

  private endGame(): void {
    if (!this.game) return;
    this.game.dispose();
    this.game = null;
    this.ctx.onGame?.(null);
  }

  private laps<T extends { laps: number }>(file: T): T {
    return this.ctx.flags.laps ? { ...file, laps: this.ctx.flags.laps } : file;
  }

  /** New seed per Cup / race, fixed under `?test` (repeatable e2e runs). */
  private seed(): number {
    return this.ctx.flags.test ? this.ctx.flags.seed : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  private racers(humans: number): number {
    return Math.max(humans, Math.min(8, this.ctx.flags.racers));
  }

  // --- Single race (gameplay.md §2.2): random grid, no workshop, no repair ---------------------------

  startSingle(c: SetupChoice): void {
    const players = this.ctx.isMobile ? 1 : c.players;
    const d = DIFFICULTY[c.difficulty];
    const n = this.racers(players);
    const entrants: Entrant[] = Array.from({ length: n }, (_, i) =>
      i < players
        ? { name: playerName(i, players), color: IDENTITY_COLORS[i]!, vehicle: c.vehicles[i] ?? 'hotrod' }
        : { name: RIVAL_NAMES[i]!, color: IDENTITY_COLORS[i]!, vehicle: aiVehicle(i), tune: tuneFor(noLevels(), d.aiPace), skill: d.aiSkill, catchUp: d.catchUp },
    );
    const seed = this.seed();
    void this.runRace({ mode: 'single', track: this.laps(getTrack(c.trackId ?? null)), players, entrants, grid: randomGrid(n, seed), seed });
  }

  raceAgain(): void {
    this.game?.startRace();
  }

  // --- Cup ---------------------------------------------------------------------------------------

  private publish(): void {
    flowUi.season.value = this.season ? structuredClone(this.season) : null;
    saveSeason(this.ctx.store, this.season);
    flowUi.saved.value = this.season;
  }

  newCup(c: SetupChoice): void {
    const players = this.ctx.isMobile ? 1 : c.players;
    this.season = newSeason({ difficulty: c.difficulty, vehicles: c.vehicles.slice(0, players), racers: this.racers(players), seed: this.seed() });
    this.publish();
    flowUi.screen.value = 'briefing';
  }

  continueCup(): void {
    const s = loadSeason(this.ctx.store) ?? flowUi.saved.value;
    if (!s) return;
    this.season = structuredClone(s);
    this.publish();
    flowUi.workshopPlayer.value = 0;
    flowUi.screen.value = s.stage === 'workshop' ? 'workshop' : s.stage === 'done' ? 'standings' : 'briefing';
  }

  startRound(): void {
    const s = this.season;
    if (!s || s.stage !== 'briefing') return;
    const round = CUP_ROUNDS[s.round]!;
    const file = this.laps(getTrack(roundTrackId(round, (id) => id in TRACKS)));
    const d = DIFFICULTY[s.difficulty];
    const entrants: Entrant[] = s.racers.map((r, i) => ({
      name: r.name,
      color: r.color,
      vehicle: r.vehicle,
      tune: racerTune(s, i),
      skill: r.player === null ? d.aiSkill : null,
      catchUp: r.player === null ? d.catchUp : 1,
    }));
    const humans = s.racers.filter((r) => r.player !== null).length as 1 | 2;
    const decorate = (rows: ResultRow[]): ResultRow[] =>
      rows.map((row, k) => {
        const rep = reportFor(s, row.index, { position: k + 1, retired: row.retired, wrecked: row.retired && row.pf <= 0, bags: row.bags }, s.racers.length);
        return { ...row, prize: rep.prize, repair: rep.repair };
      });
    void this.runRace({ mode: 'cup', track: file, players: humans, entrants, grid: gridFor(s), seed: (s.seed + s.round * 7919) >>> 0, decorate });
  }

  resultsContinue(): void {
    const s = this.season;
    if (!s || !this.game) return;
    applyRace(s, this.game.outcomes());
    this.endGame();
    this.publish();
    flowUi.screen.value = 'standings';
  }

  standingsContinue(): void {
    const s = this.season;
    if (!s) return;
    flowUi.workshopPlayer.value = 0;
    flowUi.screen.value = s.stage === 'done' ? 'trophy' : 'workshop';
  }

  buy(racer: number, line: UpgradeLine): void {
    const s = this.season;
    if (!s || s.stage !== 'workshop' || s.racers[racer]?.player === null) return;
    if (buyUpgrade(s, racer, line)) this.publish();
  }

  workshopDone(): void {
    const s = this.season;
    if (!s) return;
    const humans = s.racers.filter((r) => r.player !== null).length;
    if (flowUi.workshopPlayer.value + 1 < humans) {
      flowUi.workshopPlayer.value++;
      return;
    }
    toBriefing(s);
    this.publish();
    flowUi.screen.value = 'briefing';
  }

  // --- Pause menu ----------------------------------------------------------------------------------

  resume(): void {
    this.game?.setPaused(false);
  }

  restart(): void {
    if (!this.game || this.game.setup.mode === 'cup') return;
    this.game.startRace();
    this.game.setPaused(false);
  }

  retire(): void {
    this.game?.retire();
  }

  /** Back to the title. A finished Cup is cleared; a Cup left mid-race resumes at that briefing. */
  toTitle(): void {
    this.endGame();
    if (this.season?.stage === 'done') {
      this.season = null;
      this.publish();
    }
    this.season = null;
    flowUi.season.value = null;
    flowUi.saved.value = loadSeason(this.ctx.store);
    flowUi.screen.value = 'title';
    ui.loading.value = false;
  }
}
