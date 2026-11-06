import type { ModelSpecInput } from '@diploma-3d/schema';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow, rotateHalfTurn } from './export/layout.ts';
import type { ThreeMfObject } from './export/three-mf.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import type { Vec3 } from './mesh.ts';
import { type GeneratedModel, generateModel } from './model.ts';

export interface ModelArtifacts {
  readonly model: GeneratedModel;
  /** The solid, or the parts of a section in their assembled position. */
  readonly previewGlb: Uint8Array<ArrayBuffer>;
  /**
   * For a section only: the parts moved apart, so that the cut faces show; along the plane's normal for flat faces,
   * along the sliding direction, off the tongue, for a dovetail.
   */
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
  const objects = printObjects(model);
  const printFile = { fileName: `${model.name}.3mf`, bytes: createThreeMf(objects, { title: model.name }) };
  const previewGlb = await createPreviewGlb(previewObjects(model, 0));
  if (model.section === undefined) return { model, previewGlb, printFile };
  const gap = SECTION_PREVIEW_GAP_RELATIVE * Math.max(...model.size);
  return { model, previewGlb, separatedPreviewGlb: await createPreviewGlb(previewObjects(model, gap)), printFile };
}

/**
 * The solids for the preview. With `gap` > 0 the upper part of a section moves away: by `gap` along the plane's normal
 * from flat cut faces, or, from a dovetail, along the sliding direction until it is off the tongue and `gap` further,
 * because the engaged parts cannot be pulled apart along the normal.
 */
function previewObjects({ solids, section }: GeneratedModel, gap: number): PreviewObject[] {
  if (section === undefined) return [...solids];
  const [direction, distance] =
    section.connector === undefined
      ? [section.plane.normal, gap]
      : [section.connector.frame.u, section.connector.exitDistance + gap];
  const offset: Vec3 = [direction[0] * distance, direction[1] * distance, direction[2] * distance];
  return solids.map((solid) => ({ ...solid, ...(solid.part === 'upper' && gap > 0 ? { displayOffset: offset } : {}) }));
}

/**
 * The print file's objects, side by side on the build plate. With a dovetail both connector faces print upwards: the
 * lower part stands on its lower base, and the upper part is turned half a turn about the sliding direction onto its
 * upper base, which also keeps the groove's flanks at 45° overhangs. Flat cut faces keep the parts as they are.
 */
function printObjects({ solids, section }: GeneratedModel): readonly ThreeMfObject[] {
  if (solids.length === 1) return solids;
  const axis = section?.connector?.frame.u;
  return arrangeInRow(
    axis === undefined
      ? solids
      : solids.map((solid) => (solid.part === 'upper' ? { ...solid, mesh: rotateHalfTurn(solid.mesh, axis) } : solid)),
  );
}
