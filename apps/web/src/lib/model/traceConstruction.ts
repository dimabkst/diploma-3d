/**
 * Picking the base element of a triangular prism's longitudinal plane along a line of its base on the model: the vertex of a
 * median, an altitude or a bisector, the side a midline is parallel to. The plane, its trace and its position are the
 * longitudinal mode's own, see `traceSelection`, `followTrace` and the engine's `boxTraceLine`; only the choice is made here.
 */
import { type BoxVertices, boxTraceLine } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment, BoxVertex } from '@diploma-3d/schema';
import type { BoxChoices, BoxKeysOf, TraceChoice } from './box.ts';
import { constructionKeys } from './throughPoint.ts';

/** What a trace is chosen by: a base vertex, or a base side. */
export type TraceTarget = 'vertex' | 'side';

export const traceTargetOf = (kind: TraceChoice): TraceTarget | undefined =>
  kind === 'median' || kind === 'height' || kind === 'bisector' ? 'vertex' : kind === 'midline' ? 'side' : undefined;

/** Whether a box's longitudinal plane is along a line of its base chosen by a vertex or a side, picked on the model. */
export const tracePilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  constructionKeys(keys) && choices[keys.Section] === 'longitudinal' && traceTargetOf(choices[keys.Trace]) !== undefined;

/** The lower base's vertex a vertex of either base stands for: A for A₁. */
export const lowerVertex = (vertex: BoxVertex): BoxVertex => vertex.replace('1', '') as BoxVertex;

/** The lower base's side a side of either base stands for: AB for A₁B₁. */
export const lowerSide = ([first, second]: readonly [BoxVertex, BoxVertex]): BoxSegment => [
  lowerVertex(first),
  lowerVertex(second),
];

type Vec = readonly [number, number, number];

/**
 * The longitudinal plane's trace on the lower base, as drawn: the engine's own line of the base, clipped to the base polygon.
 * Undefined for a trace at an angle, or a line that misses the base.
 */
export function baseTrace(
  vertices: BoxVertices,
  corners: readonly BoxVertex[],
  spec: Extract<BoxSectionSpec, { type: 'longitudinal' }>,
): readonly [Vec, Vec] | undefined {
  const line = boxTraceLine(vertices, spec);
  if (line === undefined) return undefined;
  const { point: p, direction: d } = line;
  const hits: number[] = [];
  for (const [index, name] of corners.entries()) {
    const a = vertices[name];
    const b = vertices[corners[(index + 1) % corners.length] as BoxVertex];
    const e = [b[0] - a[0], b[1] - a[1]] as const;
    // p + t·d = a + s·e in the base plane: Cramer's rule on the 2 × 2 system.
    const det = d[0] * -e[1] - d[1] * -e[0];
    if (Math.abs(det) < 1e-12) continue;
    const [rx, ry] = [a[0] - p[0], a[1] - p[1]];
    const t = (rx * -e[1] - ry * -e[0]) / det;
    const s = (d[0] * ry - d[1] * rx) / det;
    if (s >= -1e-9 && s <= 1 + 1e-9) hits.push(t);
  }
  if (hits.length < 2) return undefined;
  const at = (t: number): Vec => [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]];
  return [at(Math.min(...hits)), at(Math.max(...hits))];
}
