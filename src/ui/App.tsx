import { ui, type PlayerHud } from './state';
import { TouchControls } from './TouchControls';
import type { TouchSource } from '../input/touch';

interface Props {
  touch: TouchSource;
  onResume: () => void;
}

export function App({ touch, onResume }: Props) {
  const players = ui.players.value;
  const split = ui.splitScreen.value;
  return (
    <div class={`ui-root ${split ? 'split' : ''}`}>
      {players.map((p) => (
        <PlayerHudView key={p.index} p={p} split={split} />
      ))}
      <div class="badge" data-testid="backend-badge">
        {ui.backend.value} · {ui.tier.value} · {Math.round(ui.renderScale.value * 100)}% · {ui.fps.value} fps
      </div>
      {ui.showTouch.value && !split && <TouchControls source={touch} />}
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

function PlayerHudView({ p, split }: { p: PlayerHud; split: boolean }) {
  const pos = split ? (p.index === 0 ? 'p-top' : 'p-bottom') : 'p-top';
  return (
    <div class={`hud ${pos}`} data-testid={`hud-p${p.index + 1}`}>
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
  );
}
