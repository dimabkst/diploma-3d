import type { DovetailConnector, DovetailEntrance, ModelSpecInput, Section } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { dot, findMeshDefects, type TriangleMesh, type Vec3 } from '../mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { type DovetailPlan, dovetailEntranceDirection, dovetailFeasibility, isHorizontalCut, planDovetail } from './dovetail.ts';
import { coneApexAngleBounds, cutOfSection, type SectionedShape, solidCut } from './frame.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const scale = { longestDimensionMm: 80 };
const cone = { kind: 'cone', heightRatio: 2, offsetRatio: 0 } as const;
const apexBounds = coneApexAngleBounds(cone, scale, 0) as { min: number; max: number };

const dovetail = (entrance?: DovetailEntrance): DovetailConnector => ({
  type: 'dovetail',
  sizeFactor: 1,
  lengthPercent: 50,
  clearanceMm: 0.2,
  ...(entrance === undefined ? {} : { entrance }),
});

/** A section without its connector, for each kind of cut. */
type Cut = Section extends infer Each ? (Each extends unknown ? Omit<Each, 'connector'> : never) : never;

type Case = readonly [name: string, shape: SectionedShape, section: Cut];

const CASES: readonly Case[] = [
  ['a cone’s axial cut through its apex', cone, { type: 'vertical', offsetPercent: 0 }],
  [
    'a cone’s inclined cut through its apex',
    cone,
    { type: 'oblique-apex', inclinationDeg: (apexBounds.min + apexBounds.max) / 2, directionDeg: 0 },
  ],
  [
    'a leaning cylinder’s vertical cut',
    { kind: 'cylinder', heightRatio: 2, offsetRatio: 0.5 },
    { type: 'vertical', offsetPercent: 20 },
  ],
  [
    'a cylinder’s inclined cut',
    { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 },
    { type: 'oblique', positionPercent: 50, inclinationDeg: 30, directionDeg: 40 },
  ],
  [
    'a cylinder’s horizontal cut',
    { kind: 'cylinder', heightRatio: 2, offsetRatio: 0.3 },
    { type: 'parallel-to-bases', positionPercent: 50 },
  ],
  ['a ball’s horizontal cut', { kind: 'ball' }, { type: 'horizontal', offsetPercent: 20 }],
];

const specOf = (shape: SectionedShape, section: Cut, connector: DovetailConnector): ModelSpecInput =>
  ({ shape, scale, section: { ...section, connector } }) as ModelSpecInput;

const manifoldOf = (track: Track, mesh: TriangleMesh) =>
  track(
    new kernel.Manifold(
      new kernel.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(mesh.positions),
        triVerts: Uint32Array.from(mesh.triangles),
      }),
    ),
  );

/** Whether the solid has material in a 0,1 mm cube around the point. */
const hasMaterialAt = (track: Track, solid: Manifold, point: Vec3) =>
  track(solid.intersect(track(track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([...point])))).volume() > 1e-6;

const along = (point: Vec3, direction: Vec3, distance: number): Vec3 => [
  point[0] + distance * direction[0],
  point[1] + distance * direction[1],
  point[2] + distance * direction[2],
];
const negated = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

const planOf = (model: GeneratedModel) => model.section?.connector as DovetailPlan;

describe.each(CASES)('the entrance of %s', (_, shape, section) => {
  const models = {
    standard: generateModel(kernel, specOf(shape, section, dovetail('standard'))),
    opposite: generateModel(kernel, specOf(shape, section, dovetail('opposite'))),
  };
  const uncut = generateModel(kernel, { shape, scale } as ModelSpecInput);
  const solidSection = solidCut(shape, scale, cutOfSection({ ...section } as Section));

  it('opens at the chosen end of the stable slide axis: upper or lower, or one side or the other', () => {
    const [standard, opposite] = [planOf(models.standard), planOf(models.opposite)];
    const [towardsStandard, towardsOpposite] = [negated(standard.frame.u), negated(opposite.frame.u)];
    expect(dot(towardsStandard, towardsOpposite)).toBeCloseTo(-1, 12);
    expect(towardsStandard).toEqual(dovetailEntranceDirection(solidSection, 'standard'));
    if (isHorizontalCut(solidSection)) {
      expect(towardsStandard[2]).toBeCloseTo(0, 12);
      expect(towardsStandard).toEqual(negated(solidSection.frame.u));
    } else {
      expect(towardsStandard[2]).toBeGreaterThan(0);
      expect(towardsOpposite[2]).toBeLessThan(0);
    }
    // The plane, its normal and the parts' roles stay as they are.
    expect(opposite.frame.n).toEqual(standard.frame.n);
    expect(opposite.frame.origin).toEqual(standard.frame.origin);
    expect(models.opposite.solids.map(({ part }) => part)).toEqual(models.standard.solids.map(({ part }) => part));
  });

  it.each(['standard', 'opposite'] as const)(
    '%s: closes the other end with a stop, opens the chosen boundary, and leaves the slide path clear',
    (entrance) => {
      const model = models[entrance];
      const other = models[entrance === 'standard' ? 'opposite' : 'standard'];
      const plan = planOf(model);
      const towardsEntrance = negated(plan.frame.u);
      withScope((track) => {
        const [lower, female] = (model.solids as readonly Solid[]).map(({ mesh }) => manifoldOf(track, mesh)) as [
          Manifold,
          Manifold,
        ];
        const otherFemale = manifoldOf(track, (other.solids[1] as Solid).mesh);
        const whole = manifoldOf(track, (uncut.solids[0] as Solid).mesh);
        for (const solid of [lower, female]) {
          const pieces = solid.decompose();
          for (const piece of pieces) track(piece);
          expect(pieces).toHaveLength(1);
        }
        for (const { mesh } of model.solids) expect(findMeshDefects(mesh)).toEqual([]);
        const inGroove = along(plan.frame.origin, plan.frame.n, plan.height / 2);
        expect(hasMaterialAt(track, lower, inGroove)).toBe(true);
        expect(hasMaterialAt(track, female, inGroove)).toBe(false);
        // The stop: material beyond the closed end, where the other entrance's channel ran.
        const closedEnd = plan.length / 2 + plan.clearance;
        const behind = along(inGroove, plan.frame.u, closedEnd + 0.4);
        expect(hasMaterialAt(track, female, behind)).toBe(true);
        expect(hasMaterialAt(track, otherFemale, behind)).toBe(false);
        // The chosen channel is open all the way to the part's boundary, which it leaves.
        const sign = dot(towardsEntrance, solidSection.frame.u) > 0 ? 1 : -1;
        const reach =
          'entranceReachWithin' in solidSection
            ? solidSection.entranceReachWithin(plan.height + plan.clearance, sign)
            : plan.exitDistance - plan.length / 2 - plan.clearance - 1;
        for (const share of [0.1, 0.4, 0.7, 0.95]) {
          const point = along(inGroove, towardsEntrance, plan.length / 2 + share * (reach - plan.length / 2));
          expect(hasMaterialAt(track, female, point), `${share} of the way to the entrance`).toBe(false);
        }
        expect(hasMaterialAt(track, whole, along(inGroove, towardsEntrance, reach + 0.5))).toBe(false);
        // The tongue alone, moved relative to the female part: out along +d freely, and into the stop along −d.
        const tongue = track(lower.trimByPlane([...plan.frame.n], dot(plan.frame.n, plan.frame.origin) + 0.05));
        for (let travel = 0; travel <= plan.exitDistance; travel += plan.exitDistance / 8) {
          const moved = track(tongue.translate([...along([0, 0, 0], towardsEntrance, travel)]));
          expect(track(moved.intersect(female)).volume(), `${travel.toFixed(1)} mm out`).toBeLessThan(1e-3);
        }
        const pushed = track(tongue.translate([...along([0, 0, 0], plan.frame.u, plan.clearance + 0.1)]));
        expect(track(pushed.intersect(female)).volume()).toBeGreaterThan(1e-3);
      });
    },
  );
});

describe('a cone cut through its apex', () => {
  it('routes the lower entrance to the base and closes the one near the apex', () => {
    const top = generateModel(kernel, specOf(cone, { type: 'vertical', offsetPercent: 0 }, dovetail('standard')));
    const bottom = generateModel(kernel, specOf(cone, { type: 'vertical', offsetPercent: 0 }, dovetail('opposite')));
    withScope((track) => {
      const [topFemale, bottomFemale] = [top, bottom].map((model) => manifoldOf(track, (model.solids[1] as Solid).mesh));
      const plan = planOf(bottom);
      // At the base the groove's profile is open from below only with the lower entrance.
      const atBase: Vec3 = [plan.frame.origin[0], plan.frame.origin[1], 0.3];
      const inLayer = along(atBase, plan.frame.n, plan.height / 2);
      expect(hasMaterialAt(track, bottomFemale as Manifold, inLayer)).toBe(false);
      expect(hasMaterialAt(track, topFemale as Manifold, inLayer)).toBe(true);
      // Towards the apex, above the tongue, only the upper entrance cuts the cone.
      const aboveTongue = along(along(plan.frame.origin, plan.frame.n, plan.height / 2), [0, 0, 1], plan.length / 2 + 3);
      expect(hasMaterialAt(track, topFemale as Manifold, aboveTongue)).toBe(false);
      expect(hasMaterialAt(track, bottomFemale as Manifold, aboveTongue)).toBe(true);
    });
  });

  it('measures the walls towards the actual stop: the two ends limit different walls', () => {
    const axial = { offsetPercent: 0 };
    const failing = (entrance: DovetailEntrance) =>
      planDovetail(cone, scale, axial, { ...dovetail(entrance), lengthPercent: 70 }).issues.map(({ code }) => code);
    // A too long tongue: with the entrance at the top the stop runs into the base; at the bottom, the narrow apex end's walls.
    expect(failing('standard')).toContain('stop-thin');
    expect(failing('opposite')).not.toContain('stop-thin');
    expect(failing('opposite')).toEqual(expect.arrayContaining(['groove-wall-thin', 'backing-thin']));
    const [standard, opposite] = (['standard', 'opposite'] as const).map(
      (entrance) => dovetailFeasibility(cone, scale, axial, dovetail(entrance)).parameters.height.bounds.max,
    );
    expect(standard).not.toBeCloseTo(opposite as number, 2);
  });
});

describe('regressions', () => {
  it('a configuration without the field keeps the direction it was built with', () => {
    for (const [, shape, section] of CASES) {
      const legacy = generateModel(kernel, specOf(shape, section, dovetail()));
      const standard = generateModel(kernel, specOf(shape, section, dovetail('standard')));
      expect(planOf(legacy).frame).toEqual(planOf(standard).frame);
      expect(planOf(legacy).entrance).toBe('standard');
      legacy.solids.forEach((solid, index) => {
        expect(solid.mesh.positions).toEqual((standard.solids[index] as Solid).mesh.positions);
      });
    }
  });

  it('switching back and forth rebuilds the same parts from the uncut solid each time', () => {
    const [, shape, section] = CASES[1] as Case;
    const build = (entrance: DovetailEntrance) => generateModel(kernel, specOf(shape, section, dovetail(entrance)));
    const first = { standard: build('standard'), opposite: build('opposite') };
    for (const entrance of ['opposite', 'standard', 'opposite', 'standard'] as const) {
      const again = build(entrance);
      again.solids.forEach((solid, index) => {
        expect(solid.mesh.positions).toEqual((first[entrance].solids[index] as Solid).mesh.positions);
        expect(solid.mesh.triangles).toEqual((first[entrance].solids[index] as Solid).mesh.triangles);
      });
    }
  });

  it('the separated preview moves the tongue’s part towards the chosen entrance, and the file stays unmoved', async () => {
    const { WebIO } = await import('@gltf-transform/core');
    for (const entrance of ['standard', 'opposite'] as const) {
      const artifacts = await buildModelArtifacts(
        kernel,
        specOf(cone, { type: 'vertical', offsetPercent: 0 }, dovetail(entrance)),
      );
      const nodes = (await new WebIO().readBinary(artifacts.separatedPreviewGlb as Uint8Array)).getRoot().listNodes();
      const [partOne, partTwo] = nodes as [(typeof nodes)[number], (typeof nodes)[number]];
      // glTF's +Y is the model's +Z: part 1 leaves upwards through the upper entrance, downwards through the lower one.
      expect(Math.sign(partOne.getTranslation()[1])).toBe(entrance === 'standard' ? 1 : -1);
      expect(partTwo.getTranslation()).toEqual([0, 0, 0]);
    }
  });
});
