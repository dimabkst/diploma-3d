import type { ModelSpecInput } from '@diploma-3d/schema';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import type { DovetailPlan } from '../connectors/dovetail.ts';
import type { RoundConnectorPlan } from '../connectors/round.ts';
import { GeometryError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { measureMesh } from '../mesh.ts';
import { prismShapeProportions } from '../shapes/prism.ts';
import { prismDimensionsMm } from '../shapes/prism-geometry.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import {
  MODEL_SETTINGS_PATH,
  MODEL_SETTINGS_SCHEMA_VERSION,
  type ModelSettingsDocument,
  type ModelSettingsInput,
  serializeModelSettings,
} from './model-settings.ts';
import { readThreeMf } from './three-mf.test-helper.ts';
import { createThreeMf, SETTINGS_PART, THREE_MF_MODEL_PATH } from './three-mf.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

// biome-ignore lint/suspicious/noExplicitAny: a parsed document is read field by field in these tests.
type Json = any;

/** The settings stored in a 3MF, as a reader that knows only the package would find them. */
function settingsOf(bytes: Uint8Array) {
  const entries = unzipSync(bytes);
  const part = entries[MODEL_SETTINGS_PATH];
  if (part === undefined) throw new Error('No settings part');
  const text = strFromU8(part);
  return { text, json: JSON.parse(text) as Json, entries };
}

const exported = async (spec: ModelSpecInput, input?: ModelSettingsInput) => {
  const artifacts = await buildModelArtifacts(kernel, spec, input);
  return { artifacts, ...settingsOf(artifacts.printFile.bytes) };
};

/** Fields that version 1 had and version 2 leaves out, wherever they were. */
const REMOVED = [
  'exportedObjects',
  'assembledBody',
  'boundingBoxMm',
  'plane',
  'entranceDirection',
  'slideDistanceToRemoveMm',
  'undercutPerSideMm',
  'fieldSuffixes',
  'conventions.fieldSuffixes',
  'dimensionsSource',
  'automaticAdjustments',
  'inclination',
  'resolvedDimensions',
] as const;

const keysDeep = (value: unknown): string[] =>
  value !== null && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : [];

describe('a plain body entered by its offsets', async () => {
  // A longest dimension with more digits than a display would show.
  const scale = { longestDimensionMm: 80.123456789012 };
  const shape = {
    kind: 'prism',
    baseType: 'regular',
    baseSides: 5,
    heightRatio: 1.5,
    offsetXRatio: 0.3,
    offsetYRatio: -0.2,
  } as const;
  const { artifacts, text, json, entries } = await exported({ shape, scale }, { inclinationInput: { enteredAs: 'offsets' } });

  it('stores one readable JSON document of version 2, with its application, kind and units', () => {
    expect(text).toBe(`${JSON.stringify(json, null, 2)}\n`);
    expect(json.schemaVersion).toBe(2);
    expect(MODEL_SETTINGS_SCHEMA_VERSION).toBe(2);
    expect(json.application).toEqual({ name: 'diploma-3d', generator: '@diploma-3d/engine', generatorVersion: '0.0.0' });
    expect(json.export).toEqual({ kind: 'model' });
    expect(json.units).toEqual({ length: 'mm', angle: 'deg' });
    expect(Object.keys(json)).toEqual(['schemaVersion', 'application', 'export', 'units', 'sourceModel']);
  });

  it('keeps the offsets as entered, with no angle reverse-calculated from them', () => {
    expect(json.sourceModel.shape).toEqual({ ...shape, inclinationInput: 'offsets', ratioReference: 'the base side a' });
  });

  it('records the body’s own dimensions at full precision, and nothing the old version had besides', () => {
    const { edge, height, lateralEdge } = prismDimensionsMm(prismShapeProportions(artifacts.model.spec.shape as never), scale);
    expect(json.sourceModel.longestDimensionMm).toBe(80.123456789012);
    expect(json.sourceModel.bodyDimensions).toEqual({ baseSideAMm: edge, heightMm: height, lateralEdgeMm: lateralEdge });
    // No generated name of the model either.
    expect(Object.keys(json.sourceModel)).toEqual(['shape', 'longestDimensionMm', 'bodyDimensions']);
    for (const field of REMOVED) expect(keysDeep(json)).not.toContain(field);
  });

  it('keeps the package as it was: the part, its content type, its must-preserve relationship and the same geometry', () => {
    const { contentTypes, relationships } = readThreeMf(artifacts.printFile.bytes);
    expect(Object.keys(entries).sort()).toEqual(
      [THREE_MF_MODEL_PATH, MODEL_SETTINGS_PATH, '[Content_Types].xml', '_rels/.rels'].sort(),
    );
    expect(MODEL_SETTINGS_PATH).toBe('3D/Other/model-settings.json');
    expect(contentTypes).toContainEqual({ extension: 'json', contentType: 'application/json' });
    expect(relationships.filter(({ type }) => type === SETTINGS_PART.relationship)).toEqual([
      { id: 'rel1', target: '/3D/Other/model-settings.json', type: SETTINGS_PART.relationship },
    ]);
    const bare = unzipSync(createThreeMf(artifacts.model.solids, { title: artifacts.model.name }));
    expect(entries[THREE_MF_MODEL_PATH]).toEqual(bare[THREE_MF_MODEL_PATH]);
    expect(artifacts.printFile.fileName).toBe('prism-5-sided.3mf');
  });
});

describe('a body entered by its angles', () => {
  it('keeps the accepted inclination and a nonzero direction instead of the offsets they gave', async () => {
    const offset = 1.5 / Math.tan((70 * Math.PI) / 180);
    const turn = (135 * Math.PI) / 180;
    const shape = {
      kind: 'prism',
      baseType: 'regular',
      baseSides: 4,
      heightRatio: 1.5,
      offsetXRatio: offset * Math.cos(turn),
      offsetYRatio: offset * Math.sin(turn),
    } as const;
    const { json } = await exported(
      { shape, scale: { longestDimensionMm: 80 } },
      { inclinationInput: { enteredAs: 'angles', inclinationDeg: 70, directionDeg: 135 } },
    );
    expect(json.sourceModel.shape).toEqual({
      kind: 'prism',
      baseType: 'regular',
      baseSides: 4,
      heightRatio: 1.5,
      inclinationInput: 'angles',
      inclinationDeg: 70,
      directionDeg: 135,
      ratioReference: 'the base side a',
    });
  });

  it('gives a round figure the direction of the offset its angle produced, never assuming it', async () => {
    const leaning = async (offsetRatio: number) =>
      (
        await exported(
          { shape: { kind: 'cylinder', heightRatio: 2, offsetRatio }, scale: { longestDimensionMm: 80 } },
          { inclinationInput: { enteredAs: 'angles', inclinationDeg: 60 } },
        )
      ).json.sourceModel.shape;
    expect(await leaning(0.4)).toEqual({
      kind: 'cylinder',
      heightRatio: 2,
      inclinationInput: 'angles',
      inclinationDeg: 60,
      directionDeg: 0,
      ratioReference: 'the base radius r',
    });
    // A round figure's offset is never negative: its direction is that of the offset, along +X, or none when upright.
    expect(await leaning(0)).not.toHaveProperty('directionDeg');
  });
});

describe('a cut with a dovetail entering from the opposite end', async () => {
  const connector = { type: 'dovetail', sizeFactor: 1.2, lengthPercent: 40, clearanceMm: 0.25, entrance: 'opposite' } as const;
  const { artifacts, json } = await exported({
    shape: { kind: 'cone', heightRatio: 2, offsetRatio: 0 },
    scale: { longestDimensionMm: 80 },
    section: { type: 'vertical', offsetPercent: 0, connector },
  });
  const plan = artifacts.model.section?.connector as DovetailPlan;
  const { radius, height } = roundDimensionsMm({ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, { longestDimensionMm: 80 });

  it('records the cut by its own parameters and the connector’s settings once, with its physical dimensions', () => {
    expect(json.sourceModel.section).toEqual({ type: 'vertical', offsetPercent: 0 });
    expect(json.sourceModel.bodyDimensions).toEqual({ baseRadiusMm: radius, heightMm: height, offsetMm: 0 });
    expect(json.sourceModel.connector).toEqual({
      settings: connector,
      conventions: { clearanceMm: expect.stringMatching(/each pair of mating surfaces/) },
      dimensions: {
        tongueHeightMm: plan.height,
        tongueRootWidthMm: plan.rootWidth,
        tongueHeadWidthMm: plan.headWidth,
        tongueLengthMm: plan.length,
        leadInChamferMm: plan.leadIn,
      },
    });
    for (const field of REMOVED) expect(keysDeep(json)).not.toContain(field);
    expect(json).not.toHaveProperty('exportedParts');
  });
});

describe('separate pins', async () => {
  const connector = {
    type: 'dowel',
    count: 2,
    profile: 'circle',
    diameterFactor: 1.2,
    depthFactor: 1.5,
    spacingPercent: 45,
    lowerClearanceMm: 0.4,
    upperClearanceMm: 0.5,
  } as const;
  const { artifacts, json: model } = await exported({
    shape: { kind: 'cylinder', heightRatio: 3, offsetRatio: 0 },
    scale: { longestDimensionMm: 80 },
    section: { type: 'parallel-to-bases', positionPercent: 50, connector },
  });
  const plan = artifacts.model.section?.connector as RoundConnectorPlan;

  it('record the source model, and apart from it the pins actually in the file', () => {
    const pins = settingsOf(artifacts.pinsFile?.bytes as Uint8Array).json;
    expect(model.export).toEqual({ kind: 'model' });
    expect(model).not.toHaveProperty('exportedParts');
    expect(pins.export).toEqual({ kind: 'pins' });
    expect(pins.sourceModel).toEqual(model.sourceModel);
    expect(pins.sourceModel.connector.settings).toEqual(connector);
    expect(pins.sourceModel.connector.dimensions).toEqual({
      connectors: plan.sites.map((site) => ({
        nominalSizeMm: site.pinDiameter,
        offsetFromCentreMm: site.along,
        chamferMm: site.chamfer,
      })),
      dowelLengthMm: 2 * plan.insertion,
      holeDepthMm: plan.holeDepth,
    });
    expect(pins.exportedParts).toEqual({
      pins: plan.sites.map((site) => ({ nominalSizeMm: site.pinDiameter, lengthMm: 2 * plan.insertion })),
    });
    // The file's pins stand on an end: as long as recorded.
    for (const { mesh } of readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects) {
      expect(measureMesh(mesh).size[2]).toBeCloseTo(2 * plan.insertion, 4);
    }
  });
});

describe('a connector trial', async () => {
  const connector = { type: 'twist', sizeMm: 17.4, holeClearanceMm: 0.45, axialClearanceMm: 0.25 } as const;
  const { artifacts, json: model } = await exported({
    shape: { kind: 'cylinder', heightRatio: 100 / 30, offsetRatio: 0 },
    scale: { longestDimensionMm: 100 },
    section: { type: 'parallel-to-bases', positionPercent: 50, connector },
  });

  it('records the source model, and the holders actually exported', () => {
    const trial = settingsOf(artifacts.trialFile?.bytes as Uint8Array).json;
    expect(trial.export).toEqual({ kind: 'connector-trial' });
    expect(trial.sourceModel).toEqual(model.sourceModel);
    expect(trial.sourceModel.connector.settings).toEqual(connector);
    expect(Object.keys(trial.sourceModel.connector.conventions)).toEqual(['sizeMm', 'holeClearanceMm', 'axialClearanceMm']);
    const holders = readThreeMf(artifacts.trialFile?.bytes as Uint8Array).model.objects.map(({ mesh }) => measureMesh(mesh).size);
    const { trialHolders } = trial.exportedParts;
    expect(trialHolders.holderDiameterMm).toBeCloseTo(holders[0]?.[0] as number, 2);
    expect(trialHolders.femaleHeightMm).toBeCloseTo(holders[1]?.[2] as number, 4);
    expect(trialHolders.maleBaseHeightMm).toBe(3);
  });
});

describe('serialization', () => {
  it('refuses a non-finite number instead of writing a misleading null', () => {
    const document = { schemaVersion: 2, broken: { valueMm: Number.NaN } } as unknown as ModelSettingsDocument;
    expect(() => serializeModelSettings(document)).toThrow(GeometryError);
    const infinite = { schemaVersion: 2, value: Number.POSITIVE_INFINITY } as unknown as ModelSettingsDocument;
    expect(() => serializeModelSettings(infinite)).toThrow(/non-finite/);
  });

  it('keeps every digit of a number', () => {
    const document = { schemaVersion: 2, value: 0.1 + 0.2 } as unknown as ModelSettingsDocument;
    expect(JSON.parse(serializeModelSettings(document)).value).toBe(0.1 + 0.2);
  });
});
