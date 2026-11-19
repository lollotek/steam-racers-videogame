/**
 * The playtest tuning kit for LLMs: a Markdown guide (format, rules, game primer, every parameter)
 * and a defaults file, both built from the live Tunables registry so they never drift from the
 * code. Downloadable from the title screen ("Playtest tuning"); copies in docs/tuning/ are kept up
 * to date by tests/unit/tuning-kit.test.ts (`npm run tuning:kit`).
 */
import type { NumberDef, TunableDef, TunableRegistry } from '../core/tunables';
import { LATE_GROUPS, TUNING_FORMAT, TUNING_VERSION, buildTuningFile, type TuningFile } from '../core/tuning-file';

export const GUIDE_FILENAME = 'steam-racers-tuning-guide.md';
export const DEFAULTS_FILENAME = 'steam-racers-tuning-defaults.json';

type Area = 'gameplay' | 'feel' | 'visual';

interface GroupInfo {
  title: string;
  area: Area;
  about: string;
}

/** One entry per tunable group. Groups missing here still appear (under "Other"). */
const GROUPS: Record<string, GroupInfo> = {
  handling: {
    title: 'Driving and handling',
    area: 'gameplay',
    about:
      'How the vehicle drives. There is no throttle: the vehicle chases the target speed of the engaged gear (6 gears, 6th = `handling.maxSpeed`). ' +
      'Higher `grip`/`sideStiffness` = more planted, less sliding. Drift starts when steering is above `driftSteer` and speed above `driftMinSpeed` × max; then the rear grip drops to `driftRearGrip`. ' +
      '`maxSteer` is the steering angle at low speed, scaled by `steerAtSpeed` at top speed (lower = calmer at speed). Suspension and upright values are stability helpers: change them only for bouncing/flipping complaints.',
  },
  gearbox: {
    title: 'Gearbox and steam push',
    area: 'gameplay',
    about:
      'Gear up = a steam push (costs 1 PV) that also shifts up; brake taps shift down, holding brake for `holdToBrake` seconds really brakes (reverse when stopped). ' +
      '`pushDuration` / `pushCooldown` shape the push rhythm; `steerResponse` is how fast the steering follows the input (higher = twitchier).',
  },
  boiler: {
    title: 'Boiler and steam points (PV)',
    area: 'gameplay',
    about:
      'The central resource. PV are generated passively (one every `regenTime` s, slower above CAL) and spent on pushes. Above CAL the boiler is in the red zone: pushes are stronger but pressure builds; ' +
      'at full pressure (or at 2 × CAL) a reliability test starts: a needle sweeps a half ring and the player must press a gear key on the green notch. Missing it costs gears and hull (emergency valves) or, at 2 × CAL, causes an explosion. ' +
      'Note: a SHORTER `regenTime` means MORE steam. To make the red zone less punishing raise `pressureTime`, `notchWidth` or `testTime`, or lower the damage values.',
  },
  start: {
    title: 'Start test (launch at GO)',
    area: 'gameplay',
    about:
      'Before GO the player holds STEAM to keep a needle inside a green band. Share of time in band in the last `window` seconds decides Perfect / Good / normal start; above `redLine` at GO = stall. ' +
      'Wider `bandWidth` or lower `riseRate` = easier start. `calmTime` blocks pushes and weapons right after GO.',
  },
  weapons: {
    title: 'Weapons and aiming',
    area: 'gameplay',
    about:
      'Weapons are locked at the start and arm when a racer first reaches gear `unlockGear` or completes `unlockLap` laps. The front cannon locks the rival ahead (range, half-angle, lock time) and the shot lands at random inside a dispersion cone: ' +
      '`cone.*` widen it (high gears, steering, recent manoeuvres, vent clouds) or narrow it (`cone.steady` after holding the line for `steadyTime`). Where the shot crosses the target decides the zone (`zone.*`, as fractions of half width): centre and vital add bonus damage. ' +
      'Damage is in PF (hull points; a vehicle has about 20).',
  },
  hull: {
    title: 'Hull, damage and ramming',
    area: 'gameplay',
    about:
      'Hull points (PF) and how they are lost. Each barricade type has `hit` (glancing impact), `crash` (head-on) and `scrapeEvery` (1 PF every N seconds while scraping, 0 = never) damage. ' +
      'Ramming compares inertia + a die roll (`ramDie` sides) + a perpendicular bonus; the margin decides damage, strong wins shove the target. `smokeAt` / `fireAt` are visual damage thresholds; at 0 PF the vehicle is a wreck.',
  },
  barricades: {
    title: 'Track edges (barricade physics)',
    area: 'gameplay',
    about:
      'How the track edge reacts, per barricade type (earth, riveted, hedgehog, corrugated, sandbags, barbed, stone, runepylon, ironrail, wreckwall, tyres, roots, crystal). ' +
      '`scrapeSpeed` = speed kept while sliding along it (× max), `scrapeDrag` = how hard it slows, `hitLoss` = speed lost on a glancing hit, `crashScale` multiplies the crash threshold (higher = harder to crash). ' +
      'The global `crashSpeed` / `crashAngle` decide when a hit becomes a crash (vehicle stops for `crashStun` s). Damage values are in the `hull` group.',
  },
  stats: {
    title: 'Vehicle characteristics',
    area: 'gameplay',
    about:
      'Per-vehicle tabletop stats for the two vehicles (`hotrod`: light, nimble; `tank`: heavy, tracked). CAL = boiler capacity in PV before the red zone; AFF = reliability (slower pressure, wider test notch); ' +
      'RES = subtracted from every hit\'s damage; MAN = manoeuvrability (wider start band); PF = hull points; mass = ramming inertia. Good place to balance the two vehicles against each other.',
  },
  ai: {
    title: 'AI rivals',
    area: 'gameplay',
    about:
      'How the computer drivers race. `lateralAccel` is the cornering limit they plan with (higher = faster and riskier in corners), `steerGain` and `lookAhead*` shape the racing line, `fireRate` how eagerly they shoot when locked, `avoid*` how they dodge other cars, ' +
      '`catchUpGap` the gap after which a rival behind gets a small speed help. NOTE: in Grand Prix and Single race the chosen difficulty sets each rival\'s skill and pace, so `ai.skill` only applies to quick test races; the other `ai.*` values always apply.',
  },
  race: {
    title: 'Race rules',
    area: 'gameplay',
    about: 'Countdown length, grid layout, automatic reposition when stuck or flipped, wall friction.',
  },
  pickups: {
    title: 'Crates on the track',
    area: 'gameplay',
    about: 'Coal crates give PV, money bags give Cup money. Collect radius and respawn time.',
  },
  jumps: {
    title: 'Jumps and landings',
    area: 'gameplay',
    about: 'A clean landing (enough airtime, vehicle level enough) gives `cleanPv` steam.',
  },
  hazards: {
    title: 'Track hazards',
    area: 'gameplay',
    about: 'Per-track hazard zones (molten metal, traffic, etc.). Can be switched off entirely with `hazards.enabled`.',
  },
  camera: {
    title: 'Camera',
    area: 'feel',
    about:
      'Two modes: `board` (high isometric "tabletop" view, the default) and `chase` (behind the vehicle). Each has FOV, pitch, distance (grows towards `distanceAtSpeed` at top speed) and look-ahead. Half-lives are smoothing times (higher = lazier camera).',
  },
  feedback: {
    title: 'Impact feedback (sparks, screen shake)',
    area: 'feel',
    about: 'Sparks and screen shake on impacts and scraping. Turn `shake` off or lower `shakeAmplitude` for motion-sensitive players.',
  },
  hud: {
    title: 'HUD helpers',
    area: 'feel',
    about: 'The gear/steam tag under the vehicle, the corner warning above it (how early it appears) and the boiler test ring size.',
  },
  input: {
    title: 'Controller input',
    area: 'feel',
    about: 'Gamepad stick deadzone and trigger threshold.',
  },
  ink: { title: 'Rendering: ink material', area: 'visual', about: 'Toon shading bands and hatching. Visual style only.' },
  lines: { title: 'Rendering: outlines', area: 'visual', about: 'Ink outlines and the player hull border colours. Visual style only.' },
  post: { title: 'Rendering: post-processing', area: 'visual', about: 'Bloom, colour grade, paper, grain, anti-aliasing. Visual style only. `debugView` must stay `off` for normal play.' },
  fog: { title: 'Rendering: fog', area: 'visual', about: 'Height fog. Visual style only.' },
  light: { title: 'Rendering: lights', area: 'visual', about: 'Sun, ambient and furnace lights. Visual style only.' },
  fx: { title: 'Rendering: particles', area: 'visual', about: 'Steam and smoke particles. Visual and performance.' },
  dressing: { title: 'Rendering: scenery density', area: 'visual', about: 'Props around the track (applied on the next race). Lower for performance.' },
  world: { title: 'World build', area: 'visual', about: 'Track-side decoration switches (applied on the next race).' },
  showcase: { title: 'Demo / showcase', area: 'visual', about: 'Developer demo helpers (autopilot for the player, camera target). Leave alone for playtests.' },
};

const AREAS: { area: Area; title: string; advice: string }[] = [
  { area: 'gameplay', title: 'Gameplay', advice: 'Where balance and feel live. Most playtest feedback maps to these groups.' },
  { area: 'feel', title: 'Camera, feedback and controls', advice: 'Comfort and readability. Safe to change.' },
  { area: 'visual', title: 'Visual and technical', advice: 'Look and performance only. Change these only when the playtester explicitly asks about visuals or performance.' },
];

/** Notes that explain a parameter beyond its label. */
const KEY_NOTES: Record<string, string> = {
  'handling.maxSpeed': 'Top speed in 6th gear; each gear is a fraction of it. Biggest single lever on pace. The AI uses it too.',
  'handling.accel': 'How fast the vehicle reaches the gear target speed.',
  'handling.grip': 'Overall tyre grip. Too high feels on rails, too low feels icy.',
  'handling.driftRearGrip': 'Lower = longer, looser drifts.',
  'handling.mass': 'Physics mass; mostly affects bumps and contact, not ramming damage (see stats.*.mass).',
  'boiler.regenTime': 'Seconds per passively generated PV. LOWER = MORE steam.',
  'boiler.pushCost': 'PV spent per push / shift up.',
  'boiler.pressureTime': 'Higher = more time in the red zone before the reliability test.',
  'boiler.notchWidth': 'Higher = easier reliability test.',
  'gearbox.pushCooldown': 'Minimum time between two pushes.',
  'weapons.unlockGear': '1 = weapons armed from GO.',
  'weapons.unlockLap': '0 = only the gear unlocks weapons.',
  'weapons.cannon.damage': 'Base damage per hit, before zone bonuses and the target RES.',
  'ai.lateralAccel': 'Main AI pace lever in corners. Keep it in line with handling.grip.',
  'ai.skill': 'Only for quick test races: difficulty overrides it in Grand Prix and Single race.',
  'camera.mode': '"board" = isometric tabletop view, "chase" = behind the vehicle.',
  'post.debugView': 'Keep "off".',
  'ink.debugView': 'Keep "off".',
};

function inKit(def: TunableDef): boolean {
  return !LATE_GROUPS.includes(def.group);
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function range(def: TunableDef): string {
  switch (def.type) {
    case 'number': {
      const d = def as NumberDef;
      return `${d.min} … ${d.max}${d.step !== undefined ? ` (step ${d.step})` : ''}`;
    }
    case 'boolean':
      return 'true / false';
    case 'color':
      return '"#RRGGBB"';
    case 'option':
      return def.options.map((o) => `"${o}"`).join(' / ');
  }
}

function value(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : String(v);
}

/** The defaults file: every parameter of the kit at its default value. */
export function buildDefaultsFile(registry: TunableRegistry): TuningFile {
  const all = buildTuningFile(registry, {
    name: 'Defaults',
    notes: 'Every playtest parameter at its default value. Copy only the keys you want to change into a new file.',
    onlyChanged: false,
  });
  const params: TuningFile['params'] = {};
  for (const t of registry.all()) if (inKit(t.def)) params[t.def.key] = t.def.default;
  const { params: _changed, ...head } = all;
  return { ...head, params: Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]!])) };
}

export function buildGuideMarkdown(registry: TunableRegistry): string {
  const defs = registry.all().map((t) => t.def).filter(inKit);
  const groups = [...new Set(defs.map((d) => d.group))];
  const info = (g: string): GroupInfo => GROUPS[g] ?? { title: g, area: 'visual', about: '' };
  const example: TuningFile = {
    format: TUNING_FORMAT,
    version: TUNING_VERSION,
    name: 'Forgiving boiler',
    author: 'playtester name (optional)',
    notes: 'More steam and a gentler red zone: players ran dry before every corner and exploded too often.',
    params: { 'boiler.regenTime': 1.2, 'boiler.pressureTime': 8, 'boiler.notchWidth': 0.22 },
  };

  const out: string[] = [];
  out.push(
    '# Steam Racers · playtest tuning guide',
    '',
    `Generated from the game's parameter registry (${defs.length} parameters). Give this file and \`${DEFAULTS_FILENAME}\` to any AI assistant (ChatGPT, Claude, Gemini, …).`,
    '',
    '## For the playtester',
    '',
    '1. Open a chat with an AI assistant and attach this guide (and the defaults file if you can).',
    '2. Tell it what you felt while playing, in your own words, and ask for one of:',
    '   - **"Write me a tuning file"**: it answers with a JSON file. Save it as `something.json` (or just copy the text).',
    '   - **"Guide me"**: it asks questions and explains which values to change, step by step.',
    '3. In the game: title screen → **Playtest tuning** → **Load file** (or **Paste JSON**). The tuning stays active, also after a reload, until you press **Reset to defaults**. The title screen shows which tuning is active.',
    '4. Play, then tell the AI how it felt and iterate. Send the final file to the developers together with your feedback.',
    '',
    'Example requests:',
    '',
    '> I keep running out of steam before corners and the boiler explodes too often. Write me a tuning file that is more forgiving, but not too easy.',
    '',
    '> The cars feel like they are on ice and the AI is way too fast in corners. Guide me through fixing this.',
    '',
    '## Instructions for the AI assistant',
    '',
    'You are helping a playtester of **Steam Racers**, a steampunk combat racing game, adjust gameplay parameters. Follow these rules:',
    '',
    '- Work in one of two modes, as the playtester asks: **generate** a tuning file, or **guide** them (ask about their experience, propose changes one small batch at a time, explain each). If the feedback is vague, ask one or two short questions first (which vehicle, which track, what exactly felt wrong).',
    '- Only use parameter keys listed in the reference below, spelled exactly. Never invent keys.',
    '- Keep every number inside its range and, when a step is given, on a multiple of the step. Booleans are `true`/`false`, options must be one of the listed strings, colours are `"#RRGGBB"`.',
    '- Include **only the parameters you change**. Anything left out stays at its default. Loading a file always starts from the defaults, so a new file must contain every change you still want.',
    '- Prefer small, targeted changes: usually 2 to 8 parameters, roughly 10–30 % away from the current value, so the playtester can tell what each change did. Explain bigger jumps.',
    '- Stay in the **Gameplay** and **Camera, feedback and controls** groups unless the playtester asks about visuals or performance.',
    '- Mind the links between parameters: faster cars (`handling.maxSpeed`) usually also need the camera `distanceAtSpeed` values and the AI (`ai.lateralAccel`) checked; steam income (`boiler.regenTime`, `pickups.coalPv`, `jumps.cleanPv`) and spending (`boiler.pushCost`) balance each other; weapon damage is relative to hull points (`stats.*.pf`, about 20).',
    `- Output the file as a single \`\`\`json code block in exactly this format (\`format\` and \`version\` are fixed; \`name\` short, under 40 characters; \`notes\` says what changed and why), then a short plain-language list of the changes:`,
    '',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '',
    '- If the playtester sends back a file they used, treat its values as the current state and build the next version from it.',
    '',
    '## Game primer',
    '',
    '- **Racing**: 4–8 steam vehicles race laps on tabletop-style tracks. There is no throttle: the vehicle drives itself at the speed of the engaged gear (6 gears). The player shifts up (each upshift is a *steam push* that costs steam), shifts down / brakes, steers, drifts in corners, vents steam and shoots.',
    '- **PV (steam points)**: the boiler resource. Generated over time and from coal crates and clean jump landings; spent on pushes and shifting up. **CAL** is the boiler capacity; above it the boiler is in the red zone (stronger pushes, rising pressure, risk of a reliability test and explosion).',
    '- **PF (hull points)**: a vehicle has about 20. Lost to weapon hits, rams, crashes and scraping dangerous barricades. At 0 the vehicle is a wreck and retires.',
    '- **AFF / RES / MAN**: reliability (gentler boiler), resistance (reduces damage), manoeuvrability (easier start).',
    '- **Vehicles**: `hotrod` (light, nimble, rear-wheel drive) and `tank` (heavy, tracked, bigger boiler, wins rams).',
    '- **Weapons**: front cannon with limited shells, locked until the boiler warms up (6th gear or after lap 1 by default). Shots land at random in a dispersion cone.',
    '- **Track edges**: a smooth invisible wall with a barricade type per side; the type decides speed loss, crashes and damage.',
    '- Units: m = metres, m/s = metres per second (32 m/s ≈ 115 km/h), s = seconds, ° = degrees, rad = radians.',
    '',
    '## Parameter reference',
    '',
    'Columns: key (use exactly), default value, allowed range, unit, meaning.',
    '',
  );

  for (const a of AREAS) {
    const gs = groups.filter((g) => info(g).area === a.area);
    if (!gs.length) continue;
    out.push(`### ${a.title}`, '', a.advice, '');
    for (const g of gs) {
      const gi = info(g);
      out.push(`#### ${gi.title} (\`${g}.*\`)`, '');
      if (gi.about) out.push(gi.about, '');
      out.push('| Key | Default | Range | Unit | Meaning |', '| :-- | --: | :-- | :-- | :-- |');
      for (const d of defs.filter((x) => x.group === g)) {
        const unit = d.type === 'number' ? (d.unit ?? '') : '';
        const meaning = [d.label ?? '', d.description ?? '', KEY_NOTES[d.key] ?? ''].filter(Boolean).join('. ');
        out.push(`| \`${d.key}\` | ${cell(value(d.default))} | ${cell(range(d))} | ${cell(unit)} | ${cell(meaning)} |`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}
