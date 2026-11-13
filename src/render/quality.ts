/**
 * Quality tiers and dynamic resolution (doc 02 §14, doc 03 §10.2). Pure logic, unit tested.
 */
export type QualityTierName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityTier {
  name: QualityTierName;
  /** Default render scale (fraction of CSS size × capped DPR). */
  renderScale: number;
  minRenderScale: number;
  maxRenderScale: number;
  maxDpr: number;
  shadowMapSize: number; // 0 = blob shadows
  hatching: boolean;
  bloomMips: number;
  dynamicLights: number;
  particles: number;
}

export const TIERS: Record<QualityTierName, QualityTier> = {
  low: { name: 'low', renderScale: 0.6, minRenderScale: 0.5, maxRenderScale: 0.75, maxDpr: 2, shadowMapSize: 0, hatching: false, bloomMips: 3, dynamicLights: 2, particles: 2000 },
  medium: { name: 'medium', renderScale: 0.75, minRenderScale: 0.55, maxRenderScale: 0.9, maxDpr: 2, shadowMapSize: 1024, hatching: true, bloomMips: 4, dynamicLights: 4, particles: 5000 },
  high: { name: 'high', renderScale: 1, minRenderScale: 0.7, maxRenderScale: 1, maxDpr: 2, shadowMapSize: 2048, hatching: true, bloomMips: 5, dynamicLights: 16, particles: 15000 },
  ultra: { name: 'ultra', renderScale: 1, minRenderScale: 0.8, maxRenderScale: 1, maxDpr: 2, shadowMapSize: 4096, hatching: true, bloomMips: 5, dynamicLights: 32, particles: 20000 },
};

export interface DeviceInfo {
  backend: 'webgpu' | 'webgl2';
  isMobile: boolean;
  cores: number;
  /** navigator.deviceMemory in GB, if available. */
  memoryGb: number | null;
  screenPixels: number;
}

/** Initial tier guess; refined later by a benchmark and by dynamic resolution. */
export function detectTier(d: DeviceInfo): QualityTierName {
  if (d.isMobile) {
    if (d.memoryGb !== null && d.memoryGb <= 3) return 'low';
    return d.cores >= 6 ? 'medium' : 'low'; // D4 target: mid-range 2021 → medium
  }
  if (d.backend === 'webgl2') return d.cores >= 8 ? 'medium' : 'low';
  if (d.cores >= 12 && (d.memoryGb === null || d.memoryGb >= 8)) return 'ultra';
  return 'high';
}

export function isMobileDevice(nav: Navigator, win: Window): boolean {
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const iPadOS = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
  const coarse = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  return uaMobile || iPadOS || (coarse && Math.min(win.screen.width, win.screen.height) < 820);
}

/**
 * Dynamic resolution controller: lowers render scale when frames are slow for `downAfter` seconds,
 * raises it when frames are comfortably fast for `upAfter` seconds. Never changes features, only scale.
 */
export class DynamicResolution {
  static readonly HITCH_MS = 250;
  scale: number;
  enabled = true;
  targetFps: number;
  step = 0.05;
  downAfter = 1;
  upAfter = 3;
  /** Raise only when frame time is below this fraction of the budget. */
  headroom = 0.8;
  private avgMs: number;
  private slowTime = 0;
  private fastTime = 0;

  constructor(
    public tier: QualityTier,
    targetFps: number,
  ) {
    this.scale = tier.renderScale;
    this.targetFps = targetFps;
    this.avgMs = 1000 / targetFps;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.scale = tier.renderScale;
    this.slowTime = this.fastTime = 0;
  }

  /** Forget the frame history (race start, resume): loading hitches are not GPU load. */
  reset(): void {
    this.avgMs = 1000 / this.targetFps;
    this.slowTime = this.fastTime = 0;
  }

  get averageMs(): number {
    return this.avgMs;
  }

  /** Feed a frame duration; returns true when the scale changed. */
  update(frameMs: number): boolean {
    if (!this.enabled) return false;
    // A single very long frame is a hitch (shader compile, GC, tab switch), not sustained load:
    // lowering the resolution for it would only add a second hitch (render targets reallocated).
    if (frameMs > DynamicResolution.HITCH_MS) return false;
    const dt = frameMs / 1000;
    this.avgMs += (frameMs - this.avgMs) * 0.1; // EMA
    const budget = 1000 / this.targetFps;
    // Small tolerance so vsync jitter around the budget does not count as slow.
    if (this.avgMs > budget * 1.05) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (this.avgMs < budget * this.headroom) {
      this.fastTime += dt;
      this.slowTime = 0;
    } else {
      this.slowTime = this.fastTime = 0;
    }
    const prev = this.scale;
    if (this.slowTime >= this.downAfter) {
      this.scale = Math.max(this.tier.minRenderScale, round2(this.scale - this.step));
      this.slowTime = 0;
    } else if (this.fastTime >= this.upAfter) {
      this.scale = Math.min(this.tier.maxRenderScale, round2(this.scale + this.step));
      this.fastTime = 0;
    }
    return this.scale !== prev;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
