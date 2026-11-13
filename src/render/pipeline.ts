/**
 * Ink-comic render pipeline (doc 02 §2, §5, §7, §11):
 * MRT geometry pass (color HDR, view normals, meta) → outlines → bloom → tonemap →
 * grade → vignette + paper + grain → AA. Debug views replace the output node.
 */
import {
  BlendMode,
  MaterialBlending,
  NeutralToneMapping,
  RenderPipeline,
  SRGBColorSpace,
  type Camera,
  type Scene,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  abs,
  cameraFar,
  cameraNear,
  unpackRGBToNormal,
  packNormalToRGB,
  dot,
  float,
  floor,
  hash,
  length,
  luminance,
  max,
  mix,
  mrt,
  normalView,
  output,
  pass,
  perspectiveDepthToViewZ,
  renderOutput,
  screenUV,
  select,
  smoothstep,
  step,
  texture,
  time,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { tunables } from '../core/tunables';
import { U } from './ink/ink-uniforms';
import { fogFactorFromDistance } from './ink/ink-material';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const REBUILD_KEYS = new Set(['post.bloom', 'post.aa', 'post.debugView', 'lines.enabled']);

export class InkPipeline {
  readonly pipeline: RenderPipeline;
  private scenePass: N;
  private bloomNode: N = null;
  private dirty = true;

  constructor(
    private renderer: WebGPURenderer,
    scene: Scene,
    camera: Camera,
    private tex: { noise: Texture; paper: Texture },
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // tonemap + sRGB done in the graph
    this.scenePass = pass(scene, camera);
    // Default MRT outputs for materials that do not override them (non-ink materials).
    // normal/meta use the material's blending: opaque materials overwrite, particles (alpha 0) keep
    // the destination, so smoke and steam never produce outlines (doc 02 §2).
    const sceneMrt = mrt({ output, normal: packNormalToRGB(normalView), meta: vec4(0, 0.5, 0, 0) });
    sceneMrt.setBlendMode('normal', new BlendMode(MaterialBlending));
    sceneMrt.setBlendMode('meta', new BlendMode(MaterialBlending));
    this.scenePass.setMRT(sceneMrt);
    tunables.onChange((key) => {
      if (REBUILD_KEYS.has(key)) this.dirty = true;
      if (this.bloomNode && key === 'post.bloomStrength') this.bloomNode.strength.value = tunables.get('post.bloomStrength');
      if (this.bloomNode && key === 'post.bloomRadius') this.bloomNode.radius.value = tunables.get('post.bloomRadius');
      if (this.bloomNode && key === 'post.bloomThreshold') this.bloomNode.threshold.value = tunables.get('post.bloomThreshold');
    });
  }

  setCamera(camera: Camera): void {
    this.scenePass.camera = camera;
  }

  /** Call on resize / pixel-ratio change. */
  updateResolution(): void {
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    U.invResolution.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    U.resolutionScale.value = h / 1080;
  }

  /** Precompile the scene-pass programs (MRT variants) without blocking where the backend allows it. */
  async compileAsync(): Promise<void> {
    if (this.dirty) this.rebuild();
    await this.scenePass.compileAsync(this.renderer);
  }

  render(): void {
    if (this.dirty) this.rebuild();
    this.pipeline.render();
  }

  private rebuild(): void {
    this.dirty = false;
    const sp = this.scenePass;
    const color: N = sp.getTextureNode('output');
    const normalTex: N = sp.getTextureNode('normal');
    const metaTex: N = sp.getTextureNode('meta');
    const depthTex: N = sp.getTextureNode('depth');
    const view = tunables.get<string>('post.debugView');

    const viewZAt = (uv: N): N => perspectiveDepthToViewZ(depthTex.sample(uv).x, cameraNear, cameraFar);
    const normalAt = (uv: N): N => unpackRGBToNormal(normalTex.sample(uv).xyz);

    const edges = Fn(() => {
      // Static screen-space wobble (S2: never re-seeded, no "boiling").
      const nz: N = texture(this.tex.noise).sample(screenUV.div(U.invResolution).div(256)).rg.sub(0.5).mul(2);
      const uvC: N = screenUV.add(nz.mul(U.wobbleAmp).mul(U.invResolution));
      const metaC: N = metaTex.sample(uvC);
      const widthPx: N = select(metaC.g.greaterThan(0.75), U.vehicleLineWidth, U.lineWidth).mul(U.resolutionScale);
      const o: N = U.invResolution.mul(max(widthPx.mul(0.5), 0.5));
      const zC: N = viewZAt(uvC);
      const nC: N = normalAt(uvC);
      let depthE: N = float(0);
      let creaseE: N = float(0);
      let idE: N = float(0);
      let weight: N = metaC.g;
      const offsets = [vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1), vec2(0.7, 0.7), vec2(-0.7, -0.7), vec2(0.7, -0.7), vec2(-0.7, 0.7)];
      for (const off of offsets) {
        const uvN: N = uvC.add(off.mul(o));
        const zN: N = viewZAt(uvN);
        const metaN: N = metaTex.sample(uvN);
        depthE = max(depthE, abs(zN.sub(zC)).div(abs(zC).max(0.001)));
        creaseE = max(creaseE, float(1).sub(dot(nC, normalAt(uvN))));
        idE = max(idE, step(0.002, abs(metaN.r.sub(metaC.r))));
        weight = max(weight, metaN.g);
      }
      const sil = smoothstep(U.depthThreshold.mul(0.5), U.depthThreshold, depthE);
      const creaseT: N = float(1).sub(U.creaseCos);
      const crease = smoothstep(creaseT.mul(0.7), creaseT.mul(1.3), creaseE).mul(U.creaseStrength);
      const idEdge = idE.mul(U.idStrength);
      const e: N = max(sil, max(crease, idEdge)).mul(step(0.01, weight));
      return e.mul(float(1).sub(fogFactorFromDistance(zC.negate())));
    });

    const linesOn = tunables.get<boolean>('lines.enabled');
    const edge: N = linesOn ? edges() : float(0);
    let hdr: N = vec4(mix(color.rgb, U.inkColor, edge), 1);

    this.bloomNode = null;
    if (tunables.get<boolean>('post.bloom')) {
      this.bloomNode = bloom(color, tunables.get('post.bloomStrength'), tunables.get('post.bloomRadius'), tunables.get('post.bloomThreshold'));
      hdr = hdr.add(vec4(this.bloomNode.rgb, 0));
    }

    let ldr: N = renderOutput(vec4(hdr.rgb.mul(U.exposure), 1), NeutralToneMapping, SRGBColorSpace);
    ldr = grade(ldr.rgb);
    ldr = paperAndGrain(ldr, this.tex.paper);
    let out: N = vec4(ldr, 1);

    const aa = tunables.get<string>('post.aa');
    if (aa === 'fxaa') out = fxaa(out);
    else if (aa === 'smaa') out = smaa(out);

    switch (view) {
      case 'grayscale':
        out = vec4(vec3(luminance(out.rgb)), 1);
        break;
      case 'normals':
        out = vec4(normalTex.rgb, 1);
        break;
      case 'depth':
        out = vec4(vec3(sp.getLinearDepthNode().oneMinus().pow(8)), 1);
        break;
      case 'edges':
        out = vec4(vec3(float(1).sub(edge)), 1);
        break;
      case 'objectId':
        out = vec4(hash(metaTex.r.mul(1000)), hash(metaTex.r.mul(2000)), metaTex.g, 1);
        break;
      case 'noPost':
        out = renderOutput(color, NeutralToneMapping, SRGBColorSpace);
        break;
    }
    this.pipeline.outputNode = out;
    this.pipeline.needsUpdate = true;
  }
}

/** Display-space grading (stand-in for the biome 3D LUT until S1 tones are matched). */
function grade(c: N): N {
  const lum: N = luminance(c);
  let g: N = mix(vec3(lum), c, U.saturation);
  g = g.sub(0.5).mul(U.contrast).add(0.5);
  g = g.mul(U.gain).add(U.lift.mul(float(1).sub(g)));
  return g.saturate();
}

function paperAndGrain(c: N, paperTex: Texture): N {
  const d: N = length(screenUV.sub(0.5).mul(vec2(1.2, 1)));
  const vig: N = mix(float(1), smoothstep(0.85, 0.3, d), U.vignette);
  let g: N = c.mul(vig);
  const paper: N = texture(paperTex).sample(screenUV.div(U.invResolution).div(512)).r;
  g = g.mul(float(1).add(paper.sub(0.5).mul(2).mul(U.paper)));
  const seed: N = screenUV.div(U.invResolution).add(floor(time.mul(24)).mul(17.13));
  const n: N = hash(seed.x.add(seed.y.mul(4096.0))).sub(0.5);
  return g.add(n.mul(U.grain)).saturate();
}
