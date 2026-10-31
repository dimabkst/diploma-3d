import { defaultModelSpecs, type ModelSpec } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { InvalidModelSpecError } from './errors.ts';
import { toGltfPosition } from './export/glb.ts';
import { readThreeMf } from './export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import { triangleAt, triangleCount, vertexAt } from './mesh.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

describe('buildModelArtifacts', () => {
  it('derives the cube preview and the cube.3mf print file from the same geometry', async () => {
    const { model, previewGlb, printFile } = await buildModelArtifacts(kernel, defaultModelSpecs.cube);
    expect(printFile.fileName).toBe('cube.3mf');

    const printed = readThreeMf(printFile.bytes).model.objects[0]?.mesh;
    expect(printed).toEqual(model.solids[0]?.mesh);
    if (printed === undefined) throw new Error('No printed mesh');

    const previewMesh = (await new WebIO().readBinary(previewGlb)).getRoot().listMeshes()[0];
    const previewPositions = previewMesh?.listPrimitives()[0]?.getAttribute('POSITION');
    expect(previewPositions?.getCount()).toBe(triangleCount(printed) * 3);
    for (let triangle = 0; triangle < triangleCount(printed); triangle += 1) {
      triangleAt(printed, triangle).forEach((vertex, corner) => {
        const expected = toGltfPosition(vertexAt(printed, vertex));
        const actual = previewPositions?.getElement(triangle * 3 + corner, []) ?? [];
        expected.forEach((component, axis) => {
          // Float32 metres: ±5e-8 m.
          expect(actual[axis]).toBeCloseTo(component, 7);
        });
      });
    }
  });

  it('produces no artifacts for invalid input', async () => {
    const invalid = { shape: { kind: 'cube' }, scale: { unitLengthMm: -1 } } satisfies ModelSpec;
    await expect(buildModelArtifacts(kernel, invalid)).rejects.toBeInstanceOf(InvalidModelSpecError);
  });
});
