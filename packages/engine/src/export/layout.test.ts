import { describe, expect, it } from 'vitest';
import { measureMesh, subtract, triangleAreaVector, triangleCount } from '../mesh.ts';
import { rightTetrahedron, translated } from '../test-fixtures.ts';
import { arrangeInRow, PRINT_LAYOUT_GAP_MM } from './layout.ts';

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
