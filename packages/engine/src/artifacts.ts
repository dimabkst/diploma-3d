import type { ModelSpecInput } from '@diploma-3d/schema';
import { obliqueAxes } from './connectors/frame.ts';
import { dowelLength, type RoundConnectorPlan } from './connectors/round.ts';
import {
  buildTwistTrial,
  TWIST_TRAVEL_DEG,
  TWIST_TRIAL_FRAME,
  type TwistLayout,
  type TwistPlan,
  verifyTwist,
} from './connectors/twist.ts';
import { createPreviewGlb, type PreviewObject } from './export/glb.ts';
import { arrangeInRow, restOnFlatFace, rotateHalfTurn, rotateOntoZ } from './export/layout.ts';
import {
  type ExportKind,
  type ModelSettingsInput,
  modelSettingsDocument,
  serializeModelSettings,
} from './export/model-settings.ts';
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
import { type ConnectorPlan, type GeneratedModel, generateModel, type Solid } from './model.ts';
import { withScope } from './scope.ts';
import type { Plane } from './section.ts';
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
   * With a twist connector only: two low holders around the same male and recess, for trying the fit before printing the model.
   * Built by the same builders from the same millimetres; nothing fits them to the model's longest dimension.
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
export async function buildModelArtifacts(
  kernel: GeometryKernel,
  spec: ModelSpecInput,
  input: ModelSettingsInput = {},
): Promise<ModelArtifacts> {
  const model = generateModel(kernel, spec);
  // Every file records the settings of this very model, from the specification and plans it was generated from.
  const threeMf = (objects: readonly ThreeMfObject[], title: string, kind: ExportKind) =>
    createThreeMf(objects, { title, settingsJson: serializeModelSettings(modelSettingsDocument(model, kind, input)) });
  const oriented = printOrientation(model);
  // An uncut solid stays where it was built; the parts of a section lie in a row.
  const objects = model.solids.length === 1 ? oriented : withoutRoundingSlivers(model, arrangeInRow(oriented));
  const printFile = { fileName: `${model.name}.3mf`, bytes: threeMf(objects, model.name, 'model') };
  const previewGlb = await createPreviewGlb(previewObjects(model, 0));
  if (model.section === undefined) return { model, previewGlb, printFile };
  const separatedPreviewGlb = await createPreviewGlb(previewObjects(model, previewSeparation(model)));
  const pins = oriented.filter((object) => object.part === 'dowel');
  const connector = model.section.connector;
  if (connector?.type === 'twist') {
    const trialFile = twistTrialFile(kernel, connector, (holders, title) => threeMf(holders, title, 'connector-trial'));
    return { model, previewGlb, separatedPreviewGlb, printFile, trialFile };
  }
  if (pins.length === 0 || (connector?.type !== 'plug' && connector?.type !== 'dowel')) {
    return { model, previewGlb, separatedPreviewGlb, printFile };
  }
  const pinsName = pinsFileName(connector);
  const pinsFile = { fileName: `${pinsName}.3mf`, bytes: threeMf(arrangeInRow(pins), pinsName, 'pins') };
  return { model, previewGlb, separatedPreviewGlb, printFile, pinsFile };
}

/**
 * A twist connector's small features, moved far along the plate in a large model's row, may round to slivers in float32 that they
 * did not have where they were built.
 */
const withoutRoundingSlivers = ({ section }: GeneratedModel, objects: readonly ThreeMfObject[]): readonly ThreeMfObject[] =>
  section?.connector?.type === 'twist' ? objects.map(collapsed) : objects;

const collapsed = <T extends ThreeMfObject>(object: T): T => ({
  ...object,
  mesh: collapseRoundingSlivers({ mesh: object.mesh, newFaces: new Uint8Array(triangleCount(object.mesh)) }).mesh,
});

/** What a trial must identify: its size and both clearances, e.g. "twist-trial-S14-d0.5-a0.2mm". */
export function twistTrialFileName({ size, holeClearance, axialClearance }: TwistLayout): string {
  return `twist-trial-S${fileMillimetres(size)}-d${fileMillimetres(holeClearance)}-a${fileMillimetres(axialClearance)}mm`;
}

/**
 * The trial holders in the model's print orientation, the male upwards and the recess's mouth on the bed. They pass the same 3D
 * checks as the model's parts, within their own surroundings.
 */
function twistTrialFile(
  kernel: GeometryKernel,
  { layout }: TwistPlan,
  pack: (objects: readonly ThreeMfObject[], title: string) => Uint8Array<ArrayBuffer>,
): PrintFile {
  const objects = withScope((track) => {
    const { male, female, whole } = buildTwistTrial(kernel, track, layout);
    verifyTwist(kernel, track, whole, { lower: male, upper: female }, { frame: TWIST_TRIAL_FRAME, layout });
    return [
      { name: 'twist-trial-male', mesh: meshFromManifold(male) },
      { name: 'twist-trial-female', mesh: meshFromManifold(female) },
    ];
  });
  const arranged = arrangeInRow(objects).map(collapsed);
  for (const { mesh } of arranged) assertValidSolidMesh(mesh);
  const name = twistTrialFileName(layout);
  return { fileName: `${name}.3mf`, bytes: pack(arranged, name) };
}

/** Millimetres for a file name: thousandths at most, with a point, and no trailing zeros. */
const fileMillimetres = (value: number): string => String(Number(value.toFixed(3)));

/**
 * What a replacement must match: the profile, each pin's nominal size and the whole length, a section plate's thickness
 * included, e.g. "dowels-square-d8-d6.4-L24mm".
 */
export function pinsFileName(plan: RoundConnectorPlan): string {
  const sizes = plan.sites.map(({ pinDiameter }) => `d${fileMillimetres(pinDiameter)}`).join('-');
  return `dowels-${plan.profile}-${sizes}-L${fileMillimetres(dowelLength(plan))}mm`;
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
  // Around a section plate the parts move by what still reaches across, measured there; see `explodedAroundPlate`.
  if (section === undefined || connector === undefined || connector.type === 'dovetail' || section.plate !== undefined) {
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
function previewObjects(model: GeneratedModel, gap: number): PreviewObject[] {
  const { solids, section } = model;
  const shown = solids.map(withAppearance);
  if (section === undefined || gap === 0) return shown;
  if (section.plate !== undefined) return explodedAroundPlate(model, shown, gap);
  if (section.secondInterface !== undefined) return explodedAlongPlanes(model, shown);
  const { connector, plane, type } = section;
  if (connector?.type === 'twist') {
    // Locked lugs cannot be pulled through their ledges: the upper part is shown turned to where it comes off, and withdrawn.
    const displayOffset = scaled(plane.normal, gap);
    const displayTurn = { angleDeg: -TWIST_TRAVEL_DEG, axis: connector.frame.n, pivot: connector.frame.origin };
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
 * The three parts of two parallel planes moved apart along their shared normal for display: the lower part stays, the middle
 * part moves by the lower plane's gap and the upper part by both, so that the parts keep their order and their cut faces stay
 * parallel and aligned. Each gap is the single cut's, `SECTION_PREVIEW_GAP_RELATIVE`·M or for plugs, dowels and magnets
 * `CONNECTOR_PREVIEW_GAP_RELATIVE`·M, and more where what the plane's lower part carries, a plug, a tongue or seated dowels,
 * reaches further beyond it. A dowel stays seated in the part below its plane. Not an assembly path.
 */
function explodedAlongPlanes(model: GeneratedModel, shown: readonly PreviewObject[]): PreviewObject[] {
  const section = model.section as NonNullable<GeneratedModel['section']>;
  const second = section.secondInterface as NonNullable<typeof section.secondInterface>;
  const longest = Math.max(...model.size);
  const { normal } = section.plane;
  const gapAt = ({ offset }: Plane, connector: ConnectorPlan | undefined, below: (solid: Solid) => boolean) => {
    let reach = 0;
    for (const { mesh } of model.solids.filter(below)) {
      for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
        const [x, y, z] = vertexAt(mesh, vertex);
        reach = Math.max(reach, normal[0] * x + normal[1] * y + normal[2] * z - offset);
      }
    }
    const flat = connector === undefined || connector.type === 'dovetail';
    const least = (flat ? SECTION_PREVIEW_GAP_RELATIVE : CONNECTOR_PREVIEW_GAP_RELATIVE) * longest;
    return Math.max(least, reach + SECTION_PREVIEW_GAP_RELATIVE * longest);
  };
  const lowerGap = gapAt(
    section.plane,
    section.connector,
    (solid) => solid.part === 'lower' || (solid.part === 'dowel' && solid.joint === 0),
  );
  const upperGap = gapAt(
    second.plane,
    second.connector,
    (solid) => solid.part === 'middle' || (solid.part === 'dowel' && solid.joint === 1),
  );
  return shown.map((object, index) => {
    const solid = model.solids[index] as Solid;
    const moved =
      solid.part === 'upper'
        ? lowerGap + upperGap
        : solid.part === 'middle' || (solid.part === 'dowel' && solid.joint === 1)
          ? lowerGap
          : 0;
    return moved === 0 ? object : { ...object, displayOffset: scaled(normal, moved) };
  });
}

/** A section plate is shown in its own neutral colour, apart from the solid and its cut faces. */
const withAppearance = (solid: Solid): PreviewObject => (solid.part === 'plate' ? { ...solid, appearance: 'plate' } : solid);

/**
 * The parts of a section plate's assembly moved apart along the plane's normal for display, whatever the connector and the
 * cut: the plate stays, the part on the normal's negative side with any dowels in it moves along −n and the other one along
 * +n, each by `gap` beyond what still
 * reaches across, measured on the meshes: plugs or dowels through the plate, tongues on its faces. Not an assembly path:
 * a dovetail's parts slide off parallel to the plate.
 */
function explodedAroundPlate(model: GeneratedModel, shown: readonly PreviewObject[], gap: number): PreviewObject[] {
  const { plane, plate } = model.section as NonNullable<GeneratedModel['section']>;
  const half = (plate?.thickness ?? 0) / 2;
  // The extent of a kind of solid along the normal from the middle plane; empty, and so never reaching, without one.
  const heights = (part: Solid['part']) => {
    let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const { mesh } of model.solids.filter((solid) => solid.part === part)) {
      for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
        const [x, y, z] = vertexAt(mesh, vertex);
        const height = plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z - plane.offset;
        [min, max] = [Math.min(min, height), Math.max(max, height)];
      }
    }
    return { min, max };
  };
  // The parts by the side of the plane they lie on: below or above a horizontal plate, numbered beside another one.
  const negative = model.solids.some((solid) => solid.part === 'part-1') ? 'part-1' : 'lower';
  const positive = negative === 'part-1' ? 'part-2' : 'upper';
  const [lower, upper, plateHeights, dowels] = ([negative, positive, 'plate', 'dowel'] as const).map(heights) as [
    ReturnType<typeof heights>,
    ReturnType<typeof heights>,
    ReturnType<typeof heights>,
    ReturnType<typeof heights>,
  ];
  // How far what moves down reaches above the plate's lower face, and the plate below it; likewise upwards.
  const down = Math.max(0, lower.max + half, dowels.max + half) + Math.max(0, -half - plateHeights.min) + gap;
  const up = Math.max(0, half - upper.min) + Math.max(0, plateHeights.max - half) + gap;
  return shown.map((object, index) => {
    const part = model.solids[index]?.part;
    if (part === negative || part === 'dowel') return { ...object, displayOffset: scaled(plane.normal, -down) };
    if (part === positive) return { ...object, displayOffset: scaled(plane.normal, up) };
    return object;
  });
}

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
 *
 * A section plate lies flat on a face, also with plugs or dowels through it, whichever way its cut runs. With a dovetail it
 * carries a tongue on each face, so it stands on its edge instead, the tongues' sliding direction u upwards: each tongue then
 * rises as a prism along its own axis and nothing of it overhangs, but the plate is a thin wall on a narrow edge and needs a
 * brim at least; nothing here claims it prints without supports.
 */
function printOrientation(model: GeneratedModel): readonly (Solid & ThreeMfObject)[] {
  const { section } = model;
  const plate = section?.plate;
  const connector = section?.connector;
  if (plate === undefined) return partsOrientation(model);
  // On its edge, the tongues' sliding direction upwards, or flat on a face, its normal along the cut's.
  const up = connector?.type === 'dovetail' ? connector.frame.u : plate.frame.n;
  return partsOrientation(model).map((solid) =>
    solid.part === 'plate' ? { ...solid, mesh: rotateOntoZ(solid.mesh, up) } : solid,
  );
}

/** The parts' and dowels' print orientation; a section plate, as built, is turned by `printOrientation`. */
function partsOrientation({ solids, section, spec }: GeneratedModel): readonly (Solid & ThreeMfObject)[] {
  if (solids.length === 1) return solids;
  const connector = section?.connector;
  if (spec.shape.kind === 'ball') {
    // No base to stand on, and nothing is flattened to make one: each part rests on its cut face if that is free, so the
    // lower part turns over; with a plug or a tongue on it, it keeps its cut face up, on its curved side and on supports.
    // Beside a section plate the tongues are the plate's, and the lower part has a groove only.
    const protrudes = connector?.type === 'plug' || (connector?.type === 'dovetail' && section?.plate === undefined);
    return solids.map((solid) =>
      solid.part === 'lower' && !protrudes ? { ...solid, mesh: rotateHalfTurn(solid.mesh, [1, 0, 0]) } : solid,
    );
  }
  if (spec.section?.type === 'oblique' && (spec.shape.kind === 'cylinder' || spec.shape.kind === 'cone')) {
    const isCone = spec.shape.kind === 'cone';
    const baseHeight = roundDimensionsMm(spec.shape, spec.scale).height;
    const { n, v } = obliqueAxes(spec.section.inclinationDeg, spec.section.directionDeg);
    // Whichever part keeps the base or the apex, a plug or a tongue on the cut face could not rest on the bed; beside a
    // section plate the tongues are the plate's, and the parts only have grooves.
    const protrudes = connector?.type === 'plug' || (connector?.type === 'dovetail' && section?.plate === undefined);
    return solids.map((solid) => {
      if (solid.part === 'plate') return solid;
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
    // A twist connector's recess is made for its mouth on the bed: the ledges are the first layers, the roof slopes at 45°.
    const turnsOver = solid.part === 'upper' && spec.shape.kind !== 'cone' && connector.type !== 'twist';
    return turnsOver ? { ...solid, mesh: rotateHalfTurn(solid.mesh, u) } : solid;
  });
}
