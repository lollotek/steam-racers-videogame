import { WebGPURenderer } from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: WebGPURenderer;
  backend: Backend;
  canvas: HTMLCanvasElement;
}

/**
 * Renderer bootstrap (doc 03 §10.1): WebGPU first, automatic WebGL2 fallback.
 * `forceWebGL` (URL flag ?backend=webgl2) tests the fallback path on WebGPU machines.
 */
export async function createRenderer(container: HTMLElement, forceWebGL: boolean): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  const canvas = renderer.domElement;
  canvas.id = 'game-canvas';
  container.appendChild(canvas);
  console.info(`[render] backend: ${backend}`);
  return { renderer, backend, canvas };
}

/** Effective pixel ratio = min(devicePixelRatio, maxDpr) × renderScale. */
export function pixelRatioFor(devicePixelRatio: number, maxDpr: number, renderScale: number): number {
  return Math.max(0.25, Math.min(devicePixelRatio, maxDpr) * renderScale);
}
