import { dovetailProfileMm, planDovetail, planRoundConnectors, roundDimensionsMm } from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import {
  connectorUnits,
  cylinderConnectorScale,
  formatPhysical,
  percentRange,
  physicalRange,
  shownText,
  storedText,
  storedValue,
} from './connectorScale.ts';
import { scaledConnectorDefaults } from './parameters.ts';

const scaledKeys = Object.keys(scaledConnectorDefaults) as (keyof typeof scaledConnectorDefaults)[];

const scaleOf = (printSizeMm: number, cylinderHeightRatio = 2, cylinderOffsetRatio = 0) => {
  const scale = cylinderConnectorScale({ printSizeMm, cylinderHeightRatio, cylinderOffsetRatio });
  if (scale === undefined) throw new Error('Expected a scale');
  return scale;
};

describe('connector settings in millimetres', () => {
  it('takes the radius as the engine builds the cylinder, and needs every value for it', () => {
    expect(scaleOf(80)).toEqual({ longestDimensionMm: 80, radiusMm: 40, heightMm: 80 });
    expect(scaleOf(80, 8).radiusMm).toBeCloseTo(10, 12);
    expect(scaleOf(80, 2, 1).radiusMm).toBeCloseTo(
      roundDimensionsMm({ kind: 'cylinder', heightRatio: 2, offsetRatio: 1 }, { longestDimensionMm: 80 }).radius,
      12,
    );
    expect(cylinderConnectorScale({ printSizeMm: 80, cylinderHeightRatio: 2 })).toBeUndefined();
  });

  it('follows the engine’s formulas: h = 0,025·M·k, L = 2r·p, d = 0,0625·M·k, e = 0,05·M·k, a dowel 2e, s = r·p', () => {
    const scale = scaleOf(80);
    const plug = connectorUnits(scale, 'plug');
    const dowel = connectorUnits(scale, 'dowel');
    expect(plug).toEqual({
      cylinderDovetailSize: 2,
      cylinderDovetailLengthPercent: 0.8,
      cylinderRoundDiameter: 5,
      cylinderRoundDepth: 4,
      cylinderRoundSpacingPercent: 0.4,
    });
    expect(dowel.cylinderRoundDepth).toBe(8);
    // The same stored settings give the engine's dimensions.
    const shape = { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 } as const;
    const tongue = planDovetail(shape, { longestDimensionMm: 80 }, 50, {
      type: 'dovetail',
      sizeFactor: 1.25,
      lengthPercent: 40,
      clearanceMm: 0.2,
    });
    expect(tongue.height).toBeCloseTo(1.25 * plug.cylinderDovetailSize, 12);
    expect(tongue.length).toBeCloseTo(40 * plug.cylinderDovetailLengthPercent, 12);
    expect(dovetailProfileMm(1, 80).height).toBe(plug.cylinderDovetailSize);
    const pins = planRoundConnectors(shape, { longestDimensionMm: 80 }, 50, {
      type: 'dowel',
      count: 2,
      spacingPercent: 45,
      diameterFactor: 1.5,
      depthFactor: 0.75,
      lowerClearanceMm: 0.1,
      upperClearanceMm: 0.2,
    });
    expect(pins.sites[0]?.pinDiameter).toBeCloseTo(1.5 * plug.cylinderRoundDiameter, 12);
    expect(pins.sites[0]?.along).toBeCloseTo(45 * plug.cylinderRoundSpacingPercent, 12);
    // The dowel field shows the whole length; each part takes half of it.
    expect(0.75 * dowel.cylinderRoundDepth).toBeCloseTo(2 * pins.insertion, 12);
    expect(storedValue(8, dowel.cylinderRoundDepth)).toBe(1);
    expect(storedValue(4, plug.cylinderRoundDepth)).toBe(1);
  });

  it('takes a vertical section’s length and spacing from its height', () => {
    // A flat cylinder, r = 40 mm and H = 20 mm: 50 % is 10 mm along the height, not 40 mm along a diameter.
    const flat = scaleOf(80, 0.5);
    const parallel = connectorUnits(flat, 'plug');
    const vertical = connectorUnits(flat, 'plug', 'vertical');
    expect(parallel.cylinderDovetailLengthPercent).toBe(0.8);
    expect(parallel.cylinderRoundSpacingPercent).toBe(0.4);
    expect(vertical.cylinderDovetailLengthPercent).toBe(0.2);
    expect(vertical.cylinderRoundSpacingPercent).toBe(0.1);
    // The size scales every one with the model.
    const [small, large] = [scaleOf(60), scaleOf(120)].map((scale) => connectorUnits(scale, 'plug', 'vertical'));
    for (const key of scaledKeys) expect(large?.[key]).toBeCloseTo(2 * (small?.[key] ?? 0), 12);
    // The same settings give the engine's dimensions.
    const shape = { kind: 'cylinder', heightRatio: 0.5, offsetRatio: 0 } as const;
    const pins = planRoundConnectors(
      shape,
      { longestDimensionMm: 80 },
      { offsetPercent: 25 },
      { type: 'plug', count: 2, spacingPercent: 45, diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.2 },
    );
    expect(pins.sites[0]?.along).toBeCloseTo(45 * vertical.cylinderRoundSpacingPercent, 12);
    const tongue = planDovetail(
      shape,
      { longestDimensionMm: 80 },
      { offsetPercent: 0 },
      { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 },
    );
    expect(tongue.length).toBeCloseTo(50 * vertical.cylinderDovetailLengthPercent, 12);
  });

  it('scales with M at fixed settings, and keeps the length and spacing proportional to the radius', () => {
    const [small, large] = [scaleOf(60), scaleOf(120)].map((scale) => connectorUnits(scale, 'dowel'));
    for (const key of scaledKeys) {
      expect(large?.[key]).toBeCloseTo(2 * (small?.[key] ?? 0), 12);
    }
    // Only h/r changes: M-relative sizes stay, section-relative ones follow the radius, 40 mm or 10 mm.
    const [wide, slim] = [scaleOf(80, 2), scaleOf(80, 8)].map((scale) => connectorUnits(scale, 'plug'));
    expect(slim?.cylinderRoundDiameter).toBe(wide?.cylinderRoundDiameter);
    expect(slim?.cylinderDovetailSize).toBe(wide?.cylinderDovetailSize);
    expect((slim?.cylinderDovetailLengthPercent ?? 0) * 4).toBeCloseTo(wide?.cylinderDovetailLengthPercent ?? 0, 12);
    expect((slim?.cylinderRoundSpacingPercent ?? 0) * 4).toBeCloseTo(wide?.cylinderRoundSpacingPercent ?? 0, 12);
  });

  it('round-trips typed millimetres to the stored settings and back without drifting, at several scales', () => {
    for (const scale of [scaleOf(60), scaleOf(80), scaleOf(120), scaleOf(80, 2, 1), scaleOf(37.5, 0.5, 1.5)]) {
      for (const type of ['plug', 'dowel'] as const) {
        const units = connectorUnits(scale, type);
        for (const key of scaledKeys) {
          const unit = units[key];
          // Settings well beyond the former slider limits round-trip as well.
          for (const stored of [0.3, 0.75, 1, 1.37, 2.5, 7.75, 45, 87.5]) {
            // Shown, typed back and shown again: the same text, and a value within a thousandth of a millimetre.
            const shown = formatPhysical(stored, unit);
            const back = storedText(shown, unit);
            expect(shownText(back, unit)).toBe(shown);
            expect(Math.abs(Number(back.replace(',', '.')) - stored) * unit).toBeLessThanOrEqual(5e-4 + 1e-9);
          }
        }
      }
    }
  });

  it('rounds a feasible interval inwards to thousandths, keeps a narrower one exact and never reverses it', () => {
    expect(physicalRange({ min: 2.8, max: 38.5 }, 0.25)).toEqual({ min: 2.8, max: 38.5, increment: 0.25 });
    // The binary roundoff of an exact bound does not move it by a thousandth.
    expect(physicalRange({ min: 2.8000000000000003, max: 38.49999999999999 }, 0.25)).toEqual({
      min: 2.8,
      max: 38.5,
      increment: 0.25,
    });
    expect(physicalRange({ min: 1.2344, max: 5.6789 }, 0.25)).toEqual({ min: 1.235, max: 5.678, increment: 0.25 });
    // Narrower than a thousandth and between two of them: the exact ends, not a reversed pair.
    expect(physicalRange({ min: 2.0003, max: 2.0007 }, 0.25)).toEqual({ min: 2.0003, max: 2.0007, increment: 0.25 });
    expect(physicalRange({ min: 3, max: 3 }, 0.25)).toEqual({ min: 3, max: 3, increment: 0.25 });
    // A range that only zero satisfies within roundoff reads 0, not -0.
    expect(Object.is(physicalRange({ min: 0, max: 2.2e-16 }, 0.05)?.min, 0)).toBe(true);
    expect(physicalRange(null, 0.25)).toBeUndefined();
    expect(physicalRange({ min: 3.1, max: 1.5 }, 0.25)).toBeUndefined();
  });

  it('rounds a plane’s percentage bounds inwards to hundredths, symmetrically, and keeps round ones as they are', () => {
    expect(percentRange({ min: -80, max: 80 }, 5)).toEqual({ min: -80, max: 80, increment: 5 });
    // The binary roundoff of 0,8·r does not move the bound.
    expect(percentRange({ min: -80.00000000000001, max: 79.99999999999999 }, 5)).toEqual({ min: -80, max: 80, increment: 5 });
    expect(percentRange({ min: -63.9639, max: 63.9639 }, 5)).toEqual({ min: -63.96, max: 63.96, increment: 5 });
    // Only the axial cut remains: 0, not -0, which would read as a sign.
    expect(Object.is(percentRange({ min: -0, max: 0 }, 5).min, 0)).toBe(true);
  });

  it('stores short decimals, and keeps drafts that are not numbers as typed', () => {
    // M = 60 mm: 1,5 mm per unit. 3,3 mm is 2,2, not 2,1999999999999997.
    expect(storedValue(3.3, 1.5)).toBe(2.2);
    expect(storedText('2,25', 1.5)).toBe('1,5');
    expect(storedText('1,125', 1.5)).toBe('0,75');
    for (const draft of ['', 'два', '-']) expect(storedText(draft, 1.5)).toBe(draft);
    expect(shownText('два', 1.5)).toBe('два');
    expect(shownText('1,1', 2)).toBe('2,2');
  });
});

describe('connector settings on an oblique plane', () => {
  const plane = {
    cylinderObliquePositionPercent: 50,
    cylinderObliqueInclinationDeg: 30,
    cylinderObliqueDirectionDeg: 0,
  };
  const withPlane = (printSizeMm: number, previous?: Parameters<typeof cylinderConnectorScale>[1]) =>
    cylinderConnectorScale({ printSizeMm, cylinderHeightRatio: 2, cylinderOffsetRatio: 0, ...plane }, previous);

  it('measures lengths on the actual section’s span, which scales with M', () => {
    const scale = withPlane(80);
    if (scale === undefined) throw new Error('Expected a scale');
    expect(scale.obliqueSpanMm).toBeCloseTo(160 / Math.sqrt(3), 1);
    const units = connectorUnits(scale, 'plug', 'oblique');
    expect(units.cylinderDovetailLengthPercent).toBeCloseTo((scale.obliqueSpanMm as number) / 100, 12);
    expect(units.cylinderRoundSpacingPercent).toBeCloseTo((scale.obliqueSpanMm as number) / 200, 12);
    expect(units.cylinderRoundDiameter).toBeCloseTo(5, 12);
    expect(withPlane(160)?.obliqueSpanMm).toBeCloseTo(2 * (scale.obliqueSpanMm as number), 1);
  });

  it('keeps the last span while the plane is being corrected, and ignores it for the other cuts', () => {
    const last = withPlane(80);
    const scale = cylinderConnectorScale({ printSizeMm: 80, cylinderHeightRatio: 2, cylinderOffsetRatio: 0 }, last);
    expect(scale?.obliqueSpanMm).toBe(last?.obliqueSpanMm);
    const { cylinderObliquePositionPercent: _, ...withoutPosition } = plane;
    expect(
      cylinderConnectorScale({ printSizeMm: 80, cylinderHeightRatio: 2, cylinderOffsetRatio: 0, ...withoutPosition }, last)
        ?.obliqueSpanMm,
    ).toBe(last?.obliqueSpanMm);
    const units = connectorUnits(scale as NonNullable<typeof scale>, 'plug');
    expect(units.cylinderDovetailLengthPercent).toBeCloseTo(0.8, 12);
    expect(connectorUnits(scale as NonNullable<typeof scale>, 'plug', 'vertical').cylinderDovetailLengthPercent).toBeCloseTo(
      0.8,
      12,
    );
  });
});
