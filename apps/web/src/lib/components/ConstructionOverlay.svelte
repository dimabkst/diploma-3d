
<script lang="ts">
import { LINKED_PREVIEW_COLORS } from '@diploma-3d/engine';
import type { BoxVertex } from '@diploma-3d/schema';
import { onMount } from 'svelte';
import { vertexName } from '../model/box.ts';
import {
  type ConstructionGeometry,
  type ConstructionPick,
  type ConstructionView,
  CONSTRUCTION_HOVER_ATTRIBUTE as HOVER_ATTRIBUTE,
} from '../model/throughPoint.ts';
import PointLabel from './PointLabel.svelte';

/** The parts of model-viewer's camera API the overlay reads. */
type ViewerElement = HTMLElement & {
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  getCameraTarget(): { x: number; y: number; z: number };
  getFieldOfView(): number;
};

let {
  viewer,
  view,
  onpick,
}: {
  viewer: HTMLElement;
  view: ConstructionView;
  onpick: (pick: ConstructionPick) => void;
} = $props();

type Vec = readonly [number, number, number];
/** The camera as model-viewer renders with it: its position, its axes, the canvas's size and the projection's scale. */
type Camera = {
  readonly position: Vec;
  readonly right: Vec;
  readonly up: Vec;
  readonly forward: Vec;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
};

const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/**
 * model-viewer's camera, from its public state: it orbits its target at the orbit's distance, θ about the vertical axis from +Z
 * towards +X and φ from straight above, looks at the target with +Y up, and projects with the vertical field of view. The overlay
 * projects every point of the construction itself rather than through hotspots, which model-viewer moves only when it next
 * renders: a new M, segment and section are then placed in the same update as each other.
 */
function readCamera(element: ViewerElement): Camera {
  const { theta, phi, radius } = element.getCameraOrbit();
  const target = element.getCameraTarget();
  const centre: Vec = [target.x, target.y, target.z];
  const position: Vec = [
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  ];
  const forward = unit(minus(centre, position));
  const right = unit(cross(forward, [0, 1, 0]));
  const height = element.clientHeight;
  return {
    position,
    right,
    up: cross(right, forward),
    forward,
    width: element.clientWidth,
    height,
    scale: height / 2 / Math.tan((element.getFieldOfView() * Math.PI) / 360),
  };
}

const sameCamera = (a: Camera, b: Camera) =>
  a.width === b.width &&
  a.height === b.height &&
  a.scale === b.scale &&
  [a.position, a.forward, a.right].every((vector, index) =>
    vector.every((value, axis) => value === ([b.position, b.forward, b.right][index] as Vec)[axis]),
  );

// Followed every frame, and replaced only when it moved, so that a still view renders nothing.
let camera = $state.raw<Camera | undefined>();
onMount(() => {
  let frame = 0;
  const step = () => {
    const next = readCamera(viewer as ViewerElement);
    if (camera === undefined || !sameCamera(camera, next)) camera = next;
    frame = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(frame);
});

type Projected = {
  readonly points: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly facing: readonly boolean[];
};

/**
 * Where each point of the construction is on the canvas, and which faces turn towards the camera: an edge or a vertex whose faces
 * all turn away is hidden behind the convex solid. Derived from the geometry and the camera together.
 */
function project(geometry: ConstructionGeometry, at: Camera): Projected {
  const points: Record<string, { x: number; y: number }> = {};
  for (const [id, point] of Object.entries(geometry.points)) {
    const offset = minus(point, at.position);
    const depth = dot(offset, at.forward);
    if (!(depth > 0)) continue;
    points[id] = {
      x: at.width / 2 + (dot(offset, at.right) / depth) * at.scale,
      y: at.height / 2 - (dot(offset, at.up) / depth) * at.scale,
    };
  }
  const facing = geometry.faces.map(({ normal, point }) => dot(normal, minus(at.position, point)) > 0);
  return { points, facing };
}

const projected = $derived<Projected>(camera === undefined ? { points: {}, facing: [] } : project(view.geometry, camera));

// A tap chooses; a drag turns the model. Within this distance and time a press is a tap, wherever the camera went meanwhile.
const TAP_SLOP_PX = { mouse: 6, touch: 12 };
const TAP_MS = 600;
// How near a tap must be to a vertex or an edge on screen, more for a finger.
const VERTEX_REACH_PX = { mouse: 16, touch: 28 };
const EDGE_REACH_PX = { mouse: 10, touch: 22 };

const distanceToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * The element a tap at this point of the canvas chooses: the nearest vertex within reach, else the nearest edge; or none. Only
 * the targets count, except that a tap for the segment reaches every vertex, so that the page can say why one makes no segment.
 */
function pickAt(point: { x: number; y: number }, touch: boolean, anyVertex: boolean): ConstructionPick | undefined {
  if (view.field === undefined) return undefined;
  if (view.faceTargets.length > 0) return faceAt(point);
  const kind = touch ? 'touch' : 'mouse';
  const candidates =
    anyVertex && (view.field === 'segment' || view.field === 'diagonal') ? view.geometry.vertices : view.vertexTargets;
  const vertices = candidates
    .map((vertex) => ({ vertex, at: projected.points[vertex] }))
    .filter((candidate): candidate is { vertex: BoxVertex; at: { x: number; y: number } } => candidate.at !== undefined)
    .map(({ vertex, at }) => ({ vertex, distance: Math.hypot(point.x - at.x, point.y - at.y) }))
    .filter(({ distance }) => distance <= VERTEX_REACH_PX[kind])
    .sort((a, b) => a.distance - b.distance || a.vertex.localeCompare(b.vertex));
  if (vertices[0] !== undefined) return { kind: 'vertex', vertex: vertices[0].vertex };
  const edges = [...view.geometry.edges, ...(view.lines ?? [])]
    .filter(({ key }) => view.edgeTargets.includes(key))
    .flatMap(({ key, ends }) => {
      const [a, b] = [projected.points[ends[0]], projected.points[ends[1]]];
      return a === undefined || b === undefined ? [] : [{ key, distance: distanceToSegment(point, a, b) }];
    })
    .filter(({ distance }) => distance <= EDGE_REACH_PX[kind])
    .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return edges[0] === undefined ? undefined : { kind: 'edge', edge: edges[0].key };
}

onMount(() => {
  let press: { id: number; x: number; y: number; time: number; touch: boolean } | undefined;
  const down = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      touch: event.pointerType !== 'mouse',
    };
  };
  const up = (event: PointerEvent) => {
    const started = press;
    press = undefined;
    if (started === undefined || started.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - started.x, event.clientY - started.y);
    if (moved > TAP_SLOP_PX[started.touch ? 'touch' : 'mouse'] || event.timeStamp - started.time > TAP_MS) return;
    const box = viewer.getBoundingClientRect();
    const pick = pickAt({ x: event.clientX - box.left, y: event.clientY - box.top }, started.touch, true);
    if (pick !== undefined) onpick(pick);
  };
  const cancel = () => {
    press = undefined;
  };
  // A mouse over a target, not while dragging, marks it and shows the pointer cursor.
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.buttons !== 0) {
      hovered = undefined;
      return;
    }
    const box = viewer.getBoundingClientRect();
    hovered = pickAt({ x: event.clientX - box.left, y: event.clientY - box.top }, false, false);
  };
  const leave = () => {
    hovered = undefined;
  };
  const listeners: [string, (event: PointerEvent) => void][] = [
    ['pointerdown', down],
    ['pointerup', up],
    ['pointercancel', cancel],
    ['pointermove', move],
    ['pointerleave', leave],
  ];
  for (const [type, listener] of listeners) viewer.addEventListener(type, listener as EventListener);
  return () => {
    for (const [type, listener] of listeners) viewer.removeEventListener(type, listener as EventListener);
  };
});

let hovered = $state.raw<ConstructionPick | undefined>();
$effect(() => {
  viewer.toggleAttribute(HOVER_ATTRIBUTE, hovered !== undefined);
  return () => viewer.removeAttribute(HOVER_ATTRIBUTE);
});
const pickKey = (pick: ConstructionPick) =>
  pick.kind === 'vertex' ? `vertex:${pick.vertex}` : pick.kind === 'edge' ? `edge:${pick.edge}` : `face:${pick.face}`;
const isHovered = (pick: ConstructionPick) => hovered !== undefined && pickKey(hovered) === pickKey(pick);

/** Whether a point lies within a convex polygon on screen, its border included, whichever way round its corners run. */
function within(point: { x: number; y: number }, corners: readonly { x: number; y: number }[]): boolean {
  let sign = 0;
  for (const [index, a] of corners.entries()) {
    const b = corners[(index + 1) % corners.length] as { x: number; y: number };
    const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (side === 0) continue;
    if (sign !== 0 && Math.sign(side) !== sign) return false;
    sign = Math.sign(side);
  }
  return true;
}

/**
 * The face a tap at this point chooses: of the solid's faces turned towards the camera, the one under the pointer, which on a convex
 * solid is the nearest there; faces turned away lie behind it, to be reached by turning the model or by name.
 */
function faceAt(point: { x: number; y: number }): ConstructionPick | undefined {
  for (const [index, face] of view.geometry.faces.entries()) {
    if (!view.faceTargets.includes(face.name) || projected.facing[index] !== true) continue;
    const corners = face.corners.map(at);
    if (corners.some((corner) => corner === undefined)) continue;
    if (within(point, corners as { x: number; y: number }[])) return { kind: 'face', face: face.name };
  }
  return undefined;
}

const facePoints = (corners: readonly string[]) =>
  corners
    .map((corner) => at(corner))
    .filter((corner) => corner !== undefined)
    .map(({ x, y }) => `${x},${y}`)
    .join(' ');

const at = (id: string) => projected.points[id];
const segmentKeyOf = (ends: readonly [BoxVertex, BoxVertex]) => `${ends[0]}-${ends[1]}`;
// The sections in their planes' colours, as their cut faces have in the preview.
const [firstColor, secondColor] = LINKED_PREVIEW_COLORS.planes;
const sectionOutlines = $derived(
  view.geometry.sections.map((corners) =>
    corners
      .map(at)
      .filter((point) => point !== undefined)
      .map(({ x, y }) => `${x},${y}`)
      .join(' '),
  ),
);
const segmentEnds = $derived(view.geometry.segment === undefined ? undefined : view.geometry.segment.ends.map(at));
const pointEdgeEnds = $derived(view.geometry.pointEdge === undefined ? undefined : view.geometry.pointEdge.ends.map(at));
const m = $derived(view.geometry.m === undefined ? undefined : at(view.geometry.m));
const pendingAt = $derived(view.pending === undefined ? undefined : at(view.pending));

// The labels stand a little outside each vertex, away from the solid's middle on screen, so that neither the vertex, nor its
// target ring, nor the edges meeting there are covered; only the text moves, never the point it names.
const LABEL_OFFSET_PX = 18;
// A label's half size, about: it is kept this far inside the canvas, never cut off at its edge.
const LABEL_HALF_PX = { x: 14, y: 10 };
const inside = (x: number, y: number) => ({
  x: Math.min(Math.max(x, LABEL_HALF_PX.x), (camera?.width ?? x) - LABEL_HALF_PX.x),
  y: Math.min(Math.max(y, LABEL_HALF_PX.y), (camera?.height ?? y) - LABEL_HALF_PX.y),
});
const labels = $derived.by(() => {
  const shown = view.geometry.vertices.flatMap((vertex) => {
    const point = at(vertex);
    return point === undefined ? [] : [{ vertex, point }];
  });
  const middle = shown.reduce((sum, { point }) => ({ x: sum.x + point.x / shown.length, y: sum.y + point.y / shown.length }), {
    x: 0,
    y: 0,
  });
  return shown.map(({ vertex, point }) => {
    const [dx, dy] = [point.x - middle.x, point.y - middle.y];
    const length = Math.hypot(dx, dy);
    const [ux, uy] = length < 1 ? [Math.SQRT1_2, -Math.SQRT1_2] : [dx / length, dy / length];
    const faces = view.geometry.vertexFaces[vertex] ?? [];
    return {
      vertex,
      ...inside(point.x + ux * LABEL_OFFSET_PX, point.y + uy * LABEL_OFFSET_PX),
      hidden: !faces.some((face) => projected.facing[face] === true),
    };
  });
});
</script>

<!-- Display only: drawn over the viewer, it lets every pointer event through to the camera and to the picking above. -->
<svg class="overlay" style:--section-color={firstColor} style:--second-color={secondColor} aria-hidden="true">
  <!-- The face a plane is measured from, and the one under the pointer while a face is being chosen; under the sections. -->
  {#each view.geometry.faces as face, index (face.name)}
    {@const reference = view.geometry.referenceFace === face.name}
    {@const hover = isHovered({ kind: 'face', face: face.name })}
    {#if reference || hover}
      <polygon
        class={['face', reference && 'reference', hover && 'hover', projected.facing[index] !== true && 'behind']}
        points={facePoints(face.corners)}
        data-face={face.name}
      />
    {/if}
  {/each}
  {#each sectionOutlines as outline, index (index)}
    {#if outline !== ''}
      <polygon class={['section', index === 1 && 'second']} points={outline} />
    {/if}
  {/each}
  {#each view.geometry.edges as edge (edge.key)}
    {@const [a, b] = [at(edge.ends[0]), at(edge.ends[1])]}
    {#if a !== undefined && b !== undefined}
      {@const visible = edge.faces.some((face) => projected.facing[face] === true)}
      <line
        class={[
          'edge',
          !visible && 'hidden',
          view.edgeTargets.includes(edge.key) && 'target',
          isHovered({ kind: 'edge', edge: edge.key }) && 'hover',
        ]}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
      />
    {/if}
  {/each}
  <!-- A longitudinal plane's trace on the base: in the section's colour while the plane passes through it. -->
  {#if view.geometry.trace !== undefined}
    {@const [a, b] = [at(view.geometry.trace.ends[0]), at(view.geometry.trace.ends[1])]}
    {#if a !== undefined && b !== undefined}
      <line
        class={['trace-line', view.geometry.trace.through ? 'in-plane' : 'selected']}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
      />
    {/if}
  {/if}
  <!-- Lines besides the edges, such as the base diagonals offered: faint while offered, marked when chosen. -->
  {#each view.lines ?? [] as line (line.key)}
    {@const [a, b] = [at(line.ends[0]), at(line.ends[1])]}
    {#if a !== undefined && b !== undefined}
      <line
        class={['offered', line.state, isHovered({ kind: 'edge', edge: line.key }) && 'hover']}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        data-line={line.key}
      />
    {/if}
  {/each}
  <!-- M's edge as chosen, also one that gives no section with the segment, which stays marked until it is changed. -->
  {#if pointEdgeEnds !== undefined && pointEdgeEnds[0] !== undefined && pointEdgeEnds[1] !== undefined}
    <line
      class={['point-edge', view.geometry.pointEdge?.eligible === false && 'ineligible', view.field === 'point' && 'active']}
      x1={pointEdgeEnds[0].x}
      y1={pointEdgeEnds[0].y}
      x2={pointEdgeEnds[1].x}
      y2={pointEdgeEnds[1].y}
    />
  {/if}
  {#if segmentEnds !== undefined && segmentEnds[0] !== undefined && segmentEnds[1] !== undefined}
    <line
      class={['segment', view.field === 'segment' && 'active']}
      x1={segmentEnds[0].x}
      y1={segmentEnds[0].y}
      x2={segmentEnds[1].x}
      y2={segmentEnds[1].y}
      data-segment={view.geometry.segment === undefined ? undefined : segmentKeyOf(view.geometry.segment.ends)}
    />
  {/if}
  {#if view.field === 'segment' || view.field === 'diagonal' || view.field === 'normal' || view.field === 'trace'}
    {#each view.vertexTargets as vertex (vertex)}
      {@const point = at(vertex)}
      {#if point !== undefined && vertex !== view.pending}
        <!-- Around the vertex itself; its label stands beside it. -->
        <circle
          class={[
            'target-vertex',
            view.pending !== undefined && 'eligible',
            isHovered({ kind: 'vertex', vertex }) && 'hover',
          ]}
          cx={point.x}
          cy={point.y}
          r="14"
        />
      {/if}
    {/each}
  {/if}
  {#if pendingAt !== undefined}
    <circle class="pending" cx={pendingAt.x} cy={pendingAt.y} r="16" />
    <!-- The segment the first vertex would make with the vertex under the pointer, before it is chosen. -->
    {#if hovered?.kind === 'vertex' && hovered.vertex !== view.pending && view.vertexTargets.includes(hovered.vertex)}
      {@const end = at(hovered.vertex)}
      {#if end !== undefined}
        <line class="offered candidate hover-preview" x1={pendingAt.x} y1={pendingAt.y} x2={end.x} y2={end.y} />
      {/if}
    {/if}
  {/if}
  {#if m !== undefined}
    <circle class={['m', view.field === 'point' && 'active']} cx={m.x} cy={m.y} r="6" />
  {/if}
</svg>
<!-- Above every line and fill of the construction, so that each label stays readable, those of hidden vertices too, which a tap
     still chooses; dimmer there, as their edges are dashed. Display only, like the drawing under it. -->
<div class="labels" aria-hidden="true">
  {#each labels as label (label.vertex)}
    <span class="label-at" style:transform={`translate(${label.x}px, ${label.y}px)`}>
      <PointLabel text={vertexName(label.vertex)} tone={label.hidden ? 'hidden' : 'visible'} />
    </span>
  {/each}
  {#if m !== undefined}
    {@const placed = inside(m.x + 12, m.y - 14)}
    <span class="label-at" style:transform={`translate(${placed.x}px, ${placed.y}px)`}>
      <PointLabel text="M" tone="visible" />
    </span>
  {/if}
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .section {
    fill: color-mix(in srgb, var(--section-color) 25%, transparent);
    stroke: var(--section-color);
    stroke-width: 2.5px;
    stroke-linejoin: round;
  }

  /* A face chosen as a reference: a cool tint and outline, unlike any section's warm or green fill. */
  .face {
    stroke-linejoin: round;
  }

  .face.reference {
    fill: color-mix(in srgb, var(--color-link) 16%, transparent);
    stroke: var(--color-link-hover);
    stroke-width: 2.5px;
  }

  .face.reference.behind {
    fill: color-mix(in srgb, var(--color-link) 8%, transparent);
    stroke-dasharray: 6 5;
  }

  .face.hover:not(.reference) {
    fill: color-mix(in srgb, var(--color-accent) 12%, transparent);
    stroke: var(--color-accent);
    stroke-width: 2px;
  }

  .face.reference.hover {
    stroke: var(--color-accent);
  }

  .section.second {
    fill: color-mix(in srgb, var(--second-color) 25%, transparent);
    stroke: var(--second-color);
  }

  .labels {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* A zero-size anchor at the label's centre; the label is centred on it. */
  .label-at {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0;
    height: 0;
  }

  .edge {
    stroke: var(--color-text);
    stroke-width: 1.5px;
    stroke-linecap: round;
  }

  .edge.hidden {
    stroke: var(--color-text-muted);
    stroke-dasharray: 6 5;
  }

  /* What a tap may choose: drawn over the edge in the link colour, its dashes kept where it is hidden. */
  .edge.target {
    stroke: var(--color-link-hover);
    stroke-width: 3px;
  }

  .edge.hover {
    stroke: var(--color-accent);
    stroke-width: 4px;
  }

  .offered,
  .trace-line {
    stroke-linecap: round;
  }

  .offered.candidate {
    stroke: var(--color-link-hover);
    stroke-width: 2px;
    stroke-dasharray: 6 6;
    opacity: 0.75;
  }

  /* Chosen, the plane moved off it: marked, but not in the section's colour. */
  .offered.selected,
  .trace-line.selected {
    stroke: var(--color-text);
    stroke-width: 3.5px;
  }

  /* Chosen, the plane through it: in the section's colour, as a segment of the plane is. */
  .offered.in-plane,
  .trace-line.in-plane {
    stroke: var(--section-color);
    stroke-width: 4px;
  }

  .offered.hover {
    stroke: var(--color-accent);
    stroke-width: 4px;
    stroke-dasharray: none;
    opacity: 1;
  }

  /* M's edge as chosen: thicker than the solid's own edges. */
  .point-edge {
    stroke: var(--color-text);
    stroke-width: 3.5px;
    stroke-linecap: round;
  }

  .point-edge.active {
    stroke-width: 5px;
  }

  /* Chosen, but giving no section with the segment: still shown, marked as the problem. */
  .point-edge.ineligible {
    stroke: var(--color-error);
    stroke-dasharray: 3 6;
  }

  /* The segment lies in the plane: drawn in its section's colour. */
  .segment {
    stroke: var(--section-color);
    stroke-width: 5px;
    stroke-linecap: round;
  }

  .segment.active {
    stroke-width: 7px;
  }

  .target-vertex {
    fill: none;
    stroke: var(--color-link-hover);
    stroke-width: 1.5px;
  }

  .target-vertex.eligible {
    fill: color-mix(in srgb, var(--color-link-hover) 20%, transparent);
    stroke-width: 2.5px;
  }

  .target-vertex.hover {
    stroke: var(--color-accent);
    stroke-width: 3px;
  }

  .pending {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 3px;
  }

  .m {
    fill: var(--section-color);
    stroke: var(--color-bg);
    stroke-width: 2px;
  }

  .m.active {
    stroke: var(--color-accent);
    stroke-width: 3px;
  }

</style>
