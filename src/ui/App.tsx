import { ui, formatTime, type PlayerHud } from './state';
import { TouchControls } from './TouchControls';
import { Controls } from './Controls';
import { enterFullscreen } from './fullscreen';
import type { TouchSource } from '../input/touch';

interface Props {
  touch: TouchSource;
  onResume: () => void;
  onRestart: () => void;
}

export function App({ touch, onResume, onRestart }: Props) {
  const players = ui.players.value;
  const split = ui.splitScreen.value;
  const results = ui.results.value;
  const countdown = ui.countdown.value;
  return (
    <div class={`ui-root ${split ? 'split' : ''}`}>
      {players.map((p) => (
        <PlayerHudView key={p.index} p={p} split={split} />
      ))}
      {!split && <Leaderboard />}
      {ui.phase.value === 'countdown' && countdown > 0 && (
        <div class="countdown" data-testid="countdown">
          {countdown}
        </div>
      )}
      <div class="badge" data-testid="backend-badge">
        {ui.backend.value} · {ui.tier.value} · {Math.round(ui.renderScale.value * 100)}% · {ui.fps.value} fps
      </div>
      {ui.showTouch.value && !split && !results && <TouchControls source={touch} />}
      {results && (
        <div class="overlay" data-testid="results">
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
                    <td class="dim">best {formatTime(r.bestLap)}</td>
                    <td class="dim">{r.pf} PF</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button class="btn" data-testid="restart" onClick={onRestart}>
              Race again
            </button>
            <p class="dim">Enter · Steam push · A</p>
          </div>
        </div>
      )}
      {ui.loading.value && (
        <div class="overlay" data-testid="loading">
          <div class="panel">
            <h1>Stoking the boiler…</h1>
          </div>
        </div>
      )}
      {ui.paused.value && (
        <div class="overlay" data-testid="pause-overlay" onPointerDown={onResume}>
          <div class="panel pause">
            <h1>Paused</h1>
            <Controls split={split} touch={ui.showTouch.value} />
            <p class="dim">Esc / P / Start, or tap to resume</p>
          </div>
        </div>
      )}
      {ui.error.value && (
        <div class="overlay">
          <div class="panel error">
            <h1>Cannot start</h1>
            <p>{ui.error.value}</p>
          </div>
        </div>
      )}
      <div class="rotate-hint" data-testid="rotate-hint" onPointerUp={() => void enterFullscreen()}>
        <div>
          <p>Rotate the device to landscape</p>
          <p class="dim">or tap to play fullscreen</p>
        </div>
      </div>
    </div>
  );
}

function Leaderboard() {
  return (
    <div class="leaderboard" data-testid="leaderboard">
      {ui.standings.value.map((s, i) => (
        <div key={s.name} class={`row ${s.isPlayer ? 'me' : ''} ${s.retired ? 'retired' : ''}`}>
          <span class="pos">{i + 1}</span>
          <span class="swatch" style={{ background: s.color }} />
          <span class="name">{s.name}</span>
        </div>
      ))}
    </div>
  );
}

function PlayerHudView({ p, split }: { p: PlayerHud; split: boolean }) {
  const pos = split ? (p.index === 0 ? 'p-top' : 'p-bottom') : 'p-top';
  return (
    <div class={`hud ${pos}`} data-testid={`hud-p${p.index + 1}`}>
      <div class="race-block">
        <div class="big">
          <span data-testid={`pos-p${p.index + 1}`}>{p.position}</span>
          <small>/{p.racers} POS</small>
        </div>
        <div class="big">
          <span data-testid={`lap-p${p.index + 1}`}>{p.lap}</span>
          <small>/{p.laps} LAP</small>
        </div>
        <div class="times">
          <div>LAP {formatTime(p.lapTime)}</div>
          <div class="dim">BEST {formatTime(p.bestLap)}</div>
        </div>
      </div>
      <div class="drive-block">
        <div class="gear-plate" style={{ borderColor: p.identityColor }}>
          <span class="gear-label">GEAR</span>
          <span class={`gear ${p.gear >= 5 ? 'red' : ''}`} data-testid={`gear-p${p.index + 1}`}>
            {p.gear}
          </span>
        </div>
        <div class="speed">
          <span data-testid={`speed-p${p.index + 1}`}>{p.speedKmh}</span> km/h
        </div>
        <div class={`push ${p.pushReady ? 'ready' : ''}`}>STEAM</div>
        <div class="device">{p.device}</div>
      </div>
      <div class="strip">
        <HullBox p={p} />
        <div class={`ammo ${p.cannonReady ? 'ready' : ''} ${p.armed ? '' : 'locked'}`} data-testid={`ammo-p${p.index + 1}`} title="Front cannon shells">
          <span class="ammo-label">CANNON</span>
          <span class="ammo-count">{p.armed ? p.ammo : `LOCKED · LAP ${p.unlockLap + 1}`}</span>
        </div>
        <BoilerGauge p={p} />
        {p.money > 0 && (
          <div class="money" data-testid={`money-p${p.index + 1}`} title="Cup money collected">
            $ {p.money.toLocaleString('en-US')}
          </div>
        )}
      </div>
      {p.wrongWay && !p.finished && <div class="wrong-way">WRONG WAY</div>}
      {p.finished && <div class="finished">FINISH</div>}
      <div class="banners" data-testid={`banners-p${p.index + 1}`}>
        {p.banners.map((b) => (
          <div key={b.id} class={`banner ${b.tone}`}>
            {b.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hull box (gameplay.md §6.1): PF bar, orange under 50 %, red and flashing under 25 %. */
function HullBox({ p }: { p: PlayerHud }) {
  const f = p.pfMax > 0 ? p.pf / p.pfMax : 0;
  return (
    <div class={`hull ${p.condition}`} data-testid={`hull-p${p.index + 1}`}>
      <span class="hull-label">HULL</span>
      <div class="hull-bar">
        <div class="hull-fill" style={{ width: `${(f * 100).toFixed(1)}%` }} />
      </div>
      <span class="hull-num" data-testid={`pf-p${p.index + 1}`}>
        {p.pf}
      </span>
    </div>
  );
}

/** Boiler gauge (gameplay.md §5.2): 0 → 2 × CAL, right half red; pressure bar under the red half. */
function BoilerGauge({ p }: { p: PlayerHud }) {
  const b = p.boiler;
  const max = Math.max(1, b.cal * 2);
  return (
    <div class={`boiler ${b.test ? 'testing' : ''} ${b.pv > b.cal ? 'red' : ''}`} data-testid={`boiler-p${p.index + 1}`}>
      <span class="boiler-label">BOILER</span>
      <div class="boiler-gauge">
        {Array.from({ length: max }, (_, i) => (
          <i key={i} class={`cell ${i >= b.cal ? 'over' : ''} ${i < Math.floor(b.pv) ? 'full' : ''}`} />
        ))}
        <div class="pressure" style={{ width: `${(b.pressure * 50).toFixed(1)}%` }} />
      </div>
      <span class="boiler-num">
        {Math.floor(b.pv)}/{b.cal}
      </span>
    </div>
  );
}
