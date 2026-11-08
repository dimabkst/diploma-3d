import type { ModelSpecInput } from '@diploma-3d/schema';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow, rotateHalfTurn, rotateOntoZ } from './export/layout.ts';
import type { ThreeMfObject } from './export/three-mf.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import { type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';

export interface ModelArtifacts {
  readonly model: GeneratedModel;
  /** The solid, or the parts of a section in their assembled position. */
  readonly previewGlb: Uint8Array<ArrayBuffer>;
  /**
   * For a section only: the parts moved apart, so that the cut faces show; along the plane's normal for flat faces,
   * plugs and dowels, along the sliding direction, off the tongue, for a dovetail.
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

/** The part on the positive side of a section's plane: the one with the holes or the groove. */
const onPositiveSide = ({ part }: Solid) => part === 'upper' || part === 'part-2';

/**
 * How far the separated preview moves a part, from the generated parts: SECTION_PREVIEW_GAP_RELATIVE·M for flat cut
 * faces and for a dovetail, which first slides off its tongue; for plugs and dowels at least
 * CONNECTOR_PREVIEW_GAP_RELATIVE·M, and more when what stands on the plane's negative side, a plug or the seated dowels,
 * reaches further beyond the cut than that less the flat cut's gap, so that the other part clears it by that gap. Only
 * display nodes move, so neither the meshes nor the print file depend on it.
 */
export function previewSeparation({ solids, section, size }: GeneratedModel): number {
  const longest = Math.max(...size);
  const connector = section?.connector;
  if (section === undefined || connector === undefined || connector.type === 'dovetail') {
    return SECTION_PREVIEW_GAP_RELATIVE * longest;
  }
  const { normal, offset } = section.plane;
  let reach = 0;
  for (const solid of solids) {
    if (onPositiveSide(solid)) continue;
    const { mesh } = solid;
    for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
      const [x, y, z] = vertexAt(mesh, vertex);
      reach = Math.max(reach, normal[0] * x + normal[1] * y + normal[2] * z - offset);
    }
  }
  return Math.max(CONNECTOR_PREVIEW_GAP_RELATIVE * longest, reach + SECTION_PREVIEW_GAP_RELATIVE * longest);
}

/**
 * The solids for the preview. With `gap` > 0 the part on the plane's positive side moves away by `gap` along the plane's
 * normal, from flat cut faces, plugs and dowels, which stay seated in the other part. A dovetail cannot come apart along
 * the normal once engaged, so its parts slide off the tongue and `gap` further. In a parallel cut the upper part moves
 * along +u. In a vertical cut part 2, with the groove, stays where it is and part 1, with the tongue, rises along −u,
 * which is the way it comes off; the groove opens upwards.
 */
function previewObjects({ solids, section }: GeneratedModel, gap: number): PreviewObject[] {
  if (section === undefined || gap === 0) return [...solids];
  const { connector, plane, type } = section;
  const sliding = connector?.type === 'dovetail' ? connector : undefined;
  const direction = sliding === undefined ? plane.normal : type === 'vertical' ? scaled(sliding.frame.u, -1) : sliding.frame.u;
  const offset = scaled(direction, (sliding?.exitDistance ?? 0) + gap);
  const moves = (solid: Solid) =>
    sliding !== undefined && type === 'vertical' ? solid.part === 'part-1' : onPositiveSide(solid);
  return solids.map((solid) => (moves(solid) ? { ...solid, displayOffset: offset } : solid));
}

const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

/**
 * The print file's objects, side by side on the build plate. Flat cut faces keep the parts as they are. With a parallel
 * cut's connector both connector faces print upwards: the lower part stands on its lower base, and the upper part is
 * turned half a turn about u onto its upper base, which also keeps a dovetail groove's flanks at 45° overhangs. A
 * vertical cut's parts stay upright on what remains of their bases, by translation only; their connector faces stand
 * upright too, so a connector along them may need another orientation in the slicer. Removable dowels stand upright on
 * an end face.
 */
function printObjects({ solids, section }: GeneratedModel): readonly ThreeMfObject[] {
  if (solids.length === 1) return solids;
  const connector = section?.connector;
  if (connector === undefined) return arrangeInRow(solids);
  const { u, n } = connector.frame;
  return arrangeInRow(
    solids.map((solid) => {
      if (solid.part === 'dowel') return { ...solid, mesh: rotateOntoZ(solid.mesh, n) };
      return solid.part === 'upper' ? { ...solid, mesh: rotateHalfTurn(solid.mesh, u) } : solid;
    }),
  );
}
