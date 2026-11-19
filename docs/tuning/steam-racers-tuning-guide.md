# Steam Racers · playtest tuning guide

Generated from the game's parameter registry (374 parameters). Give this file and `steam-racers-tuning-defaults.json` to any AI assistant (ChatGPT, Claude, Gemini, …).

## For the playtester

1. Open a chat with an AI assistant and attach this guide (and the defaults file if you can).
2. Tell it what you felt while playing, in your own words, and ask for one of:
   - **"Write me a tuning file"**: it answers with a JSON file. Save it as `something.json` (or just copy the text).
   - **"Guide me"**: it asks questions and explains which values to change, step by step.
3. In the game: title screen → **Playtest tuning** → **Load file** (or **Paste JSON**). The tuning stays active, also after a reload, until you press **Reset to defaults**. The title screen shows which tuning is active.
4. Play, then tell the AI how it felt and iterate. Send the final file to the developers together with your feedback.

Example requests:

> I keep running out of steam before corners and the boiler explodes too often. Write me a tuning file that is more forgiving, but not too easy.

> The cars feel like they are on ice and the AI is way too fast in corners. Guide me through fixing this.

## Instructions for the AI assistant

You are helping a playtester of **Steam Racers**, a steampunk combat racing game, adjust gameplay parameters. Follow these rules:

- Work in one of two modes, as the playtester asks: **generate** a tuning file, or **guide** them (ask about their experience, propose changes one small batch at a time, explain each). If the feedback is vague, ask one or two short questions first (which vehicle, which track, what exactly felt wrong).
- Only use parameter keys listed in the reference below, spelled exactly. Never invent keys.
- Keep every number inside its range and, when a step is given, on a multiple of the step. Booleans are `true`/`false`, options must be one of the listed strings, colours are `"#RRGGBB"`.
- Include **only the parameters you change**. Anything left out stays at its default. Loading a file always starts from the defaults, so a new file must contain every change you still want.
- Prefer small, targeted changes: usually 2 to 8 parameters, roughly 10–30 % away from the current value, so the playtester can tell what each change did. Explain bigger jumps.
- Stay in the **Gameplay** and **Camera, feedback and controls** groups unless the playtester asks about visuals or performance.
- Mind the links between parameters: faster cars (`handling.maxSpeed`) usually also need the camera `distanceAtSpeed` values and the AI (`ai.lateralAccel`) checked; steam income (`boiler.regenTime`, `pickups.coalPv`, `jumps.cleanPv`) and spending (`boiler.pushCost`) balance each other; weapon damage is relative to hull points (`stats.*.pf`, about 20).
- Output the file as a single ```json code block in exactly this format (`format` and `version` are fixed; `name` short, under 40 characters; `notes` says what changed and why), then a short plain-language list of the changes:

```json
{
  "format": "steam-racers-tuning",
  "version": 1,
  "name": "Forgiving boiler",
  "author": "playtester name (optional)",
  "notes": "More steam and a gentler red zone: players ran dry before every corner and exploded too often.",
  "params": {
    "boiler.regenTime": 1.2,
    "boiler.pressureTime": 8,
    "boiler.notchWidth": 0.22
  }
}
```

- If the playtester sends back a file they used, treat its values as the current state and build the next version from it.

## Game primer

- **Racing**: 4–8 steam vehicles race laps on tabletop-style tracks. There is no throttle: the vehicle drives itself at the speed of the engaged gear (6 gears). The player shifts up (each upshift is a *steam push* that costs steam), shifts down / brakes, steers, drifts in corners, vents steam and shoots.
- **PV (steam points)**: the boiler resource. Generated over time and from coal crates and clean jump landings; spent on pushes and shifting up. **CAL** is the boiler capacity; above it the boiler is in the red zone (stronger pushes, rising pressure, risk of a reliability test and explosion).
- **PF (hull points)**: a vehicle has about 20. Lost to weapon hits, rams, crashes and scraping dangerous barricades. At 0 the vehicle is a wreck and retires.
- **AFF / RES / MAN**: reliability (gentler boiler), resistance (reduces damage), manoeuvrability (easier start).
- **Vehicles**: `hotrod` (light, nimble, rear-wheel drive) and `tank` (heavy, tracked, bigger boiler, wins rams).
- **Weapons**: front cannon with limited shells, locked until the boiler warms up (6th gear or after lap 1 by default). Shots land at random in a dispersion cone.
- **Track edges**: a smooth invisible wall with a barricade type per side; the type decides speed loss, crashes and damage.
- Units: m = metres, m/s = metres per second (32 m/s ≈ 115 km/h), s = seconds, ° = degrees, rad = radians.

## Parameter reference

Columns: key (use exactly), default value, allowed range, unit, meaning.

### Gameplay

Where balance and feel live. Most playtest feedback maps to these groups.

#### Race rules (`race.*`)

Countdown length, grid layout, automatic reposition when stuck or flipped, wall friction.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `race.gridFirst` | 6.25 | 2 … 30 (step 0.25) | m | Grid: pole behind the line |
| `race.gridRowGap` | 12.5 | 6 … 30 (step 0.5) | m | Grid: distance between rows |
| `race.gridStagger` | 7.5 | 0 … 15 (step 0.5) | m | Grid: left column offset back |
| `race.gridLateral` | 0.5 | 0.2 … 0.7 (step 0.01) |  | Grid: columns from centre (× half width) |
| `race.countdown` | 3 | 0 … 10 (step 0.5) | s | Countdown |
| `race.autoReposition` | 2.5 | 0.5 … 10 (step 0.5) | s | Auto reposition after stuck/flipped |
| `race.wallFriction` | 0.15 | 0 … 1 (step 0.01) |  | Safety wall friction |
| `race.impactMinSpeed` | 2.5 | 0.5 … 20 (step 0.1) | m/s | Impact event: min speed change |

#### Boiler and steam points (PV) (`boiler.*`)

The central resource. PV are generated passively (one every `regenTime` s, slower above CAL) and spent on pushes. Above CAL the boiler is in the red zone: pushes are stronger but pressure builds; at full pressure (or at 2 × CAL) a reliability test starts: a needle sweeps a half ring and the player must press a gear key on the green notch. Missing it costs gears and hull (emergency valves) or, at 2 × CAL, causes an explosion. Note: a SHORTER `regenTime` means MORE steam. To make the red zone less punishing raise `pressureTime`, `notchWidth` or `testTime`, or lower the damage values.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `boiler.startPv` | 2 | 0 … 20 (step 1) | PV | Ignition PV on the grid |
| `boiler.regenTime` | 1.5 | 0.1 … 10 (step 0.1) | s/PV | Passive generation (below CAL). Seconds per passively generated PV. LOWER = MORE steam. |
| `boiler.redRegenFactor` | 0.3 | 0 … 1 (step 0.05) |  | Passive generation above CAL (×) |
| `boiler.pushCost` | 1 | 0 … 5 (step 1) | PV | Push cost. PV spent per push / shift up. |
| `boiler.downshiftRefund` | 1 | 0 … 3 (step 1) | PV | Downshift from 4th+: PV back |
| `boiler.redPushBonus` | 1.4 | 1 … 3 (step 0.05) |  | Push strength in the red zone (×) |
| `boiler.pressureTime` | 6 | 0.5 … 30 (step 0.5) | s | Red zone: time to full pressure (1 PV over, AFF 0). Higher = more time in the red zone before the reliability test. |
| `boiler.affPressure` | 0.15 | 0 … 0.5 (step 0.01) |  | Pressure slowdown per AFF |
| `boiler.testTime` | 1.4 | 0.3 … 5 (step 0.05) | s | Reliability test: needle sweep |
| `boiler.testGrace` | 0.2 | 0 … 1 (step 0.05) | s | Reliability test: gear presses ignored at start |
| `boiler.notchWidth` | 0.16 | 0.02 … 0.6 (step 0.01) |  | Reliability test: notch width. Higher = easier reliability test. |
| `boiler.affNotch` | 0.025 | 0 … 0.2 (step 0.005) |  | Notch width per AFF |
| `boiler.ventPressure` | 0.35 | 0 … 1 (step 0.05) |  | Vent: pressure released |
| `boiler.ventCloud` | 2.5 | 0 … 10 (step 0.1) | s | Vent cloud lifetime |
| `boiler.ventCooldown` | 0.4 | 0 … 3 (step 0.05) | s | Vent cooldown |
| `boiler.emergencyGears` | 3 | 0 … 5 (step 1) |  | Emergency valves: gears lost |
| `boiler.emergencyDamage` | 1 | 0 … 10 (step 1) | PF | Emergency valves: damage |
| `boiler.burstDamage` | 2 | 0 … 10 (step 1) | PF | Valves give (2×CAL): damage |
| `boiler.explosionStall` | 2.5 | 0 … 10 (step 0.1) | s | Explosion: STALL time |
| `boiler.explosionCal` | 2 | 0 … 5 (step 1) | PV | Explosion: CAL lost |
| `boiler.explosionNoRegen` | 8 | 0 … 60 (step 1) | s | Explosion: no passive generation |
| `boiler.shockRadius` | 9 | 0 … 30 (step 0.5) | m | Explosion: shock wave radius |
| `boiler.shockImpulse` | 9 | 0 … 40 (step 0.5) | m/s | Explosion: shock wave push |

#### Gearbox and steam push (`gearbox.*`)

Gear up = a steam push (costs 1 PV) that also shifts up; brake taps shift down, holding brake for `holdToBrake` seconds really brakes (reverse when stopped). `pushDuration` / `pushCooldown` shape the push rhythm; `steerResponse` is how fast the steering follows the input (higher = twitchier).

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `gearbox.holdToBrake` | 0.25 | 0.05 … 1 (step 0.05) | s | Hold time → brake |
| `gearbox.pushDuration` | 0.8 | 0.1 … 3 (step 0.05) | s | Steam push duration |
| `gearbox.pushCooldown` | 1 | 0 … 5 (step 0.05) | s | Steam push cooldown. Minimum time between two pushes. |
| `gearbox.steerResponse` | 8 | 1 … 40 (step 0.5) | 1/s | Steer response |

#### Driving and handling (`handling.*`)

How the vehicle drives. There is no throttle: the vehicle chases the target speed of the engaged gear (6 gears, 6th = `handling.maxSpeed`). Higher `grip`/`sideStiffness` = more planted, less sliding. Drift starts when steering is above `driftSteer` and speed above `driftMinSpeed` × max; then the rear grip drops to `driftRearGrip`. `maxSteer` is the steering angle at low speed, scaled by `steerAtSpeed` at top speed (lower = calmer at speed). Suspension and upright values are stability helpers: change them only for bouncing/flipping complaints.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `handling.maxSpeed` | 32 | 5 … 80 (step 0.5) | m/s | Max speed (6th). Top speed in 6th gear; each gear is a fraction of it. Biggest single lever on pace. The AI uses it too. |
| `handling.accel` | 9 | 1 … 40 (step 0.5) | m/s² | Engine acceleration. How fast the vehicle reaches the gear target speed. |
| `handling.engineBrake` | 5 | 0 … 30 (step 0.5) | m/s² | Engine braking (above gear speed) |
| `handling.brake` | 20 | 1 … 60 (step 0.5) | m/s² | Brake |
| `handling.pushAccel` | 10 | 0 … 40 (step 0.5) | m/s² | Steam push accel |
| `handling.maxSteer` | 0.55 | 0.1 … 1.2 (step 0.01) | rad | Max steer angle (slow) |
| `handling.steerAtSpeed` | 0.35 | 0.05 … 1 (step 0.01) |  | Steer factor at top speed |
| `handling.grip` | 2.2 | 0.2 … 12 (step 0.05) |  | Tyre friction slip. Overall tyre grip. Too high feels on rails, too low feels icy. |
| `handling.sideStiffness` | 1 | 0.1 … 4 (step 0.05) |  | Side friction stiffness |
| `handling.driftRearGrip` | 0.55 | 0.1 … 1 (step 0.01) |  | Rear grip while drifting. Lower = longer, looser drifts. |
| `handling.driftSteer` | 0.75 | 0 … 1 (step 0.01) |  | Steer needed to drift |
| `handling.driftMinSpeed` | 0.45 | 0 … 1 (step 0.01) |  | Speed fraction needed to drift |
| `handling.suspensionStiffness` | 28 | 2 … 100 (step 0.5) |  | Suspension stiffness |
| `handling.suspensionDamping` | 3.5 | 0.1 … 20 (step 0.1) |  | Suspension damping |
| `handling.uprightAssist` | 9 | 0 … 20 (step 0.5) | rad/s | Upright assist (spring frequency) |
| `handling.maxTiltRate` | 2.5 | 0.5 … 10 (step 0.1) | rad/s | Max roll/pitch rate |
| `handling.maxYawRate` | 3.2 | 1 … 10 (step 0.1) | rad/s | Max yaw rate |
| `handling.yawInertia` | 3.5 | 1 … 4 (step 0.05) |  | Yaw inertia × per halving of vehicle size |
| `handling.mass` | 1400 | 200 … 6000 (step 50) | kg | Mass. Physics mass; mostly affects bumps and contact, not ramming damage (see stats.*.mass). |

#### Track edges (barricade physics) (`barricades.*`)

How the track edge reacts, per barricade type (earth, riveted, hedgehog, corrugated, sandbags, barbed, stone, runepylon, ironrail, wreckwall, tyres, roots, crystal). `scrapeSpeed` = speed kept while sliding along it (× max), `scrapeDrag` = how hard it slows, `hitLoss` = speed lost on a glancing hit, `crashScale` multiplies the crash threshold (higher = harder to crash). The global `crashSpeed` / `crashAngle` decide when a hit becomes a crash (vehicle stops for `crashStun` s). Damage values are in the `hull` group.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `barricades.crashSpeed` | 9 | 2 … 30 (step 0.5) | m/s | Crash: speed into the edge |
| `barricades.crashAngle` | 45 | 10 … 89 (step 1) | ° | Crash: min impact angle |
| `barricades.crashStun` | 0.7 | 0 … 3 (step 0.05) | s | Crash: stop time |
| `barricades.hitMinSpeed` | 1.5 | 0 … 10 (step 0.1) | m/s | Hit: min speed into the edge |
| `barricades.alignRate` | 2.6 | 0.2 … 8 (step 0.1) | rad/s | Nose realign rate on contact |
| `barricades.contactBand` | 0.3 | 0.02 … 1 (step 0.01) | m | Contact band (scrape distance) |
| `barricades.releaseTime` | 0.25 | 0 … 2 (step 0.05) | s | Time off the edge before contact ends |
| `barricades.rehitTime` | 0.6 | 0 … 3 (step 0.05) | s | Time off the edge before a new hit counts |
| `barricades.runepylon.drain` | 1 | 0 … 5 (step 1) | PV | Rune pylon: PV drained |
| `barricades.runepylon.drainEvery` | 1.5 | 0.2 … 10 (step 0.1) | s | Rune pylon: drain every (scrape) |
| `barricades.scrapeTick` | 0.5 | 0.1 … 3 (step 0.05) | s | Scrape event interval (damage tick, M3) |
| `barricades.earth.scrapeSpeed` | 0.7 | 0.1 … 1 (step 0.01) |  | earth: scrape speed (× max) |
| `barricades.earth.scrapeDrag` | 8 | 0 … 40 (step 0.5) | m/s² | earth: scrape drag |
| `barricades.earth.hitLoss` | 0.2 | 0 … 1 (step 0.01) |  | earth: speed lost on hit |
| `barricades.earth.crashScale` | 1.15 | 0.3 … 3 (step 0.05) |  | earth: crash threshold × |
| `barricades.riveted.scrapeSpeed` | 0.85 | 0.1 … 1 (step 0.01) |  | riveted: scrape speed (× max) |
| `barricades.riveted.scrapeDrag` | 5 | 0 … 40 (step 0.5) | m/s² | riveted: scrape drag |
| `barricades.riveted.hitLoss` | 0.25 | 0 … 1 (step 0.01) |  | riveted: speed lost on hit |
| `barricades.riveted.crashScale` | 1 | 0.3 … 3 (step 0.05) |  | riveted: crash threshold × |
| `barricades.hedgehog.scrapeSpeed` | 0.45 | 0.1 … 1 (step 0.01) |  | hedgehog: scrape speed (× max) |
| `barricades.hedgehog.scrapeDrag` | 16 | 0 … 40 (step 0.5) | m/s² | hedgehog: scrape drag |
| `barricades.hedgehog.hitLoss` | 0.45 | 0 … 1 (step 0.01) |  | hedgehog: speed lost on hit |
| `barricades.hedgehog.crashScale` | 0.85 | 0.3 … 3 (step 0.05) |  | hedgehog: crash threshold × |
| `barricades.corrugated.scrapeSpeed` | 0.75 | 0.1 … 1 (step 0.01) |  | corrugated: scrape speed (× max) |
| `barricades.corrugated.scrapeDrag` | 8 | 0 … 40 (step 0.5) | m/s² | corrugated: scrape drag |
| `barricades.corrugated.hitLoss` | 0.3 | 0 … 1 (step 0.01) |  | corrugated: speed lost on hit |
| `barricades.corrugated.crashScale` | 1 | 0.3 … 3 (step 0.05) |  | corrugated: crash threshold × |
| `barricades.sandbags.scrapeSpeed` | 0.5 | 0.1 … 1 (step 0.01) |  | sandbags: scrape speed (× max) |
| `barricades.sandbags.scrapeDrag` | 14 | 0 … 40 (step 0.5) | m/s² | sandbags: scrape drag |
| `barricades.sandbags.hitLoss` | 0.15 | 0 … 1 (step 0.01) |  | sandbags: speed lost on hit |
| `barricades.sandbags.crashScale` | 1.6 | 0.3 … 3 (step 0.05) |  | sandbags: crash threshold × |
| `barricades.barbed.scrapeSpeed` | 0.55 | 0.1 … 1 (step 0.01) |  | barbed: scrape speed (× max) |
| `barricades.barbed.scrapeDrag` | 12 | 0 … 40 (step 0.5) | m/s² | barbed: scrape drag |
| `barricades.barbed.hitLoss` | 0.2 | 0 … 1 (step 0.01) |  | barbed: speed lost on hit |
| `barricades.barbed.crashScale` | 1.3 | 0.3 … 3 (step 0.05) |  | barbed: crash threshold × |
| `barricades.stone.scrapeSpeed` | 0.8 | 0.1 … 1 (step 0.01) |  | stone: scrape speed (× max) |
| `barricades.stone.scrapeDrag` | 6 | 0 … 40 (step 0.5) | m/s² | stone: scrape drag |
| `barricades.stone.hitLoss` | 0.3 | 0 … 1 (step 0.01) |  | stone: speed lost on hit |
| `barricades.stone.crashScale` | 0.95 | 0.3 … 3 (step 0.05) |  | stone: crash threshold × |
| `barricades.runepylon.scrapeSpeed` | 0.8 | 0.1 … 1 (step 0.01) |  | runepylon: scrape speed (× max) |
| `barricades.runepylon.scrapeDrag` | 6 | 0 … 40 (step 0.5) | m/s² | runepylon: scrape drag |
| `barricades.runepylon.hitLoss` | 0.2 | 0 … 1 (step 0.01) |  | runepylon: speed lost on hit |
| `barricades.runepylon.crashScale` | 1.1 | 0.3 … 3 (step 0.05) |  | runepylon: crash threshold × |
| `barricades.ironrail.scrapeSpeed` | 0.85 | 0.1 … 1 (step 0.01) |  | ironrail: scrape speed (× max) |
| `barricades.ironrail.scrapeDrag` | 4 | 0 … 40 (step 0.5) | m/s² | ironrail: scrape drag |
| `barricades.ironrail.hitLoss` | 0.25 | 0 … 1 (step 0.01) |  | ironrail: speed lost on hit |
| `barricades.ironrail.crashScale` | 1.05 | 0.3 … 3 (step 0.05) |  | ironrail: crash threshold × |
| `barricades.wreckwall.scrapeSpeed` | 0.5 | 0.1 … 1 (step 0.01) |  | wreckwall: scrape speed (× max) |
| `barricades.wreckwall.scrapeDrag` | 14 | 0 … 40 (step 0.5) | m/s² | wreckwall: scrape drag |
| `barricades.wreckwall.hitLoss` | 0.45 | 0 … 1 (step 0.01) |  | wreckwall: speed lost on hit |
| `barricades.wreckwall.crashScale` | 0.85 | 0.3 … 3 (step 0.05) |  | wreckwall: crash threshold × |
| `barricades.tyres.scrapeSpeed` | 0.55 | 0.1 … 1 (step 0.01) |  | tyres: scrape speed (× max) |
| `barricades.tyres.scrapeDrag` | 12 | 0 … 40 (step 0.5) | m/s² | tyres: scrape drag |
| `barricades.tyres.hitLoss` | 0.15 | 0 … 1 (step 0.01) |  | tyres: speed lost on hit |
| `barricades.tyres.crashScale` | 1.7 | 0.3 … 3 (step 0.05) |  | tyres: crash threshold × |
| `barricades.roots.scrapeSpeed` | 0.5 | 0.1 … 1 (step 0.01) |  | roots: scrape speed (× max) |
| `barricades.roots.scrapeDrag` | 13 | 0 … 40 (step 0.5) | m/s² | roots: scrape drag |
| `barricades.roots.hitLoss` | 0.15 | 0 … 1 (step 0.01) |  | roots: speed lost on hit |
| `barricades.roots.crashScale` | 1.5 | 0.3 … 3 (step 0.05) |  | roots: crash threshold × |
| `barricades.crystal.scrapeSpeed` | 0.92 | 0.1 … 1 (step 0.01) |  | crystal: scrape speed (× max) |
| `barricades.crystal.scrapeDrag` | 3 | 0 … 40 (step 0.5) | m/s² | crystal: scrape drag |
| `barricades.crystal.hitLoss` | 0.3 | 0 … 1 (step 0.01) |  | crystal: speed lost on hit |
| `barricades.crystal.crashScale` | 1 | 0.3 … 3 (step 0.05) |  | crystal: crash threshold × |

#### Start test (launch at GO) (`start.*`)

Before GO the player holds STEAM to keep a needle inside a green band. Share of time in band in the last `window` seconds decides Perfect / Good / normal start; above `redLine` at GO = stall. Wider `bandWidth` or lower `riseRate` = easier start. `calmTime` blocks pushes and weapons right after GO.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `start.riseRate` | 0.9 | 0.1 … 4 (step 0.05) | /s | Needle rise (STEAM held) |
| `start.fallRate` | 0.7 | 0.1 … 4 (step 0.05) | /s | Needle fall (released) |
| `start.bandCentre` | 0.62 | 0.2 … 0.9 (step 0.01) |  | Green band centre |
| `start.bandWidth` | 0.14 | 0.02 … 0.5 (step 0.01) |  | Green band width |
| `start.manBand` | 0.015 | 0 … 0.1 (step 0.005) |  | Band width per MAN |
| `start.poleBonus` | 0.03 | 0 … 0.2 (step 0.005) |  | Band width bonus: pole position |
| `start.affTolerance` | 0.012 | 0 … 0.1 (step 0.002) |  | Tolerance above band per AFF |
| `start.redLine` | 0.9 | 0.5 … 1 (step 0.01) |  | Red zone (stall at GO) |
| `start.window` | 1.5 | 0.25 … 3 (step 0.05) | s | Judged window before GO |
| `start.perfect` | 0.85 | 0.3 … 1 (step 0.01) |  | Perfect: share in band |
| `start.good` | 0.5 | 0.1 … 1 (step 0.01) |  | Good: share in band |
| `start.perfectPush` | 1.8 | 0 … 5 (step 0.1) | s | Perfect: free push |
| `start.goodPush` | 0.8 | 0 … 5 (step 0.1) | s | Good: free push |
| `start.stall` | 1.2 | 0 … 5 (step 0.1) | s | Stall: engine off |
| `start.calmTime` | 2.5 | 0 … 10 (step 0.25) | s | After GO: no pushes, no fire |

#### Hull, damage and ramming (`hull.*`)

Hull points (PF) and how they are lost. Each barricade type has `hit` (glancing impact), `crash` (head-on) and `scrapeEvery` (1 PF every N seconds while scraping, 0 = never) damage. Ramming compares inertia + a die roll (`ramDie` sides) + a perpendicular bonus; the margin decides damage, strong wins shove the target. `smokeAt` / `fireAt` are visual damage thresholds; at 0 PF the vehicle is a wreck.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `hull.smokeAt` | 0.5 | 0 … 1 (step 0.05) |  | Engine smokes below (× PF) |
| `hull.fireAt` | 0.25 | 0 … 1 (step 0.05) |  | Engine burns below (× PF) |
| `hull.wreckToResults` | 3 | 0 … 15 (step 0.5) | s | Player wrecked → results after |
| `hull.pushedBonus` | 1 | 0 … 5 (step 1) | PF | Edge hit while rammed: extra PF |
| `hull.ramMinSpeed` | 5 | 0.5 … 30 (step 0.5) | m/s | Ram: min closing speed |
| `hull.ramNoseCos` | 0.7 | 0 … 1 (step 0.05) |  | Ram: nose cone (cos) |
| `hull.ramPerpBonus` | 2 | 0 … 6 (step 1) |  | Ram: perpendicular bonus |
| `hull.ramDie` | 4 | 1 … 12 (step 1) |  | Ram: die sides |
| `hull.ramShove` | 4 | 0 … 20 (step 0.5) | m/s | Ram: shove on a strong win |
| `hull.ramCooldown` | 0.8 | 0 … 5 (step 0.1) | s | Ram: same pair cooldown |
| `hull.sideSpeed` | 7 | 0.5 … 30 (step 0.5) | m/s | Side contact: min speed for 1 PF |
| `hull.earth.hit` | 0 | 0 … 10 (step 1) | PF | earth: hit damage |
| `hull.earth.crash` | 1 | 0 … 10 (step 1) | PF | earth: crash damage |
| `hull.earth.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | earth: 1 PF every (scrape, 0 = never) |
| `hull.riveted.hit` | 1 | 0 … 10 (step 1) | PF | riveted: hit damage |
| `hull.riveted.crash` | 2 | 0 … 10 (step 1) | PF | riveted: crash damage |
| `hull.riveted.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | riveted: 1 PF every (scrape, 0 = never) |
| `hull.hedgehog.hit` | 2 | 0 … 10 (step 1) | PF | hedgehog: hit damage |
| `hull.hedgehog.crash` | 3 | 0 … 10 (step 1) | PF | hedgehog: crash damage |
| `hull.hedgehog.scrapeEvery` | 1.5 | 0 … 10 (step 0.25) | s | hedgehog: 1 PF every (scrape, 0 = never) |
| `hull.corrugated.hit` | 1 | 0 … 10 (step 1) | PF | corrugated: hit damage |
| `hull.corrugated.crash` | 1 | 0 … 10 (step 1) | PF | corrugated: crash damage |
| `hull.corrugated.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | corrugated: 1 PF every (scrape, 0 = never) |
| `hull.sandbags.hit` | 0 | 0 … 10 (step 1) | PF | sandbags: hit damage |
| `hull.sandbags.crash` | 1 | 0 … 10 (step 1) | PF | sandbags: crash damage |
| `hull.sandbags.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | sandbags: 1 PF every (scrape, 0 = never) |
| `hull.barbed.hit` | 0 | 0 … 10 (step 1) | PF | barbed: hit damage |
| `hull.barbed.crash` | 0 | 0 … 10 (step 1) | PF | barbed: crash damage |
| `hull.barbed.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | barbed: 1 PF every (scrape, 0 = never) |
| `hull.stone.hit` | 1 | 0 … 10 (step 1) | PF | stone: hit damage |
| `hull.stone.crash` | 2 | 0 … 10 (step 1) | PF | stone: crash damage |
| `hull.stone.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | stone: 1 PF every (scrape, 0 = never) |
| `hull.runepylon.hit` | 0 | 0 … 10 (step 1) | PF | runepylon: hit damage |
| `hull.runepylon.crash` | 1 | 0 … 10 (step 1) | PF | runepylon: crash damage |
| `hull.runepylon.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | runepylon: 1 PF every (scrape, 0 = never) |
| `hull.ironrail.hit` | 0 | 0 … 10 (step 1) | PF | ironrail: hit damage |
| `hull.ironrail.crash` | 2 | 0 … 10 (step 1) | PF | ironrail: crash damage |
| `hull.ironrail.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | ironrail: 1 PF every (scrape, 0 = never) |
| `hull.wreckwall.hit` | 2 | 0 … 10 (step 1) | PF | wreckwall: hit damage |
| `hull.wreckwall.crash` | 3 | 0 … 10 (step 1) | PF | wreckwall: crash damage |
| `hull.wreckwall.scrapeEvery` | 1.5 | 0 … 10 (step 0.25) | s | wreckwall: 1 PF every (scrape, 0 = never) |
| `hull.tyres.hit` | 0 | 0 … 10 (step 1) | PF | tyres: hit damage |
| `hull.tyres.crash` | 0 | 0 … 10 (step 1) | PF | tyres: crash damage |
| `hull.tyres.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | tyres: 1 PF every (scrape, 0 = never) |
| `hull.roots.hit` | 0 | 0 … 10 (step 1) | PF | roots: hit damage |
| `hull.roots.crash` | 1 | 0 … 10 (step 1) | PF | roots: crash damage |
| `hull.roots.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | roots: 1 PF every (scrape, 0 = never) |
| `hull.crystal.hit` | 0 | 0 … 10 (step 1) | PF | crystal: hit damage |
| `hull.crystal.crash` | 2 | 0 … 10 (step 1) | PF | crystal: crash damage |
| `hull.crystal.scrapeEvery` | 0 | 0 … 10 (step 0.25) | s | crystal: 1 PF every (scrape, 0 = never) |

#### Weapons and aiming (`weapons.*`)

Weapons are locked at the start and arm when a racer first reaches gear `unlockGear` or completes `unlockLap` laps. The front cannon locks the rival ahead (range, half-angle, lock time) and the shot lands at random inside a dispersion cone: `cone.*` widen it (high gears, steering, recent manoeuvres, vent clouds) or narrow it (`cone.steady` after holding the line for `steadyTime`). Where the shot crosses the target decides the zone (`zone.*`, as fractions of half width): centre and vital add bonus damage. Damage is in PF (hull points; a vehicle has about 20).

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `weapons.unlockGear` | 6 | 1 … 6 (step 1) |  | Weapons unlock reaching gear (1 = from GO). 1 = weapons armed from GO. |
| `weapons.unlockLap` | 1 | 0 … 5 (step 1) | laps | …or after laps (0 = gear only). 0 = only the gear unlocks weapons. |
| `weapons.cannon.ammo` | 6 | 0 … 30 (step 1) |  | Cannon: shells at the start |
| `weapons.cannon.lapAmmo` | 1 | 0 … 10 (step 1) |  | Cannon: shells per lap (until ammo crates) |
| `weapons.cannon.cooldown` | 1.2 | 0.1 … 5 (step 0.05) | s | Cannon: reload time |
| `weapons.cannon.range` | 70 | 10 … 200 (step 1) | m | Cannon: lock range |
| `weapons.cannon.lockAngle` | 22 | 2 … 60 (step 1) | ° | Cannon: lock half-angle |
| `weapons.cannon.lockTime` | 0.35 | 0 … 2 (step 0.05) | s | Cannon: time to lock |
| `weapons.cannon.damage` | 2 | 0 … 20 (step 1) | PF | Cannon: base damage. Base damage per hit, before zone bonuses and the target RES. |
| `weapons.cannon.vitalBonus` | 1 | 0 … 10 (step 1) | PF | Cannon: vital extra |
| `weapons.cannon.centreBonus` | 2 | 0 … 10 (step 1) | PF | Cannon: centre extra |
| `weapons.cannon.speed` | 140 | 20 … 500 (step 5) | m/s | Cannon: shell speed (flight time) |
| `weapons.cone.base` | 5 | 0 … 15 (step 0.1) | ° | Cone: base half-angle |
| `weapons.cone.highGear` | 1.5 | 0 … 10 (step 0.1) | ° | Cone: per side in 5th/6th |
| `weapons.cone.steer` | 4 | 0 … 15 (step 0.1) | ° | Cone: full steering |
| `weapons.cone.manoeuvre` | 2 | 0 … 10 (step 0.1) | ° | Cone: recent manoeuvre |
| `weapons.cone.cloud` | 5 | 0 … 20 (step 0.1) | ° | Cone: through a vent cloud |
| `weapons.cone.steady` | 1 | 0 … 5 (step 0.1) | ° | Cone: holding the line (−) |
| `weapons.cone.steadyTime` | 1 | 0 … 5 (step 0.1) | s | Cone: time to hold the line |
| `weapons.cone.wobble` | 1.3 | 0 … 4 (step 0.05) | m | Shell wobble (lateral, any range) |
| `weapons.zone.centre` | 0.1 | 0 … 1 (step 0.01) |  | Zone: centre (× half width) |
| `weapons.zone.vital` | 0.3 | 0 … 1 (step 0.01) |  | Zone: vital |
| `weapons.zone.body` | 0.85 | 0 … 1.5 (step 0.01) |  | Zone: body |
| `weapons.zone.edge` | 1.15 | 0 … 2 (step 0.01) |  | Zone: edge (sparks only) |
| `weapons.sightStep` | 2 | 0.5 … 8 (step 0.25) | m | Line of sight: check step |
| `weapons.sightMargin` | 0.6 | -2 … 4 (step 0.1) | m | Line of sight: corridor margin beyond the edge |

#### Vehicle characteristics (`stats.*`)

Per-vehicle tabletop stats for the two vehicles (`hotrod`: light, nimble; `tank`: heavy, tracked). CAL = boiler capacity in PV before the red zone; AFF = reliability (slower pressure, wider test notch); RES = subtracted from every hit's damage; MAN = manoeuvrability (wider start band); PF = hull points; mass = ramming inertia. Good place to balance the two vehicles against each other.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `stats.hotrod.cal` | 5 | 1 … 12 (step 1) | PV | hotrod: CAL |
| `stats.hotrod.aff` | 2 | 0 … 6 (step 1) |  | hotrod: AFF |
| `stats.hotrod.res` | 0 | 0 … 5 (step 1) |  | hotrod: RES |
| `stats.hotrod.man` | 3 | 0 … 6 (step 1) |  | hotrod: MAN |
| `stats.hotrod.pf` | 20 | 1 … 60 (step 1) | PF | hotrod: PF |
| `stats.hotrod.mass` | 1 | 0.3 … 4 (step 0.1) |  | hotrod: ramming mass |
| `stats.tank.cal` | 6 | 1 … 12 (step 1) | PV | tank: CAL |
| `stats.tank.aff` | 3 | 0 … 6 (step 1) |  | tank: AFF |
| `stats.tank.res` | 1 | 0 … 5 (step 1) |  | tank: RES |
| `stats.tank.man` | 1 | 0 … 6 (step 1) |  | tank: MAN |
| `stats.tank.pf` | 20 | 1 … 60 (step 1) | PF | tank: PF |
| `stats.tank.mass` | 1.5 | 0.3 … 4 (step 0.1) |  | tank: ramming mass |

#### Crates on the track (`pickups.*`)

Coal crates give PV, money bags give Cup money. Collect radius and respawn time.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `pickups.radius` | 2.8 | 0.5 … 8 (step 0.1) | m | Collect radius |
| `pickups.respawn` | 8 | 0 … 60 (step 0.5) | s | Respawn after |
| `pickups.coalPv` | 2 | 0 … 10 (step 1) | PV | Coal crate: PV |
| `pickups.moneyValue` | 5000 | 0 … 50000 (step 500) | $ | Money bag: $ |

#### Jumps and landings (`jumps.*`)

A clean landing (enough airtime, vehicle level enough) gives `cleanPv` steam.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `jumps.minAir` | 0.35 | 0.05 … 2 (step 0.05) | s | Landing counts after airtime |
| `jumps.cleanTilt` | 0.93 | 0.5 … 1 (step 0.01) |  | Clean landing: min up·normal |
| `jumps.hardSpeed` | 10 | 2 … 30 (step 0.5) | m/s | Hard landing: vertical speed |
| `jumps.cleanPv` | 1 | 0 … 5 (step 1) | PV | Clean landing: PV |

#### Track hazards (`hazards.*`)

Per-track hazard zones (molten metal, traffic, etc.). Can be switched off entirely with `hazards.enabled`.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `hazards.enabled` | true | true / false |  | Hazards on |
| `hazards.crashStun` | 1.2 | 0 … 5 (step 0.1) | s | Hazard crash: stop time |
| `hazards.margin` | 1.2 | 0 … 4 (step 0.1) | m | Zone margin (vehicle half size) |

#### AI rivals (`ai.*`)

How the computer drivers race. `lateralAccel` is the cornering limit they plan with (higher = faster and riskier in corners), `steerGain` and `lookAhead*` shape the racing line, `fireRate` how eagerly they shoot when locked, `avoid*` how they dodge other cars, `catchUpGap` the gap after which a rival behind gets a small speed help. NOTE: in Grand Prix and Single race the chosen difficulty sets each rival's skill and pace, so `ai.skill` only applies to quick test races; the other `ai.*` values always apply.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `ai.lookAhead` | 7 | 2 … 30 (step 0.5) | m | Look-ahead base |
| `ai.lookAheadPerSpeed` | 0.45 | 0 … 2 (step 0.05) | s | Look-ahead per m/s |
| `ai.steerGain` | 2.2 | 0.2 … 8 (step 0.1) |  | Steer gain |
| `ai.lateralAccel` | 14 | 2 … 30 (step 0.5) | m/s² | Cornering accel limit. Main AI pace lever in corners. Keep it in line with handling.grip. |
| `ai.jumpSpeedMax` | 1.45 | 1 … 3 (step 0.05) |  | Jumps: max approach speed (× needed) |
| `ai.brakeLookAhead` | 45 | 5 … 120 (step 1) | m | Corner scan distance |
| `ai.skill` | 0.7 | 0 … 1 (step 0.05) |  | Skill (start, vent timing, aim patience). Only for quick test races: difficulty overrides it in Grand Prix and Single race. |
| `ai.fireRate` | 1.2 | 0 … 10 (step 0.1) | /s | Fire willingness when locked |
| `ai.avoidDistance` | 16 | 0 … 40 (step 1) | m | Avoidance: look ahead |
| `ai.avoidGap` | 3.2 | 0.5 … 8 (step 0.1) | m | Avoidance: lateral gap |
| `ai.ventPressure` | 0.6 | 0 … 1 (step 0.05) |  | Vents voluntarily above pressure |
| `ai.hazardLook` | 80 | 0 … 200 (step 5) | m | Hazards: look ahead |
| `ai.catchUpGap` | 60 | 0 … 400 (step 5) | m | Catch-up: gap to the car ahead |
| `ai.pickupReach` | 4 | 0 … 14 (step 0.5) | m | Crates: max detour from the line |

### Camera, feedback and controls

Comfort and readability. Safe to change.

#### Controller input (`input.*`)

Gamepad stick deadzone and trigger threshold.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `input.padDeadzone` | 0.15 | 0 … 0.5 (step 0.01) |  | Stick deadzone |
| `input.padTriggerThreshold` | 0.3 | 0.05 … 0.9 (step 0.05) |  | Trigger threshold |

#### Impact feedback (sparks, screen shake) (`feedback.*`)

Sparks and screen shake on impacts and scraping. Turn `shake` off or lower `shakeAmplitude` for motion-sensitive players.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `feedback.sparks` | true | true / false |  | Sparks |
| `feedback.sparkRate` | 110 | 0 … 400 (step 5) | 1/s | Sparks: scrape rate at max speed |
| `feedback.sparkPerHit` | 2.5 | 0 … 10 (step 0.1) |  | Sparks: count per m/s of impact |
| `feedback.sparkSpeed` | 11 | 1 … 40 (step 0.5) | m/s | Sparks: speed |
| `feedback.sparkLife` | 0.38 | 0.05 … 2 (step 0.01) | s | Sparks: life |
| `feedback.sparkLength` | 1.5 | 0.1 … 6 (step 0.05) | m | Sparks: stroke length |
| `feedback.sparkWidth` | 0.16 | 0.02 … 1 (step 0.01) | m | Sparks: stroke width |
| `feedback.sparkGlow` | 3 | 0.5 … 12 (step 0.1) |  | Sparks: brightness (bloom) |
| `feedback.sparkRedraw` | 18 | 0 … 60 (step 1) | fps | Sparks: redraw rate (0 = smooth) |
| `feedback.shake` | true | true / false |  | Screen shake |
| `feedback.shakeScrape` | 0.22 | 0 … 1 (step 0.01) |  | Shake: scraping (at max speed) |
| `feedback.shakeHit` | 0.06 | 0 … 0.5 (step 0.005) |  | Shake: edge hit (per m/s) |
| `feedback.shakeCrash` | 1 | 0 … 1 (step 0.01) |  | Shake: crash |
| `feedback.shakeVehicle` | 0.07 | 0 … 0.5 (step 0.005) |  | Shake: vehicle impact (per m/s) |
| `feedback.shakeAmplitude` | 1.6 | 0 … 8 (step 0.05) | m | Shake: amplitude |
| `feedback.shakeRoll` | 1.2 | 0 … 10 (step 0.1) | ° | Shake: roll |
| `feedback.shakeFrequency` | 17 | 2 … 60 (step 1) | Hz | Shake: frequency |
| `feedback.shakeDecay` | 2.4 | 0.2 … 10 (step 0.1) | 1/s | Shake: decay |

#### Camera (`camera.*`)

Two modes: `board` (high isometric "tabletop" view, the default) and `chase` (behind the vehicle). Each has FOV, pitch, distance (grows towards `distanceAtSpeed` at top speed) and look-ahead. Half-lives are smoothing times (higher = lazier camera).

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `camera.mode` | "board" | "board" / "chase" |  | Mode. "board" = isometric tabletop view, "chase" = behind the vehicle. |
| `camera.blendHalfLife` | 0.25 | 0.01 … 2 (step 0.01) | s | Mode blend half-life |
| `camera.posHalfLife` | 0.12 | 0.01 … 1 (step 0.01) | s | Position half-life |
| `camera.fov` | 30 | 10 … 70 (step 1) | ° | Chase FOV |
| `camera.pitch` | 52 | 20 … 89 (step 1) | ° | Chase pitch |
| `camera.distance` | 58 | 10 … 200 (step 1) | m | Chase distance (× vehicle scale) |
| `camera.distanceAtSpeed` | 70 | 10 … 240 (step 1) | m | Chase distance at max speed |
| `camera.lookAhead` | 12 | 0 … 30 (step 0.5) | m | Chase look-ahead |
| `camera.yawHalfLife` | 0.35 | 0.02 … 2 (step 0.01) | s | Chase yaw half-life |
| `camera.board.fov` | 20 | 5 … 60 (step 1) | ° | Board FOV |
| `camera.board.pitch` | 47 | 20 … 89 (step 1) | ° | Board pitch |
| `camera.board.azimuth` | 35 | -180 … 180 (step 1) | ° | Board azimuth |
| `camera.board.follow` | 0 | 0 … 1 (step 0.05) |  | Board yaw follow (0 = fixed) |
| `camera.board.followHalfLife` | 2.5 | 0.1 … 10 (step 0.1) | s | Board yaw follow half-life |
| `camera.board.distance` | 228 | 10 … 300 (step 1) | m | Board distance (× vehicle scale) |
| `camera.board.distanceAtSpeed` | 240 | 10 … 320 (step 1) | m | Board distance at max speed |
| `camera.board.lookAhead` | 40 | 0 … 80 (step 0.5) | m | Board look-ahead |

#### HUD helpers (`hud.*`)

The gear/steam tag under the vehicle, the corner warning above it (how early it appears) and the boiler test ring size.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `hud.valveRadius` | 5 | 1 … 15 (step 0.1) | m | Boiler stall ring: radius (× vehicle scale) |
| `hud.valveWidth` | 1.1 | 0.2 … 4 (step 0.05) | m | Boiler stall ring: width (× vehicle scale) |
| `hud.valveFlash` | 0.45 | 0 … 2 (step 0.05) | s | Boiler stall ring: outcome flash |
| `hud.vehicleTag` | true | true / false |  | Gear + steam under vehicle |
| `hud.tagOffset` | 2.6 | 0 … 8 (step 0.1) | m | Tag distance below the vehicle (screen down) |
| `hud.cornerTag` | true | true / false |  | Corner warning above vehicle |
| `hud.cornerOffset` | 2 | 0 … 8 (step 0.1) | m | Corner tag distance above the vehicle (screen up) |
| `hud.cornerSafeTop` | 0.33 | 0 … 0.6 (step 0.01) |  | Corner tag: HUD band (× view height) when the HUD strip is not found |
| `hud.cornerLead` | 2.5 | 0.5 … 6 (step 0.1) | s | Corner warning: time ahead |
| `hud.cornerMinLead` | 25 | 5 … 80 (step 1) | m | Corner warning: min distance |
| `hud.cornerMaxLead` | 90 | 20 … 200 (step 1) | m | Corner warning: max distance |
| `hud.cornerSGap` | 20 | 0 … 60 (step 1) | m | S: longest straight between bends |

### Visual and technical

Look and performance only. Change these only when the playtester explicitly asks about visuals or performance.

#### Rendering: ink material (`ink.*`)

Toon shading bands and hatching. Visual style only.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `ink.color` | "#1B1210" | "#RRGGBB" |  | Ink color |
| `ink.shadowColor` | "#2B1F22" | "#RRGGBB" |  | Ramp shadow color |
| `ink.litTint` | "#FFF0DC" | "#RRGGBB" |  | Ramp lit tint |
| `ink.wrap` | 0.35 | 0 … 1 (step 0.01) |  | Light wrap |
| `ink.bands` | 3 | 1 … 8 (step 1) |  | Light bands |
| `ink.bandSoftness` | 0.06 | 0.005 … 0.3 (step 0.005) |  | Band softness |
| `ink.specThreshold` | 0.93 | 0.5 … 0.999 (step 0.001) |  | Metal sheen threshold |
| `ink.hatchEnabled` | true | true / false |  | Hatching |
| `ink.hatchStrength` | 0.85 | 0 … 1 (step 0.01) |  | Hatch strength |
| `ink.hatchRef` | 1.2 | 0.05 … 10 (step 0.05) |  | Hatch light reference |
| `ink.hatchScale` | 0.05 | 0.005 … 1 (step 0.005) | tiles/m | Hatch scale |
| `ink.hatch1` | 0.3 | 0 … 1 (step 0.01) |  | Hatch level 1 start |
| `ink.hatch2` | 0.5 | 0 … 1 (step 0.01) |  | Hatch level 2 start |
| `ink.hatch3` | 0.7 | 0 … 1 (step 0.01) |  | Cross-hatch start |
| `ink.debugView` | "final" | "final" / "albedo" / "lighting" / "hatchTone" |  | Material debug view. Keep "off". |

#### Rendering: outlines (`lines.*`)

Ink outlines and the player hull border colours. Visual style only.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `lines.enabled` | true | true / false |  | Outlines |
| `lines.width` | 2 | 0.5 … 6 (step 0.1) | px@1080p | Silhouette width |
| `lines.vehicleWidth` | 3 | 0.5 … 8 (step 0.1) | px@1080p | Vehicle silhouette width |
| `lines.depthThreshold` | 0.015 | 0.001 … 0.2 (step 0.001) |  | Depth threshold (relative) |
| `lines.creaseAngle` | 35 | 5 … 90 (step 1) | ° | Crease angle |
| `lines.creaseStrength` | 0.7 | 0 … 1 (step 0.01) |  | Crease strength |
| `lines.idStrength` | 0.9 | 0 … 1 (step 0.01) |  | Object boundary strength |
| `lines.wobble` | "low" | "off" / "low" |  | Hand-drawn wobble (S2) |
| `lines.wobbleAmp` | 0.6 | 0 … 3 (step 0.05) | px | Wobble amplitude |
| `lines.player` | true | true / false |  | Player hull border |
| `lines.playerWidth` | 3.5 | 1 … 10 (step 0.5) | px@1080p | Player border width |
| `lines.playerHiddenTint` | 0.35 | 0 … 1 (step 0.05) |  | Player tint when hidden |
| `lines.playerOk` | "#6FE04A" | "#RRGGBB" |  | Player border: full hull |
| `lines.playerHurt` | "#FF9A2E" | "#RRGGBB" |  | Player border: smoking |
| `lines.playerCritical` | "#FF2E22" | "#RRGGBB" |  | Player border: burning |

#### Rendering: post-processing (`post.*`)

Bloom, colour grade, paper, grain, anti-aliasing. Visual style only. `debugView` must stay `off` for normal play.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `post.bloom` | true | true / false |  | Bloom |
| `post.bloomStrength` | 0.6 | 0 … 3 (step 0.01) |  | Bloom strength |
| `post.bloomRadius` | 0.4 | 0 … 1 (step 0.01) |  | Bloom radius |
| `post.bloomThreshold` | 1 | 0 … 4 (step 0.01) |  | Bloom threshold |
| `post.exposure` | 1.25 | 0.1 … 4 (step 0.01) |  | Exposure |
| `post.saturation` | 0.9 | 0 … 2 (step 0.01) |  | Saturation |
| `post.contrast` | 1.08 | 0.5 … 2 (step 0.01) |  | Contrast |
| `post.lift` | "#120C0D" | "#RRGGBB" |  | Lift (shadows tint) |
| `post.gain` | "#FFF4E6" | "#RRGGBB" |  | Gain (highlights tint) |
| `post.vignette` | 0.3 | 0 … 1 (step 0.01) |  | Vignette |
| `post.paper` | 0.08 | 0 … 0.4 (step 0.005) |  | Paper multiply |
| `post.grain` | 0.03 | 0 … 0.2 (step 0.005) |  | Grain |
| `post.aa` | "fxaa" | "off" / "fxaa" / "smaa" |  | Anti-aliasing |
| `post.debugView` | "final" | "final" / "grayscale" / "normals" / "depth" / "edges" / "objectId" / "noPost" |  | Post debug view. Keep "off". |

#### Rendering: fog (`fog.*`)

Height fog. Visual style only.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `fog.color` | "#3B3533" | "#RRGGBB" |  | Fog color |
| `fog.density` | 0.008 | 0 … 0.05 (step 0.0005) |  | Density |
| `fog.heightFalloff` | 0.15 | 0 … 1 (step 0.01) |  | Height falloff |
| `fog.start` | 55 | 0 … 300 (step 1) | m | Fog start distance |

#### Rendering: particles (`fx.*`)

Steam and smoke particles. Visual and performance.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `fx.particleBudget` | 1200 | 0 … 8000 (step 50) |  | Particle budget |
| `fx.steamOpacity` | 0.85 | 0 … 1 (step 0.01) |  | Steam opacity |
| `fx.smokeOpacity` | 0.8 | 0 … 1 (step 0.01) |  | Smoke opacity |
| `fx.rateScale` | 1 | 0 … 4 (step 0.05) |  | Emission rate scale |
| `fx.wind` | 1.2 | 0 … 8 (step 0.1) | m/s | Wind |

#### intro (`intro.*`)

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `intro.enabled` | true | true / false |  | Race intro (fly-over before the countdown) |
| `intro.establish` | 3.4 | 0 … 10 (step 0.1) | s | Track overview |
| `intro.point` | 2.2 | 0 … 6 (step 0.1) | s | Key point fly-by (each) |
| `intro.points` | 3 | 0 … 6 (step 1) |  | Key points shown |
| `intro.grid` | 3.4 | 0 … 10 (step 0.1) | s | Starting grid |
| `intro.hero` | 2.4 | 0 … 6 (step 0.1) | s | Player close-up |
| `intro.handoff` | 1.5 | 0.1 … 4 (step 0.1) | s | Hand-over to the race camera |
| `intro.skipHandoff` | 0.7 | 0.1 … 3 (step 0.1) | s | Hand-over after a skip |
| `intro.skipGuard` | 0.5 | 0 … 3 (step 0.1) | s | Ignore skip input for |

#### Rendering: scenery density (`dressing.*`)

Props around the track (applied on the next race). Lower for performance.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `dressing.edgeDensity` | 1 | 0 … 3 (step 0.05) |  | Edge band density (reload) |
| `dressing.midDensity` | 1 | 0 … 3 (step 0.05) |  | Mid band density (reload) |
| `dressing.farDensity` | 1 | 0 … 3 (step 0.05) |  | Far band density (reload) |
| `dressing.debris` | 1800 | 0 … 8000 (step 100) |  | Ground debris count (reload) |

#### Rendering: lights (`light.*`)

Sun, ambient and furnace lights. Visual style only.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `light.keyColor` | "#C9B8A6" | "#RRGGBB" |  | Key light color |
| `light.keyIntensity` | 4.5 | 0 … 12 (step 0.05) |  | Key intensity |
| `light.keyPitch` | 55 | 10 … 89 (step 1) | ° | Key pitch |
| `light.keyYaw` | 215 | 0 … 360 (step 1) | ° | Key yaw |
| `light.skyColor` | "#4A4440" | "#RRGGBB" |  | Hemisphere sky |
| `light.groundColor` | "#2A1E1A" | "#RRGGBB" |  | Hemisphere ground |
| `light.ambient` | 3 | 0 … 6 (step 0.05) |  | Ambient intensity |
| `light.furnaceIntensity` | 600 | 0 … 5000 (step 10) |  | Furnace light intensity |
| `light.furnaceRange` | 24 | 2 … 100 (step 1) | m | Furnace light range |

#### World build (`world.*`)

Track-side decoration switches (applied on the next race).

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `world.cornerBoards` | true | true / false |  | Chevron boards on tight corners (rebuild) |

#### Demo / showcase (`showcase.*`)

Developer demo helpers (autopilot for the player, camera target). Leave alone for playtests.

| Key | Default | Range | Unit | Meaning |
| :-- | --: | :-- | :-- | :-- |
| `showcase.smokePerSpeed` | 0.6 | 0 … 4 (step 0.05) |  | Exhaust per m/s |
| `showcase.cameraTarget` | "player" | "player" / "rival" |  | Camera follows |
| `showcase.cameraTrackBlend` | 0.7 | 0 … 1 (step 0.05) |  | Camera: track tangent vs heading |
| `showcase.playerAutopilot` | false | true / false |  | Player autopilot (demo) |
