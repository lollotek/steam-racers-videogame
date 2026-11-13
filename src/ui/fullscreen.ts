/**
 * Fullscreen + landscape lock on phones (doc 03 §17, PWA `display: fullscreen`).
 * Browsers only allow fullscreen from a user gesture, so it cannot happen on rotation alone:
 * the first tap (any tap: the "rotate" hint, the touch controls, a menu) enters fullscreen and
 * locks the orientation to landscape, which also rotates the game on Android. If the player
 * leaves fullscreen (back gesture), the next tap enters it again. Installed PWAs start fullscreen.
 */

type OrientationLock = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

export function isFullscreen(): boolean {
  return !!document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches;
}

export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* refused (no gesture, iframe, iOS Safari): keep playing in the page */
  }
  try {
    await (screen.orientation as OrientationLock | undefined)?.lock?.('landscape');
  } catch {
    /* not supported or not in fullscreen */
  }
}

/** Enter fullscreen on every tap while not fullscreen. Returns a disposer. */
export function installAutoFullscreen(): () => void {
  // pointerup / touchend are user-activation events for touch input (pointerdown is not).
  const onTap = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'mouse') return;
    if (!isFullscreen()) void enterFullscreen();
  };
  window.addEventListener('pointerup', onTap, true);
  window.addEventListener('touchend', onTap, true);
  return () => {
    window.removeEventListener('pointerup', onTap, true);
    window.removeEventListener('touchend', onTap, true);
  };
}
