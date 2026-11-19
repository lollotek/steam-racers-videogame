/**
 * Menu navigation for the front-end screens (doc 04 B1): keyboard, gamepad and touch.
 * Every button with `data-nav` inside the root is an item, in DOM order.
 *  - Keyboard: arrows / WASD move, Enter / Space activate (native button focus), Esc / Backspace back.
 *  - Gamepad: d-pad or left stick move, A activates, B goes back.
 *  - Touch / mouse: tap the button (pointer hover moves the focus).
 * Only the most recently mounted active menu listens, so a pause menu over a results card works.
 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

type Menu = { root: RefObject<HTMLElement | null>; back: (() => void) | undefined };
const stack: Menu[] = [];

const items = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])') ?? []);
/** The default item of a menu: `[data-autofocus]`, else the first one. */
const preferred = (root: HTMLElement | null) => root?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? items(root)[0];

function move(m: Menu, d: number): void {
  const list = items(m.root.current);
  if (list.length === 0) return;
  const cur = list.indexOf(document.activeElement as HTMLElement);
  // Nothing focused (focus lost on a re-render): the first press lands on the default item.
  if (cur < 0) {
    preferred(m.root.current)?.focus();
    return;
  }
  list[(cur + d + list.length) % list.length]!.focus();
}

function activate(m: Menu): void {
  const list = items(m.root.current);
  const el = list.includes(document.activeElement as HTMLElement) ? (document.activeElement as HTMLElement) : preferred(m.root.current);
  el?.click();
}

const top = () => stack[stack.length - 1];

function onKey(e: KeyboardEvent): void {
  const m = top();
  if (!m || e.repeat) return;
  // Typing in a text field (tuning JSON): only Esc leaves it.
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
    if (e.code === 'Escape') t.blur();
    return;
  }
  const prev = ['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA'].includes(e.code);
  const next = ['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD'].includes(e.code);
  if (prev || next) {
    move(m, prev ? -1 : 1);
    e.preventDefault();
  } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
    // A focused button clicks itself; otherwise the first item.
    if (!items(m.root.current).includes(document.activeElement as HTMLElement)) activate(m);
    else (document.activeElement as HTMLElement).click();
    e.preventDefault();
  } else if ((e.code === 'Escape' || e.code === 'Backspace') && m.back) {
    m.back();
    e.preventDefault();
  }
}

/** Space clicks a focused button on keyup natively: we already clicked on keydown. */
function onKeyUp(e: KeyboardEvent): void {
  if (top() && e.code === 'Space') e.preventDefault();
}

// Gamepad: edge-triggered, held buttons at mount time do not fire (A from the previous screen).
let prevPad = new Set<string>();
let polling = false;
function padState(): Set<string> {
  const s = new Set<string>();
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p) continue;
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    if (b(12) || ay < -0.6) s.add('up');
    if (b(13) || ay > 0.6) s.add('down');
    if (b(14) || ax < -0.6) s.add('up');
    if (b(15) || ax > 0.6) s.add('down');
    if (b(0)) s.add('a');
    if (b(1)) s.add('b');
  }
  return s;
}
function poll(): void {
  if (stack.length === 0) {
    polling = false;
    return;
  }
  const now = padState();
  const m = top()!;
  const edge = (k: string) => now.has(k) && !prevPad.has(k);
  if (edge('up')) move(m, -1);
  if (edge('down')) move(m, 1);
  if (edge('a')) activate(m);
  if (edge('b')) m.back?.();
  prevPad = now;
  requestAnimationFrame(poll);
}

function onPointer(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  const el = (e.target as HTMLElement | null)?.closest?.('[data-nav]') as HTMLElement | null;
  if (el && !el.hasAttribute('disabled') && document.activeElement !== el) el.focus({ preventScroll: true });
}

/** Register a menu while mounted (and `active`). Focuses the first item (or `[data-autofocus]`). */
export function useMenuNav(root: RefObject<HTMLElement | null>, back?: () => void, active = true): void {
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    if (!active) return;
    const m: Menu = { root, back: undefined };
    Object.defineProperty(m, 'back', { get: () => backRef.current });
    if (stack.length === 0) {
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('pointermove', onPointer);
    }
    stack.push(m);
    prevPad = padState();
    if (!polling) {
      polling = true;
      requestAnimationFrame(poll);
    }
    preferred(root.current)?.focus({ preventScroll: true });
    return () => {
      const i = stack.indexOf(m);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointermove', onPointer);
      }
    };
  }, [active, root]);
}

/** Re-focus the first item when the content of a menu changes (wizard steps). */
export function useRefocus(root: RefObject<HTMLElement | null>, key: unknown): void {
  // Layout effect: runs before the next key event can reach the old focus.
  useLayoutEffect(() => {
    const focus = () => preferred(root.current)?.focus({ preventScroll: true });
    focus();
    // Preact may replace the focused button after this commit (keyed lists): focus again.
    const t = setTimeout(focus, 0);
    return () => clearTimeout(t);
  }, [key]);
}
