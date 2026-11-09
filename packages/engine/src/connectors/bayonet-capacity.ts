import type { BayonetConnector, PhysicalScale } from '@diploma-3d/schema';
import {
  type BayonetDimensions,
  type BayonetIssue,
  bayonetChecks,
  bayonetDimensions,
  bayonetFlexureTravel,
  bayonetSupported,
  leastBayonetProjection,
} from './bayonet.ts';
import { bisect, type Interval } from './bounds.ts';
import { type ParallelCylinderSection, type SectionedShape, type SolidCut, satisfies, solidCut } from './frame.ts';

/** What a new bayonet prefers, within what fits: a share of the largest stem, and a compact height near one stem diameter. */
export const BAYONET_DEFAULT_SHARE = { diameter: 0.25, projection: 0.5 } as const;

/** The grids of the interface's controls, in millimetres. */
export const BAYONET_STEPS_MM = { diameter: 0.1, projection: 0.25, clearance: 0.05 } as const;

export interface BayonetResolution {
  readonly status: 'available';
  /** The dimensions to build, with its clearances as they came. */
  readonly connector: BayonetConnector;
  /** Whether the dimensions differ from those given; defaults always count as given. */
  readonly adjusted: boolean;
  /** What failed at the dimensions given, when they had to change. */
  readonly issues: readonly BayonetIssue[];
}

export interface BayonetUnavailable {
  readonly status: 'unavailable';
  /** What fails even at the smallest stem that its lugs and tongue allow, at its least height. */
  readonly issues: readonly BayonetIssue[];
}

export type BayonetOutcome = BayonetResolution | BayonetUnavailable;

const passes = (section: ParallelCylinderSection, dimensions: BayonetDimensions) =>
  bayonetChecks(section, dimensions).every(satisfies);

/** What decides whether a stem is printable at all, whatever the height and the walls around it. */
const STEM_FLOOR: readonly BayonetIssue['code'][] = [
  'lug-too-narrow',
  'lug-keying-lost',
  'lug-bearing-short',
  'ledge-gap-short',
  'stem-core-thin',
  'tongue-too-short',
];

/** The dimensions at a stem with the least height it needs and an interference within the flexure's travel. */
function atStem(dimensions: BayonetDimensions, diameter: number): BayonetDimensions {
  const interference = Math.min(dimensions.interference, bayonetFlexureTravel());
  const { projection: _height, ...others } = { ...dimensions, diameter, interference };
  return { ...others, projection: leastBayonetProjection(others) };
}

/** The stems for which some height fits, from its own printable minimum to what the walls around the socket allow; null if none. */
function stemRange(section: ParallelCylinderSection, dimensions: BayonetDimensions): Interval | null {
  const largest = 2 * section.radius;
  const holds = (diameter: number) =>
    bayonetChecks(section, { ...dimensions, diameter })
      .filter(({ code }) => STEM_FLOOR.includes(code))
      .every(satisfies);
  if (!holds(largest)) return null;
  const least = bisect(holds, largest, 0.5);
  const fits = (diameter: number) => passes(section, atStem(dimensions, diameter));
  if (!fits(least)) return null;
  return { min: least, max: fits(largest) ? largest : bisect(fits, least, largest) };
}

/** The heights that fit at a stem for which `stemRange` holds: from the least it needs up to the socket's roof. */
function projectionRange(section: ParallelCylinderSection, dimensions: BayonetDimensions): Interval {
  const least = atStem(dimensions, dimensions.diameter);
  const fits = (projection: number) => passes(section, { ...least, projection });
  const deepest = section.depthExtent;
  return { min: least.projection, max: fits(deepest) ? deepest : bisect(fits, least.projection, deepest) };
}

const onGrid = (units: number, step: number) => Number((units * step).toFixed(6));

/** The multiple of `step` nearest to `value` within the interval; the value itself, clamped, if the interval holds none. */
function snapInside(value: number, { min, max }: Interval, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const candidates = [Math.round(clamped / step), Math.ceil(clamped / step), Math.floor(clamped / step)].map((units) =>
    onGrid(units, step),
  );
  return candidates.find((candidate) => candidate >= min && candidate <= max) ?? clamped;
}

const toConnector = (connector: BayonetConnector, dimensions: BayonetDimensions): BayonetConnector => ({
  ...connector,
  stemDiameterMm: dimensions.diameter,
  projectionMm: dimensions.projection,
  detentInterferenceMm: dimensions.interference,
});

function unavailable(section: ParallelCylinderSection, dimensions: BayonetDimensions): BayonetUnavailable {
  const range = stemRange(section, dimensions);
  // The smallest stem that its own lugs and tongue allow is the one that fits if any does.
  const holds = (diameter: number) =>
    bayonetChecks(section, { ...dimensions, diameter })
      .filter(({ code }) => STEM_FLOOR.includes(code))
      .every(satisfies);
  const largest = 2 * section.radius;
  const stem = range?.min ?? (holds(largest) ? bisect(holds, largest, 0.5) : dimensions.diameter);
  return { status: 'unavailable', issues: bayonetChecks(section, atStem(dimensions, stem)).filter((check) => !satisfies(check)) };
}

const sectionOf = (shape: SectionedShape, scale: PhysicalScale, cut: SolidCut) =>
  bayonetSupported(shape, cut) ? (solidCut(shape, scale, cut) as ParallelCylinderSection) : undefined;

/**
 * A new bayonet from what the section actually offers: the stem at a quarter of the largest that still leaves a height, never
 * below what its lugs and tongue need, and the height near the smaller of half of what that stem allows and one stem diameter,
 * clamped into what fits. They are coupled, as a thicker stem deepens the conical roof, so that the height follows the stem.
 * These are preferences only: they limit no slider.
 */
export function defaultBayonet(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: BayonetConnector,
): BayonetOutcome {
  const section = sectionOf(shape, scale, cut);
  if (section === undefined) return { status: 'unavailable', issues: [] };
  const given = bayonetDimensions(connector);
  const stems = stemRange(section, given);
  if (stems === null) return unavailable(section, given);
  const diameter = snapInside(BAYONET_DEFAULT_SHARE.diameter * stems.max, stems, BAYONET_STEPS_MM.diameter);
  const at = atStem(given, diameter);
  const heights = projectionRange(section, at);
  const projection = snapInside(
    Math.min(BAYONET_DEFAULT_SHARE.projection * heights.max, diameter),
    heights,
    BAYONET_STEPS_MM.projection,
  );
  return finish(section, given, { ...at, projection }, connector, false);
}

/**
 * The dimensions as they are if they fit; otherwise the nearest that do, with the clearances kept. Deterministic and idempotent:
 * what comes out fits, and so comes out unchanged the next time. It reads only the given settings, so that nothing shrinks step
 * by step and a model that returns to its former shape gets its former dimensions. A stem and height that both had to shrink move
 * together towards the smallest mechanism, as a thick stem can leave almost no height.
 */
export function normalizeBayonet(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: BayonetConnector,
): BayonetOutcome {
  const section = sectionOf(shape, scale, cut);
  if (section === undefined) return { status: 'unavailable', issues: [] };
  const given = bayonetDimensions(connector);
  if (passes(section, given)) return { status: 'available', connector, adjusted: false, issues: [] };
  const stems = stemRange(section, given);
  if (stems === null) return unavailable(section, given);
  const interference = Math.min(given.interference, bayonetFlexureTravel());
  const placed = { ...given, interference };
  const within = (value: number, { min, max }: Interval) => Math.min(max, Math.max(min, value));
  let diameter = within(given.diameter, stems);
  let heights = projectionRange(section, { ...placed, diameter });
  if (diameter < given.diameter && heights.max < given.projection) {
    const smallest = atStem(placed, stems.min);
    const blended = (share: number): BayonetDimensions => ({
      ...placed,
      diameter: smallest.diameter + share * (given.diameter - smallest.diameter),
      projection: smallest.projection + share * (given.projection - smallest.projection),
    });
    const fitting = (share: number) => {
      const dimensions = blended(share);
      return dimensions.diameter <= stems.max && passes(section, dimensions);
    };
    diameter = blended(bisect(fitting, 0, 1)).diameter;
  }
  if (diameter !== given.diameter) diameter = snapInside(diameter, stems, BAYONET_STEPS_MM.diameter);
  heights = projectionRange(section, { ...placed, diameter });
  const projection =
    given.projection >= heights.min && given.projection <= heights.max
      ? given.projection
      : snapInside(given.projection, heights, BAYONET_STEPS_MM.projection);
  return finish(section, given, { ...placed, diameter, projection }, connector, true);
}

/** The whole result validated once more; only a roundoff at an interval's end could still fail, and then its exact end is used. */
function finish(
  section: ParallelCylinderSection,
  given: BayonetDimensions,
  dimensions: BayonetDimensions,
  connector: BayonetConnector,
  adjusted: boolean,
): BayonetOutcome {
  const issues = adjusted ? bayonetChecks(section, given).filter((check) => !satisfies(check)) : [];
  if (passes(section, dimensions))
    return { status: 'available', connector: toConnector(connector, dimensions), adjusted, issues };
  return unavailable(section, given);
}
