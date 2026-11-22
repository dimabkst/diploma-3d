import type { Connector, PhysicalScale, Shape } from '@diploma-3d/schema';
import enginePackage from '../../package.json' with { type: 'json' };
import type { DovetailPlan } from '../connectors/dovetail.ts';
import type { MagnetPlan } from '../connectors/magnet.ts';
import { dowelLength, plugHeight, type RoundConnectorPlan } from '../connectors/round.ts';
import { type TwistPlan, twistTrialDimensions } from '../connectors/twist.ts';
import { GeometryError } from '../errors.ts';
import type { GeneratedModel } from '../model.ts';
import { ballRadiusMm } from '../shapes/ball.ts';
import { type BaseShape, baseSidesMm } from '../shapes/base.ts';
import { boxEdgeLengthsMm } from '../shapes/box.ts';
import { parallelepipedDimensionsMm } from '../shapes/parallelepiped.ts';
import { prismShapeProportions } from '../shapes/prism.ts';
import { prismDimensionsMm } from '../shapes/prism-geometry.ts';
import { pyramidShapeDimensionsMm } from '../shapes/pyramid.ts';
import { regularPolyhedronMeasurements } from '../shapes/regular-polyhedron.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import { SETTINGS_PART } from './three-mf.ts';

/** Where the settings live inside every 3MF this application writes: an optional custom part, not a 3MF extension. */
export const MODEL_SETTINGS_PATH = SETTINGS_PART.path;

export const MODEL_SETTINGS_SCHEMA_VERSION = 2;

/** Which of the application's downloads a 3MF is. */
export type ExportKind = 'model' | 'pins' | 'connector-trial';

/**
 * What the request knew besides the specification, from the same snapshot as the specification it built: how a displaced
 * figure's inclination was entered, with the angles accepted in that mode.
 */
export interface ModelSettingsInput {
  readonly inclinationInput?:
    | { readonly enteredAs: 'offsets' }
    | { readonly enteredAs: 'angles'; readonly inclinationDeg: number; readonly directionDeg?: number };
}

/** What a figure's ratios are relative to, as the interface shows them. */
function ratioReference(shape: Shape): string | undefined {
  switch (shape.kind) {
    case 'cylinder':
    case 'cone':
      return 'the base radius r';
    case 'cuboid':
    case 'parallelepiped':
    case 'prism':
    case 'pyramid':
      return 'the base side a';
    default:
      return undefined;
  }
}

/** The fields that hold a displaced figure's offsets; none for a figure without a displacement. */
function offsetFieldsOf(shape: Shape): readonly string[] {
  switch (shape.kind) {
    case 'prism':
    case 'parallelepiped':
      return ['offsetXRatio', 'offsetYRatio'];
    case 'pyramid':
      return ['apexXRatio', 'apexYRatio'];
    case 'cylinder':
    case 'cone':
      return ['offsetRatio'];
    default:
      return [];
  }
}

/**
 * The figure with its applied defaults and one representation of its displacement, the one the user entered: the offsets,
 * or instead of them the accepted inclination and direction. A round figure's angle input has no direction of its own; its
 * direction is that of the offset it produced, not assumed.
 */
function shapeSettings(shape: Shape, input: ModelSettingsInput) {
  const reference = ratioReference(shape);
  const withReference = reference === undefined ? {} : { ratioReference: reference };
  const offsets = offsetFieldsOf(shape);
  const entered = input.inclinationInput;
  if (offsets.length === 0) return { ...shape, ...withReference };
  if (entered?.enteredAs !== 'angles') return { ...shape, inclinationInput: 'offsets' as const, ...withReference };
  const fields = Object.fromEntries(Object.entries(shape).filter(([key]) => !offsets.includes(key)));
  const roundOffset = shape.kind === 'cylinder' || shape.kind === 'cone' ? shape.offsetRatio : 0;
  const directionDeg = entered.directionDeg ?? (roundOffset === 0 ? undefined : roundOffset > 0 ? 0 : 180);
  return {
    ...fields,
    inclinationInput: 'angles' as const,
    inclinationDeg: entered.inclinationDeg,
    ...(directionDeg === undefined ? {} : { directionDeg }),
    ...withReference,
  };
}

/** The base sides besides a, named by their letters. */
const sidesMm = (sides: Readonly<Record<string, number | undefined>>) =>
  Object.fromEntries(
    Object.entries(sides).flatMap(([letter, value]) =>
      value === undefined ? [] : [[letter === 't' ? 'baseHeightMm' : `baseSide${letter.toUpperCase()}Mm`, value]],
    ),
  );

/** The original assembled body's own dimensions in millimetres, from the same scale as its geometry. */
function bodyDimensions(shape: Shape, scale: PhysicalScale) {
  switch (shape.kind) {
    case 'cube':
      return { edgeMm: scale.longestDimensionMm };
    case 'cuboid': {
      const [a, b, height] = boxEdgeLengthsMm(shape, scale);
      return { baseSideAMm: a, baseSideBMm: b, heightMm: height };
    }
    case 'parallelepiped': {
      const { edge, baseSideB, height, lateralEdge } = parallelepipedDimensionsMm(shape, scale);
      return { baseSideAMm: edge, baseSideBMm: baseSideB, heightMm: height, lateralEdgeMm: lateralEdge };
    }
    case 'prism': {
      const { edge, height, lateralEdge } = prismDimensionsMm(prismShapeProportions(shape), scale);
      return {
        baseSideAMm: edge,
        ...sidesMm({ ...baseSidesMm(shape as BaseShape, edge) }),
        heightMm: height,
        lateralEdgeMm: lateralEdge,
      };
    }
    case 'pyramid':
    case 'tetrahedron': {
      const { edge, height, sides } = pyramidShapeDimensionsMm(shape, scale);
      return { baseSideAMm: edge, ...sidesMm({ ...sides }), heightMm: height };
    }
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
      return { edgeMm: regularPolyhedronMeasurements(shape.kind, scale).edge };
    case 'ball':
      return { radiusMm: ballRadiusMm(scale) };
    case 'cylinder':
    case 'cone': {
      const { radius, height, offset } = roundDimensionsMm(shape, scale);
      return { baseRadiusMm: radius, heightMm: height, offsetMm: offset };
    }
  }
}

const dovetailConnector = (plan: DovetailPlan) => ({
  conventions: {
    clearanceMm: 'the gap between each pair of mating surfaces, measured normal to them; not a total of both sides',
    ...(plan.interfaces === undefined
      ? {}
      : { placement: 'a tongue of these dimensions on each face of the section plate, its groove in the part beyond' }),
  },
  dimensions: {
    tongueHeightMm: plan.height,
    tongueRootWidthMm: plan.rootWidth,
    tongueHeadWidthMm: plan.headWidth,
    tongueLengthMm: plan.length,
    leadInChamferMm: plan.leadIn,
  },
});

const roundConnector = (plan: RoundConnectorPlan) => ({
  conventions: {
    nominalSizeMm: 'the diameter of a circle, of a polygon’s circumscribed circle, or of the circle that a flat side cuts',
    clearanceMm: 'the total enlargement Δ of the hole’s profile; every side surface lies Δ/2 outside the pin’s',
  },
  dimensions: {
    connectors: plan.sites.map((site) => ({
      nominalSizeMm: site.pinDiameter,
      offsetFromCentreMm: site.along,
      chamferMm: site.chamfer,
    })),
    ...(plan.type === 'plug' ? { plugHeightMm: plugHeight(plan) } : { dowelLengthMm: dowelLength(plan) }),
    // Through a section plate a plug stands its thickness higher and a dowel is that much longer than the engagement.
    ...(plan.plateThickness === undefined ? {} : { engagementMm: plan.insertion }),
    holeDepthMm: plan.holeDepth,
  },
});

const twistConnector = ({ layout }: TwistPlan) => ({
  conventions: {
    sizeMm: 'the diameter of the circle around the whole head, lugs included',
    holeClearanceMm: 'the total enlargement Δ of the recess’s profile; every sliding side surface lies Δ/2 outside the head’s',
    axialClearanceMm: 'the gap at each opposed axial pair of faces, above and below the head; not their sum',
  },
  dimensions: {
    neckRadiusMm: layout.neckRadius,
    neckHeightMm: layout.neckHeight,
    discRadiusMm: layout.discRadius,
    headThicknessMm: layout.headThickness,
    wideLugTipHalfWidthMm: layout.wideHalfWidth,
    narrowLugTipHalfWidthMm: layout.narrowHalfWidth,
    recessDepthMm: layout.recessDepth,
  },
});

const magnetConnector = (plan: MagnetPlan) => ({
  conventions: {
    holeDiameterMm:
      'magnet diameter plus the diameter allowance, added to the whole diameter; the pocket polygon’s flats lie on it',
    holeDepthMm: 'magnet thickness plus the depth allowance, from the mating face to the pocket’s bottom',
    pairs: 'per mating interface: each pair is one pocket in each part on one shared axis along the cut’s normal, 2 magnets',
    minimumEdgeGapMm: 'from each opening’s outer edge, entry chamfer included, to the edge of the mating faces',
    ...(plan.faceGap > 0
      ? { placement: 'the pockets lie in the two parts on either side of the section plate, which stays whole between them' }
      : {}),
  },
  dimensions: {
    holeDiameterMm: plan.holeDiameter,
    holeDepthMm: plan.holeDepth,
    entryChamferMm: plan.chamfer,
    sideMaterialMm: plan.wall,
    bottomMaterialMm: plan.bottomWall,
    spacingMm: plan.spacing,
    minimumEdgeGapMm: plan.edgeGap,
    pocketPolygonSides: plan.segments,
    magnetsTotal: 2 * plan.sites.length,
    axis: plan.frame.n,
    pairs: plan.sites.map((site) => ({ centreMm: site.centre, alongUMm: site.along, alongVMm: site.across })),
  },
});

/** The connector's settings as generated, after any automatic correction, with its physical dimensions. */
function connectorSettings(model: GeneratedModel) {
  const settings: Connector | undefined = model.spec.section?.connector;
  const plan = model.section?.connector;
  if (settings === undefined || plan === undefined) return undefined;
  const resolved =
    plan.type === 'dovetail'
      ? dovetailConnector(plan)
      : plan.type === 'twist'
        ? twistConnector(plan)
        : plan.type === 'magnet'
          ? magnetConnector(plan)
          : roundConnector(plan);
  return { settings, ...resolved };
}

/** A section plate's outline as built; its thickness and margin are among the section's settings. */
function plateDimensions(model: GeneratedModel) {
  const plate = model.section?.plate;
  if (plate === undefined) return undefined;
  return {
    conventions: {
      outlineLengthMm:
        'along the cut frame’s u, the dovetail’s sliding axis: +Y on a cut parallel to the base, +Z on a vertical one, uphill on an oblique one',
    },
    // As built: where the solid's base cuts the plate off, smaller than the outline grown by the margin.
    outlineLengthMm: plate.extent.u.max - plate.extent.u.min,
    outlineWidthMm: plate.extent.v.max - plate.extent.v.min,
    cornerRadiusMm: plate.cornerRadius,
  };
}

/** What a file of pins or a trial holds apart from the model whose settings it records: the parts actually exported. */
function exportedParts(model: GeneratedModel, kind: ExportKind) {
  const plan = model.section?.connector;
  if (kind === 'pins' && (plan?.type === 'plug' || plan?.type === 'dowel')) {
    return { pins: plan.sites.map((site) => ({ nominalSizeMm: site.pinDiameter, lengthMm: dowelLength(plan) })) };
  }
  if (kind === 'connector-trial' && plan?.type === 'twist') {
    const { outerRadius, maleBaseHeight, femaleHeight } = twistTrialDimensions(plan.layout);
    return {
      trialHolders: {
        connector: 'the source model’s connector, at its size',
        holderDiameterMm: 2 * outerRadius,
        maleBaseHeightMm: maleBaseHeight,
        femaleHeightMm: femaleHeight,
      },
    };
  }
  return undefined;
}

/**
 * The settings that produced a generated model, from the very specification and plans it was generated from: the values
 * the geometry was built with, after any automatic correction, at full precision.
 */
export function modelSettingsDocument(model: GeneratedModel, kind: ExportKind, input: ModelSettingsInput = {}) {
  const { shape, scale, section } = model.spec;
  const connector = connectorSettings(model);
  const plate = plateDimensions(model);
  const { connector: _connector, ...cut } = section ?? {};
  const parts = exportedParts(model, kind);
  return {
    schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION,
    application: { name: 'diploma-3d', generator: enginePackage.name, generatorVersion: enginePackage.version },
    export: { kind },
    units: { length: 'mm', angle: 'deg' },
    sourceModel: {
      shape: shapeSettings(shape, input),
      longestDimensionMm: scale.longestDimensionMm,
      bodyDimensions: bodyDimensions(shape, scale),
      ...(section === undefined ? {} : { section: cut }),
      ...(plate === undefined ? {} : { sectionPlate: plate }),
      ...(connector === undefined ? {} : { connector }),
    },
    ...(parts === undefined ? {} : { exportedParts: parts }),
  };
}

export type ModelSettingsDocument = ReturnType<typeof modelSettingsDocument>;

/** UTF-8 JSON with two-space indentation; a non-finite number is an error rather than a misleading null. */
export function serializeModelSettings(document: ModelSettingsDocument): string {
  return `${JSON.stringify(
    document,
    (key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new GeometryError(`The model settings hold a non-finite number at "${key}".`);
      }
      return value;
    },
    2,
  )}\n`;
}
