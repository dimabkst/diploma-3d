import type { PhysicalScale, TwistConnector } from '@diploma-3d/schema';
import { bisect, type Interval } from './bounds.ts';
import { type ParallelCylinderSection, type SectionedShape, type SolidCut, satisfies, solidCut } from './frame.ts';
import { type TwistDimensions, type TwistIssue, twistChecks, twistDimensions, twistSupported } from './twist.ts';

/** A new connector's size as a share of the largest that fits; it bounds no slider. */
export const TWIST_DEFAULT_SHARE = 0.25;

/** The grids of the interface's controls, in millimetres. */
export const TWIST_STEPS_MM = { size: 0.1, clearance: 0.05 } as const;

export interface TwistResolution {
  readonly status: 'available';
  /** The size to build, with the clearances as they came. */
  readonly connector: TwistConnector;
  /** Whether the size differs from the one given; defaults always count as given. */
  readonly adjusted: boolean;
  /** What failed at the size given, when it had to change. */
  readonly issues: readonly TwistIssue[];
}

export interface TwistUnavailable {
  readonly status: 'unavailable';
  /** What fails even at the smallest printable size. */
  readonly issues: readonly TwistIssue[];
}

export type TwistOutcome = TwistResolution | TwistUnavailable;

/** The checks that a larger size only eases: those of the connector itself, whatever surrounds it. */
const SIZE_FLOOR: readonly TwistIssue['code'][] = [
  'lug-too-narrow',
  'keying-lost',
  'bearing-short',
  'engagement-short',
  'neck-too-thin',
  'ledge-thin',
  'rib-thin',
];

const failing = (section: ParallelCylinderSection, dimensions: TwistDimensions) =>
  twistChecks(section, dimensions).filter((check) => !satisfies(check));

// Far beyond any printable model: the construction's own minimum does not depend on the solid, so it is found even where the
// solid is narrower, and the explanation then names what the solid lacks.
const LARGEST_CONSTRUCTION_MM = 1000;

/** The least size the connector's own construction allows, whatever surrounds it. */
function leastSize(section: ParallelCylinderSection, dimensions: TwistDimensions): number | undefined {
  const holds = (size: number) =>
    twistChecks(section, { ...dimensions, size })
      .filter(({ code }) => SIZE_FLOOR.includes(code))
      .every(satisfies);
  return holds(LARGEST_CONSTRUCTION_MM) ? bisect(holds, LARGEST_CONSTRUCTION_MM, 0.5) : undefined;
}

/**
 * The sizes that fit, with the clearances as they are: from the construction's printable minimum up to what the walls around the
 * recess and over its roof allow, one interval, since every wall only thins with the size. `null` when none fits.
 */
function sizeRange(section: ParallelCylinderSection, dimensions: TwistDimensions): Interval | null {
  const least = leastSize(section, dimensions);
  const fits = (size: number) => failing(section, { ...dimensions, size }).length === 0;
  if (least === undefined || !fits(least)) return null;
  const largest = 2 * section.radius;
  return { min: least, max: fits(largest) ? largest : bisect(fits, least, largest) };
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

function unavailable(section: ParallelCylinderSection, dimensions: TwistDimensions): TwistUnavailable {
  const least = leastSize(section, dimensions);
  return { status: 'unavailable', issues: failing(section, { ...dimensions, size: least ?? dimensions.size }) };
}

const sectionOf = (shape: SectionedShape, scale: PhysicalScale, cut: SolidCut) =>
  twistSupported(shape, cut) ? (solidCut(shape, scale, cut) as ParallelCylinderSection) : undefined;

/**
 * A new connector's size from what the section actually offers with these clearances: a quarter of the largest that fits, never
 * below the construction's printable minimum, on the control's grid. Not derived from the model's largest dimension.
 */
export function defaultTwist(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: TwistConnector,
): TwistOutcome {
  const section = sectionOf(shape, scale, cut);
  if (section === undefined) return { status: 'unavailable', issues: [] };
  const given = twistDimensions(connector);
  const sizes = sizeRange(section, given);
  if (sizes === null) return unavailable(section, given);
  const size = snapInside(TWIST_DEFAULT_SHARE * sizes.max, sizes, TWIST_STEPS_MM.size);
  return finish(section, given, size, connector, false);
}

/**
 * The size as it is if it fits; otherwise the nearest one that does, on the grid, with the clearances kept. Deterministic and
 * idempotent, and it reads only the given settings: nothing shrinks step by step, and a model that returns to its former shape
 * gets its former size.
 */
export function normalizeTwist(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: TwistConnector,
): TwistOutcome {
  const section = sectionOf(shape, scale, cut);
  if (section === undefined) return { status: 'unavailable', issues: [] };
  const given = twistDimensions(connector);
  if (failing(section, given).length === 0) return { status: 'available', connector, adjusted: false, issues: [] };
  const sizes = sizeRange(section, given);
  if (sizes === null) return unavailable(section, given);
  return finish(section, given, snapInside(given.size, sizes, TWIST_STEPS_MM.size), connector, true);
}

/** The result validated once more; only a roundoff at an interval's end could fail, and then that exact end is used. */
function finish(
  section: ParallelCylinderSection,
  given: TwistDimensions,
  size: number,
  connector: TwistConnector,
  adjusted: boolean,
): TwistOutcome {
  const issues = adjusted ? failing(section, given) : [];
  const sizes = sizeRange(section, given);
  for (const candidate of [size, sizes?.min, sizes?.max]) {
    if (candidate !== undefined && failing(section, { ...given, size: candidate }).length === 0) {
      return { status: 'available', connector: { ...connector, sizeMm: candidate }, adjusted, issues };
    }
  }
  return unavailable(section, given);
}
