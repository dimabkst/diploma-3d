import type { ModelSpecInput } from '@diploma-3d/schema';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow } from './export/layout.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import { type GeneratedModel, generateModel } from './model.ts';

export interface ModelArtifacts {
  readonly model: GeneratedModel;
  /** The solid, or the parts of a section in their assembled position. */
  readonly previewGlb: Uint8Array<ArrayBuffer>;
  /** For a section only: the parts moved apart along the plane's normal, so that the cut faces show. */
  readonly separatedPreviewGlb?: Uint8Array<ArrayBuffer>;
  readonly printFile: { readonly fileName: string; readonly bytes: Uint8Array<ArrayBuffer> };
}

/**
 * How far the preview moves the upper part of a section away from the lower one, relative to the longest side of the
 * assembled model: enough to see both cut faces, little enough to keep the parts recognisable as one solid.
 */
export const SECTION_PREVIEW_GAP_RELATIVE = 0.15;

/**
 * Preview and print file are both derived from the single validated mesh set of `generateModel`. The parts of a
 * section are separate objects of the print file, laid out side by side; the preview's separation moves only display
 * nodes, so it changes neither the meshes nor the print file.
 */
export async function buildModelArtifacts(kernel: GeometryKernel, spec: ModelSpecInput): Promise<ModelArtifacts> {
  const model = generateModel(kernel, spec);
  const objects = model.solids.length > 1 ? arrangeInRow(model.solids) : model.solids;
  const printFile = { fileName: `${model.name}.3mf`, bytes: createThreeMf(objects, { title: model.name }) };
  const previewGlb = await createPreviewGlb(previewObjects(model, 0));
  if (model.section === undefined) return { model, previewGlb, printFile };
  const gap = SECTION_PREVIEW_GAP_RELATIVE * Math.max(...model.size);
  return { model, previewGlb, separatedPreviewGlb: await createPreviewGlb(previewObjects(model, gap)), printFile };
}

/** The solids for the preview, with the upper part of a section moved by `gap` millimetres along the plane's normal. */
function previewObjects({ solids, section }: GeneratedModel, gap: number): PreviewObject[] {
  if (section === undefined) return [...solids];
  const { normal } = section.plane;
  return solids.map((solid) => ({
    ...solid,
    cutPlane: section.plane,
    ...(solid.part === 'upper' && gap > 0 ? { displayOffset: [normal[0] * gap, normal[1] * gap, normal[2] * gap] } : {}),
  }));
}
