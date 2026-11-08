import {
  type CylinderShape,
  DEFAULT_DOVETAIL,
  type DovetailConnector,
  type ModelSpecInput,
  maxTiltDisplacement,
} from '@diploma-3d/schema';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorUnsuitableError, ConnectorVerificationError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, type Vec3, vertexAt, vertexCount } from '../mesh.ts';
import { type GeneratedModel, generateModel } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import {
  DOVETAIL_MINIMUMS_MM,
  dovetailProfileMm,
  grooveCutter,
  isStrictlyConvex,
  offsetConvexPolygon,
  planDovetail,
} from './dovetail.ts';

// Loaded before collection: the joined cases below are built once per case while the suites are defined.
const kernel: GeometryKernel = await loadGeometryKernel();

afterEach(() => {
  vi.restoreAllMocks();
});

const cylinder = (heightRatio: number, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const dovetail = (overrides: Partial<DovetailConnector> = {}): DovetailConnector => ({
  type: 'dovetail',
  ...DEFAULT_DOVETAIL,
  ...overrides,
});
/** A cut at the position, joined by the connector; `null` keeps the faces flat. */
const spec = (
  shape: CylinderShape,
  positionPercent: number,
  connector: DovetailConnector | null = dovetail(),
  longestDimensionMm = 80,
): ModelSpecInput => ({
  shape,
  scale: { longestDimensionMm },
  section: { type: 'parallel-to-bases', positionPercent, ...(connector === null ? {} : { connector }) },
});

/** Below this, an intersection volume in mm³ is roundoff of the float32 meshes, not contact. */
const VOLUME_TOLERANCE = 1e-3;
const SQRT2 = Math.SQRT2;

const along = (vector: Vec3, distance: number): KernelVec3 => [vector[0] * distance, vector[1] * distance, vector[2] * distance];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function manifoldOf(track: Track, mesh: TriangleMesh): Manifold {
  return track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
}

/** The volume of a temporary result, released at once with the scope. */
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** A small cube centred on the point. */
const probe = (track: Track, [x, y, z]: Vec3, side = 0.2) =>
  track(track(kernel.Manifold.cube([side, side, side], true)).translate([x, y, z]));

function partsOf(model: GeneratedModel) {
  const [lower, upper] = model.solids;
  const plan = model.section?.connector;
  if (lower === undefined || upper === undefined || plan?.type !== 'dovetail') throw new Error('Expected two joined parts');
  return { lower, upper, plan };
}

describe('dovetail dimensions', () => {
  it.each([
    [60, 1.5, 4.5, 7.5],
    [80, 2, 6, 10],
    [120, 3, 9, 15],
  ])('at M = %s mm and k = 1: h = %s, b = %s, B = %s mm', (longest, h, b, B) => {
    const profile = dovetailProfileMm(1, longest);
    expect(profile.height).toBeCloseTo(h, 12);
    expect(profile.rootWidth).toBeCloseTo(b, 12);
    expect(profile.headWidth).toBeCloseTo(B, 12);
    // The clearance stays in millimetres whatever the size: the groove's neck is b + 2·√2·c wide.
    const plan = planDovetail(cylinder(2), { longestDimensionMm: longest }, 50, dovetail());
    expect(plan.clearance).toBe(0.2);
    const [[, n1], [v1], [v2, n2]] = [plan.grooveProfile[1], plan.grooveProfile[1], plan.grooveProfile[2]] as [
      [number, number],
      [number, number],
      [number, number],
    ];
    expect(v1 + ((v2 - v1) * (0 - n1)) / (n2 - n1)).toBeCloseTo(b / 2 + 0.2 * SQRT2, 9);
    expect(plan.normalPlay).toBeCloseTo(0.2 * SQRT2, 12);
    expect(plan.undercut).toBeCloseTo(h - 0.2 * SQRT2, 9);
  });

  it('scales with k: k = 1,5 at M = 80 mm gives 3, 9 and 15 mm', () => {
    const profile = dovetailProfileMm(1.5, 80);
    expect([profile.height, profile.rootWidth, profile.headWidth].map((value) => Number(value.toFixed(9)))).toEqual([3, 9, 15]);
  });

  it('widens away from the root at 45° on both sides, a retaining profile', () => {
    const { tongueProfile, height, rootWidth, headWidth } = planDovetail(cylinder(2), { longestDimensionMm: 80 }, 50, dovetail());
    expect(isStrictlyConvex(tongueProfile)).toBe(true);
    expect(headWidth).toBeGreaterThan(rootWidth);
    const [, [v1, n1], [v2, n2]] = tongueProfile as [[number, number], [number, number], [number, number]];
    expect((v2 - v1) / (n2 - n1)).toBeCloseTo(1, 12);
    expect(v2).toBeCloseTo(headWidth / 2, 12);
    expect(n2).toBe(height);
  });
});

describe('offsetConvexPolygon', () => {
  it('moves every edge outwards normal to itself, sloped edges included', () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(offsetConvexPolygon(square, [0.5, 0.5, 0.5, 0.5])).toEqual([
      [-0.5, -0.5],
      [1.5, -0.5],
      [1.5, 1.5],
      [-0.5, 1.5],
    ]);
    // A 45° edge moved by c normal to itself moves by c·√2 horizontally.
    const triangle: [number, number][] = [
      [0, 0],
      [2, 0],
      [0, 2],
    ];
    const [, right, top] = offsetConvexPolygon(triangle, [0, 1, 0]);
    expect(right?.[0]).toBeCloseTo(2 + SQRT2, 12);
    expect(top?.[1]).toBeCloseTo(2 + SQRT2, 12);
    expect(isStrictlyConvex(triangle)).toBe(true);
    expect(
      isStrictlyConvex([
        [0, 0],
        [2, 0],
        [1, 0.2],
        [2, 1],
        [0, 1],
      ]),
    ).toBe(false);
  });
});

describe('planDovetail', () => {
  it('centres the frame on the section and slides perpendicular to the lean; a right cylinder slides along +Y', () => {
    const shape = cylinder(2, 1);
    const { radius: r, height: H, offset: d } = roundDimensionsMm(shape, { longestDimensionMm: 80 });
    const { frame } = planDovetail(shape, { longestDimensionMm: 80 }, 30, dovetail());
    expect(frame.origin[0]).toBeCloseTo(0.3 * d, 12);
    expect(frame.origin[1]).toBeLessThan(VOLUME_TOLERANCE);
    expect(frame.origin[2]).toBeCloseTo(0.3 * H, 12);
    expect(frame.n).toEqual([0, 0, 1]);
    expect(frame.u).toEqual([0, 1, 0]);
    expect(frame.v).toEqual([1, 0, 0]);
    expect(planDovetail(cylinder(2), { longestDimensionMm: 80 }, 50, dovetail()).frame.u).toEqual([0, 1, 0]);
    // The tongue runs along the full diameter through the centre.
    expect(planDovetail(shape, { longestDimensionMm: 80 }, 30, dovetail({ lengthPercent: 40 })).length).toBeCloseTo(0.8 * r, 12);
  });

  it.each([
    [
      'too low and too narrow at M = 40 mm, k = 0,75',
      cylinder(0.5),
      50,
      dovetail({ sizeFactor: 0.75 }),
      40,
      ['tongue-too-low', 'neck-too-narrow'],
    ],
    ['too low at M = 60 mm, k = 0,75', cylinder(2), 50, dovetail({ sizeFactor: 0.75 }), 60, ['tongue-too-low']],
    [
      'without backing over the groove at 90 % of a flat cylinder',
      cylinder(0.5),
      90,
      dovetail({ sizeFactor: 1.5 }),
      40,
      ['backing-thin'],
    ],
    [
      'without material under the tongue at 10 % of a flat cylinder',
      cylinder(0.5),
      10,
      dovetail({ sizeFactor: 1.5 }),
      40,
      ['base-thin'],
    ],
    [
      'with thin walls beside the groove of a slim oblique cylinder',
      cylinder(4, 4),
      10,
      dovetail({ sizeFactor: 1.5, clearanceMm: 0.1, lengthPercent: 25 }),
      40,
      ['groove-wall-thin'],
    ],
    [
      'with thin walls around the closed end where the lean moves the section',
      cylinder(1, 1.866),
      50,
      dovetail({ sizeFactor: 1.5, clearanceMm: 0.4 }),
      40,
      ['groove-wall-thin'],
    ],
    [
      'that leaves the section of a flat oblique cylinder',
      cylinder(0.5, 1.866),
      50,
      dovetail({ sizeFactor: 1.5, clearanceMm: 0.1 }),
      40,
      ['groove-wall-thin', 'backing-thin'],
    ],
    [
      'too short for a straight working length after the lead-in',
      cylinder(2),
      50,
      dovetail({ lengthPercent: 2 }),
      80,
      ['tongue-too-short'],
    ],
    [
      'with the undercut taken by the clearance',
      cylinder(0.5),
      50,
      dovetail({ sizeFactor: 0.75, clearanceMm: 0.4 }),
      48,
      ['tongue-too-low', 'undercut-lost'],
    ],
  ] as const)('rejects a dovetail %s', (_, shape, position, connector, longest, codes) => {
    const { issues } = planDovetail(shape, { longestDimensionMm: longest }, position, connector);
    expect(issues.map((issue) => issue.code)).toEqual(codes);
    for (const issue of issues) expect(issue.valueMm).toBeLessThan(issue.minimumMm);
  });

  it('accepts the default dovetail on the default cylinder and keeps every margin above its minimum', () => {
    expect(planDovetail(cylinder(2), { longestDimensionMm: 80 }, 50, dovetail()).issues).toEqual([]);
    expect(DOVETAIL_MINIMUMS_MM).toEqual({ tongueHeight: 1.2, neckWidth: 2.4, wall: 1.2, undercut: 0.4, straightLength: 1.2 });
  });

  it('refuses an unsuitable dovetail before building anything, without shrinking or moving it', () => {
    const hull = vi.spyOn(kernel.Manifold, 'cylinder');
    expect(() => generateModel(kernel, spec(cylinder(0.5), 90, dovetail(), 80))).toThrow(ConnectorUnsuitableError);
    expect(hull).not.toHaveBeenCalled();
  });
});

// Valid combinations: right and oblique cylinders, flat and tall, at several cut positions.
const joined: readonly (readonly [string, CylinderShape, number, DovetailConnector])[] = [
  ['a right cylinder, h/r = 2, at 30 %', cylinder(2), 30, dovetail()],
  ['a right cylinder, h/r = 2, at 50 %', cylinder(2), 50, dovetail()],
  [
    'a right cylinder, h/r = 2, at 70 %, k = 1,5, 60 %, c = 0,4 mm',
    cylinder(2),
    70,
    dovetail({ sizeFactor: 1.5, lengthPercent: 60, clearanceMm: 0.4 }),
  ],
  ['a flat right cylinder, h/r = 0,5, at 50 %', cylinder(0.5), 50, dovetail()],
  ['an oblique cylinder, h/r = 2, d/r = 1, at 30 %', cylinder(2, 1), 30, dovetail()],
  [
    'an oblique cylinder, h/r = 2, d/r = 1, at 70 %, k = 0,75, 25 %, c = 0,1 mm',
    cylinder(2, 1),
    70,
    dovetail({ sizeFactor: 0.75, lengthPercent: 25, clearanceMm: 0.1 }),
  ],
  ['the flattest oblique cylinder, h/r = 0,5 at β = 15°, at 50 %', cylinder(0.5, maxTiltDisplacement(0.5)), 50, dovetail()],
  ['a tall oblique cylinder, h/r = 4, d/r = 4, at 50 %', cylinder(4, 4), 50, dovetail({ sizeFactor: 0.75 })],
];

describe.each(joined)('a dovetail joining %s', (_, shape, position, connector) => {
  const model = generateModel(kernel, spec(shape, position, connector));
  const smooth = generateModel(kernel, spec(shape, position, null));
  const whole = generateModel(kernel, { shape, scale: { longestDimensionMm: 80 } });
  const { lower, upper, plan } = partsOf(model);
  const { frame, height: h, length: tongueLength, clearance: c } = plan;
  const { radius: r } = roundDimensionsMm(shape, { longestDimensionMm: 80 });

  it('leaves two closed, connected solids with positive volume and the assembled size of the cylinder', () => {
    expect(plan.issues).toEqual([]);
    for (const part of [lower, upper]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      expect(part.measurements.volume).toBeGreaterThan(0);
    }
    withScope((track) => {
      for (const part of [lower, upper]) {
        const pieces = manifoldOf(track, part.mesh).decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      }
    });
    expect(model.size).toEqual(whole.size);
  });

  it('adds the tongue to the lower part with its nominal h, b, B and length, centred on the section', () => {
    const top = frame.origin[2] + h;
    expect(lower.measurements.bounds.max[2]).toBeCloseTo(top, 4);
    const points = Array.from({ length: vertexCount(lower.mesh) }, (_, vertex) => vertexAt(lower.mesh, vertex));
    const head = points.filter(([, , z]) => Math.abs(z - top) < 1e-4);
    const xs = head.map(([x]) => x - frame.origin[0]);
    const ys = head.map(([, y]) => y - frame.origin[1]);
    expect(Math.min(...xs)).toBeCloseTo(-plan.headWidth / 2, 4);
    expect(Math.max(...xs)).toBeCloseTo(plan.headWidth / 2, 4);
    // The head runs from −L/2 to the lead-in chamfer at the entering end.
    expect(Math.min(...ys)).toBeCloseTo(-tongueLength / 2, 4);
    expect(Math.max(...ys)).toBeCloseTo(tongueLength / 2 - plan.leadIn, 4);
    // At the cut, the root is b wide.
    const root = points.filter(
      ([x, , z]) => Math.abs(z - frame.origin[2]) < 1e-4 && Math.abs(Math.abs(x - frame.origin[0]) - plan.rootWidth / 2) < 1e-4,
    );
    expect(root.length).toBeGreaterThanOrEqual(4);
  });

  it('cuts the groove with the clearance c in millimetres at the neck, and marks the new faces for the preview', () => {
    const bottom = frame.origin[2];
    const neck = Array.from({ length: vertexCount(upper.mesh) }, (_, vertex) => vertexAt(upper.mesh, vertex)).filter(
      ([x, , z]) =>
        Math.abs(z - bottom) < 1e-4 && Math.abs(Math.abs(x - frame.origin[0]) - (plan.rootWidth / 2 + c * SQRT2)) < 1e-4,
    );
    expect(neck.length).toBeGreaterThanOrEqual(4);
    for (const part of [lower, upper]) {
      const marked = part.newFaces?.reduce((sum, flag) => sum + flag, 0) ?? 0;
      expect(marked).toBeGreaterThan(0);
      expect(marked).toBeLessThan((part.newFaces?.length ?? 0) / 2);
    }
  });

  it('keeps added material inside the cylinder and removes material only where the groove is', () => {
    withScope((track) => {
      const [lowerM, upperM, wholeM] = [lower, upper, whole.solids[0]].map((solid) =>
        manifoldOf(track, solid?.mesh as TriangleMesh),
      ) as [Manifold, Manifold, Manifold];
      expect(volumeOf(track, lowerM.subtract(wholeM))).toBeLessThan(VOLUME_TOLERANCE);
      expect(volumeOf(track, upperM.subtract(wholeM))).toBeLessThan(VOLUME_TOLERANCE);
      expect(volumeOf(track, lowerM.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
      const removed = track(track(wholeM.subtract(lowerM)).subtract(upperM));
      const cutter = grooveCutter(kernel, track, plan);
      expect(volumeOf(track, removed.subtract(cutter))).toBeLessThan(VOLUME_TOLERANCE);
      // The tongue adds what the lower part gains; the groove removes it and the clearance and entrance channel.
      const [smoothLower, smoothUpper] = smooth.solids.map((solid) => solid.measurements.volume) as [number, number];
      const added = lower.measurements.volume - smoothLower;
      const cut = smoothUpper - upper.measurements.volume;
      expect(added).toBeGreaterThan(0.9 * ((plan.rootWidth + plan.headWidth) / 2) * h * tongueLength * 0.95);
      expect(removed.volume()).toBeGreaterThan(0);
      expect(Math.abs(removed.volume() - (cut - added))).toBeLessThan(1e-2);
    });
  });

  it('slides the lower part along −u relative to the upper one all the way out without touching it', () => {
    withScope((track) => {
      const [lowerM, upperM] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      // The swept groove is what proves the path clear; these positions guard against regressions in between.
      for (let step = 0; step <= 12; step += 1) {
        const moved = track(lowerM.translate(along(frame.u, (-plan.exitDistance * step) / 12)));
        expect(volumeOf(track, moved.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
      }
      // At the end the tongue is past the upper part: the entrance is open to the outside.
      const out = track(lowerM.translate(along(frame.u, -plan.exitDistance)));
      expect(volumeOf(track, out.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
    });
  });

  it('holds the parts together along n once the clearance is taken up, engaged or half slid in', () => {
    withScope((track) => {
      const [lowerM, upperM] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      for (const slide of [0, tongueLength / 4]) {
        const placed = track(lowerM.translate(along(frame.u, -slide)));
        const lift = (distance: number) => volumeOf(track, track(upperM.translate(along(frame.n, distance))).intersect(placed));
        expect(lift(plan.normalPlay - 0.03)).toBeLessThan(VOLUME_TOLERANCE);
        expect(lift(plan.normalPlay + 0.05)).toBeGreaterThan(0.1);
        // Halfway up the head would have to pass the narrower neck: lifting by h only ends past it.
        expect(lift(h / 2)).toBeGreaterThan(1);
      }
    });
  });

  it('stops the tongue at the closed end after the clearance, and leaves the entrance channel open', () => {
    withScope((track) => {
      const [lowerM, upperM] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      const push = (distance: number) => volumeOf(track, track(lowerM.translate(along(frame.u, distance))).intersect(upperM));
      expect(push(c - 0.03)).toBeLessThan(VOLUME_TOLERANCE);
      expect(push(c + 0.05)).toBeGreaterThan(0.01);
      const middle = plus(frame.origin, along(frame.n, h / 2) as Vec3);
      // Behind the stop the upper part is solid; before the tongue, near the side wall, the channel is empty.
      const stop = probe(track, plus(middle, along(frame.u, tongueLength / 2 + c + 0.6) as Vec3));
      expect(volumeOf(track, stop.intersect(upperM))).toBeCloseTo(0.008, 6);
      const channel = probe(track, plus(middle, along(frame.u, -(r - 0.5)) as Vec3));
      expect(volumeOf(track, channel.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
      expect(volumeOf(track, channel.intersect(lowerM))).toBeLessThan(VOLUME_TOLERANCE);
    });
  });
});

describe('the tongue height in millimetres', () => {
  // h = 0,025·M·k depends on the print size and k only. At M = 80 mm the radius ranges from 40 mm (h/r = 0,5, the
  // diameter is the longest side) to 10 mm (h/r = 8, the height is), but the tongue stays 2 mm high.
  it.each([0.5, 2, 4, 8])('is 2 mm above the cut of a right cylinder with h/r = %s at M = 80 mm, k = 1, 50 %%', (heightRatio) => {
    const model = generateModel(kernel, spec(cylinder(heightRatio), 50));
    const plane = model.section?.plane;
    const [lower] = model.solids;
    if (plane === undefined || lower === undefined) throw new Error('Expected a joined section');
    // The assembled lower part in the model's millimetres, before any preview separation or print placement:
    // max over its vertices of (p − p₀)·n, with p₀·n = the plane's offset.
    const heights = Array.from({ length: vertexCount(lower.mesh) }, (_, vertex) => {
      const [x, y, z] = vertexAt(lower.mesh, vertex);
      return x * plane.normal[0] + y * plane.normal[1] + z * plane.normal[2] - plane.offset;
    });
    expect(Math.abs(Math.max(...heights) - 2)).toBeLessThan(1e-4);
  });
});

describe('a dovetail and the smooth cut', () => {
  it('keeps the smooth cut exactly as it was without a connector', () => {
    const smooth = generateModel(kernel, spec(cylinder(2), 50, null));
    expect(smooth.section?.connector).toBeUndefined();
    const [lower, upper] = smooth.solids;
    expect(lower?.measurements.bounds.max[2]).toBeCloseTo(40, 4);
    expect(upper?.measurements.bounds.min[2]).toBeCloseTo(40, 4);
    const whole =
      generateModel(kernel, { shape: cylinder(2), scale: { longestDimensionMm: 80 } }).solids[0]?.measurements.volume ?? 0;
    expect(Math.abs((lower?.measurements.volume ?? 0) + (upper?.measurements.volume ?? 0) - whole) / whole).toBeLessThan(1e-6);
    // Only the cut caps are new faces: they lie in the plane.
    for (const part of [lower, upper]) {
      const mesh = part?.mesh as TriangleMesh;
      part?.newFaces?.forEach((flag, triangle) => {
        if (flag !== 1) return;
        for (const corner of [0, 1, 2]) {
          expect(vertexAt(mesh, mesh.triangles[triangle * 3 + corner] as number)[2]).toBeCloseTo(40, 4);
        }
      });
    }
  });

  it('keeps M: changing the connector changes neither the radius, the height nor the assembled size', () => {
    const plain = generateModel(kernel, spec(cylinder(2, 1), 50, null));
    for (const connector of [dovetail(), dovetail({ sizeFactor: 1.5, lengthPercent: 60, clearanceMm: 0.4 })]) {
      expect(generateModel(kernel, spec(cylinder(2, 1), 50, connector)).bounds).toEqual(plain.bounds);
    }
  });
});

describe('a dovetail releases its Manifold objects', () => {
  const methods = ['add', 'subtract', 'intersect', 'translate', 'transform', 'splitByPlane', 'decompose'] as const;
  const isDeleted = (manifold: Manifold) => (manifold as unknown as { isDeleted(): boolean }).isDeleted();

  function trackAll() {
    const created: Manifold[] = [];
    const record = <T>(result: T): T => {
      if (Array.isArray(result)) created.push(...(result as Manifold[]));
      else created.push(result as Manifold);
      return result;
    };
    const instance = kernel.Manifold.cube(1);
    const prototype = Object.getPrototypeOf(instance) as Manifold;
    instance.delete();
    for (const method of methods) {
      const original = prototype[method] as (...args: unknown[]) => unknown;
      vi.spyOn(prototype, method).mockImplementation(function (this: Manifold, ...args: unknown[]) {
        return record(original.apply(this, args));
      } as never);
    }
    for (const method of ['cylinder', 'hull'] as const) {
      const original = kernel.Manifold[method] as (...args: unknown[]) => unknown;
      vi.spyOn(kernel.Manifold, method).mockImplementation(((...args: unknown[]) =>
        record(original.apply(kernel.Manifold, args))) as never);
    }
    return { created, prototype };
  }

  it('after a successful build and verification', () => {
    const { created } = trackAll();
    generateModel(kernel, spec(cylinder(2, 1), 50));
    expect(created.length).toBeGreaterThan(15);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when a verification fails', () => {
    const { created, prototype } = trackAll();
    vi.spyOn(prototype, 'volume').mockReturnValue(1e9);
    expect(() => generateModel(kernel, spec(cylinder(2), 50))).toThrow(ConnectorVerificationError);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when building the groove throws', () => {
    const { created, prototype } = trackAll();
    vi.spyOn(prototype, 'subtract').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, spec(cylinder(2), 50))).toThrow('out of memory');
    expect(created.length).toBeGreaterThan(3);
    expect(created.every(isDeleted)).toBe(true);
  });
});
