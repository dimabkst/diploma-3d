import { dovetailProfileMm, planDovetail, planRoundConnectors, roundDimensionsMm } from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import {
  connectorUnits,
  cylinderConnectorScale,
  formatPhysical,
  physicalRange,
  shownText,
  storedText,
  storedValue,
} from './connectorScale.ts';
import { scaledConnectorSettings } from './parameters.ts';

const scaleOf = (printSizeMm: number, cylinderHeightRatio = 2, cylinderOffsetRatio = 0) => {
  const scale = cylinderConnectorScale({ printSizeMm, cylinderHeightRatio, cylinderOffsetRatio });
  if (scale === undefined) throw new Error('Expected a scale');
  return scale;
};

describe('connector settings in millimetres', () => {
  it('takes the radius as the engine builds the cylinder, and needs every value for it', () => {
    expect(scaleOf(80)).toEqual({ longestDimensionMm: 80, radiusMm: 40 });
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
    expect(storedValue(8, dowel.cylinderRoundDepth, scaledConnectorSettings.cylinderRoundDepth.limits)).toBe(1);
    expect(storedValue(4, plug.cylinderRoundDepth, scaledConnectorSettings.cylinderRoundDepth.limits)).toBe(1);
  });

  it('scales with M at fixed settings, and keeps the length and spacing proportional to the radius', () => {
    const [small, large] = [scaleOf(60), scaleOf(120)].map((scale) => connectorUnits(scale, 'dowel'));
    for (const key of Object.keys(scaledConnectorSettings) as (keyof typeof scaledConnectorSettings)[]) {
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
        for (const [key, { limits }] of Object.entries(scaledConnectorSettings) as [
          keyof typeof scaledConnectorSettings,
          (typeof scaledConnectorSettings)[keyof typeof scaledConnectorSettings],
        ][]) {
          const unit = units[key];
          for (const fraction of [0, 0.13, 0.5, 0.77, 1]) {
            const stored = limits.min + fraction * (limits.max - limits.min);
            // Shown, typed back and shown again: the same text, and a value within a thousandth of a millimetre.
            const shown = formatPhysical(stored, unit);
            const back = storedText(shown, unit, limits);
            expect(shownText(back, unit)).toBe(shown);
            expect(Math.abs(Number(back.replace(',', '.')) - stored) * unit).toBeLessThanOrEqual(5e-4 + 1e-9);
          }
          // Every slider position, the rounded ends included, is an accepted value.
          const range = physicalRange(limits, unit, 0.25);
          for (const end of [range.min, range.max]) {
            const value = storedValue(end, unit, limits);
            expect(value).toBeGreaterThanOrEqual(limits.min);
            expect(value).toBeLessThanOrEqual(limits.max);
          }
          expect(range.max - range.min).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stores short decimals and the exact limits, and keeps drafts that are not numbers as typed', () => {
    const { limits } = scaledConnectorSettings.cylinderDovetailSize;
    // M = 60 mm: 1,5 mm per unit. 3,3 mm is 2,2, not 2,1999999999999997; 2,25 mm is exactly the limit 1,5.
    expect(storedValue(3.3, 1.5, limits)).toBe(2.2);
    expect(storedText('2,25', 1.5, limits)).toBe('1,5');
    expect(storedText('1,125', 1.5, limits)).toBe('0,75');
    for (const draft of ['', 'два', '-']) expect(storedText(draft, 1.5, limits)).toBe(draft);
    expect(shownText('два', 1.5)).toBe('два');
    expect(shownText('1,1', 2)).toBe('2,2');
  });
});
