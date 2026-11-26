<script lang="ts">
import { SECTION_COLORS } from '@diploma-3d/engine';
import { compassPoint } from '../model/compass.ts';

let {
  directionDeg,
  camera,
}: {
  /** The horizontal direction an oblique plane rises along, from the model's +X towards +Y. */
  directionDeg: number;
  /** The viewer's camera, which this follows, so that the axes stay those of the model as it is turned. */
  camera: { readonly theta: number; readonly phi: number };
} = $props();

const RING = 34;
const AXIS = 30;
const ARROW = 28;
const LABEL = 42;
const HEAD_LENGTH = 9;
const HEAD_ANGLE_DEG = 16;

const at = (angleDeg: number, reach: number) => compassPoint(angleDeg, reach, camera);
const line = (angleDeg: number, reach: number) => {
  const { x, y } = at(angleDeg, reach);
  return { x2: x, y2: y };
};
const head = $derived(
  [
    at(directionDeg, ARROW),
    at(directionDeg - HEAD_ANGLE_DEG, ARROW - HEAD_LENGTH),
    at(directionDeg + HEAD_ANGLE_DEG, ARROW - HEAD_LENGTH),
  ]
    .map(({ x, y }) => `${x},${y}`)
    .join(' '),
);
const [axisX, axisY] = $derived([at(0, LABEL), at(90, LABEL)]);
const description = $derived(`Площина піднімається в напрямі ${directionDeg}° від осі X до осі Y`);
</script>

<!-- A sketch over the viewer, so it is in neither the preview's model nor the print file, and lets the drag through. -->
<!-- The arrow takes the first section's colour, as its cut faces have in the preview; a second plane rises the same way. -->
<figure class="section-compass" data-direction={directionDeg} style:--plane-color={SECTION_COLORS[0]}>
  <svg viewBox="-50 -50 100 100" role="img" aria-label={description}>
    <ellipse class="ring" rx={RING} ry={RING * Math.abs(Math.cos(camera.phi))} />
    <line class="axis" {...line(0, AXIS)} />
    <line class="axis" {...line(90, AXIS)} />
    <text class="axis-label" x={axisX.x} y={axisX.y}>X</text>
    <text class="axis-label" x={axisY.x} y={axisY.y}>Y</text>
    <line class="arrow" {...line(directionDeg, ARROW - HEAD_LENGTH)} />
    <polygon class="arrow-head" points={head} />
  </svg>
  <figcaption>підйом площини</figcaption>
</figure>

<style>
  .section-compass {
    /* A shade darker on the light theme, as the section's lines in the construction. */
    --plane-line: color-mix(in oklch, var(--plane-color), black var(--section-line-shade));
    position: absolute;
    z-index: 1;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    justify-items: center;
    width: 84px;
    margin: 0;
    padding: var(--space-1);
    pointer-events: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
  }

  svg {
    display: block;
    width: 100%;
  }

  figcaption {
    color: var(--color-text-muted);
    font-size: var(--text-tiny);
    line-height: 1.2;
    text-align: center;
  }

  .ring {
    fill: none;
    stroke: var(--color-border-strong);
  }

  .axis {
    stroke: var(--color-text-dim);
    stroke-width: 1.5;
  }

  .axis-label {
    fill: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: 13px;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .arrow {
    stroke: var(--plane-line);
    stroke-width: 3;
    stroke-linecap: round;
  }

  .arrow-head {
    fill: var(--plane-line);
  }
</style>
