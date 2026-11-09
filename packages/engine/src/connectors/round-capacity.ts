import type { PhysicalScale, RoundConnector } from '@diploma-3d/schema';
import { bisect, type Interval } from './bounds.ts';
import { type SectionedShape, type SolidCut, type SolidSection, satisfies, solidCut } from './frame.ts';
import {
  leastInsertion,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorDimensions,
  type RoundConnectorIssue,
  roundConnectorChecks,
  roundConnectorDimensions,
} from './round.ts';

/** The share of its feasible maximum a new connector's nominal size and insertion start at; they bound no slider. */
export const ROUND_CONNECTOR_DEFAULT_SHARE = { size: 0.25, insertion: 0.5 } as const;

/** The grids of the interface's controls, in millimetres: the nominal size, a plug's height or a dowel's whole length, and a pair's spacing. */
export const ROUND_CONNECTOR_STEPS_MM = { size: 0.1, length: 0.25, spacing: 0.25 } as const;

export interface RoundConnectorResolution {
  readonly status: 'available';
  /** The dimensions to build, with type, count, profile and clearances as they came. */
  readonly connector: RoundConnector;
  /** Whether the dimensions differ from those given; defaults always count as given. */
  readonly adjusted: boolean;
  /** What failed at the dimensions given, when they had to change. */
  readonly issues: readonly RoundConnectorIssue[];
}

export interface RoundConnectorUnavailable {
  readonly status: 'unavailable';
  /** What fails even at the smallest usable size and depth. */
  readonly issues: readonly RoundConnectorIssue[];
}

export type RoundConnectorOutcome = RoundConnectorResolution | RoundConnectorUnavailable;

const passes = (section: SolidSection, dimensions: RoundConnectorDimensions): boolean =>
  roundConnectorChecks(section, dimensions).every(satisfies);

const withLeastInsertion = (dimensions: RoundConnectorDimensions, diameter: number): RoundConnectorDimensions => ({
  ...dimensions,
  diameter,
  insertion: leastInsertion(dimensions.type, dimensions.profile ?? 'circle', diameter),
});

/** The sizes below which a pin is too thin or a pair loses its keying, whatever its depth. */
const SIZE_FLOOR_CHECKS: readonly RoundConnectorIssue['code'][] = ['pin-too-thin', 'keying-lost'];

/** The least nominal size that the pin's own width and a pair's keying allow; undefined if none does, as a too wide clearance may rule out. */
function leastSize(section: SolidSection, dimensions: RoundConnectorDimensions): number | undefined {
  const holds = (diameter: number) =>
    roundConnectorChecks(section, { ...dimensions, diameter })
      .filter(({ code }) => SIZE_FLOOR_CHECKS.includes(code))
      .every(satisfies);
  const largest = Math.max(2 * section.radius, section.span);
  return holds(largest) ? bisect(holds, largest, 0) : undefined;
}

/**
 * The nominal sizes for which some depth fits, with everything else as it is. A deeper hole only adds to the cavity, so the
 * least insertion that keeps the straight engagement decides whether a size fits at all; a larger size only widens the
 * cavity, so that those sizes form one interval, above the pin's own least width. `null` when none fits.
 */
function sizeRange(section: SolidSection, dimensions: RoundConnectorDimensions): Interval | null {
  const least = leastSize(section, dimensions);
  if (least === undefined) return null;
  const fits = (diameter: number) => passes(section, withLeastInsertion(dimensions, diameter));
  if (!fits(least)) return null;
  const largest = Math.max(2 * section.radius, section.span);
  return { min: least, max: fits(largest) ? largest : bisect(fits, least, largest) };
}

/** The insertions that fit at a size for which `sizeRange` holds: from the least engagement up to the walls and the far side. */
function insertionRange(section: SolidSection, dimensions: RoundConnectorDimensions): Interval {
  const least = withLeastInsertion(dimensions, dimensions.diameter);
  const fits = (insertion: number) => passes(section, { ...dimensions, insertion });
  const deepest = section.depthExtent;
  return { min: least.insertion, max: fits(deepest) ? deepest : bisect(fits, least.insertion, deepest) };
}

// The grid's multiples read as exact decimals, 13,9 rather than 13,900000000000002.
const onGrid = (units: number, step: number): number => Number((units * step).toFixed(6));

/**
 * The multiple of `step` nearest to `value` within the interval, as the controls can show it. An interval that holds no
 * multiple gives the value itself, clamped: the exact end rather than one outside the feasible set.
 */
function snapInside(value: number, { min, max }: Interval, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const candidates = [Math.round(clamped / step), Math.floor(clamped / step), Math.ceil(clamped / step)].map((units) =>
    onGrid(units, step),
  );
  return candidates.find((candidate) => candidate >= min && candidate <= max) ?? clamped;
}

/** The grid of e: a dowel's field shows its whole length 2e. */
const insertionStep = ({ type }: RoundConnectorDimensions) =>
  type === 'dowel' ? ROUND_CONNECTOR_STEPS_MM.length / 2 : ROUND_CONNECTOR_STEPS_MM.length;

/**
 * The spacing nearest to the current one at which a pair fits at all, on the control's grid. The current one is kept
 * whenever it works: only a section too small for it moves the pair.
 */
function workableSpacing(section: SolidSection, dimensions: RoundConnectorDimensions): number | undefined {
  if (dimensions.count === 1) return dimensions.spacing;
  const least = leastSize(section, dimensions);
  if (least === undefined) return undefined;
  const fitsAt = (spacing: number) => passes(section, withLeastInsertion({ ...dimensions, spacing }, least));
  if (fitsAt(dimensions.spacing)) return dimensions.spacing;
  const step = ROUND_CONNECTOR_STEPS_MM.spacing;
  const multiples = Array.from({ length: Math.floor(section.span / 2 / step) }, (_, index) => onGrid(index + 1, step));
  const nearestFirst = multiples.sort((a, b) => Math.abs(a - dimensions.spacing) - Math.abs(b - dimensions.spacing));
  return nearestFirst.find(fitsAt);
}

/** The physical dimensions as the stored settings, which keep the connector's other fields. */
function toConnector(connector: RoundConnector, dimensions: RoundConnectorDimensions, section: SolidSection, longest: number) {
  const { diameter, insertion, spacing } = dimensions;
  return {
    ...connector,
    diameterFactor: diameter / (ROUND_CONNECTOR_PROPORTIONS.diameter * longest),
    depthFactor: insertion / (ROUND_CONNECTOR_PROPORTIONS.insertion * longest),
    ...(connector.count === 2 ? { spacingPercent: (100 * spacing) / (section.span / 2) } : {}),
  } as RoundConnector;
}

/** What fails at the smallest connector, for an explanation of why none fits. */
function smallestIssues(section: SolidSection, dimensions: RoundConnectorDimensions): readonly RoundConnectorIssue[] {
  const least = leastSize(section, dimensions);
  const smallest = least === undefined ? dimensions : withLeastInsertion(dimensions, least);
  return roundConnectorChecks(section, smallest).filter((check) => !satisfies(check));
}

interface Solved {
  readonly section: SolidSection;
  readonly given: RoundConnectorDimensions;
  /** The given dimensions at a spacing that works, and the sizes that fit there. */
  readonly placed: RoundConnectorDimensions;
  readonly sizes: Interval;
}

function solve(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: RoundConnector,
): Solved | RoundConnectorUnavailable {
  const section = solidCut(shape, scale, cut);
  const given = roundConnectorDimensions(connector, scale.longestDimensionMm, section.span / 2);
  const spacing = workableSpacing(section, given);
  const placed = spacing === undefined ? undefined : { ...given, spacing };
  const sizes = placed === undefined ? null : sizeRange(section, placed);
  if (placed === undefined || sizes === null) return { status: 'unavailable', issues: smallestIssues(section, given) };
  return { section, given, placed, sizes };
}

/**
 * A new connector's dimensions from what the section actually offers: its type, count, profile, clearances and preferred
 * spacing as they are, the nominal size at a quarter of the largest size that still leaves a depth, and the insertion at
 * half of what that size then allows, both on the controls' grids and validated together. They are coupled, so the depth
 * follows the size rather than each being a share of its own independent maximum. For a pair, the size and the walls are
 * those of both connectors and both sets of holes.
 */
export function defaultRoundConnector(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: RoundConnector,
): RoundConnectorOutcome {
  const solved = solve(shape, scale, cut, connector);
  if ('status' in solved) return solved;
  const { section, placed, sizes } = solved;
  const diameter = snapInside(ROUND_CONNECTOR_DEFAULT_SHARE.size * sizes.max, sizes, ROUND_CONNECTOR_STEPS_MM.size);
  const depths = insertionRange(section, { ...placed, diameter });
  const insertion = snapInside(ROUND_CONNECTOR_DEFAULT_SHARE.insertion * depths.max, depths, insertionStep(placed));
  return finish(solved, { ...placed, diameter, insertion }, connector, scale, false);
}

/**
 * The dimensions as they are if they fit; otherwise the nearest ones that do, with the type, count, profile, clearances and
 * placement scheme kept. Deterministic and idempotent: what comes out fits, and so comes out unchanged the next time. It
 * reads only the given settings, so a stored value is never shrunk step by step: a model that returns to its former shape
 * gets its former dimensions.
 *
 * The size comes first, then the depth for it. Where both had to shrink they are coupled, as a large size can leave almost
 * no depth; they then move together along the line towards the smallest connector until they fit, and the depth takes what
 * that size allows.
 */
export function normalizeRoundConnector(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: RoundConnector,
): RoundConnectorOutcome {
  const section = solidCut(shape, scale, cut);
  const stated = roundConnectorDimensions(connector, scale.longestDimensionMm, section.span / 2);
  if (passes(section, stated)) return { status: 'available', connector, adjusted: false, issues: [] };
  const solved = solve(shape, scale, cut, connector);
  if ('status' in solved) return solved;
  const { placed, sizes } = solved;
  const within = (value: number, { min, max }: Interval) => Math.min(max, Math.max(min, value));
  let diameter = within(placed.diameter, sizes);
  let depths = insertionRange(section, { ...placed, diameter });
  if (diameter < placed.diameter && depths.max < placed.insertion) {
    const smallest = withLeastInsertion(placed, sizes.min);
    const blended = (share: number): RoundConnectorDimensions => ({
      ...placed,
      diameter: smallest.diameter + share * (placed.diameter - smallest.diameter),
      insertion: smallest.insertion + share * (placed.insertion - smallest.insertion),
    });
    const fitting = (share: number) => {
      const dimensions = blended(share);
      return (
        dimensions.diameter <= sizes.max &&
        dimensions.insertion >= withLeastInsertion(dimensions, dimensions.diameter).insertion &&
        passes(section, dimensions)
      );
    };
    diameter = blended(bisect(fitting, 0, 1)).diameter;
    depths = insertionRange(section, { ...placed, diameter });
  }
  if (diameter !== placed.diameter) {
    diameter = snapInside(diameter, sizes, ROUND_CONNECTOR_STEPS_MM.size);
    depths = insertionRange(section, { ...placed, diameter });
  }
  const insertion =
    placed.insertion >= depths.min && placed.insertion <= depths.max
      ? placed.insertion
      : snapInside(placed.insertion, depths, insertionStep(placed));
  return finish(solved, { ...placed, diameter, insertion }, connector, scale, true);
}

/**
 * The complete result validated once more. Snapping stays inside each interval, so a failure here can only be the roundoff
 * of the interval's ends; those exact ends, which `satisfies` accepts, are then used.
 */
function finish(
  { section, given, sizes }: Solved,
  dimensions: RoundConnectorDimensions,
  connector: RoundConnector,
  scale: PhysicalScale,
  adjusted: boolean,
): RoundConnectorOutcome {
  const longest = scale.longestDimensionMm;
  const issues = adjusted ? roundConnectorChecks(section, given).filter((check) => !satisfies(check)) : [];
  if (passes(section, dimensions)) {
    return { status: 'available', connector: toConnector(connector, dimensions, section, longest), adjusted, issues };
  }
  const exact = withLeastInsertion(dimensions, sizes.min);
  if (passes(section, exact)) {
    return { status: 'available', connector: toConnector(connector, exact, section, longest), adjusted, issues };
  }
  return { status: 'unavailable', issues: smallestIssues(section, given) };
}
