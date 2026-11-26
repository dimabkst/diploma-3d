/**
 * Picking on the model the base element of a triangular prism's longitudinal plane, or of a triangular pyramid's plane through its
 * apex, along a line of its base: the vertex of a median, an altitude or a bisector, the side a midline is parallel to; and a
 * pyramid's lateral edge SV of its plane through SV and its height SH, whose foot H is where the apex projects, or through SV and a
 * point M of the base edge opposite, placed at the midpoint or a ratio BM : MC. The plane, its trace and its position are the
 * mode's own, see `traceSelection`, `followTrace` and the engine's `boxTraceLine`; only the choices are made here.
 */
import { type BoxVertices, boxTraceLine } from '@diploma-3d/engine';
import { type BoxSectionSpec, type BoxSegment, type BoxVertex, PYRAMID_APEX } from '@diploma-3d/schema';
import {
  type BoxChoices,
  type BoxContext,
  type BoxKeysOf,
  type BoxNumberKey,
  segmentName,
  type TraceChoice,
  traceSelection,
  vertexName,
} from './box.ts';
import { constructionKeys, PILOT_MESSAGES, type PilotDraft, pointPercentOf } from './throughPoint.ts';

/** What a trace is chosen by: a base vertex, a base side, or a pyramid's lateral edge SV. */
export type TraceTarget = 'vertex' | 'side' | 'lateral';

export const traceTargetOf = (kind: TraceChoice): TraceTarget | undefined =>
  kind === 'median' || kind === 'height' || kind === 'bisector'
    ? 'vertex'
    : kind === 'midline'
      ? 'side'
      : kind === 'edge-point' || kind === 'height-edge'
        ? 'lateral'
        : undefined;

/**
 * Whether a prism's longitudinal plane, or a pyramid's plane through its apex, is along a line of the base chosen by a vertex or a
 * side, or through a lateral edge, picked on the model.
 */
export const tracePilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  constructionKeys(keys, choices) &&
  (choices[keys.Section] === 'longitudinal' || choices[keys.Section] === 'through-apex') &&
  traceTargetOf(choices[keys.Trace]) !== undefined;

/** Whether the plane through the apex is the one through a lateral edge SV and a point M of a base edge, M placed by a ratio. */
export const apexPointActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  tracePilotActive(keys, choices) && choices[keys.Section] === 'through-apex' && choices[keys.Trace] === 'edge-point';

/** M's share of its base edge BC from B, in percent: 50 at the midpoint, 100 a / (a + b) for BM : MC = a : b. */
export const apexPointPercent = (keys: BoxKeysOf, choices: BoxChoices, read: (key: BoxNumberKey) => number | undefined) =>
  pointPercentOf(choices[keys.TracePointMode], read(keys.TracePointRatioFirst), read(keys.TracePointRatioSecond));

/**
 * The plane through the lateral edge SV and M on the base edge BC as drafted, checked before any plane is made: the ratio a pair
 * of numbers not both zero, and M not at an end joined to V by a base edge, which gives that lateral face; M at another end is a
 * diagonal section. Whether the parts are thick enough is the section's own check.
 */
export function apexDraft(
  keys: BoxKeysOf,
  choices: BoxChoices,
  values: Readonly<Record<string, number | undefined>>,
  context: BoxContext,
  ratioErrors: Readonly<Record<string, string | undefined>>,
): PilotDraft {
  const { vertex, segment } = traceSelection(keys, choices, context);
  if (vertex === undefined) return { status: 'incomplete', message: 'Оберіть бічне ребро.' };
  if (segment === undefined) {
    return {
      status: 'invalid',
      problem: 'face',
      message: `Жодна точка основи не дає з ${segmentName([PYRAMID_APEX, vertex])} перерізу. Оберіть інше бічне ребро.`,
    };
  }
  if (choices[keys.TracePointMode] === 'ratio') {
    const error = ratioErrors[keys.TracePointRatioFirst] ?? ratioErrors[keys.TracePointRatioSecond];
    if (error !== undefined) return { status: 'invalid', problem: 'ratio', message: error };
  }
  const percent = apexPointPercent(keys, choices, (key) => values[key]);
  if (percent === undefined) return { status: 'invalid', problem: 'ratio', message: PILOT_MESSAGES.zeroRatio };
  const end = percent <= 0 ? segment[0] : percent >= 100 ? segment[1] : undefined;
  // M at an end of its edge is a base vertex: with SV a lateral face where V and it are joined by a base edge, as B is to A of a
  // square SABCD; otherwise a diagonal section, as C gives SAC, which the section's own checks then take.
  const adjacent =
    end !== undefined && context.topology.edges.some(([a, b]) => (a === vertex && b === end) || (a === end && b === vertex));
  if (end !== undefined && adjacent) {
    const face = ([PYRAMID_APEX, vertex, end] as BoxVertex[]).map((name) => vertexName(name)).join('');
    return {
      status: 'invalid',
      problem: 'face',
      message:
        `Точка M збігається з вершиною ${vertexName(end)}: площина ${face} — грань піраміди. ` +
        `Пересуньте M уздовж ${segmentName(segment)} від вершини ${vertexName(end)}.`,
    };
  }
  return { status: 'valid', percent };
}

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
  spec: Extract<BoxSectionSpec, { type: 'longitudinal' | 'through-apex' }>,
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
