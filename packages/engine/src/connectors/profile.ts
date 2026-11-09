import type { ConnectorProfile } from '@diploma-3d/schema';
import type { Vec2 } from '../shapes/polygon.ts';

/**
 * The cross-sections of plugs, dowels and their holes, in the cut plane's coordinates (x along v, y along u), for a nominal
 * radius r and an `offset` of the side surfaces, outward or, negative, inward.
 *
 * Every profile is an intersection of half-planes, with a disc for the round ones. Offsetting moves each half-plane and the
 * disc's edge by the same distance, so that a flat face lies exactly `offset` away from its original, unlike a scaled
 * profile, and corners stay as sharp as they are: such a shape contains every point within `offset` of the original, so
 * that no corner has less clearance than a face. A polygon's corner has offset/cos(π/n), and a hole with Δ = 2·offset keeps
 * the intended clearance everywhere.
 */

const POLYGONS = {
  // Corners on +X, so that a triangle or hexagon is symmetric about the cut plane's x axis, as the flat side is.
  triangle: { sides: 3, phase: 0 },
  // Sides along the axes.
  square: { sides: 4, phase: Math.PI / 4 },
  hexagon: { sides: 6, phase: 0 },
} as const;

type PolygonProfile = keyof typeof POLYGONS;

const isPolygon = (profile: ConnectorProfile): profile is PolygonProfile => Object.hasOwn(POLYGONS, profile);

function polygonCorners(profile: PolygonProfile, radius: number, offset: number): Vec2[] {
  const { sides, phase } = POLYGONS[profile];
  // The apothem moves by the offset; the circumradius follows from it.
  const circumradius = radius + offset / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, index): Vec2 => {
    const angle = phase + (2 * Math.PI * index) / sides;
    return [circumradius * Math.cos(angle), circumradius * Math.sin(angle)];
  });
}

/** The flat side x = r/2 + offset of the disc with radius r + offset, and the upper of the two corners where they meet. */
function flattedCircle(radius: number, offset: number) {
  const round = radius + offset;
  const flat = radius / 2 + offset;
  return { round, flat, cornerY: Math.sqrt(Math.max(0, round * round - flat * flat)) };
}

/** The largest value of (x, y)·(dx, dy) on the profile: how far it reaches along a direction, scaled by that vector's length. */
export function profileSupport(profile: ConnectorProfile, radius: number, offset: number, dx: number, dy: number): number {
  if (isPolygon(profile)) {
    return Math.max(...polygonCorners(profile, radius, offset).map(([x, y]) => x * dx + y * dy));
  }
  if (profile === 'circle') return (radius + offset) * Math.hypot(dx, dy);
  const { round, flat, cornerY } = flattedCircle(radius, offset);
  const length = Math.hypot(dx, dy);
  // A direction within the corners' angle reaches furthest at a corner: the arc's point along it was cut off.
  return round * dx <= flat * length ? round * length : flat * dx + cornerY * Math.abs(dy);
}

/** The profile's greatest distance from the point −(cx, cy), which on a convex shape lies at a corner or on its arc. */
export function profileReach(profile: ConnectorProfile, radius: number, offset: number, cx: number, cy: number): number {
  if (isPolygon(profile)) {
    return Math.max(...polygonCorners(profile, radius, offset).map(([x, y]) => Math.hypot(cx + x, cy + y)));
  }
  const distance = Math.hypot(cx, cy);
  if (profile === 'circle') return distance + radius + offset;
  const { round, flat, cornerY } = flattedCircle(radius, offset);
  if (round * cx <= flat * distance) return distance + round;
  return Math.max(Math.hypot(cx + flat, cy + cornerY), Math.hypot(cx + flat, cy - cornerY));
}

/** The narrowest width between parallel support lines of the profile. */
export function profileMinWidth(profile: ConnectorProfile, radius: number, offset: number): number {
  switch (profile) {
    case 'circle':
      return 2 * (radius + offset);
    case 'flatted-circle':
      return radius + offset + (radius / 2 + offset);
    case 'triangle':
      // A corner opposite a side: the height, three apothems.
      return 3 * (radius * Math.cos(Math.PI / 3) + offset);
    case 'square':
      return 2 * (radius * Math.cos(Math.PI / 4) + offset);
    case 'hexagon':
      return 2 * (radius * Math.cos(Math.PI / 6) + offset);
  }
}

/**
 * The angles at which a profile's rings have their arc's vertices, shared by a site's pin and holes so that corresponding
 * facets stay parallel and the clearance holds between them, as on the circles the kernel revolves: the multiples of 2π/N
 * from +X. A flat side leaves out those it cuts off at any ring, and those so near its corner that a facet would be a sliver.
 * Its corner moves towards the flat side as the offset grows, so the most inward ring has the farthest one.
 */
export function profileArcAngles(
  profile: ConnectorProfile,
  radius: number,
  mostInwardOffset: number,
  segments: number,
): number[] {
  if (isPolygon(profile)) return [];
  const step = (2 * Math.PI) / segments;
  const angles = Array.from({ length: segments }, (_, index) => index * step);
  if (profile === 'circle') return angles;
  const { round, flat } = flattedCircle(radius, mostInwardOffset);
  const corner = Math.acos(flat / round) + step / 4;
  return angles.filter((angle) => angle > corner && angle < 2 * Math.PI - corner);
}

/**
 * The profile's boundary, counter-clockwise, with as many vertices for every offset given the same `arcAngles`, so that
 * rings of one site can be joined vertex by vertex. Each ring holds the origin, which every profile contains.
 */
export function profileRing(profile: ConnectorProfile, radius: number, offset: number, arcAngles: readonly number[]): Vec2[] {
  if (isPolygon(profile)) return polygonCorners(profile, radius, offset);
  const round = radius + offset;
  const arc = arcAngles.map((angle): Vec2 => [round * Math.cos(angle), round * Math.sin(angle)]);
  if (profile === 'circle') return arc;
  const { flat, cornerY } = flattedCircle(radius, offset);
  return [[flat, cornerY], ...arc, [flat, -cornerY]];
}
