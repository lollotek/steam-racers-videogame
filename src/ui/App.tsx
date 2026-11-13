import { ui, formatTime, type PlayerHud } from './state';
import { TouchControls } from './TouchControls';
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
                  <tr key={r.name} class={r.isPlayer ? 'me' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      <span class="swatch" style={{ background: r.color }} />
                      {r.name}
                    </td>
                    <td>{r.time !== null ? formatTime(r.time) : 'racing…'}</td>
                    <td class="dim">best {formatTime(r.bestLap)}</td>
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
          <div class="panel">
            <h1>Paused</h1>
            <p>Esc / P / Start, or tap to resume</p>
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
      <div class="rotate-hint">Rotate the device to landscape</div>
    </div>
  );
}

function Leaderboard() {
  return (
    <div class="leaderboard" data-testid="leaderboard">
      {ui.standings.value.map((s, i) => (
        <div key={s.name} class={`row ${s.isPlayer ? 'me' : ''}`}>
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
      {p.wrongWay && !p.finished && <div class="wrong-way">WRONG WAY</div>}
      {p.finished && <div class="finished">FINISH</div>}
    </div>
  );
}
