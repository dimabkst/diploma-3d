import { describe, expect, it } from 'vitest';
import { measureMesh, subtract, type TriangleMesh, triangleAreaVector, triangleCount, type Vec3 } from '../mesh.ts';
import { rightTetrahedron, translated } from '../test-fixtures.ts';
import { arrangeInRow, PRINT_LAYOUT_GAP_MM, restOnFlatFace } from './layout.ts';

describe('arrangeInRow', () => {
  // Two solids of different size, off the origin and partly below z = 0, the second overlapping the first.
  const objects = [
    { name: 'first', mesh: translated(rightTetrahedron(10, 20, 30), [-7, 4, -3]) },
    { name: 'second', mesh: translated(rightTetrahedron(30, 10, 5), [2, -9, 12]) },
  ];
  const arranged = arrangeInRow(objects);
  const boxes = arranged.map((object) => measureMesh(object.mesh).bounds);

  it('rests every object on z = 0 with its XY box centred on y = 0', () => {
    for (const { min, max } of boxes) {
      expect(min[2]).toBe(0);
      expect(min[1] + max[1]).toBeCloseTo(0, 6);
    }
  });

  it(`leaves ${PRINT_LAYOUT_GAP_MM} mm between the XY boxes along X and centres the row on x = 0`, () => {
    const [first, second] = boxes;
    expect((second?.min[0] ?? 0) - (first?.max[0] ?? 0)).toBeCloseTo(PRINT_LAYOUT_GAP_MM, 5);
    expect((first?.min[0] ?? 0) + (second?.max[0] ?? 0)).toBeCloseTo(0, 5);
    expect(arrangeInRow(objects, 12).map((object) => measureMesh(object.mesh).bounds.min[0])).toEqual([
      -(10 + 12 + 30) / 2,
      -(10 + 12 + 30) / 2 + 10 + 12,
    ]);
  });

  it('only translates: names, triangles, sizes, volumes and face orientations stay', () => {
    arranged.forEach((object, index) => {
      const original = objects[index];
      if (original === undefined) throw new Error('Missing object');
      expect(object.name).toBe(original.name);
      expect(object.mesh.triangles).toBe(original.mesh.triangles);
      const [before, after] = [measureMesh(original.mesh), measureMesh(object.mesh)];
      after.size.forEach((value, axis) => {
        expect(value).toBeCloseTo(before.size[axis] ?? Number.NaN, 5);
      });
      expect(after.volume).toBeCloseTo(before.volume, 3);
      for (let triangle = 0; triangle < triangleCount(object.mesh); triangle += 1) {
        const difference = subtract(triangleAreaVector(object.mesh, triangle), triangleAreaVector(original.mesh, triangle));
        for (const component of difference) expect(Math.abs(component)).toBeLessThan(1e-3);
      }
    });
  });
});

describe('restOnFlatFace', () => {
  const turnAxis: Vec3 = [1, 0, 0];
  /** A tetrahedron from its corners, the first three of which it stands on, counter-clockwise from above. */
  const tetrahedron = (base: readonly [Vec3, Vec3, Vec3], apex: Vec3): TriangleMesh => ({
    positions: Float32Array.from([...base, apex].flat()),
    triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]),
  });
  const faceDownArea = (mesh: TriangleMesh) => {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const vector = triangleAreaVector(mesh, triangle);
      if (vector[2] < 0 && Math.abs(vector[0]) + Math.abs(vector[1]) < 1e-6) area -= vector[2] / 2;
    }
    return area;
  };
  const standing = tetrahedron(
    [
      [0, 0, 0],
      [30, 0, 0],
      [0, 30, 0],
    ],
    [5, 5, 20],
  );

  it('leaves a part that has the lower base as it is', () => {
    expect(restOnFlatFace(standing, { baseHeight: 20, turnAxis })).toBe(standing);
  });

  it('turns a part that has only the upper base onto it, by a half turn that keeps its size', () => {
    const hanging = tetrahedron(
      [
        [0, 30, 20],
        [30, 0, 20],
        [0, 0, 20],
      ],
      [5, 5, 0],
    );
    const rested = restOnFlatFace(hanging, { baseHeight: 20, turnAxis });
    const measured = measureMesh(rested);
    expect(measured.volume).toBeCloseTo(measureMesh(hanging).volume, 3);
    expect(measured.size).toEqual(measureMesh(hanging).size);
    expect(measured.bounds.min[2]).toBe(-20);
    expect(faceDownArea(rested)).toBeCloseTo(450, 3);
  });

  it('does not balance a part on a base that its centre of mass misses', () => {
    // The centre of mass lies 25 mm along X, far beyond the 1 mm base.
    const leaning = tetrahedron(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [100, 0, 10],
    );
    // Without a face to spare it stays on the base it has, as an uncut leaning solid does.
    expect(restOnFlatFace(leaning, { baseHeight: 10, turnAxis })).toBe(leaning);
    // A flat cut face that carries it takes over: here the face through the base's long edge and the apex.
    const [ax, ay, az] = [100, 0, 10];
    const edge: Vec3 = [-1, 1, 0];
    const up: Vec3 = [ax - 1, ay, az];
    const normal: Vec3 = [
      edge[1] * up[2] - edge[2] * up[1],
      edge[2] * up[0] - edge[0] * up[2],
      edge[0] * up[1] - edge[1] * up[0],
    ];
    const size = Math.hypot(...normal);
    const outward: Vec3 = [normal[0] / size, normal[1] / size, normal[2] / size];
    const rested = restOnFlatFace(leaning, { baseHeight: 10, turnAxis, cutFaceOutward: outward });
    expect(rested).not.toBe(leaning);
    expect(measureMesh(rested).volume).toBeCloseTo(measureMesh(leaning).volume, 3);
    expect(faceDownArea(rested)).toBeGreaterThan(0);
  });

  it('turns a part with no flat face to spare so that its connector’s face points up, and rests on a free cut otherwise', () => {
    // Floating above the base's plane: a tip, whose one flat side faces −Y.
    const tip = tetrahedron(
      [
        [0, 0, 5],
        [10, 0, 5],
        [5, 0, 15],
      ],
      [5, 10, 8],
    );
    const outward: Vec3 = [0, -1, 0];
    const up = restOnFlatFace(tip, { baseHeight: 30, turnAxis, connectorFace: outward });
    const free = restOnFlatFace(tip, { baseHeight: 30, turnAxis, cutFaceOutward: outward });
    // y ↦ z, so that the face at y = 0 is now the plane z = 0 of the rotation, and points up or down.
    expect(measureMesh(up).bounds.max[2]).toBeCloseTo(0, 5);
    expect(measureMesh(free).bounds.min[2]).toBeCloseTo(0, 5);
    expect(measureMesh(up).volume).toBeCloseTo(measureMesh(tip).volume, 3);
    expect(measureMesh(free).volume).toBeCloseTo(measureMesh(tip).volume, 3);
  });

  it('keeps the part as it is when both bases carry it equally', () => {
    const box = (width: number): TriangleMesh => ({
      positions: Float32Array.from([
        0,
        0,
        0,
        width,
        0,
        0,
        width,
        width,
        0,
        0,
        width,
        0,
        0,
        0,
        10,
        width,
        0,
        10,
        width,
        width,
        10,
        0,
        width,
        10,
      ]),
      triangles: Uint32Array.from([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
      ]),
    });
    const equal = box(10);
    expect(restOnFlatFace(equal, { baseHeight: 10, turnAxis })).toBe(equal);
  });
});
