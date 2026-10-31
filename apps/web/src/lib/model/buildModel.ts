import { buildModelArtifacts, loadGeometryKernel, type ModelArtifacts } from '@diploma-3d/engine';
import type { ModelSpec } from '@diploma-3d/schema';
// The web package pins the engine's manifold-3d version only so that Vite can emit the WASM file and provide its URL.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

export function buildModel(spec: ModelSpec): Promise<ModelArtifacts> {
  return loadGeometryKernel({ wasmUrl: manifoldWasmUrl }).then((kernel) => buildModelArtifacts(kernel, spec));
}
