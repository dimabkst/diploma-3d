import { buildModelArtifacts, loadGeometryKernel, type ModelArtifacts, type ModelSettingsInput } from '@diploma-3d/engine';
import type { ModelSpec } from '@diploma-3d/schema';
// The web package pins the engine's manifold-3d version only so that Vite can emit the WASM file and provide its URL.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

/** The artifacts of a request's specification, whose files record the settings of that same request. */
export function buildModel(spec: ModelSpec, settingsInput: ModelSettingsInput): Promise<ModelArtifacts> {
  return loadGeometryKernel({ wasmUrl: manifoldWasmUrl }).then((kernel) => buildModelArtifacts(kernel, spec, settingsInput));
}
