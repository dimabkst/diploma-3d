import type { ModelSpec } from '@diploma-3d/schema';
import { createPreviewGlb } from './export/glb.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import { type GeneratedModel, generateModel } from './model.ts';

export interface ModelArtifacts {
  readonly model: GeneratedModel;
  readonly previewGlb: Uint8Array<ArrayBuffer>;
  readonly printFile: { readonly fileName: string; readonly bytes: Uint8Array<ArrayBuffer> };
}

/** Preview and print file are both derived from the single validated mesh set of `generateModel`. */
export async function buildModelArtifacts(kernel: GeometryKernel, spec: ModelSpec): Promise<ModelArtifacts> {
  const model = generateModel(kernel, spec);
  const printFile = { fileName: `${model.name}.3mf`, bytes: createThreeMf(model.solids, { title: model.name }) };
  return { model, previewGlb: await createPreviewGlb(model.solids), printFile };
}
