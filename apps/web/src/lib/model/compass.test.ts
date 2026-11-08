import { describe, expect, it } from 'vitest';
import { compassPoint } from './compass.ts';

const degrees = (value: number) => (value * Math.PI) / 180;

describe('compassPoint', () => {
  it('draws the model’s +X to the right and +Y upwards, seen from straight above with the camera at θ = 0', () => {
    const above = { theta: 0, phi: 0 };
    expect(compassPoint(0, 10, above).x).toBeCloseTo(10, 12);
    expect(compassPoint(0, 10, above).y).toBeCloseTo(0, 12);
    expect(compassPoint(90, 10, above).x).toBeCloseTo(0, 12);
    expect(compassPoint(90, 10, above).y).toBeCloseTo(-10, 12);
  });

  it('turns against the camera: at θ = 90° the camera stands on the model’s +X side', () => {
    const fromSide = { theta: degrees(90), phi: 0 };
    // Screen right is the model's +Y there, and into the screen its −X.
    expect(compassPoint(90, 10, fromSide).x).toBeCloseTo(10, 12);
    expect(compassPoint(0, 10, fromSide).y).toBeCloseTo(10, 12);
  });

  it('foreshortens what runs into the screen by the camera’s polar angle, and nothing across it', () => {
    const camera = { theta: 0, phi: degrees(60) };
    expect(compassPoint(0, 10, camera).x).toBeCloseTo(10, 12);
    expect(compassPoint(90, 10, camera).y).toBeCloseTo(-5, 12);
    expect(compassPoint(90, 10, { theta: 0, phi: degrees(90) }).y).toBeCloseTo(0, 12);
  });

  it('gives 0° and 360° the same point', () => {
    const camera = { theta: 0.6, phi: 1.1 };
    expect(compassPoint(360, 10, camera).x).toBeCloseTo(compassPoint(0, 10, camera).x, 12);
    expect(compassPoint(360, 10, camera).y).toBeCloseTo(compassPoint(0, 10, camera).y, 12);
  });
});
