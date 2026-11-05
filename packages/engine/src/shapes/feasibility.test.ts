import {
  type ModelSpecInput,
  maxTiltDisplacement,
  RATIO_LIMITS,
  ROUND_HEIGHT_LIMITS,
  type Shape,
  TILT_OFFSET_LIMITS,
} from '@diploma-3d/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { checkNumericalFeasibility, MAX_RELATIVE_ROUNDING } from './feasibility.ts';
import { circularSegments, MAX_CIRCLE_DEVIATION_MM, roundDimensionsMm } from './round.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

const at = (shape: Shape, longestDimensionMm = 80): ModelSpecInput => ({ shape, scale: { longestDimensionMm } });

function solidOf(spec: ModelSpecInput) {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  expect(findMeshDefects(solid.mesh)).toEqual([]);
  return solid;
}

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);
/** The inscribed regular N-gon of radius r, which the exported circle is. */
const polygonArea = (segments: number, r: number) => (segments * r ** 2 * Math.sin((2 * Math.PI) / segments)) / 2;
const SQRT3 = Math.sqrt(3);

describe('solids at the limits of the parameter domain', () => {
  it('builds a pyramid with h/a = 0,25: 80 × 80 × 20 mm and V = a²h/3', () => {
    const solid = solidOf(
      at({ kind: 'pyramid', baseType: 'regular', baseSides: 4, heightRatio: 0.25, apexXRatio: 0, apexYRatio: 0 }),
    );
    expect(solid.measurements.size.map((value) => Number(value.toFixed(3)))).toEqual([80, 80, 20]);
    expect(relativeError(solid.measurements.volume, (80 ** 2 * 20) / 3)).toBeLessThan(1e-6);
  });

  it('builds a cylinder with h/r = 4,8 off the slider steps: r = 80/4,8 mm and h = 80 mm', () => {
    const r = 80 / 4.8;
    const solid = solidOf(at({ kind: 'cylinder', heightRatio: 4.8, offsetRatio: 0 }));
    expect(solid.measurements.size[2]).toBeCloseTo(80, 4);
    expect(solid.measurements.size[0]).toBeCloseTo(2 * r, 4);
    expect(relativeError(solid.measurements.volume, polygonArea(circularSegments(r), r) * 80)).toBeLessThan(1e-6);
  });

  it.each([
    [ROUND_HEIGHT_LIMITS.min, 40, 20],
    [ROUND_HEIGHT_LIMITS.max, 10, 80],
  ])('builds the cone with h/r = %s: r = %s mm, h = %s mm', (heightRatio, r, h) => {
    const solid = solidOf(at({ kind: 'cone', heightRatio, offsetRatio: 0 }));
    expect(solid.measurements.size[2]).toBeCloseTo(h, 4);
    expect(relativeError(solid.measurements.volume, (polygonArea(circularSegments(r), r) * h) / 3)).toBeLessThan(1e-6);
  });

  it('builds the cuboid with b/a = 0,25 and c/a = 4: 20 × 5 × 80 mm', () => {
    const { min, max } = RATIO_LIMITS;
    const solid = solidOf(at({ kind: 'cuboid', widthRatio: min, heightRatio: max }));
    expect(solid.measurements.size.map((value) => Number(value.toFixed(4)))).toEqual([20, 5, 80]);
    expect(relativeError(solid.measurements.volume, 20 * 5 * 80)).toBeLessThan(1e-6);
  });

  it('keeps every circle within the accuracy target over the whole range of h/r and d/r', () => {
    for (const longestDimensionMm of [1, 80, 1000]) {
      for (const heightRatio of [ROUND_HEIGHT_LIMITS.min, 1, ROUND_HEIGHT_LIMITS.max]) {
        for (const offsetRatio of [0, Math.min(4, maxTiltDisplacement(heightRatio))]) {
          for (const kind of ['cylinder', 'cone'] as const) {
            const { radius } = roundDimensionsMm({ kind, heightRatio, offsetRatio }, { longestDimensionMm });
            // The circle spans 2r of the box, so r ≤ L/2 whatever the proportions.
            expect(radius).toBeLessThanOrEqual(longestDimensionMm / 2);
            const segments = circularSegments(radius);
            expect(radius * (1 - Math.cos(Math.PI / segments))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
          }
        }
      }
    }
  });

  it('builds the flattest allowed leans: β = 15° at h/a = 0,25 and the corner (−4, 4) at h/a = 4', () => {
    const flattest = maxTiltDisplacement(0.25);
    const shapes: Shape[] = [
      { kind: 'prism', baseType: 'regular', baseSides: 4, heightRatio: 0.25, offsetXRatio: flattest, offsetYRatio: 0 },
      {
        kind: 'prism',
        baseType: 'triangle',
        baseSideRatio: RATIO_LIMITS.max,
        baseAngleDeg: 15,
        heightRatio: 0.25,
        offsetXRatio: 0,
        offsetYRatio: -flattest,
      },
      {
        kind: 'pyramid',
        baseType: 'regular',
        baseSides: 4,
        heightRatio: 4,
        apexXRatio: TILT_OFFSET_LIMITS.min,
        apexYRatio: TILT_OFFSET_LIMITS.max,
      },
      { kind: 'cone', heightRatio: ROUND_HEIGHT_LIMITS.min, offsetRatio: maxTiltDisplacement(ROUND_HEIGHT_LIMITS.min) },
    ];
    for (const shape of shapes) {
      // Thousands of times inside the numerical limit: the domain never reaches it.
      expect(checkNumericalFeasibility(shape).relativeRounding).toBeLessThan(MAX_RELATIVE_ROUNDING / 1000);
      expect(solidOf(at(shape)).measurements.volume).toBeGreaterThan(0);
    }
    // A square base a and its copy at D = a/(4 tan 15°) ≈ 0,933a along X: a box of (1 + D)a × a × a/4.
    const a = 80 / (1 + flattest);
    expect(relativeError(solidOf(at(shapes[0] as Shape)).measurements.volume, a ** 3 / 4)).toBeLessThan(1e-6);
  });

  it('refuses a lean beyond the limits, such as h/a = 4 at 30° (X/a = 4√3), before building it', () => {
    const steep = { kind: 'prism', baseSides: 4, heightRatio: 4, offsetXRatio: 4 * SQRT3, offsetYRatio: 0 } as const;
    expect(() => generateModel(kernel, { shape: steep, scale: { longestDimensionMm: 80 } })).toThrow(InvalidModelSpecError);
    const flat = { kind: 'prism', baseSides: 4, heightRatio: 0.25, offsetXRatio: 1, offsetYRatio: 0 } as const;
    expect(() => generateModel(kernel, { shape: flat, scale: { longestDimensionMm: 80 } })).toThrow(InvalidModelSpecError);
  });
});

describe('checkNumericalFeasibility', () => {
  const trianglePrism = (offsetXRatio: number): Shape => ({
    kind: 'prism',
    baseType: 'triangle',
    baseSideRatio: 1,
    baseAngleDeg: 60,
    heightRatio: 1,
    offsetXRatio,
    offsetYRatio: 0,
  });

  it('accepts every solid of fixed proportions', () => {
    for (const kind of ['cube', 'octahedron', 'icosahedron', 'dodecahedron', 'ball'] as const) {
      expect(checkNumericalFeasibility({ kind })).toEqual({ feasible: true, relativeRounding: 0 });
    }
  });

  it('rejects displacements of thousands of base widths and coordinates that overflow', () => {
    // Outside the domain, which the schema refuses first; the engine still guards against them.
    expect(checkNumericalFeasibility(trianglePrism(100)).feasible).toBe(true);
    expect(checkNumericalFeasibility(trianglePrism(1e5)).feasible).toBe(false);
    expect(checkNumericalFeasibility(trianglePrism(1e308)).feasible).toBe(false);
    expect(checkNumericalFeasibility({ kind: 'cone', heightRatio: 1, offsetRatio: 1e308 }).feasible).toBe(false);
  });
});
