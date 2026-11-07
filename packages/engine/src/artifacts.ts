import type { ModelSpecInput } from '@diploma-3d/schema';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow, rotateHalfTurn } from './export/layout.ts';
import type { ThreeMfObject } from './export/three-mf.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import { type Vec3, vertexAt, vertexCount } from './mesh.ts';
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
 * The same for plugs and dowels, which come apart along the normal: from the default viewing direction, about 28°
 * above the cut, the upper part must rise about half the cut's diameter to uncover nearly all of the lower part's cut
 * face, with the plugs or seated dowels on it, also those on the far side. A minimum: a longer connector raises the
 * upper part further, see `previewSeparation`.
 */
export const CONNECTOR_PREVIEW_GAP_RELATIVE = 0.5;

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
  const separatedPreviewGlb = await createPreviewGlb(previewObjects(model, previewSeparation(model)));
  return { model, previewGlb, separatedPreviewGlb, printFile };
}

/**
 * How far the separated preview moves the upper part, from the generated parts: SECTION_PREVIEW_GAP_RELATIVE·M for
 * flat cut faces and for a dovetail, which first slides off its tongue; for plugs and dowels at least
 * CONNECTOR_PREVIEW_GAP_RELATIVE·M, and more when what stands on the lower part, a plug or the seated dowels, reaches
 * higher above the cut than that less the flat cut's gap, so that the upper part clears it by that gap. Only display
 * nodes move, so neither the meshes nor the print file depend on it.
 */
export function previewSeparation({ solids, section, size }: GeneratedModel): number {
  const longest = Math.max(...size);
  const connector = section?.connector;
  if (section === undefined || connector === undefined || connector.type === 'dovetail') {
    return SECTION_PREVIEW_GAP_RELATIVE * longest;
  }
  const { normal, offset } = section.plane;
  let reach = 0;
  for (const { mesh, part } of solids) {
    if (part === 'upper') continue;
    for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
      const [x, y, z] = vertexAt(mesh, vertex);
      reach = Math.max(reach, normal[0] * x + normal[1] * y + normal[2] * z - offset);
    }
  }
  return Math.max(CONNECTOR_PREVIEW_GAP_RELATIVE * longest, reach + SECTION_PREVIEW_GAP_RELATIVE * longest);
}

/**
 * The solids for the preview. With `gap` > 0 the upper part of a section moves away: by `gap` along the plane's normal
 * from flat cut faces, or, from a dovetail, along the sliding direction until it is off the tongue and `gap` further,
 * because the engaged parts cannot be pulled apart along the normal.
 */
function previewObjects({ solids, section }: GeneratedModel, gap: number): PreviewObject[] {
  if (section === undefined) return [...solids];
  // Plugs and dowels come apart along the normal; the dowels stay seated in the lower part.
  const [direction, distance] =
    section.connector?.type === 'dovetail'
      ? [section.connector.frame.u, section.connector.exitDistance + gap]
      : [section.plane.normal, gap];
  const offset: Vec3 = [direction[0] * distance, direction[1] * distance, direction[2] * distance];
  return solids.map((solid) => ({ ...solid, ...(solid.part === 'upper' && gap > 0 ? { displayOffset: offset } : {}) }));
}

/**
 * The print file's objects, side by side on the build plate. With a connector both connector faces print upwards: the
 * lower part stands on its lower base, and the upper part is turned half a turn about u onto its upper base, which
 * also keeps a dovetail groove's flanks at 45° overhangs. Removable dowels stand upright on an end face, as they are
 * built along the normal. Flat cut faces keep the parts as they are.
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
