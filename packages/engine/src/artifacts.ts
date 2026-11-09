import type { ModelSpecInput } from '@diploma-3d/schema';
import {
  BAYONET_TRAVEL_DEG,
  BAYONET_TRIAL_FRAME,
  type BayonetLayout,
  type BayonetPlan,
  buildBayonetTrial,
  verifyBayonet,
} from './connectors/bayonet.ts';
import { obliqueAxes } from './connectors/frame.ts';
import type { RoundConnectorPlan } from './connectors/round.ts';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow, restOnFlatFace, rotateHalfTurn, rotateOntoZ } from './export/layout.ts';
import type { ThreeMfObject } from './export/three-mf.ts';
import { createThreeMf } from './export/three-mf.ts';
import type { GeometryKernel } from './kernel.ts';
import {
  assertValidSolidMesh,
  collapseRoundingSlivers,
  meshFromManifold,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';
import { withScope } from './scope.ts';
import { roundDimensionsMm } from './shapes/round.ts';

export interface ModelArtifacts {
  readonly model: GeneratedModel;
  /** The solid, or the parts of a section in their assembled position. */
  readonly previewGlb: Uint8Array<ArrayBuffer>;
  /**
   * For a section only: the parts moved apart, so that the cut faces show; along the plane's normal for flat faces,
   * plugs and dowels, along the sliding direction, off the tongue, for a dovetail.
   */
  readonly separatedPreviewGlb?: Uint8Array<ArrayBuffer>;
  readonly printFile: PrintFile;
  /**
   * With removable dowels only: the dowels alone, for reprinting them. The same meshes as in `printFile`, moved rigidly, so
   * that a replacement has the exact size of the assembly's own; nothing fits them to the model's longest dimension.
   */
  readonly pinsFile?: PrintFile;
  /**
   * With a bayonet only: two small holders around the same male and socket, for trying the fit before printing the model. Built
   * by the same builders from the same dimensions, in millimetres; nothing fits them to the model's longest dimension.
   */
  readonly trialFile?: PrintFile;
}

export interface PrintFile {
  readonly fileName: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
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
  const oriented = printOrientation(model);
  // An uncut solid stays where it was built; the parts of a section lie in a row.
  const objects = model.solids.length === 1 ? oriented : withoutRoundingSlivers(model, arrangeInRow(oriented));
  const printFile = { fileName: `${model.name}.3mf`, bytes: createThreeMf(objects, { title: model.name }) };
  const previewGlb = await createPreviewGlb(previewObjects(model, 0));
  if (model.section === undefined) return { model, previewGlb, printFile };
  const separatedPreviewGlb = await createPreviewGlb(previewObjects(model, previewSeparation(model)));
  const pins = oriented.filter((object) => object.part === 'dowel');
  const connector = model.section.connector;
  if (connector?.type === 'bayonet') {
    return { model, previewGlb, separatedPreviewGlb, printFile, trialFile: bayonetTrialFile(kernel, connector) };
  }
  if (pins.length === 0 || connector === undefined || connector.type === 'dovetail') {
    return { model, previewGlb, separatedPreviewGlb, printFile };
  }
  const pinsName = pinsFileName(connector);
  const pinsFile = { fileName: `${pinsName}.3mf`, bytes: createThreeMf(arrangeInRow(pins), { title: pinsName }) };
  return { model, previewGlb, separatedPreviewGlb, printFile, pinsFile };
}

/**
 * A bayonet's small features, moved far along the plate in a large model's row, may round to slivers in float32 that they did not
 * have where they were built.
 */
const withoutRoundingSlivers = ({ section }: GeneratedModel, objects: readonly ThreeMfObject[]): readonly ThreeMfObject[] =>
  section?.connector?.type === 'bayonet'
    ? objects.map((object) => ({
        ...object,
        mesh: collapseRoundingSlivers({ mesh: object.mesh, newFaces: new Uint8Array(triangleCount(object.mesh)) }).mesh,
      }))
    : objects;

/** Millimetres for a file name: thousandths at most, with a point, and no trailing zeros. */
const fileMillimetres = (value: number): string => String(Number(value.toFixed(3)));

/** What a replacement must match: the profile, each pin's nominal size and the whole length, e.g. "dowels-square-d8-d6.4-L24mm". */
export function pinsFileName({ profile, sites, insertion }: RoundConnectorPlan): string {
  const sizes = sites.map(({ pinDiameter }) => `d${fileMillimetres(pinDiameter)}`).join('-');
  return `dowels-${profile}-${sizes}-L${fileMillimetres(2 * insertion)}mm`;
}

/** What a trial must identify: the stem, its height and the three adjustments, e.g. "bayonet-trial-d12-H12.25-c0.5-a0.2-i0.15mm". */
export function bayonetTrialFileName({
  diameter,
  projection,
  holeClearance,
  axialClearance,
  interference,
}: BayonetLayout): string {
  const part = (value: number) => fileMillimetres(value);
  return `bayonet-trial-d${part(diameter)}-H${part(projection)}-c${part(holeClearance)}-a${part(axialClearance)}-i${part(interference)}mm`;
}

/**
 * The trial holders in their print orientation, as the model's parts: the male upwards, the socket's mouth on the bed. They pass
 * the same checks of the fit as the model's parts, around their own surroundings.
 */
function bayonetTrialFile(kernel: GeometryKernel, { layout }: BayonetPlan): PrintFile {
  const objects = withScope((track) => {
    const { male, female, whole } = buildBayonetTrial(kernel, track, layout);
    verifyBayonet(kernel, track, whole, { lower: male, upper: female }, { frame: BAYONET_TRIAL_FRAME, layout });
    return [
      { name: 'bayonet-trial-male', mesh: meshFromManifold(male) },
      { name: 'bayonet-trial-female', mesh: meshFromManifold(female) },
    ];
  });
  const arranged = arrangeInRow(objects).map(({ name, mesh }) => ({
    name,
    mesh: collapseRoundingSlivers({ mesh, newFaces: new Uint8Array(triangleCount(mesh)) }).mesh,
  }));
  for (const { mesh } of arranged) assertValidSolidMesh(mesh);
  const name = bayonetTrialFileName(layout);
  return { fileName: `${name}.3mf`, bytes: createThreeMf(arranged, { title: name }) };
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
 * along +u. In a vertical or oblique cut part 2, with the groove, stays where it is and part 1, with the tongue, moves
 * uphill along −u, which is the way it comes off; the groove opens uphill.
 */
function previewObjects({ solids, section }: GeneratedModel, gap: number): PreviewObject[] {
  if (section === undefined || gap === 0) return [...solids];
  const { connector, plane, type } = section;
  if (connector?.type === 'bayonet') {
    // Locked lugs cannot be pulled straight through their ledges: the upper part is shown at its insertion angle.
    const displayOffset = scaled(plane.normal, gap);
    const displayTurn = { angleDeg: -BAYONET_TRAVEL_DEG, axis: connector.frame.n, pivot: connector.frame.origin };
    return solids.map((solid) => (onPositiveSide(solid) ? { ...solid, displayOffset, displayTurn } : solid));
  }
  const sliding = connector?.type === 'dovetail' ? connector : undefined;
  const tongueMoves = sliding !== undefined && type !== 'parallel-to-bases' && type !== 'horizontal';
  const direction = sliding === undefined ? plane.normal : tongueMoves ? scaled(sliding.frame.u, -1) : sliding.frame.u;
  const offset = scaled(direction, (sliding?.exitDistance ?? 0) + gap);
  const moves = (solid: Solid) => (tongueMoves ? solid.part === 'part-1' : onPositiveSide(solid));
  return solids.map((solid) => (moves(solid) ? { ...solid, displayOffset: offset } : solid));
}

const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

/**
 * The print file's objects in their print orientation, by proper rotations only, before they are laid out side by side on
 * the build plate. Flat cut faces keep the parts as they are. With a parallel
 * cut's connector both connector faces print upwards: the lower part stands on its lower base, and the upper part is
 * turned half a turn about u onto its upper base, which also keeps a dovetail groove's flanks at 45° overhangs. An upper
 * cone has an apex instead of that base: it stays upright on its cut face, with its holes or groove opening towards the
 * bed, which they may need supports for. A
 * vertical cut's parts stay upright on what remains of their bases, by translation only; their connector faces stand
 * upright too, so a connector along them may need another orientation in the slicer. An oblique cut's parts each choose
 * their own resting face, see `restOnFlatFace`; the parts of a plane through a cone's apex both keep some of the base,
 * and stay upright on it. Removable dowels stand upright on an end face.
 */
function printOrientation({ solids, section, spec }: GeneratedModel): readonly (Solid & ThreeMfObject)[] {
  if (solids.length === 1) return solids;
  const connector = section?.connector;
  if (spec.shape.kind === 'ball') {
    // No base to stand on, and nothing is flattened to make one: each part rests on its cut face if that is free, so the
    // lower part turns over; with a plug or a tongue on it, it keeps its cut face up, on its curved side and on supports.
    const protrudes = connector?.type === 'plug' || connector?.type === 'dovetail';
    return solids.map((solid) =>
      solid.part === 'lower' && !protrudes ? { ...solid, mesh: rotateHalfTurn(solid.mesh, [1, 0, 0]) } : solid,
    );
  }
  if (spec.section?.type === 'oblique' && (spec.shape.kind === 'cylinder' || spec.shape.kind === 'cone')) {
    const isCone = spec.shape.kind === 'cone';
    const baseHeight = roundDimensionsMm(spec.shape, spec.scale).height;
    const { n, v } = obliqueAxes(spec.section.inclinationDeg, spec.section.directionDeg);
    // Whichever part keeps the base or the apex, a plug or a tongue on the cut face could not rest on the bed.
    const protrudes = connector?.type === 'plug' || connector?.type === 'dovetail';
    return solids.map((solid) => {
      if (solid.part === 'dowel') return { ...solid, mesh: rotateOntoZ(solid.mesh, n) };
      const outward = solid.part === 'part-1' ? n : scaled(n, -1);
      const cutFaceFree = isCone ? !(protrudes && solid.part === 'part-1') : connector === undefined;
      return {
        ...solid,
        mesh: restOnFlatFace(solid.mesh, {
          baseHeight,
          turnAxis: v,
          ...(cutFaceFree ? { cutFaceOutward: outward } : {}),
          ...(isCone && !cutFaceFree ? { connectorFace: outward } : {}),
        }),
      };
    });
  }
  if (connector === undefined) return solids;
  const { u, n } = connector.frame;
  return solids.map((solid) => {
    if (solid.part === 'dowel') return { ...solid, mesh: rotateOntoZ(solid.mesh, n) };
    // A bayonet's socket is designed for its mouth on the bed: its roof slopes for that, and its ledges rise from there.
    const turnsOver = solid.part === 'upper' && spec.shape.kind !== 'cone' && connector.type !== 'bayonet';
    return turnsOver ? { ...solid, mesh: rotateHalfTurn(solid.mesh, u) } : solid;
  });
}
