import { buildModelArtifacts, loadGeometryKernel, MODEL_SETTINGS_PATH, type RoundConnectorPlan } from '@diploma-3d/engine';
import type { RoundConnector } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { readThreeMfPart } from '../../../../../packages/engine/src/export/three-mf.test-helper.ts';
import {
  commitConnectorEdit,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterState,
  resolveModelRequest,
} from './parameters.ts';
import { initialTiltModes } from './tilt.ts';

const kernel = await loadGeometryKernel();

const settingsOf = (bytes: Uint8Array) => {
  const part = readThreeMfPart(bytes, MODEL_SETTINGS_PATH);
  if (part === undefined) throw new Error('No settings part');
  return JSON.parse(part);
};

describe('the settings a download records come from the request that generated it', () => {
  // r = 30 mm and H = 100 mm.
  const choices = { ...initialParameterChoices(), cylinderSection: 'parallel-to-bases', cylinderConnector: 'dowel' } as const;
  const texts = { ...initialParameterTexts(), printSizeMm: '100', cylinderHeightRatio: '3,3333333333' };

  it('an automatically corrected length is recorded as the value the geometry was built with, not the one asked for', async () => {
    const state: ParameterState = { texts, choices, connectorEdits: {} };
    const committed = commitConnectorEdit(
      'cylinder',
      state,
      resolveModelRequest('cylinder', texts, choices, { connectorEdits: {} }),
    );
    // A dowel 60 mm long: e = 30 mm = 0,05·M·k at M = 100 mm, k = 6. Then the cut moves where it no longer fits.
    const moved = { ...committed.texts, cylinderRoundDepth: '6', cylinderSectionPercent: '90' };
    const request = resolveModelRequest('cylinder', moved, choices, { connectorEdits: committed.connectorEdits });
    if (request.spec === undefined) throw new Error('expected a model');
    const connector = request.spec.section?.connector as RoundConnector;
    expect(connector.depthFactor).toBeLessThan(6);
    const artifacts = await buildModelArtifacts(kernel, request.spec, request.settingsInput);
    const json = settingsOf(artifacts.printFile.bytes);
    const plan = artifacts.model.section?.connector as RoundConnectorPlan;
    expect(json.sourceModel.connector.settings).toEqual(connector);
    expect(json.sourceModel.connector.settings.depthFactor).toBe(connector.depthFactor);
    expect(json.sourceModel.connector.dimensions.dowelLengthMm).toBe(2 * plan.insertion);
    expect(json.sourceModel.section).toEqual({ type: 'parallel-to-bases', positionPercent: 90 });
    expect(JSON.stringify(json)).not.toMatch(/automaticAdjustments|dimensionsSource|"requested"/);
    // The stored text stays as typed; only the generated model, and with it the file, has the corrected value.
    expect(moved.cylinderRoundDepth).toBe('6');
    const pins = settingsOf(artifacts.pinsFile?.bytes as Uint8Array);
    expect(pins.export).toEqual({ kind: 'pins' });
    expect(pins.sourceModel).toEqual(json.sourceModel);
  });

  it('the default offset input keeps the offsets', async () => {
    const leaning = { ...texts, cylinderOffsetRatio: '0,5' };
    const request = resolveModelRequest('cylinder', leaning, { ...choices, cylinderSection: 'none' });
    if (request.spec === undefined) throw new Error('expected a model');
    expect(request.settingsInput).toEqual({ inclinationInput: { enteredAs: 'offsets' } });
    const json = settingsOf((await buildModelArtifacts(kernel, request.spec, request.settingsInput)).printFile.bytes);
    expect(json.sourceModel.shape).toEqual({
      kind: 'cylinder',
      heightRatio: 3.3333333333,
      offsetRatio: 0.5,
      inclinationInput: 'offsets',
      ratioReference: 'the base radius r',
    });
  });

  it('an angle input keeps the accepted inclination and direction, a nonzero one included', async () => {
    const prismTexts = { ...initialParameterTexts(), prismInclinationDeg: '70', prismDirectionDeg: '135' };
    const request = resolveModelRequest('prism', prismTexts, initialParameterChoices(), {
      tiltModes: { ...initialTiltModes(), prism: 'angle' },
    });
    if (request.spec === undefined) throw new Error('expected a model');
    expect(request.settingsInput).toEqual({ inclinationInput: { enteredAs: 'angles', inclinationDeg: 70, directionDeg: 135 } });
    const json = settingsOf((await buildModelArtifacts(kernel, request.spec, request.settingsInput)).printFile.bytes);
    expect(json.sourceModel.shape).toMatchObject({ inclinationInput: 'angles', inclinationDeg: 70, directionDeg: 135 });
    expect(json.sourceModel.shape).not.toHaveProperty('offsetXRatio');
    expect(json.sourceModel.shape).not.toHaveProperty('offsetYRatio');
    // A cylinder's angle has no direction of its own: that of the offset it gave, along +X.
    const cylinder = resolveModelRequest(
      'cylinder',
      { ...texts, cylinderInclinationDeg: '70' },
      { ...choices, cylinderSection: 'none' },
      { tiltModes: { ...initialTiltModes(), cylinder: 'angle' } },
    );
    if (cylinder.spec === undefined) throw new Error('expected a model');
    const round = settingsOf((await buildModelArtifacts(kernel, cylinder.spec, cylinder.settingsInput)).printFile.bytes);
    expect(round.sourceModel.shape).toEqual({
      kind: 'cylinder',
      heightRatio: 3.3333333333,
      inclinationInput: 'angles',
      inclinationDeg: 70,
      directionDeg: 0,
      ratioReference: 'the base radius r',
    });
  });
});
