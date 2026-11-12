import { useRef, useState } from 'preact/hooks';
import type { Button } from '../input/actions';
import type { TouchSource } from '../input/touch';

/**
 * On-screen controls (gameplay.md Appendix): left steering pad, big steam-push button,
 * "Gear −" pedal (hold = brake), vent, weapons, cards, reposition, pause.
 */
export function TouchControls({ source }: { source: TouchSource }) {
  return (
    <div class="touch-controls" data-testid="touch-controls">
      <SteerPad source={source} />
      <div class="touch-right">
        <div class="touch-row small">
          <TouchButton source={source} button="card1" label="1" />
          <TouchButton source={source} button="card2" label="2" />
          <TouchButton source={source} button="card3" label="3" />
          <TouchButton source={source} button="reposition" label="⟲" />
          <TouchButton source={source} button="pause" label="II" />
        </div>
        <div class="touch-row small">
          <TouchButton source={source} button="fireRear" label="REAR" />
          <TouchButton source={source} button="fireTurret" label="TUR" />
          <TouchButton source={source} button="fireFront" label="FIRE" />
          <TouchButton source={source} button="vent" label="VENT" />
        </div>
        <div class="touch-row big">
          <TouchButton source={source} button="gearDown" label="GEAR −" cls="pedal" />
          <TouchButton source={source} button="steamPush" label="STEAM" cls="steam" />
        </div>
      </div>
    </div>
  );
}

function TouchButton({ source, button, label, cls = '' }: { source: TouchSource; button: Button; label: string; cls?: string }) {
  const [down, setDown] = useState(false);
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    capture(e);
    source.press(button);
    setDown(true);
    navigator.vibrate?.(8);
  };
  const onUp = () => {
    source.release(button);
    setDown(false);
  };
  return (
    <div
      class={`tbtn ${cls} ${down ? 'down' : ''}`}
      data-testid={`touch-${button}`}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
    >
      {label}
    </div>
  );
}

/** Pointer capture keeps a held button/drag alive when the finger slides off; may throw for synthetic events. */
function capture(e: PointerEvent): void {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* not an active pointer */
  }
}

/** Floating steering pad: steer = horizontal offset from the touch start, ±range px → ±1. */
function SteerPad({ source }: { source: TouchSource }) {
  const RANGE = 70;
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; dx: number } | null>(null);

  const onDown = (e: PointerEvent) => {
    if (start.current) return;
    e.preventDefault();
    capture(e);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setKnob({ x: e.clientX - r.left, y: e.clientY - r.top, dx: 0 });
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = Math.max(-RANGE, Math.min(RANGE, e.clientX - s.x));
    source.setSteer(dx / RANGE);
    setKnob((k) => (k ? { ...k, dx } : k));
  };
  const onUp = (e: PointerEvent) => {
    if (start.current?.id !== e.pointerId) return;
    start.current = null;
    source.setSteer(0);
    setKnob(null);
  };
  return (
    <div
      class="steer-pad"
      data-testid="touch-steer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {knob ? (
        <div class="steer-base" style={{ left: `${knob.x}px`, top: `${knob.y}px` }}>
          <div class="steer-knob" style={{ transform: `translate(${knob.dx}px, 0)` }} />
        </div>
      ) : (
        <div class="steer-hint">◀ STEER ▶</div>
      )}
    </div>
  );
}
