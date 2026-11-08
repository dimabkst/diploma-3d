import {
  type CylinderShape,
  DEFAULT_DOVETAIL,
  DIAMETRAL_CLEARANCE_LIMITS,
  DOVETAIL_CLEARANCE_LIMITS,
  type DovetailConnector,
  type DowelConnector,
  type PlugConnector,
  type RoundConnector,
} from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { generateModel } from '../model.ts';
import { connectorFeasibility, hasFeasibleValues, type ParameterBounds } from './bounds.ts';
import {
  DOVETAIL_LEAD_IN_RELATIVE,
  DOVETAIL_MINIMUMS_MM,
  type DovetailDimensions,
  type DovetailParameter,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  planDovetail,
} from './dovetail.ts';
import { type CylinderSection, cylinderSection, satisfies } from './frame.ts';
import {
  planRoundConnectors,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorDimensions,
  type RoundConnectorParameter,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './round.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const M = 80;
const scale = { longestDimensionMm: M } as const;
const cylinder = (heightRatio: number, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const pair = (count: 1 | 2, spacingPercent = 45) => (count === 2 ? { count, spacingPercent } : { count });
const plug = (count: 1 | 2 = 1, overrides: Partial<PlugConnector> = {}): PlugConnector =>
  ({ type: 'plug', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.2, ...pair(count), ...overrides }) as PlugConnector;
const dowel = (count: 1 | 2 = 1, overrides: Partial<DowelConnector> = {}): DowelConnector =>
  ({
    type: 'dowel',
    diameterFactor: 1,
    depthFactor: 1,
    lowerClearanceMm: 0.1,
    upperClearanceMm: 0.2,
    ...pair(count),
    ...overrides,
  }) as DowelConnector;
const dovetail = (overrides: Partial<DovetailConnector> = {}): DovetailConnector => ({
  type: 'dovetail',
  ...DEFAULT_DOVETAIL,
  ...overrides,
});

/** The multipliers for a diameter and an insertion in millimetres at M = 80 mm. */
const diameterFactor = (millimetres: number) => millimetres / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
const depthFactor = (millimetres: number) => millimetres / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);

const roundBounds = (shape: CylinderShape, position: number, connector: RoundConnector, key: RoundConnectorParameter) =>
  roundConnectorFeasibility(shape, scale, position, connector).parameters[key].bounds;
const dovetailBounds = (shape: CylinderShape, position: number, connector: DovetailConnector, key: DovetailParameter) =>
  dovetailFeasibility(shape, scale, position, connector).parameters[key].bounds;

/** The chamfer of a pin end and of its hole's entrance, min(0,08·p, 0,2·e). */
const chamfer = (pin: number, insertion: number) => Math.min(0.08 * pin, 0.2 * insertion);

describe('the reference case: M = 80 mm, a right cylinder with R = 20 mm and H = 80 mm cut at 50 %, d = 5 mm', () => {
  const shape = cylinder(4);
  const section = cylinderSection(shape, scale, 50);

  it('has the assumed section, wall, depth allowance and 0,4 mm chamfers', () => {
    expect([section.radius, section.lowerThickness, section.upperThickness]).toEqual([20, 40, 40]);
    const plan = planRoundConnectors(shape, scale, 50, plug(1));
    expect(plan.sites[0]?.pinDiameter).toBe(5);
    expect(plan.sites[0]?.chamfer).toBeCloseTo(0.4, 12);
    expect(plan.holeDepth - plan.insertion).toBeCloseTo(0.3, 12);
  });

  it('bounds a plug’s protrusion to 2,8–38,5 mm: e − 2·0,4 ≥ 2 and e ≤ 40 − 1,2 − 0,3', () => {
    const bounds = roundBounds(shape, 50, plug(1), 'insertion');
    expect(bounds.min).toBeCloseTo(2.8, 9);
    expect(bounds.max).toBeCloseTo(38.5, 9);
    expect(bounds.blocked).toBe(false);
  });

  it('bounds a dowel’s insertion into each part to 3,1–38,5 mm, a whole dowel 6,2–77 mm long', () => {
    const bounds = roundBounds(shape, 50, dowel(1), 'insertion');
    expect(bounds.min).toBeCloseTo(3.1, 9);
    expect(bounds.max).toBeCloseTo(38.5, 9);
    expect(2 * bounds.max).toBeCloseTo(77, 9);
  });
});

describe('dimensions beyond the old slider limits', () => {
  it.each([
    ['an 8 mm plug', plug(1, { depthFactor: 2 }), 90, 'hole-bottom-thin/upper'],
    ['a 16 mm dowel, 8 mm in each part', dowel(1, { depthFactor: 2 }), 10, 'hole-bottom-thin/lower'],
    ['a pair of 8 mm plugs, d = 10 mm', plug(2, { depthFactor: 2, diameterFactor: 2 }), 90, 'hole-bottom-thin/upper'],
  ])('accepts %s and builds it, until the cut moves near a base', (_, connector, position, code) => {
    expect(planRoundConnectors(cylinder(2), scale, 50, connector).issues).toEqual([]);
    const model = generateModel(kernel, {
      shape: cylinder(2),
      scale,
      section: { type: 'parallel-to-bases', positionPercent: 50, connector },
    });
    expect(model.solids.length).toBe(connector.type === 'dowel' ? 3 : 2);
    const issues = planRoundConnectors(cylinder(2), scale, position, connector).issues;
    expect(issues.map((issue) => issue.code + ('part' in issue ? `/${issue.part}` : ''))).toContain(code);
    // Near the base the same connector lies above its upper bound: 8 mm of a part leave at most 8 − 1,5 = 6,5 mm.
    expect(roundBounds(cylinder(2), position, connector, 'insertion').max).toBeCloseTo(6.5, 9);
  });

  it('accepts a dovetail 3,5 mm high and 70 mm long on the default cylinder', () => {
    const connector = dovetail({ sizeFactor: 1.75, lengthPercent: 87.5 });
    expect(planDovetail(cylinder(2), scale, 50, connector).issues).toEqual([]);
    const model = generateModel(kernel, {
      shape: cylinder(2),
      scale,
      section: { type: 'parallel-to-bases', positionPercent: 50, connector },
    });
    expect(model.solids[0]?.measurements.size[2]).toBeCloseTo(40 + 3.5, 4);
  });
});

describe('the lower bound of the insertion follows the chamfers of the actual diameter', () => {
  it.each([
    // The chamfer is 0,08·d while 0,2·e is larger; e ≥ 2 + play + 2·0,08·d.
    ['plug', 3, 2 + 2 * 0.24],
    ['plug', 5, 2.8],
    ['dowel', 3, 2.3 + 2 * 0.24],
    ['dowel', 5, 3.1],
    // For a wide pin 0,2·e is the smaller: e − 2·0,2·e ≥ 2 + play.
    ['plug', 20, 2 / 0.6],
    ['dowel', 20, 2.3 / 0.6],
  ] as const)('a %s of d = %s mm needs e ≥ %s mm', (type, diameter, minimum) => {
    const connector = (type === 'plug' ? plug : dowel)(1, { diameterFactor: diameterFactor(diameter) });
    const bounds = roundBounds(cylinder(2), 50, connector, 'insertion');
    expect(bounds.min).toBeCloseTo(minimum, 9);
    // At the bound the straight engagement is exactly 2 mm, with the chamfer of that insertion.
    const play = type === 'dowel' ? 0.3 : 0;
    expect(bounds.min - play - 2 * chamfer(diameter, bounds.min)).toBeCloseTo(2, 9);
  });
});

describe('a pair’s distance from the centre', () => {
  it.each([
    ['R = 40 mm, d = 5 mm', cylinder(2), 5, 0.2],
    ['R = 10 mm, d = 5 mm', cylinder(8), 5, 0.2],
    ['R = 40 mm, d = 12 mm, c = 0,4 mm', cylinder(2), 12, 0.4],
    ['R = 20 mm, d = 4 mm, c = 0', cylinder(4), 4, 0],
  ])('%s: s from (a₁ + a₂ + w)/2 to R − w − max(a₁, a₂)', (_, shape, diameter, clearance) => {
    const connector = plug(2, { diameterFactor: diameterFactor(diameter), holeClearanceMm: clearance });
    const { inradius } = cylinderSection(shape, scale, 50);
    // The cavities' largest radii, at their chamfered entrances.
    const [a1, a2] = [diameter, 0.8 * diameter].map((pin) => (pin + clearance) / 2 + chamfer(pin, 4));
    const bounds = roundBounds(shape, 50, connector, 'spacing');
    expect(bounds.min).toBeCloseTo(((a1 as number) + (a2 as number) + 1.2) / 2, 9);
    expect(bounds.max).toBeCloseTo(inradius - 1.2 - Math.max(a1 as number, a2 as number), 9);
  });

  it('has no feasible value when a pair cannot fit across the section', () => {
    // R = 10 mm and d = 9 mm: the two entrances and three walls need more than the inscribed diameter.
    const bounds = roundBounds(cylinder(8), 50, plug(2, { diameterFactor: diameterFactor(9) }), 'spacing');
    expect(hasFeasibleValues(bounds)).toBe(false);
    expect(bounds.min).toBeGreaterThan(bounds.max);
  });
});

describe('the diameter', () => {
  it.each([
    ['one plug', plug(1, { holeClearanceMm: 0.4 }), 3],
    // A pair: 0,8·d ≥ 3 mm, so d ≥ 3,75 mm, and d − (0,8·d + c) ≥ 0,5 mm, so d ≥ (0,5 + c)/0,2.
    ['a pair without clearance', plug(2, { holeClearanceMm: 0 }), 3.75],
    ['a pair with 0,2 mm', plug(2, { holeClearanceMm: 0.2 }), 3.75],
    ['a pair with 0,4 mm', plug(2, { holeClearanceMm: 0.4 }), 4.5],
    ['a pair of dowels, keyed by the larger clearance, 0,35 mm', dowel(2, { upperClearanceMm: 0.35 }), 4.25],
    ['a pair of dowels with 0,35 mm in the lower part', dowel(2, { lowerClearanceMm: 0.35, upperClearanceMm: 0 }), 4.25],
  ])('of %s starts at %s mm', (_, connector, minimum) => {
    expect(roundBounds(cylinder(2), 50, connector, 'diameter').min).toBeCloseTo(minimum, 9);
  });

  it('of one connector ends where the wall beside its widened entrance is 1,2 mm', () => {
    const { inradius } = cylinderSection(cylinder(8), scale, 50);
    // R = 10 mm, e = 4 mm: a wide pin's chamfer is 0,2·e = 0,8 mm, so (d + c)/2 + 0,8 = inradius − 1,2.
    const bounds = roundBounds(cylinder(8), 50, plug(1), 'diameter');
    expect(bounds.max).toBeCloseTo(2 * (inradius - 1.2 - 0.8) - 0.2, 9);
  });

  it('bounds the clearance within its calibration window by the keying of the current pair', () => {
    expect(roundBounds(cylinder(2), 50, plug(2, { diameterFactor: diameterFactor(4.2) }), 'upperClearance')).toMatchObject({
      min: 0,
    });
    expect(roundBounds(cylinder(2), 50, plug(2, { diameterFactor: diameterFactor(4.2) }), 'upperClearance').max).toBeCloseTo(
      0.34,
      9,
    );
    // 0,2 × 4,6 − 0,5 = 0,42 mm lies beyond the window: the policy limit applies.
    expect(roundBounds(cylinder(2), 50, plug(2, { diameterFactor: diameterFactor(4.6) }), 'upperClearance')).toEqual({
      ...DIAMETRAL_CLEARANCE_LIMITS,
      blocked: false,
    });
  });
});

describe('the dovetail', () => {
  const { inradius } = cylinderSection(cylinder(2), scale, 50);

  it('needs a straight length L − 0,25·h ≥ 1,2 mm, and fits its groove’s closed end 1,2 mm inside the section', () => {
    for (const [height, clearance] of [
      [2, 0.2],
      [3, 0.4],
      [1.5, 0.1],
    ] as const) {
      const connector = dovetail({ sizeFactor: height / 2, clearanceMm: clearance });
      const bounds = dovetailBounds(cylinder(2), 50, connector, 'length');
      expect(bounds.min).toBeCloseTo(DOVETAIL_MINIMUMS_MM.straightLength + DOVETAIL_LEAD_IN_RELATIVE * height, 9);
      // A right cylinder: L ≤ 2·(√((R − w)² − A²) − c), with A the groove's half width at its top.
      const halfWidth = 2.5 * height + clearance * (1 + Math.SQRT2);
      expect(bounds.max).toBeCloseTo(2 * (Math.sqrt((inradius - 1.2) ** 2 - halfWidth ** 2) - clearance), 9);
    }
  });

  it('couples the height and the length: a longer tongue allows a lower maximum height', () => {
    const maxHeight = (lengthPercent: number) => dovetailBounds(cylinder(2), 50, dovetail({ lengthPercent }), 'height').max;
    expect(maxHeight(90)).toBeLessThan(maxHeight(50));
    // At L = 40 mm the groove's top corner limits h: 2,5·h + c·(1 + √2) = √((R − w)² − (L/2 + c)²).
    const corner = Math.sqrt((inradius - 1.2) ** 2 - 20.2 ** 2) - 0.2 * (1 + Math.SQRT2);
    expect(maxHeight(50)).toBeCloseTo(corner / 2.5, 9);
    expect(dovetailBounds(cylinder(2), 50, dovetail(), 'height').min).toBeCloseTo(1.2, 9);
  });

  it('keeps the groove’s top under 1,2 mm of the upper part, and the undercut by the clearance', () => {
    // A flat cylinder, h/r = 0,5: H = 20 mm, 2 mm above a cut at 90 %, so h + c ≤ 0,8 mm: no tongue fits.
    const bounds = dovetailBounds(cylinder(0.5), 90, dovetail(), 'height');
    expect(hasFeasibleValues(bounds)).toBe(false);
    // The clearance's window is 0,1–0,4 mm; h − c·√2 ≥ 0,4 mm narrows it for a 0,9 mm tongue at M = 80 mm.
    const clearance = dovetailBounds(cylinder(2), 50, dovetail({ sizeFactor: 0.6 }), 'clearance');
    expect(clearance.min).toBe(DOVETAIL_CLEARANCE_LIMITS.min);
    expect(clearance.max).toBeCloseTo(DOVETAIL_CLEARANCE_LIMITS.max, 9);
  });
});

/** The checks of a combination at a dimension, in millimetres. */
type Probe<Key extends string> = (key: Key, value: number) => readonly { valueMm: number; minimumMm: number }[];

const roundProbe =
  (section: CylinderSection, dimensions: RoundConnectorDimensions): Probe<RoundConnectorParameter> =>
  (key, value) => {
    const clearance = { ...dimensions.clearance };
    if (key === 'lowerClearance') clearance.lower = value;
    if (key === 'upperClearance') clearance.upper = value;
    const changed = key === 'diameter' || key === 'insertion' || key === 'spacing' ? { [key]: value } : { clearance };
    return roundConnectorChecks(section, { ...dimensions, ...changed });
  };

const dovetailProbe =
  (section: CylinderSection, dimensions: DovetailDimensions): Probe<DovetailParameter> =>
  (key, value) =>
    dovetailChecks(section, { ...dimensions, [key]: value });

/**
 * Every value between the bounds passes every check, and values just outside fail, unless the bound is a calibration
 * window's end; the bounds themselves pass without the roundoff tolerance.
 */
function expectTightBounds<Key extends string>(
  bounds: ParameterBounds,
  probe: Probe<Key>,
  key: Key,
  window?: { min: number; max: number },
) {
  expect(hasFeasibleValues(bounds)).toBe(true);
  for (const fraction of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
    const value = bounds.min + fraction * (bounds.max - bounds.min);
    expect(probe(key, value).every(satisfies)).toBe(true);
  }
  for (const end of [bounds.min, bounds.max]) {
    expect(probe(key, end).every(({ valueMm, minimumMm }) => valueMm >= minimumMm)).toBe(true);
  }
  const step = 1e-6;
  if (window === undefined || bounds.min > window.min) expect(probe(key, bounds.min - step).every(satisfies)).toBe(false);
  if (window === undefined || bounds.max < window.max) expect(probe(key, bounds.max + step).every(satisfies)).toBe(false);
}

const roundCases: readonly (readonly [string, CylinderShape, number, RoundConnector])[] = [
  ['one plug, right', cylinder(2), 50, plug(1)],
  ['a pair of plugs, slim right', cylinder(8), 50, plug(2)],
  ['one dowel, oblique', cylinder(2, 1), 30, dowel(1)],
  ['a pair of dowels, oblique', cylinder(2, 1), 70, dowel(2, { spacingPercent: 30, upperClearanceMm: 0.3 })],
  ['a pair of plugs, the flattest oblique', cylinder(0.5, 1.866), 50, plug(2, { spacingPercent: 40, depthFactor: 0.75 })],
  ['a pair of dowels, tall oblique', cylinder(4, 4), 50, dowel(2, { spacingPercent: 40 })],
];

describe.each(roundCases)('bounds of %s', (_, shape, position, connector) => {
  const section = cylinderSection(shape, scale, position);
  const dimensions = roundConnectorDimensions(connector, M, section.radius);
  const { issues, parameters, unattributed } = roundConnectorFeasibility(shape, scale, position, connector);

  it('start from a valid combination that the plan accepts', () => {
    expect(issues).toEqual([]);
    expect(unattributed).toEqual([]);
    expect(planRoundConnectors(shape, scale, position, connector).issues).toEqual([]);
  });

  it('are tight: values within pass, values just outside fail', () => {
    for (const [key, { bounds }] of Object.entries(parameters) as [RoundConnectorParameter, { bounds: ParameterBounds }][]) {
      const window = key.endsWith('Clearance') ? DIAMETRAL_CLEARANCE_LIMITS : undefined;
      expectTightBounds(bounds, roundProbe(section, dimensions), key, window);
    }
  });

  it('rest on constraints that are monotone in each dimension', () => {
    for (const [key, { bounds }] of Object.entries(parameters) as [RoundConnectorParameter, { bounds: ParameterBounds }][]) {
      const top = key.endsWith('Clearance') ? 0.4 : 2 * Math.max(bounds.max, 1);
      expectMonotone((value) => roundProbe(section, dimensions)(key, value), 0, top);
    }
  });
});

const dovetailCases: readonly (readonly [string, CylinderShape, number, DovetailConnector])[] = [
  ['a right cylinder', cylinder(2), 50, dovetail()],
  ['an oblique cylinder at 30 %', cylinder(2, 1), 30, dovetail({ lengthPercent: 30 })],
  ['a tall oblique cylinder', cylinder(4, 4), 50, dovetail({ sizeFactor: 0.75 })],
  ['the flattest oblique cylinder', cylinder(0.5, 1.866), 50, dovetail({ lengthPercent: 30 })],
];

describe.each(dovetailCases)('dovetail bounds on %s', (_, shape, position, connector) => {
  const section = cylinderSection(shape, scale, position);
  const dimensions = dovetailDimensions(connector, M, section.radius);
  const { issues, parameters } = dovetailFeasibility(shape, scale, position, connector);

  it('start from a valid combination and are tight', () => {
    expect(issues).toEqual([]);
    for (const [key, { bounds }] of Object.entries(parameters) as [DovetailParameter, { bounds: ParameterBounds }][]) {
      expectTightBounds(
        bounds,
        dovetailProbe(section, dimensions),
        key,
        key === 'clearance' ? DOVETAIL_CLEARANCE_LIMITS : undefined,
      );
    }
  });

  it('rest on constraints that are monotone in each dimension', () => {
    expectMonotone((value) => dovetailProbe(section, dimensions)('height', value), 0.6, 2 * section.radius);
    expectMonotone((value) => dovetailProbe(section, dimensions)('length', value), 0, 2 * section.radius);
    expectMonotone((value) => dovetailProbe(section, dimensions)('clearance', value), 0.1, 0.4);
  });

  it('match the 3D checks at their ends: the extreme connectors build and pass verification', () => {
    const { height, length } = parameters;
    const inward = (bounds: ParameterBounds, end: 'min' | 'max') => bounds[end] + (end === 'min' ? 1e-6 : -1e-6);
    for (const [changed] of [
      [{ sizeFactor: inward(height.bounds, 'max') / (0.025 * M) }],
      [{ lengthPercent: (inward(length.bounds, 'max') / (2 * section.radius)) * 100 }],
      [{ lengthPercent: (inward(length.bounds, 'min') / (2 * section.radius)) * 100 }],
    ]) {
      const extreme = { ...connector, ...changed };
      expect(() =>
        generateModel(kernel, {
          shape,
          scale,
          section: { type: 'parallel-to-bases', positionPercent: position, connector: extreme },
        }),
      ).not.toThrow();
    }
  });
});

describe('round connectors at their bounds match the 3D checks', () => {
  it.each([
    ['the widest single plug in an oblique cylinder', cylinder(2, 1), 30, plug(1), 'diameter'],
    ['the longest dowel in an oblique cylinder', cylinder(2, 1), 30, dowel(1), 'insertion'],
    ['a pair of plugs at its outermost spacing in a tall oblique cylinder', cylinder(4, 4), 50, plug(2), 'spacing'],
    ['a pair of dowels at its innermost spacing', cylinder(2), 50, dowel(2), 'spacing'],
  ] as const)('%s builds and passes verification', (_, shape, position, connector, key) => {
    const bounds = roundBounds(shape, position, connector, key);
    const { radius } = cylinderSection(shape, scale, position);
    const end = key === 'spacing' && connector.type === 'dowel' ? bounds.min + 1e-6 : bounds.max - 1e-6;
    const changed =
      key === 'diameter'
        ? { diameterFactor: diameterFactor(end) }
        : key === 'insertion'
          ? { depthFactor: depthFactor(end) }
          : { spacingPercent: (end / radius) * 100 };
    const extreme = { ...connector, ...changed } as RoundConnector;
    expect(planRoundConnectors(shape, scale, position, extreme).issues).toEqual([]);
    expect(() =>
      generateModel(kernel, {
        shape,
        scale,
        section: { type: 'parallel-to-bases', positionPercent: position, connector: extreme },
      }),
    ).not.toThrow();
  });
});

describe('the solver', () => {
  const measure = (value: number) => [{ valueMm: 1 - (value - 5) ** 2, minimumMm: 0 }];
  const checks = ({ value }: { value: number }) => measure(value);
  const solved = (value: number, envelope = { min: 0, max: 10 }) =>
    connectorFeasibility(checks, { value }, [{ key: 'value', envelope, value, with: (_, next) => ({ value: next }) }]).parameters
      .value;

  it('finds an interval that reaches neither end of the search, for a concave constraint', () => {
    const { bounds, issues } = solved(5);
    expect(bounds.min).toBeCloseTo(4, 9);
    expect(bounds.max).toBeCloseTo(6, 9);
    expect(bounds.blocked).toBe(false);
    expect(issues).toEqual([]);
    expect(solved(8).issues).toHaveLength(1);
  });

  it('follows the interval to an end of the search, and reports none when the best value fails', () => {
    expect(solved(5, { min: 4.5, max: 10 }).bounds).toMatchObject({ min: 4.5, blocked: false });
    expect(solved(5, { min: 0, max: 5.5 }).bounds).toMatchObject({ max: 5.5, blocked: false });
    expect(solved(8, { min: 7, max: 10 }).bounds.blocked).toBe(true);
  });
});

describe('failing constraints', () => {
  it('are attributed to the dimensions that repair them, or to none when only the cut or the size can', () => {
    // At 10 % of a flat cylinder at M = 40 mm, 1 mm remains under a plug: only moving the cut or a larger size helps.
    const flat = roundConnectorFeasibility(
      cylinder(0.5),
      { longestDimensionMm: 40 },
      10,
      plug(1, { diameterFactor: 1.4, depthFactor: 1.5 }),
    );
    expect(flat.issues.map(({ code }) => code)).toEqual(['base-thin']);
    expect(flat.unattributed.map(({ code }) => code)).toEqual(['base-thin']);
    // A pair keyed by too large a clearance: both the diameter and the clearance repair it, the spacing does not.
    const loose = roundConnectorFeasibility(
      cylinder(2),
      scale,
      50,
      plug(2, { diameterFactor: diameterFactor(4), holeClearanceMm: 0.4 }),
    );
    expect(loose.parameters.diameter.issues.map(({ code }) => code)).toEqual(['keying-lost']);
    expect(loose.parameters.upperClearance.issues.map(({ code }) => code)).toEqual(['keying-lost']);
    expect(loose.parameters.spacing.issues).toEqual([]);
    expect(loose.parameters.upperClearance.bounds.max).toBeCloseTo(0.3, 9);
  });

  it('leave an empty interval when a lower and an upper limit conflict, and recover when the cut moves', () => {
    // H = 20 mm cut at 15 %: 3 mm in the lower part allow e ≤ 1,5 mm, the engagement needs e ≥ 3,1 mm.
    const near = roundBounds(cylinder(0.5), 15, dowel(1), 'insertion');
    expect(hasFeasibleValues(near)).toBe(false);
    expect(near.min).toBeCloseTo(3.1, 9);
    expect(near.max).toBeCloseTo(1.5, 9);
    expect(hasFeasibleValues(roundBounds(cylinder(0.5), 50, dowel(1), 'insertion'))).toBe(true);
  });
});

/** Each check's value, sampled along the dimension, never changes direction. */
function expectMonotone(probe: (value: number) => readonly { valueMm: number }[], from: number, to: number) {
  const samples = Array.from({ length: 401 }, (_, index) => probe(from + ((to - from) * index) / 400));
  const count = samples[0]?.length ?? 0;
  for (let check = 0; check < count; check += 1) {
    const values = samples.map((sample) => sample[check]?.valueMm ?? Number.NaN);
    const steps = values.slice(1).map((value, index) => value - (values[index] as number));
    const rises = steps.some((step) => step > 1e-12);
    const falls = steps.some((step) => step < -1e-12);
    expect(rises && falls).toBe(false);
  }
}
