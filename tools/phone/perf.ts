/**
 * Phone performance probe (doc 03 §16): FPS and CPU time per frame part, one effect off at a time.
 *
 *   npx tsx tools/phone/perf.ts [--adb path/to/adb.exe] [--serial IP[:PORT]] [--port 5173]
 *                               [--query tier=medium] [--measure 5] [--only baseline,no AA] [--profile 4] [--fullscreen]
 *
 * --profile N: instead of the scenarios, record N seconds of the JS CPU profile (DevTools Profiler
 * over CDP) during the race; prints the top functions by self time and saves out/race.cpuprofile.
 *
 * For each scenario: apply it on top of the baseline, settle, then measure for `--measure` seconds:
 *   fps / p50 / p95 frame interval  (requestAnimationFrame deltas)
 *   cpu.sim / pres / render / hud / tags  (ms per frame, JS main thread; `render` is the time to
 *   encode and submit the GPU work, not GPU execution)
 * If the frame interval is much longer than the CPU total, the GPU (or the compositor) is the limit.
 * Dynamic resolution is off; the render scale is fixed per scenario.
 */
import { writeFileSync } from 'node:fs';
import { arg, connectPhone, openGame, outDir, type Hook } from './device';

const port = Number(arg('port', '5173'));
const query = arg('query', 'tier=medium');
const measure = Number(arg('measure', '5'));
const only = arg('only', '');
const args_fullscreen = () => process.argv.includes('--fullscreen');

interface Scenario {
  name: string;
  /** Applied in the page; `g` is the Game, `t` the tunables. */
  apply: string;
}

const SCENARIOS: Scenario[] = [
  { name: 'baseline', apply: '' },
  { name: 'scale 0.5', apply: 'setScale(0.5)' },
  { name: 'scale 0.35', apply: 'setScale(0.35)' },
  { name: 'no outlines', apply: "t.set('lines.enabled', false)" },
  { name: 'no bloom', apply: "t.set('post.bloom', false)" },
  { name: 'no AA', apply: "t.set('post.aa', 'off')" },
  { name: 'no hatching', apply: "t.set('ink.hatchEnabled', false)" },
  // Turning shadows off recompiles every material (frames stall for seconds): throttle the map instead.
  { name: 'shadow every frame', apply: "t.set('quality.shadowEvery', 1)" },
  { name: 'shadow every 4th frame', apply: "t.set('quality.shadowEvery', 4)" },
  { name: 'no particles+sparks', apply: "t.set('fx.particleBudget', 0); t.set('feedback.sparks', false)" },
  { name: 'no dressing', apply: 'g.scene.traverse((o) => { if (o.isInstancedMesh) o.visible = false; })' },
  { name: 'no post (debugView)', apply: "t.set('post.debugView', 'noPost')" },
  { name: 'sim paused', apply: 'g.loop.paused = true' },
  {
    name: 'everything off',
    apply:
      "t.set('lines.enabled', false); t.set('post.bloom', false); t.set('post.aa', 'off'); t.set('ink.hatchEnabled', false); t.set('quality.shadowEvery', 4); t.set('fx.particleBudget', 0); t.set('feedback.sparks', false); t.set('post.debugView', 'noPost'); setScale(0.5)",
  },
];

const phone = await connectPhone(port);
const { page } = phone;
const bootSeconds = await openGame(phone, port, `laps=9&${query}`);

// --fullscreen: a trusted tap (CDP touch input counts as a user gesture) → the game's first-tap
// fullscreen + landscape lock, as a player would get it.
if (args_fullscreen()) {
  const cdp = await page.context().newCDPSession(page);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const pt = { x: Math.round(vp.w * 0.5), y: Math.round(vp.h * 0.3) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(2000);
  console.error(`[phone] fullscreen: ${await page.evaluate(() => !!document.fullscreenElement)}`);
}

// Instrumentation: wrap the frame parts (own properties shadow the prototype methods).
await page.evaluate(() => {
  const h = (window as unknown as Hook).__steamRacers;
  const g = h.game as Record<string, unknown> & { dynres: { enabled: boolean } };
  const w = window as unknown as Record<string, unknown>;
  const acc: Record<string, number> = { sim: 0, pres: 0, render: 0, hud: 0, tags: 0 };
  w.__perfAcc = acc;
  for (const [k, m] of [['sim', 'simStep'], ['pres', 'presentation'], ['render', 'render'], ['hud', 'updateHud'], ['tags', 'updateTags']] as const) {
    const f = (g[m] as (...a: unknown[]) => unknown).bind(g);
    g[m] = (...a: unknown[]) => {
      const t0 = performance.now();
      const r = f(...a);
      acc[k]! += performance.now() - t0;
      return r;
    };
  }
  const deltas: number[] = [];
  w.__perfDeltas = deltas;
  let last = performance.now();
  const tick = (now: number) => {
    deltas.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  g.dynres.enabled = false;
  h.tunables.set('showcase.playerAutopilot', true);
});

const profileSeconds = Number(arg('profile', '0'));
if (profileSeconds > 0) {
  await page.waitForTimeout(4000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(profileSeconds * 1000);
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
  writeFileSync(`${outDir}race.cpuprofile`, JSON.stringify(profile));
  summarize(profile);
  await phone.close();
  process.exit(0);
}

const baselineScale = await page.evaluate(() => ((window as unknown as Hook).__steamRacers.game as { dynres: { tier: { renderScale: number } } }).dynres.tier.renderScale);

const results: Record<string, unknown>[] = [];
for (const sc of SCENARIOS) {
  if (only && !only.split(',').includes(sc.name)) continue;
  // Reset to the baseline, then apply the scenario.
  await page.evaluate(
    ({ apply, scale }) => {
      const h = (window as unknown as Hook).__steamRacers;
      const g = h.game as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const t = h.tunables as unknown as { set(k: string, v: unknown): void; reset(k?: string): void };
      for (const k of ['quality.shadowEvery', 'lines.enabled', 'post.bloom', 'post.aa', 'ink.hatchEnabled', 'fx.particleBudget', 'feedback.sparks', 'post.debugView']) t.reset(k);
      g.scene.traverse((o: { isInstancedMesh?: boolean; visible: boolean }) => {
        if (o.isInstancedMesh) o.visible = true;
      });
      g.loop.paused = false;
      const setScale = (s: number) => {
        g.dynres.scale = s;
        g.applyPixelRatio();
      };
      setScale(scale);
      // eslint-disable-next-line no-new-func
      new Function('g', 't', 'setScale', apply)(g, t, setScale);
    },
    { apply: sc.apply, scale: baselineScale },
  );
  await page.waitForTimeout(2500); // settle (pipeline rebuilds, shader compiles)
  await page.evaluate(() => {
    const w = window as unknown as { __perfAcc: Record<string, number>; __perfDeltas: number[] };
    for (const k in w.__perfAcc) w.__perfAcc[k] = 0;
    w.__perfDeltas.length = 0;
  });
  await page.waitForTimeout(measure * 1000);
  const r = await page.evaluate(() => {
    const w = window as unknown as { __perfAcc: Record<string, number>; __perfDeltas: number[] };
    const d = [...w.__perfDeltas].sort((a, b) => a - b);
    const n = d.length || 1;
    const cpu: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(w.__perfAcc)) {
      cpu[k] = Number((v / n).toFixed(2));
      total += v / n;
    }
    const g = (window as unknown as Hook).__steamRacers.game as { dynres: { scale: number }; gfx: { renderer: { getPixelRatio(): number; domElement: HTMLCanvasElement } } };
    const c = g.gfx.renderer.domElement;
    return {
      fps: Number((n / (d.reduce((a, b) => a + b, 0) / 1000 || 1)).toFixed(1)),
      p50: Number((d[Math.floor(n * 0.5)] ?? 0).toFixed(1)),
      p95: Number((d[Math.floor(n * 0.95)] ?? 0).toFixed(1)),
      cpuTotal: Number(total.toFixed(2)),
      cpu,
      buffer: `${c.width}x${c.height}`,
    };
  });
  console.error(`[perf] ${sc.name.padEnd(22)} ${String(r.fps).padStart(5)} fps  p50 ${r.p50} ms  p95 ${r.p95} ms  cpu ${r.cpuTotal} ms ${JSON.stringify(r.cpu)} ${r.buffer}`);
  results.push({ scenario: sc.name, ...r });
}

const info = await page.evaluate(() => ({
  ua: navigator.userAgent,
  dpr: devicePixelRatio,
  viewport: `${innerWidth}x${innerHeight}`,
  fullscreen: !!document.fullscreenElement,
}));
console.log(JSON.stringify({ device: phone.model, bootSeconds, ...info, results, errors: phone.errors, logs: phone.logs }, null, 2));
await phone.close();

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

/** Self time per function and per source file, plus inclusive time of a few game entry points. */
function summarize(p: CpuProfile): void {
  const self = new Map<number, number>();
  p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
  const total = (p.endTime - p.startTime) / 1000;
  const byFn = new Map<string, number>();
  const byFile = new Map<string, number>();
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const nodeById = new Map(p.nodes.map((n) => [n.id, n]));
  const file = (url: string) => url.replace(/^.*\/(node_modules\/\.vite\/deps\/|src\/)?/, '').replace(/\?.*$/, '') || '(native)';
  for (const n of p.nodes) {
    const t = (self.get(n.id) ?? 0) / 1000;
    if (!t) continue;
    const key = `${n.callFrame.functionName || '(anonymous)'}  ${file(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + t);
    byFile.set(file(n.callFrame.url), (byFile.get(file(n.callFrame.url)) ?? 0) + t);
  }
  // Inclusive time of named entry points (a sample counts once per ancestor name).
  const entries = ['simStep', 'presentation', 'render', 'renderObject', 'updateHud', 'updateTags', '_renderScene', 'compile', 'update', 'step'];
  const incl = new Map<string, number>();
  p.samples.forEach((id, i) => {
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const name = nodeById.get(cur)!.callFrame.functionName;
      if (entries.includes(name) && !seen.has(name)) {
        seen.add(name);
        incl.set(name, (incl.get(name) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
      }
    }
  });
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  console.log(`profile: ${total.toFixed(0)} ms`);
  const print = (title: string, lines: string[]) => console.log([`--- ${title} ---`, ...lines].join('\n'));
  print('inclusive (entry points)', top(incl, 12));
  print('self time by function', top(byFn, 30));
  print('self time by file', top(byFile, 15));
}
