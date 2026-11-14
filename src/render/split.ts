/**
 * Split screen compositor (doc 03 §10.4, PC only).
 * Each player's full ink pipeline renders into its own half-height render target; one final pass
 * stacks them (player 1 on top). Rendering both chains straight to the canvas does not work:
 * WebGPU clears the whole attachment on load, ignoring the scissor.
 */
import { RenderPipeline, RenderTarget, Vector2, type WebGPURenderer } from 'three/webgpu';
import { screenUV, select, texture, vec2 } from 'three/tsl';
import type { InkPipeline } from './pipeline';

export class SplitCompositor {
  private readonly targets: [RenderTarget, RenderTarget];
  private readonly out: RenderPipeline;
  private size = new Vector2();

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly pipelines: readonly InkPipeline[],
  ) {
    this.targets = [new RenderTarget(1, 1), new RenderTarget(1, 1)];
    this.out = new RenderPipeline(renderer);
    // The ink chains already tonemap and encode to sRGB.
    this.out.outputColorTransform = false;
    const top = texture(this.targets[0].texture, vec2(screenUV.x, screenUV.y.mul(2)));
    const bottom = texture(this.targets[1].texture, vec2(screenUV.x, screenUV.y.mul(2).sub(1)));
    this.out.outputNode = select(screenUV.y.lessThan(0.5), top, bottom);
    this.resize();
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.out.dispose();
  }

  /** Call on resize / pixel-ratio change. */
  resize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, Math.ceil(this.size.y / 2));
    for (const t of this.targets) t.setSize(w, h);
  }

  render(): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.pipelines.forEach((p, i) => {
      r.setRenderTarget(this.targets[i]!);
      p.render();
    });
    r.setRenderTarget(prev);
    this.out.render();
  }
}
