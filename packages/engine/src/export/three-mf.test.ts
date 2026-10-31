import { defaultModelSpecs } from '@diploma-3d/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { GeometryError } from '../errors.ts';
import { loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, measureMesh, type TriangleMesh } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { rightTetrahedron, translated } from '../test-fixtures.ts';
import { readThreeMf } from './three-mf.test-helper.ts';
import { createThreeMf } from './three-mf.ts';

let cubeMesh: TriangleMesh;

beforeAll(async () => {
  const kernel = await loadGeometryKernel();
  cubeMesh = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh as TriangleMesh;
});

describe('createThreeMf', () => {
  it('writes a geometry-only OPC package with the required content types and model relationship', () => {
    const parsed = readThreeMf(createThreeMf([{ name: 'cube', mesh: cubeMesh }]));

    // No thumbnails, Metadata/ parts or slicer configuration: only the three parts required by the core specification.
    expect([...parsed.entryNames].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    expect(parsed.contentTypes).toEqual(
      expect.arrayContaining([
        { extension: 'rels', contentType: 'application/vnd.openxmlformats-package.relationships+xml' },
        { extension: 'model', contentType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' },
      ]),
    );
    expect(parsed.relationships).toEqual([
      { id: 'rel0', target: '/3D/3dmodel.model', type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel' },
    ]);
    expect(parsed.model.namespace).toBe('http://schemas.microsoft.com/3dmanufacturing/core/2015/02');
    expect(parsed.model.unit).toBe('millimeter');
  });

  it('stores the cube as one closed 80 × 80 × 80 mm object referenced by the build', () => {
    const { model } = readThreeMf(createThreeMf([{ name: 'cube', mesh: cubeMesh }], { title: 'cube' }));

    expect(model.title).toBe('cube');
    expect(model.objects).toHaveLength(1);
    const [object] = model.objects;
    expect(object).toMatchObject({ id: '1', type: 'model', name: 'cube' });
    expect(model.buildItems).toEqual([{ objectId: '1' }]);

    const mesh = object?.mesh as TriangleMesh;
    expect(findMeshDefects(mesh)).toEqual([]);
    const measurements = measureMesh(mesh);
    expect(measurements.size).toEqual([80, 80, 80]);
    expect(measurements.bounds).toEqual({ min: [-40, -40, 0], max: [40, 40, 80] });
    expect(measurements.volume).toBeCloseTo(80 ** 3, 6);
    expect(measurements.surfaceArea).toBeCloseTo(6 * 80 ** 2, 6);
  });

  it('round-trips fractional float32 coordinates and triangle order exactly', () => {
    const mesh = translated(rightTetrahedron(10, 20, 30), [0.1, -2.5, 1e-7]);
    const [object] = readThreeMf(createThreeMf([{ name: 'tetrahedron', mesh }])).model.objects;
    expect(object?.mesh.positions).toEqual(mesh.positions);
    expect(object?.mesh.triangles).toEqual(mesh.triangles);
  });

  it('keeps several meshes as separate objects with their own build items and escaped names', () => {
    const first = rightTetrahedron(10, 20, 30);
    const second = translated(rightTetrahedron(5, 5, 5), [50, 0, 0]);
    const { model } = readThreeMf(
      createThreeMf([
        { name: 'part <A> & "B"', mesh: first },
        { name: "part 'C'", mesh: second },
      ]),
    );

    expect(model.objects.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: '1', name: 'part <A> & "B"' },
      { id: '2', name: "part 'C'" },
    ]);
    expect(model.buildItems).toEqual([{ objectId: '1' }, { objectId: '2' }]);
    expect(model.objects[0]?.mesh.positions).toEqual(first.positions);
    expect(model.objects[1]?.mesh.positions).toEqual(second.positions);
  });

  it('is byte-for-byte deterministic', () => {
    expect(createThreeMf([{ name: 'cube', mesh: cubeMesh }])).toEqual(createThreeMf([{ name: 'cube', mesh: cubeMesh }]));
  });

  it('refuses empty packages and meshes that are not closed solids', () => {
    expect(() => createThreeMf([])).toThrow(GeometryError);
    const open = { positions: rightTetrahedron().positions, triangles: Uint32Array.of(0, 2, 1, 0, 1, 3, 0, 3, 2) };
    expect(() => createThreeMf([{ name: 'open', mesh: open }])).toThrow(/open-edge/);
  });
});
