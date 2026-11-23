import {
  BOX_SECTION_TYPES,
  type BoxSectionSpec,
  type BoxVertex,
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  type PhysicalScale,
  type SectionType,
  type Shape,
  type ShapeKind,
} from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import {
  type BoxCut,
  boxPartMinimumMm,
  boxPlane,
  boxSection,
  boxSplitReach,
  boxTopologyOf,
  boxVertices,
  isBoxShape,
} from './connectors/box.ts';
import {
  buildDovetail,
  buildPlateDovetail,
  type DovetailPlan,
  interfacePlan,
  planDovetail,
  verifyDovetail,
} from './connectors/dovetail.ts';
import {
  atSecondPlane,
  axialApexAngles,
  axisParallelCylinderSection,
  axisParallelOffsetLimitPercent,
  ballOffsetLimitPercent,
  ballSection,
  ballSliceMinimumMm,
  CONSTRAINT_ROUNDOFF_MM,
  coneApexChord,
  coneObliqueSection,
  coneVerticalSection,
  connectorVolumeTolerance,
  cutOfSection,
  hasSecondPlane,
  isApexChordUsable,
  isBoxSectionSpec,
  isPlateCut,
  isPlateThicknessFeasible,
  obliqueCylinderSection,
  obliqueSplitReach,
  type PlateCut,
  planeOfPlateCut,
  plateSection,
  plateThicknessRange,
  satisfies,
  sectionOffsetMm,
  verticalCylinderSection,
  verticalOffsetLimitMm,
} from './connectors/frame.ts';
import { buildMagnetPockets, type MagnetPlan, planMagnets, verifyMagnetPockets } from './connectors/magnet.ts';
import { buildRoundConnectors, planRoundConnectors, type RoundConnectorPlan, verifyRoundConnectors } from './connectors/round.ts';
import { buildTwist, planTwist, type TwistPlan, verifyTwist } from './connectors/twist.ts';
import { ConnectorUnsuitableError, GeometryError, InfeasibleGeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import {
  assertValidSolidMesh,
  type Bounds,
  collapseRoundingSlivers,
  type MeshMeasurements,
  measureMesh,
  meshFromManifold,
  meshWithNewFaces,
  originalIdsOf,
  subtract,
  type TriangleMesh,
  type Vec3,
} from './mesh.ts';
import { buildSectionPlate, type SectionPlateGeometry, sectionPlateGeometry } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { type Plane, sectionPlane, splitByParallelPlanes, splitByPlane } from './section.ts';
import { ballRadiusMm, buildBall } from './shapes/ball.ts';
import { checkNumericalFeasibility } from './shapes/feasibility.ts';
import { buildRegularPolyhedron } from './shapes/regular-polyhedron.ts';
import { buildRoundSolid, roundDimensionsMm, roundShear } from './shapes/round.ts';

export interface Solid {
  /** ASCII identifier, also used as the object name in exported files. */
  readonly name: string;
  readonly mesh: TriangleMesh;
  readonly measurements: MeshMeasurements;
  /** Display hint: the solid approximates curved surfaces, which the preview shades smoothly. */
  readonly smoothShading: boolean;
  /**
   * Display hint for a smooth solid made by shearing a right one, x' = x + kx·z, y' = y + ky·z: the preview smooths
   * its normals on the right solid and maps them through the shear. Absent for solids that were not sheared.
   */
  readonly smoothingShear?: readonly [number, number];
  /**
   * Which part of a sectioned solid this is: below or above a horizontal plane or one parallel to the bases, between two such
   * planes, on the negative (1) or positive (2) side of the normal of a vertical or oblique plane, or a separate removable dowel.
   */
  readonly part?: SectionPart;
  /** For a dowel beside two parallel planes, the plane it joins at: 0 the lower, 1 the upper one. */
  readonly joint?: 0 | 1;
  /**
   * For a part: 1 per triangle that the cut or a connector made, 0 where the solid's original surface remains. The
   * preview shows these faces apart from the exterior.
   */
  readonly newFaces?: Uint8Array;
}

/**
 * Which part of a sectioned solid this is; `plate` is a section plate between the lower and the upper part, which belongs to
 * neither and is shown in its own colour.
 */
export type SectionPart = 'lower' | 'middle' | 'upper' | 'part-1' | 'part-2' | 'plate' | 'dowel';

export type ConnectorPlan = DovetailPlan | RoundConnectorPlan | TwistPlan | MagnetPlan;

export interface ModelSection {
  readonly type: SectionType;
  /** The cutting plane in the model's millimetres; the upper part or part 2 lies on the side its normal points to. */
  readonly plane: Plane;
  /** The connector joining the parts, with the frame it is built in; absent for flat cut faces. */
  readonly connector?: ConnectorPlan;
  /** A section plate between the parts, centred on `plane`; the parts' faces lie T/2 to either side of it. */
  readonly plate?: SectionPlateGeometry;
  /**
   * A second parallel plane: its plane along the same normal, above `plane`, which is then the lower of the two, and its own
   * connector of the same settings, fitted to its own section. The middle part lies between them.
   */
  readonly secondInterface?: { readonly plane: Plane; readonly connector?: ConnectorPlan };
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
  /** ASCII identifier of the model, used for file names and the names of its solids. */
  readonly name: string;
  readonly spec: ModelSpec;
  /**
   * The whole solid, or its parts in the order of the plane's negative and positive side, followed by any section plate and
   * any removable dowels, all in the assembled position.
   */
  readonly solids: readonly Solid[];
  /** The bounds of the assembled model: of the whole solid, also when it is sectioned. */
  readonly bounds: Bounds;
  readonly size: Vec3;
  readonly section?: ModelSection;
  /**
   * For a cube or parallelepiped, its vertices by the names its sections refer to, A–D on the lower base and A1–D1 above them,
   * where the model has them: what the preview labels.
   */
  readonly vertexLabels?: readonly { readonly name: BoxVertex; readonly position: Vec3 }[];
}

type BuiltMeshes =
  | { readonly whole: TriangleMesh }
  | {
      readonly type: SectionType;
      readonly plane: Plane;
      readonly parts: Readonly<Record<'lower' | 'upper', MarkedMesh>> & { readonly middle?: MarkedMesh };
      readonly plate?: TriangleMesh;
      readonly dowels: readonly (MarkedMesh & { readonly joint?: 0 | 1 })[];
    };

type MarkedMesh = { readonly mesh: TriangleMesh; readonly newFaces: Uint8Array };

/** Completes the model name of a sectioned solid, e.g. "cylinder-parallel-section". */
const sectionNames: Readonly<Record<SectionType, string>> = {
  'parallel-to-bases': 'parallel-section',
  vertical: 'vertical-section',
  oblique: 'oblique-section',
  'oblique-apex': 'apex-section',
  horizontal: 'horizontal-section',
  'axis-parallel': 'axis-parallel-section',
  'face-parallel': 'face-parallel-section',
  longitudinal: 'longitudinal-section',
  'through-apex': 'apex-section',
  'through-line': 'edge-section',
  inclined: 'inclined-section',
};

/** The names of a section's parts in the order of the plane's negative and positive side, and their object names. */
const partNames: Readonly<Record<SectionType, readonly [SectionPart, SectionPart]>> = {
  'parallel-to-bases': ['lower', 'upper'],
  vertical: ['part-1', 'part-2'],
  oblique: ['part-1', 'part-2'],
  'oblique-apex': ['part-1', 'part-2'],
  horizontal: ['lower', 'upper'],
  'axis-parallel': ['part-1', 'part-2'],
  'face-parallel': ['part-1', 'part-2'],
  longitudinal: ['part-1', 'part-2'],
  'through-apex': ['part-1', 'part-2'],
  'through-line': ['part-1', 'part-2'],
  inclined: ['part-1', 'part-2'],
};

/** A box section's parts are the lower and the upper one only when its plane is horizontal. */
const partNamesOf = (type: SectionType, plane: Plane): readonly [SectionPart, SectionPart] =>
  isBoxSectionType(type) && Math.abs(plane.normal[2]) > 1 - HORIZONTAL_ROUNDOFF ? ['lower', 'upper'] : partNames[type];
const HORIZONTAL_ROUNDOFF = 1e-9;
const isBoxSectionType = (type: SectionType): type is BoxSectionSpec['type'] =>
  (BOX_SECTION_TYPES as readonly string[]).includes(type);
const partObjectName = (name: string, part: SectionPart): string =>
  part === 'lower' || part === 'middle' || part === 'upper' ? `${name}-${part}-part` : `${name}-${part}`;

/**
 * Validates the specification, filling in defaults, checks that the solid can be represented reliably, and builds it in
 * millimetres with one uniform scale. A section splits that solid, already at its physical size, so both parts keep
 * the scale of the whole and their cut faces coincide. A connector is planned and checked before anything is built,
 * then built in millimetres on the parts and verified on them in three dimensions.
 */
export function generateModel(kernel: GeometryKernel, input: ModelSpecInput): GeneratedModel {
  const parsed = modelSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidModelSpecError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  const spec = withConstrainedPlanes(parsed.data);
  const feasibility = checkNumericalFeasibility(spec.shape);
  if (!feasibility.feasible) throw new InfeasibleGeometryError(feasibility.relativeRounding);

  assertVerticalOffset(spec);
  assertObliqueSplit(spec);
  assertBoxSplit(spec);
  const plateGeometry = planPlate(spec);
  const pair = parallelPair(spec);
  const connector = pair === undefined ? planConnector(spec) : pair.lower.connector;
  const built = withScope((track): BuiltMeshes => {
    const solid = checked(buildShape(kernel, track, spec.shape, spec.scale));
    if (spec.section === undefined) return { whole: meshFromManifold(solid) };
    const originalIds = originalIdsOf(solid);
    const marked = (part: Manifold) => collapseRoundingSlivers(meshWithNewFaces(part, originalIds));
    if (pair !== undefined) {
      const { normal } = pair.lower.plane;
      const regions = splitByParallelPlanes(track, solid, normal, [pair.lower.plane.offset, pair.upper.plane.offset]);
      const longest = spec.scale.longestDimensionMm;
      const first = joinParts(
        kernel,
        track,
        solid,
        { lower: regions.lower, upper: regions.middle },
        pair.lower.connector,
        longest,
      );
      const second = joinParts(kernel, track, solid, { lower: first.upper, upper: regions.upper }, pair.upper.connector, longest);
      return {
        type: spec.section.type,
        plane: pair.lower.plane,
        parts: { lower: marked(first.lower), middle: marked(second.lower), upper: marked(second.upper) },
        dowels: [
          ...first.dowels.map((dowel) => ({ ...meshWithNewFaces(dowel, originalIds), joint: 0 as const })),
          ...second.dowels.map((dowel) => ({ ...meshWithNewFaces(dowel, originalIds), joint: 1 as const })),
        ],
      };
    }
    const plane = spec.section.type === 'parallel-to-bases' ? sectionPlane(spec.section, solid.boundingBox()) : cutPlaneOf(spec);
    let parts: { lower: Manifold; upper: Manifold };
    let plate: Manifold | undefined;
    if (plateGeometry === undefined) {
      const split = splitByPlane(track, solid, plane);
      parts = { lower: split.negative, upper: split.positive };
    } else {
      // The slab between the plate's faces leaves the solid; nothing else moves or changes its size.
      const half = plateGeometry.thickness / 2;
      const above = splitByPlane(track, solid, { normal: plane.normal, offset: plane.offset + half });
      const below = splitByPlane(track, above.negative, { normal: plane.normal, offset: plane.offset - half });
      parts = { lower: below.negative, upper: above.positive };
      plate = buildSectionPlate(kernel, track, plateGeometry);
      assertFillsSlab(track, solid, plate, plane, half, spec.scale.longestDimensionMm);
    }
    let dowels: readonly Manifold[] = [];
    const longest = spec.scale.longestDimensionMm;
    if (connector?.type === 'dovetail' && plate !== undefined) {
      const joined = buildPlateDovetail(kernel, track, { ...parts, plate }, connector);
      // The plate lies outside the solid by design; only its tongues must stay inside it.
      const whole = track(solid.add(plate));
      (connector.interfaces ?? []).forEach((face, index) => {
        verifyDovetail(
          kernel,
          track,
          { whole, upper: parts[face.part] },
          { lower: joined.plate, upper: joined[face.part], tongue: joined.tongues[index] as Manifold },
          interfacePlan(connector, face),
          longest,
        );
      });
      parts = { lower: checked(joined.lower), upper: checked(joined.upper) };
      plate = checked(joined.plate);
    } else if (plate !== undefined && connector !== undefined && connector.type !== 'magnet' && connector.type !== 'twist') {
      const joined = buildRoundConnectors(kernel, track, { ...parts, plate }, connector as RoundConnectorPlan);
      verifyRoundConnectors(kernel, track, solid, joined, connector as RoundConnectorPlan, longest);
      parts = { lower: checked(joined.lower), upper: checked(joined.upper) };
      if (joined.plate !== undefined) plate = checked(joined.plate);
      dowels = joined.pins.map(checked);
    } else {
      // Without a plate, or with magnets, whose pockets lie in the parts alone and leave a plate whole between them.
      const joined = joinParts(kernel, track, solid, parts, connector, longest);
      parts = { lower: joined.lower, upper: joined.upper };
      dowels = joined.dowels;
    }
    if (plate !== undefined) {
      assertConnected(plate);
      assertStanding(plate, solid, plateGeometry as SectionPlateGeometry);
    }
    return {
      type: spec.section.type,
      plane,
      parts: {
        lower: collapseRoundingSlivers(meshWithNewFaces(parts.lower, originalIds)),
        upper: collapseRoundingSlivers(meshWithNewFaces(parts.upper, originalIds)),
      },
      ...(plate === undefined ? {} : { plate: meshFromManifold(plate) }),
      dowels: dowels.map((dowel) => meshWithNewFaces(dowel, originalIds)),
    };
  });

  const name = modelName(spec.shape);
  const { shape } = spec;
  const round = shape.kind === 'cylinder' || shape.kind === 'cone';
  const solidOf = (solidName: string, mesh: TriangleMesh): Solid => {
    assertValidSolidMesh(mesh);
    return {
      name: solidName,
      mesh,
      measurements: measureMesh(mesh),
      smoothShading: round || shape.kind === 'ball',
      ...(round && shape.offsetRatio !== 0 ? { smoothingShear: roundShear(shape) } : {}),
    };
  };
  const vertexLabels = isBoxShape(shape)
    ? {
        vertexLabels: boxTopologyOf(shape).vertices.map((vertex) => ({
          name: vertex,
          position: boxVertices(shape, spec.scale)[vertex],
        })),
      }
    : {};
  if ('whole' in built) {
    const solid = solidOf(name, built.whole);
    const { bounds, size } = solid.measurements;
    return { kind: shape.kind, name, spec, solids: [solid], bounds, size, ...vertexLabels };
  }
  const sides: readonly ('lower' | 'middle' | 'upper')[] =
    built.parts.middle === undefined ? ['lower', 'upper'] : ['lower', 'middle', 'upper'];
  const parts = sides.map((side): Solid => {
    const names = partNamesOf(built.type, built.plane);
    const part: SectionPart = side === 'middle' ? 'middle' : names[side === 'lower' ? 0 : 1];
    const mesh = built.parts[side] as MarkedMesh;
    return { ...solidOf(partObjectName(name, part), mesh.mesh), part, newFaces: mesh.newFaces };
  });
  // Flat, apart from its rounded corners, which the preview shades smoothly; never sheared, as it lies in the cut's frame.
  const plates = built.plate === undefined ? [] : [plateSolid(`${name}-section-plate`, built.plate)];
  const bounds = unionBounds([...parts, ...plates].map((part) => part.measurements.bounds));
  // Curved but never sheared: a dowel lies along the cut's normal however the cylinder leans.
  const dowels = built.dowels.map(({ mesh, newFaces, joint }, index): Solid => {
    assertValidSolidMesh(mesh);
    return {
      name: `${name}-dowel-${index + 1}`,
      mesh,
      measurements: measureMesh(mesh),
      smoothShading: true,
      part: 'dowel',
      newFaces,
      ...(joint === undefined ? {} : { joint }),
    };
  });
  return {
    kind: shape.kind,
    name:
      pair === undefined
        ? `${name}-${sectionNames[built.type]}${plateGeometry === undefined ? '' : '-plate'}`
        : spec.section?.type === 'horizontal'
          ? `${name}-parallel-horizontal-sections`
          : `${name}-two-${sectionNames[built.type]}s`,
    spec,
    solids: [...parts, ...plates, ...dowels],
    bounds,
    size: subtract(bounds.max, bounds.min),
    section: {
      type: built.type,
      plane: built.plane,
      ...(connector === undefined ? {} : { connector }),
      ...(plateGeometry === undefined ? {} : { plate: plateGeometry }),
      ...(pair === undefined
        ? {}
        : {
            secondInterface: {
              plane: pair.upper.plane,
              ...(pair.upper.connector === undefined ? {} : { connector: pair.upper.connector }),
            },
          }),
    },
    ...vertexLabels,
  };
}

/** Both parts of a cut and its connector as built, with any separate dowels. */
interface JoinedParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
  readonly dowels: readonly Manifold[];
}

/**
 * Builds a connector without a section plate on the two parts on either side of one plane and verifies it on them in three
 * dimensions; every object is tracked. Beside a second parallel plane the parts are those already cut by it, so that the
 * connector is verified on the final parts.
 */
function joinParts(
  kernel: GeometryKernel,
  track: Track,
  solid: Manifold,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  connector: ConnectorPlan | undefined,
  longest: number,
): JoinedParts {
  if (connector === undefined) return { ...parts, dowels: [] };
  if (connector.type === 'dovetail') {
    const joined = buildDovetail(kernel, track, parts, connector);
    verifyDovetail(kernel, track, { whole: solid, upper: parts.upper }, joined, connector, longest);
    return { lower: checked(joined.lower), upper: checked(joined.upper), dowels: [] };
  }
  if (connector.type === 'magnet') {
    const joined = buildMagnetPockets(kernel, track, parts, connector);
    verifyMagnetPockets(kernel, track, solid, joined, connector, longest);
    return { lower: checked(joined.lower), upper: checked(joined.upper), dowels: [] };
  }
  if (connector.type === 'twist') {
    const joined = buildTwist(kernel, track, parts, connector);
    verifyTwist(kernel, track, solid, joined, connector);
    return { lower: checked(joined.lower), upper: checked(joined.upper), dowels: [] };
  }
  const joined = buildRoundConnectors(kernel, track, parts, connector);
  verifyRoundConnectors(kernel, track, solid, joined, connector, longest);
  return { lower: checked(joined.lower), upper: checked(joined.upper), dowels: joined.pins.map(checked) };
}

/** A plane of two parallel ones, and the connector planned for its own section. */
interface ParallelPlane {
  readonly plane: Plane;
  readonly connector?: ConnectorPlan;
}

/**
 * Two parallel planes, of a ball or of a cube or parallelepiped, the lower and the upper one along their shared normal, each with
 * the connector planned on its own section, which knows the other plane; undefined for a single cut. The specification's first
 * and second plane keep their identity; only the order of building follows their offsets.
 */
function parallelPair(spec: ModelSpec): { readonly lower: ParallelPlane; readonly upper: ParallelPlane } | undefined {
  const { shape, section, scale } = spec;
  if (section === undefined || !hasSecondPlane(section)) return undefined;
  const views = [section, atSecondPlane(section)].map((view): ParallelPlane => {
    const plan = planConnector({ ...spec, section: view });
    return { plane: planeOfView(shape, scale, view), ...(plan === undefined ? {} : { connector: plan }) };
  });
  const [lower, upper] = [...views].sort((a, b) => a.plane.offset - b.plane.offset) as [ParallelPlane, ParallelPlane];
  return { lower, upper };
}

/** The plane of a section with two planes, seen from either of them. */
function planeOfView(shape: ModelSpec['shape'], scale: PhysicalScale, view: NonNullable<ModelSpec['section']>): Plane {
  if (view.type === 'horizontal') return ballSection(scale, view.offsetPercent).plane;
  if (!isBoxShape(shape)) throw new GeometryError('Only a ball, a cube, a parallelepiped and a prism take two parallel planes.');
  return boxSection(shape, scale, cutOfSection(view) as BoxCut).plane;
}

function plateSolid(name: string, mesh: TriangleMesh): Solid {
  assertValidSolidMesh(mesh);
  return { name, mesh, measurements: measureMesh(mesh), smoothShading: true, part: 'plate' };
}

/**
 * The finished plate, with every connector feature on it, stays on or above the plane the uncut solid stands on, which is
 * the one its geometry was cut by: the solid's own lower base, before any cut or connector.
 */
function assertStanding(plate: Manifold, solid: Manifold, geometry: SectionPlateGeometry): void {
  const level = solid.boundingBox().min[2];
  if (Math.abs(level - geometry.standingLevel) > CONSTRAINT_ROUNDOFF_MM) {
    throw new GeometryError(`The plate was cut at ${geometry.standingLevel} mm, not at the solid's base at ${level} mm.`);
  }
  const lowest = plate.boundingBox().min[2];
  if (lowest < level - CONSTRAINT_ROUNDOFF_MM) {
    throw new GeometryError(`The section plate reaches ${level - lowest} mm below the solid's base.`);
  }
}

/**
 * The plate, before any connector, holds all of the solid between its faces, so that the assembly is the whole solid: its
 * outline's margin and the rounding of the corners the standing plane makes only shape what lies outside it.
 */
function assertFillsSlab(track: Track, solid: Manifold, plate: Manifold, plane: Plane, half: number, longest: number): void {
  const n = plane.normal;
  const below = track(solid.trimByPlane([n[0], n[1], n[2]], plane.offset - half));
  const slab = track(below.trimByPlane([-n[0], -n[1], -n[2]], -(plane.offset + half)));
  const missing = track(slab.subtract(plate)).volume();
  if (missing > connectorVolumeTolerance(longest)) {
    throw new GeometryError(`The section plate leaves ${missing} mm³ of the solid between its faces empty.`);
  }
}

function assertConnected(solid: Manifold): void {
  const pieces = solid.decompose();
  const count = pieces.length;
  for (const piece of pieces) piece.delete();
  if (count !== 1) throw new GeometryError(`The section plate is not one solid (${count} pieces).`);
}

/**
 * A section plate's geometry, refused before anything is built where it does not apply: a cylinder's and a cone's cuts and a
 * ball's horizontal one offer one, not with a twist connector, and its thickness, along the plane's normal, must leave both
 * parts. The plane itself was checked before, by the cut's own limits.
 */
function planPlate({ shape, scale, section }: ModelSpec): SectionPlateGeometry | undefined {
  if (section === undefined || !('plate' in section) || section.plate === undefined) return undefined;
  if (shape.kind !== 'cylinder' && shape.kind !== 'cone' && shape.kind !== 'ball') {
    throw new InvalidModelSpecError(['section.plate: only a cylinder, a cone and a ball offer a section plate.']);
  }
  if (section.connector?.type === 'twist') {
    throw new InvalidModelSpecError(['section.plate: a twist connector cannot join the parts through a section plate.']);
  }
  const cut = cutOfSection(section) as PlateCut;
  if (!isPlateCut(cut) || !isPlateThicknessFeasible(shape, scale, cut)) {
    const { max } = plateThicknessRange(shape, scale, planeOfPlateCut(cut));
    throw new InvalidModelSpecError([
      `section.plate.thicknessMm: ${section.plate.thicknessMm} mm leaves a part thinner than allowed; at most ${max} mm fits here.`,
    ]);
  }
  return sectionPlateGeometry(plateSection(shape, scale, cut));
}

/** The plane of a section read off a round solid: a cylinder's or a cone's vertical one, or a cylinder's oblique one. */
function cutPlaneOf({ shape, scale, section }: ModelSpec): Plane {
  if (section?.type === 'vertical' && shape.kind === 'cylinder')
    return verticalCylinderSection(shape, scale, section.offsetPercent).plane;
  if (section?.type === 'vertical' && shape.kind === 'cone')
    return coneVerticalSection(shape, scale, section.offsetPercent).plane;
  if (section?.type === 'oblique' && shape.kind === 'cylinder') return obliqueCylinderSection(shape, scale, section).plane;
  if (section?.type === 'axis-parallel' && shape.kind === 'cylinder') {
    return axisParallelCylinderSection(shape, scale, {
      offsetPercent: section.offsetPercent,
      offsetDirectionDeg: section.directionDeg,
    }).plane;
  }
  if ((section?.type === 'oblique' || section?.type === 'oblique-apex') && shape.kind === 'cone') {
    return coneObliqueSection(shape, scale, section).plane;
  }
  if (section?.type === 'horizontal' && shape.kind === 'ball') return ballSection(scale, section.offsetPercent).plane;
  if (section !== undefined && isBoxSectionSpec(section) && isBoxShape(shape)) {
    return boxSection(shape, scale, cutOfSection(section) as BoxCut).plane;
  }
  throw new GeometryError('Expected a cut that this solid offers.');
}

/**
 * The specification with every constrained plane derived from the solid it is built for: an axial plane through a cone's apex
 * takes the angle that holds the base's centre, from the cone's own proportions, whatever angle it was stored with.
 */
function withConstrainedPlanes(spec: ModelSpec): ModelSpec {
  const { shape, section } = spec;
  if (section?.type !== 'oblique-apex' || section.axial !== true || shape.kind !== 'cone') return spec;
  return { ...spec, section: { ...section, ...axialApexAngles(shape, section.directionDeg) } };
}

/** A vertical plane within the distance from the axis that leaves both parts usable; see `verticalOffsetLimitMm`. */
function assertVerticalOffset({ shape, scale, section }: ModelSpec): void {
  if (section?.type === 'axis-parallel' && shape.kind === 'cylinder') {
    const limit = axisParallelOffsetLimitPercent(shape, scale, section.directionDeg);
    if (Math.abs(section.offsetPercent) > limit + CONSTRAINT_ROUNDOFF_MM) {
      throw new InvalidModelSpecError([
        `section.offsetPercent: ${section.offsetPercent} % is beyond the ${limit} % that leave two usable parts.`,
      ]);
    }
    return;
  }
  if (section?.type === 'horizontal') {
    const limit = ballOffsetLimitPercent(scale);
    for (const [field, offset] of [
      ['offsetPercent', section.offsetPercent],
      ['secondOffsetPercent', section.secondOffsetPercent],
    ] as const) {
      if (offset !== undefined && Math.abs(offset) > limit + CONSTRAINT_ROUNDOFF_MM) {
        throw new InvalidModelSpecError([`section.${field}: ${offset} % is beyond the ${limit} % that leave usable parts.`]);
      }
    }
    if (section.secondOffsetPercent !== undefined) {
      const thickness = sectionOffsetMm(Math.abs(section.secondOffsetPercent - section.offsetPercent), ballRadiusMm(scale));
      const least = ballSliceMinimumMm(scale);
      if (thickness < least - CONSTRAINT_ROUNDOFF_MM) {
        throw new InvalidModelSpecError([
          `section.secondOffsetPercent: the part between the planes is ${thickness} mm thick, less than the ${least} mm of a usable part.`,
        ]);
      }
    }
    return;
  }
  if (section?.type !== 'vertical' || (shape.kind !== 'cylinder' && shape.kind !== 'cone')) return;
  const offset = sectionOffsetMm(section.offsetPercent, roundDimensionsMm(shape, scale).radius);
  const limit = verticalOffsetLimitMm(shape, scale);
  if (Math.abs(offset) > limit + CONSTRAINT_ROUNDOFF_MM) {
    throw new InvalidModelSpecError([
      `section.offsetPercent: ${offset} mm is beyond the ${limit} mm that leave two usable parts.`,
    ]);
  }
}

/** Both parts of an oblique cut keep a usable thickness: a body that cannot be split, whatever the connector. */
function assertObliqueSplit({ shape, scale, section }: ModelSpec): void {
  if (section?.type === 'oblique-apex' && shape.kind === 'cone') {
    const chord = coneApexChord(shape, scale, section);
    if (!isApexChordUsable(chord)) {
      throw new InvalidModelSpecError([
        `section: a plane through the apex meets the base at ${chord.offset} mm, outside the ${chord.usable.min}–${chord.usable.max} mm of two usable parts.`,
      ]);
    }
    return;
  }
  if (section?.type !== 'oblique' || (shape.kind !== 'cylinder' && shape.kind !== 'cone')) return;
  const reach = obliqueSplitReach(shape, scale, section);
  if (!satisfies(reach)) {
    throw new InvalidModelSpecError([
      `section: the thinner part reaches ${reach.valueMm} mm from the plane, less than the ${reach.minimumMm} mm of a usable part.`,
    ]);
  }
}

/**
 * A cube's or parallelepiped's section: a plane its mode fixes at all, through a point off the chosen line, and both parts, and a
 * middle part between two planes, of a usable thickness along the normal; see `boxPartMinimumMm`. Refused before anything is
 * built, like the other solids' cuts beyond their limits.
 */
function assertBoxSplit({ shape, scale, section }: ModelSpec): void {
  if (section === undefined || !isBoxSectionSpec(section)) return;
  if (!isBoxShape(shape)) {
    throw new InvalidModelSpecError([`section.type: ${section.type} is a section of a cube or a parallelepiped.`]);
  }
  const box = cutOfSection(section) as BoxCut;
  try {
    boxPlane(boxVertices(shape, scale), box.box);
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    throw new InvalidModelSpecError(['section.pointPercent: the point lies on the chosen line, which leaves the plane open.']);
  }
  const views: [string, BoxCut][] = [['positionPercent', box]];
  if (box.box.secondPositionPercent !== undefined) views.push(['secondPositionPercent', { ...box, atSecond: true }]);
  for (const [field, view] of views) {
    const reach = boxSplitReach(shape, scale, view);
    if (!satisfies(reach)) {
      throw new InvalidModelSpecError([
        `section.${field}: the thinner part reaches ${reach.valueMm} mm from the plane, less than the ${reach.minimumMm} mm of a usable part.`,
      ]);
    }
  }
  const first = boxSection(shape, scale, box);
  if (first.middle !== undefined) {
    const vertices = boxVertices(shape, scale);
    const least = boxPartMinimumMm(boxPlane(vertices, box.box).extent);
    if (first.middle.thickness < least - CONSTRAINT_ROUNDOFF_MM) {
      throw new InvalidModelSpecError([
        `section.secondPositionPercent: the part between the planes is ${first.middle.thickness} mm thick, less than the ${least} mm of a usable part.`,
      ]);
    }
  }
}

/** The connector's plan; refuses the specification before any geometry is built when the connector does not fit. */
function planConnector({ shape, scale, section }: ModelSpec): ConnectorPlan | undefined {
  if (section?.connector === undefined) return undefined;
  if (shape.kind !== 'cylinder' && shape.kind !== 'cone' && shape.kind !== 'ball' && !isBoxShape(shape)) {
    throw new ConnectorUnsuitableError([{ code: 'unsupported-shape' }]);
  }
  const { connector } = section;
  const cut = cutOfSection(section);
  const plan =
    connector.type === 'dovetail'
      ? planDovetail(shape, scale, cut, connector)
      : connector.type === 'twist'
        ? planTwist(shape, scale, cut, connector)
        : connector.type === 'magnet'
          ? planMagnets(shape, scale, cut, connector)
          : planRoundConnectors(shape, scale, cut, connector);
  if (plan.issues.length > 0) throw new ConnectorUnsuitableError(plan.issues);
  return plan;
}

function checked(solid: Manifold): Manifold {
  const status = solid.status();
  if (status !== 'NoError' || solid.isEmpty()) {
    throw new GeometryError(`Geometry kernel produced no solid (${status}).`);
  }
  return solid;
}

/** The parts of a sectioned solid fill it exactly, so their bounds together are those of the whole. */
function unionBounds(boxes: readonly Bounds[]): Bounds {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const box of boxes) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
}

/**
 * The shape kind, with the number of sides of a regular base for prisms and pyramids, e.g. "prism-6-sided", or the base
 * type otherwise, e.g. "prism-triangle" or "prism-trapezoid".
 */
export function modelName(shape: Shape): string {
  if ((shape.kind === 'prism' || shape.kind === 'pyramid') && shape.baseType !== 'regular') {
    return `${shape.kind}-${shape.baseType}`;
  }
  return shape.kind === 'prism' || shape.kind === 'pyramid' ? `${shape.kind}-${shape.baseSides}-sided` : shape.kind;
}

/**
 * The solid in millimetres: curved solids are built at size; regular polyhedra, a cube, the parallelepipeds, the prisms, the
 * pyramids and the tetrahedron as the convex hull of their vertices in millimetres.
 */
function buildShape(kernel: GeometryKernel, track: Track, shape: Shape, scale: PhysicalScale): Manifold {
  switch (shape.kind) {
    case 'cube':
    case 'cuboid':
    case 'parallelepiped':
    case 'prism':
    case 'pyramid':
    case 'tetrahedron': {
      // The very vertices that its sections' planes are constructed through and its preview labels name: an extruded base is
      // rounded to the cross-section's grid, a fraction of a micrometre off them, and a plane through a vertex then left a
      // sliver beside it that no longer passed as a closed solid once turned to its print orientation. Every base is convex.
      const vertices = boxVertices(shape, scale);
      return track(
        kernel.Manifold.hull(boxTopologyOf(shape).vertices.map((name): [number, number, number] => [...vertices[name]])),
      );
    }
    case 'cylinder':
    case 'cone':
      return buildRoundSolid(kernel, track, shape, scale);
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
      return buildRegularPolyhedron(kernel, track, shape.kind, scale);
    case 'ball':
      return buildBall(kernel, track, scale);
  }
}
