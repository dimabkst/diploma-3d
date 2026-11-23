import type { BoxVertex, ModelSpecInput } from '@diploma-3d/schema';
import { boxPolyhedron, boxVertices, isBoxShape, topologyOf } from './connectors/box.ts';
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
import { createPreviewGlb, type PreviewObject, previewDirection, previewPosition } from './export/glb.ts';
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
  dot,
  meshFromManifold,
  ROUNDING_EDGE_RELATIVE,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from './mesh.ts';
import { type ConnectorPlan, type GeneratedModel, generateModel, type SectionPart, type Solid } from './model.ts';
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
  /**
   * For a cube or parallelepiped: its vertices by name in the preview's glTF coordinates, metres and Y up, where the
   * assembled preview has them, and where the separated one has moved them with their part.
   */
  readonly vertexLabels?: readonly VertexLabel[];
  readonly separatedVertexLabels?: readonly VertexLabel[];
}

/**
 * A named vertex of the preview, in its glTF coordinates: a copy of it in the parts that keep it, placed through their nodes.
 * A vertex on a cutting plane is kept by the parts on both sides; where their copies coincide, as in the assembled preview,
 * one label stands for them.
 */
export interface VertexLabel {
  /** The solid's own name of the vertex, the same for each copy. */
  readonly name: string;
  /** The parts whose copies this label marks, in the order of the model's solids; empty for an uncut solid. */
  readonly parts: readonly SectionPart[];
  readonly position: Vec3;
  /**
   * The outward normals of the faces at the copy, glTF axes, as its parts show them: the solid's faces that they keep there
   * and the cut face of a plane through it. A corner of a convex part is in view when one of them faces the camera, which the
   * viewer uses to dim the labels of hidden corners.
   */
  readonly faceNormals: readonly Vec3[];
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
  const assembledObjects = previewObjects(model, 0);
  const previewGlb = await createPreviewGlb(assembledObjects);
  const labels = labelsOf(model, assembledObjects);
  if (model.section === undefined) return { model, previewGlb, printFile, ...labels };
  const separatedObjects = previewObjects(model, previewSeparation(model));
  const separatedPreviewGlb = await createPreviewGlb(separatedObjects);
  const vertexLabels = labels.vertexLabels;
  const separatedVertexLabels = labelsOf(model, separatedObjects).vertexLabels;
  const labelled =
    vertexLabels === undefined || separatedVertexLabels === undefined ? {} : { vertexLabels, separatedVertexLabels };
  const pins = oriented.filter((object) => object.part === 'dowel');
  const connector = model.section.connector;
  if (connector?.type === 'twist') {
    const trialFile = twistTrialFile(kernel, connector, (holders, title) => threeMf(holders, title, 'connector-trial'));
    return { model, previewGlb, separatedPreviewGlb, printFile, trialFile, ...labelled };
  }
  if (pins.length === 0 || (connector?.type !== 'plug' && connector?.type !== 'dowel')) {
    return { model, previewGlb, separatedPreviewGlb, printFile, ...labelled };
  }
  const pinsName = pinsFileName(connector);
  const pinsFile = { fileName: `${pinsName}.3mf`, bytes: threeMf(arrangeInRow(pins), pinsName, 'pins') };
  return { model, previewGlb, separatedPreviewGlb, printFile, pinsFile, ...labelled };
}

/**
 * The named vertices in the preview's coordinates, each copy through the node of its part: the vertices that generated the
 * solid, sorted into the parts by the cutting planes' own equations, see `partsKeeping`; the meshes are not searched, as a cut
 * or a connector may add, move or merge their vertices.
 */
function labelsOf(model: GeneratedModel, objects: readonly PreviewObject[]): { vertexLabels?: readonly VertexLabel[] } {
  if (model.vertexLabels === undefined) return {};
  const vertices = Object.fromEntries(model.vertexLabels.map(({ name, position }) => [name, position])) as Parameters<
    typeof boxPolyhedron
  >[0];
  const { faces } = boxPolyhedron(vertices);
  const tolerance = ROUNDING_EDGE_RELATIVE * Math.max(...model.size);
  const regions = partRegions(model, tolerance);
  type Copy = {
    readonly parts: SectionPart[];
    readonly object: PreviewObject;
    readonly position: Vec3;
    readonly faces: Set<number>;
    cuts: readonly Cut[];
  };
  const labels: VertexLabel[] = [];
  model.vertexLabels.forEach(({ name, position }, index) => {
    const copies: Copy[] = [];
    model.solids.forEach((solid, part) => {
      const region = regions.get(part);
      if (region === undefined || !region.holds(position)) return;
      const object: PreviewObject = objects[part] ?? solid;
      const kept = faces.flatMap(({ corners }, face) =>
        corners.includes(index) &&
        region.keepsFace(corners.map((corner) => vertices[topologyOf(vertices).vertices[corner] as BoxVertex]))
          ? [face]
          : [],
      );
      const copy = {
        parts: solid.part === undefined ? [] : [solid.part],
        object,
        position: previewPosition(object, position),
        faces: new Set(kept),
        cuts: region.cuts(position),
      };
      // Copies that the preview shows in one place are one label, for all of their parts; the cut faces between them are
      // inside the solid there, and only the solid's faces and any outer cut face remain.
      const same = copies.find(
        (other) =>
          Math.hypot(...other.position.map((value, axis) => value - (copy.position[axis] as number))) <= tolerance / 1000,
      );
      if (same === undefined) {
        copies.push(copy);
        return;
      }
      same.parts.push(...copy.parts);
      for (const face of copy.faces) same.faces.add(face);
      const shared = (cut: Cut, others: readonly Cut[]) => others.some((other) => other.plane === cut.plane);
      same.cuts = [...same.cuts.filter((cut) => !shared(cut, copy.cuts)), ...copy.cuts.filter((cut) => !shared(cut, same.cuts))];
    });
    for (const copy of copies) {
      labels.push({
        name,
        parts: copy.parts,
        position: copy.position,
        faceNormals: [
          ...[...copy.faces].map((face) => (faces[face] as (typeof faces)[number]).normal),
          ...copy.cuts.map((cut) => cut.normal),
        ].map((normal) => previewDirection(copy.object, normal)),
      });
    }
  });
  return { vertexLabels: labels };
}

/** A cut face through a point: the plane it lies in, by its index among the section's planes, and its outward normal. */
interface Cut {
  readonly plane: number;
  readonly normal: Vec3;
}

/** Where a part lies, by the planes that bound it: whether it keeps a point, which faces it keeps there, and its cut faces' normals. */
interface PartRegion {
  readonly holds: (point: Vec3) => boolean;
  readonly keepsFace: (corners: readonly Vec3[]) => boolean;
  readonly cuts: (point: Vec3) => Cut[];
}

/**
 * The region of each part of a section, by the index of its solid: the side of each cutting plane it lies on, with the
 * tolerance within which the generated geometry already treats points as one, so that a vertex on a plane is kept by the parts
 * on both sides of it; for a section plate, the planes of the plate's faces. The solid itself, uncut, keeps everything.
 * A face at a vertex on a plane is the part's where one of the face's corners lies on the part's side beyond the plane.
 */
function partRegions({ solids, section }: GeneratedModel, tolerance: number): Map<number, PartRegion> {
  const regions = new Map<number, PartRegion>();
  if (section === undefined) {
    regions.set(0, { holds: () => true, keepsFace: () => true, cuts: () => [] });
    return regions;
  }
  const { normal } = section.plane;
  const half = (section.plate?.thickness ?? 0) / 2;
  const height = (point: Vec3) => dot(normal, point);
  const flipped: Vec3 = [-normal[0], -normal[1], -normal[2]];
  // A bound: the part lies on the positive or negative side of n·x = offset; its cut face there faces away from that side.
  type Bound = { readonly plane: number; readonly offset: number; readonly side: 1 | -1 };
  const regionOf = (bounds: readonly Bound[]): PartRegion => {
    const inside = (point: Vec3, bound: Bound) => bound.side * (height(point) - bound.offset) >= -tolerance;
    const beyond = (point: Vec3, bound: Bound) => bound.side * (height(point) - bound.offset) > tolerance;
    const on = (point: Vec3, bound: Bound) => Math.abs(height(point) - bound.offset) <= tolerance;
    return {
      holds: (point) => bounds.every((bound) => inside(point, bound)),
      keepsFace: (corners) =>
        bounds.every(
          (bound) => corners.some((corner) => beyond(corner, bound)) || corners.every((corner) => inside(corner, bound)),
        ),
      cuts: (point) =>
        bounds
          .filter((bound) => on(point, bound))
          .map((bound) => ({ plane: bound.plane, normal: bound.side > 0 ? flipped : normal })),
    };
  };
  const first = section.plane.offset;
  const second = section.secondInterface?.plane.offset;
  solids.forEach((solid, index) => {
    const below: Bound = { plane: 0, offset: first - half, side: -1 };
    const above: Bound = { plane: second === undefined ? 0 : 1, offset: (second ?? first) + half, side: 1 };
    switch (solid.part) {
      case 'lower':
      case 'part-1':
        regions.set(index, regionOf([below]));
        break;
      case 'middle':
        regions.set(
          index,
          regionOf([
            { plane: 0, offset: first, side: 1 },
            { plane: 1, offset: second as number, side: -1 },
          ]),
        );
        break;
      case 'upper':
      case 'part-2':
        regions.set(index, regionOf([above]));
        break;
      default:
        break;
    }
  });
  return regions;
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
  const { connector, plane } = section;
  if (connector?.type === 'twist') {
    // Locked lugs cannot be pulled through their ledges: the upper part is shown turned to where it comes off, and withdrawn.
    const displayOffset = scaled(plane.normal, gap);
    const displayTurn = { angleDeg: -TWIST_TRAVEL_DEG, axis: connector.frame.n, pivot: connector.frame.origin };
    return solids.map((solid) => (onPositiveSide(solid) ? { ...solid, displayOffset, displayTurn } : solid));
  }
  const sliding = connector?.type === 'dovetail' ? connector : undefined;
  // Parts below and above a horizontal plane slide apart upwards; numbered parts of any other plane, the tongue's part uphill.
  const tongueMoves = sliding !== undefined && solids.some((solid) => solid.part === 'part-1');
  const direction = sliding === undefined ? plane.normal : tongueMoves ? scaled(sliding.frame.u, -1) : sliding.frame.u;
  const offset = scaled(direction, (sliding?.exitDistance ?? 0) + gap);
  const moves = (solid: Solid) => (tongueMoves ? solid.part === 'part-1' : onPositiveSide(solid));
  return solids.map((solid) => (moves(solid) ? { ...solid, displayOffset: offset } : solid));
}

const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

/**
 * The three parts of two parallel planes moved apart along their shared normal n for display, by their order along it, which
 * the cut gives them: the part on the lower plane's negative side, the middle one, the part on the upper plane's positive side,
 * whatever they are called, below, between and above or numbered. The middle part stays, and the others move away from it,
 * −g₁·n and +g₂·n, so that each interface opens by its own gap, the rule i − (N − 1)/2 of a single gap for N = 3. Each gap is
 * the single cut's, `SECTION_PREVIEW_GAP_RELATIVE`·M or for plugs, dowels and magnets `CONNECTOR_PREVIEW_GAP_RELATIVE`·M, and
 * more where what the part below a plane carries, a plug, a tongue or seated dowels, reaches further beyond it. A dowel stays
 * seated in the part below its plane. Not an assembly path.
 */
function explodedAlongPlanes(model: GeneratedModel, shown: readonly PreviewObject[]): PreviewObject[] {
  const section = model.section as NonNullable<GeneratedModel['section']>;
  const second = section.secondInterface as NonNullable<typeof section.secondInterface>;
  const longest = Math.max(...model.size);
  const { normal } = section.plane;
  // 0, 1, 2 from the lower plane's negative side to the upper plane's positive side.
  const orderOf = (solid: Solid): number | undefined => {
    switch (solid.part) {
      case 'lower':
      case 'part-1':
        return 0;
      case 'middle':
        return 1;
      case 'upper':
      case 'part-2':
        return 2;
      case 'dowel':
        return solid.joint;
      default:
        return undefined;
    }
  };
  const gapAt = ({ offset }: Plane, connector: ConnectorPlan | undefined, below: number) => {
    let reach = 0;
    for (const { mesh } of model.solids.filter((solid) => orderOf(solid) === below)) {
      for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
        const [x, y, z] = vertexAt(mesh, vertex);
        reach = Math.max(reach, normal[0] * x + normal[1] * y + normal[2] * z - offset);
      }
    }
    const flat = connector === undefined || connector.type === 'dovetail';
    const least = (flat ? SECTION_PREVIEW_GAP_RELATIVE : CONNECTOR_PREVIEW_GAP_RELATIVE) * longest;
    return Math.max(least, reach + SECTION_PREVIEW_GAP_RELATIVE * longest);
  };
  const moves = [-gapAt(section.plane, section.connector, 0), 0, gapAt(second.plane, second.connector, 1)];
  return shown.map((object, index) => {
    const order = orderOf(model.solids[index] as Solid);
    const moved = order === undefined ? 0 : (moves[order] as number);
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
  if (isBoxShape(spec.shape) && section !== undefined && section.type !== 'parallel-to-bases') {
    // A box's part may keep a base, the other one, or only a corner or an edge of either: it rests on whichever flat face
    // carries it, see `restOnFlatFace`, or on its flat cut face; a plug or a tongue on the cut face leaves that face out.
    const baseHeight = boxVertices(spec.shape, spec.scale).A1[2];
    const { normal } = section.plane;
    const protrudes = connector?.type === 'plug' || connector?.type === 'dovetail';
    return solids.map((solid) => {
      if (solid.part === 'dowel') return { ...solid, mesh: rotateOntoZ(solid.mesh, normal) };
      const negative = solid.part === 'lower' || solid.part === 'part-1' || solid.part === 'middle';
      const outward = negative ? normal : scaled(normal, -1);
      const cutFaceFree = connector === undefined || (!protrudes && solid.part !== 'middle');
      return {
        ...solid,
        mesh: restOnFlatFace(solid.mesh, {
          baseHeight,
          turnAxis: [1, 0, 0],
          ...(cutFaceFree ? { cutFaceOutward: outward } : { connectorFace: outward }),
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
