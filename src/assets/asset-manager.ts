import type { WebGPURenderer } from 'three/webgpu';
import type { Object3D, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Asset manager skeleton (doc 03 §11.1): manifests with byte sizes for progress,
 * reference counting and disposal. KTX2 transcoder files are served from /basis/ (added in M1).
 */
export interface ManifestEntry {
  id: string;
  url: string;
  type: 'gltf' | 'json';
  bytes: number;
}

export interface Manifest {
  id: string;
  assets: ManifestEntry[];
}

type Loaded = { kind: 'gltf'; data: GLTF } | { kind: 'json'; data: unknown };

interface Entry {
  refs: number;
  value: Loaded;
}

export type ProgressFn = (loadedBytes: number, totalBytes: number) => void;

export class AssetManager {
  private gltf: GLTFLoader;
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Loaded>>();

  constructor(renderer: WebGPURenderer, basisPath = '/basis/') {
    const ktx2 = new KTX2Loader().setTranscoderPath(basisPath);
    ktx2.detectSupport(renderer);
    this.gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  async loadManifest(manifest: Manifest, onProgress?: ProgressFn): Promise<void> {
    const total = manifest.assets.reduce((s, a) => s + a.bytes, 0);
    let done = 0;
    onProgress?.(0, total);
    await Promise.all(
      manifest.assets.map(async (a) => {
        await this.acquire(a);
        done += a.bytes;
        onProgress?.(done, total);
      }),
    );
  }

  async acquire(entry: ManifestEntry): Promise<Loaded> {
    const cached = this.cache.get(entry.id);
    if (cached) {
      cached.refs++;
      return cached.value;
    }
    let p = this.inflight.get(entry.id);
    if (!p) {
      p = this.load(entry);
      this.inflight.set(entry.id, p);
    }
    const value = await p;
    this.inflight.delete(entry.id);
    const now = this.cache.get(entry.id);
    if (now) now.refs++;
    else this.cache.set(entry.id, { refs: 1, value });
    return value;
  }

  getGltf(id: string): GLTF {
    const e = this.cache.get(id);
    if (!e || e.value.kind !== 'gltf') throw new Error(`GLTF not loaded: ${id}`);
    return e.value.data;
  }

  getJson<T>(id: string): T {
    const e = this.cache.get(id);
    if (!e || e.value.kind !== 'json') throw new Error(`JSON not loaded: ${id}`);
    return e.value.data as T;
  }

  release(id: string): void {
    const e = this.cache.get(id);
    if (!e) return;
    if (--e.refs > 0) return;
    if (e.value.kind === 'gltf') disposeObject(e.value.data.scene);
    this.cache.delete(id);
  }

  releaseManifest(manifest: Manifest): void {
    for (const a of manifest.assets) this.release(a.id);
  }

  private async load(entry: ManifestEntry): Promise<Loaded> {
    if (entry.type === 'gltf') return { kind: 'gltf', data: await this.gltf.loadAsync(entry.url) };
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Failed to load ${entry.url}: ${res.status}`);
    return { kind: 'json', data: await res.json() };
  }
}

export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Object3D & { geometry?: { dispose(): void }; material?: unknown };
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats as Record<string, unknown>[]) {
      for (const v of Object.values(m)) if (v && (v as Texture).isTexture) (v as Texture).dispose();
      (m as { dispose?: () => void }).dispose?.();
    }
  });
}
