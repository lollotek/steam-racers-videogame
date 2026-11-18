/**
 * Controls reference shown in the pause screen (gameplay.md Appendix). Built from the live
 * bindings (input/keyboard.ts, input/gamepad.ts), so it never drifts from what the game reads.
 */
import type { Button } from '../input/actions';
import { P1_KEYS, P2_KEYS, mergeBindings, type KeyBindings } from '../input/keyboard';
import { tunables } from '../core/tunables';
import { PAD_BUTTONS } from '../input/gamepad';

interface Row {
  label: string;
  /** Short rule reminder. */
  hint?: string;
  steer?: boolean;
  button?: Button;
  touch: string;
}

const ROWS: Row[] = [
  { label: 'Steer', steer: true, touch: 'Left pad' },
  { label: 'Steam push + gear up', hint: '1 PV · boiler stall: open the valve', button: 'steamPush', touch: 'STEAM' },
  { label: 'Gear down', hint: 'hold: brake, reverse · boiler stall: open the valve', button: 'gearDown', touch: 'GEAR −' },
  { label: 'Vent', hint: 'dump steam', button: 'vent', touch: 'VENT' },
  { label: 'Front cannon', button: 'fireFront', touch: 'FIRE' },
  { label: 'Reposition', button: 'reposition', touch: '⟲' },
  { label: 'Pause', button: 'pause', touch: 'II' },
];

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftRight: 'Right Shift',
  ShiftLeft: 'Left Shift',
  ControlRight: 'Right Ctrl',
  ControlLeft: 'Left Ctrl',
  Period: '.',
  Slash: '/',
  Numpad0: 'Num 0',
  Backspace: 'Backspace',
  Escape: 'Esc',
};

const PAD_NAMES: Record<number, string> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start', 12: 'D-pad ↑', 14: 'D-pad ←', 15: 'D-pad →' };

export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function keys(b: KeyBindings, row: Row): string {
  if (row.steer) return `${b.steerLeft.map(keyName).join('/')} ${b.steerRight.map(keyName).join('/')}`;
  return (b.buttons[row.button!] ?? []).map(keyName).join(' / ') || '—';
}

function hint(row: Row): string | undefined {
  if (row.button === 'fireFront') {
    const lap = tunables.get<number>('weapons.unlockLap');
    return lap > 0 ? `armed from lap ${lap + 1}` : 'auto-aims the rival ahead';
  }
  return row.hint;
}

function pad(row: Row): string {
  if (row.steer) return 'Left stick';
  return (PAD_BUTTONS[row.button!] ?? []).map((i) => PAD_NAMES[i] ?? `#${i}`).join(' / ');
}

export function Controls({ split, touch }: { split: boolean; touch: boolean }) {
  return (
    <table class="controls" data-testid="controls-help">
      <thead>
        <tr>
          <th />
          <th>{split ? 'Player 1' : 'Keyboard'}</th>
          {split && <th>Player 2</th>}
          <th>Gamepad</th>
          {touch && <th>Touch</th>}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.label}>
            <td class="action">
              {r.label}
              {hint(r) && <span class="hint"> · {hint(r)}</span>}
            </td>
            <td>{keys(split ? P1_KEYS : mergeBindings(P1_KEYS, P2_KEYS), r)}</td>
            {split && <td>{r.button === 'pause' ? '—' : keys(P2_KEYS, r)}</td>}
            <td>{pad(r)}</td>
            {touch && <td>{r.touch}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
