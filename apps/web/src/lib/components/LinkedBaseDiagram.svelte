<script lang="ts">
import { LINKED_PREVIEW_COLORS } from '@diploma-3d/engine';
import type { LinkedDiagram, LinkedPoint } from '../model/parameters.ts';
import type { LinkedElement } from '../shapes.ts';

let {
  diagram,
  active = [],
}: {
  /** The construction to draw; undefined while it is not valid, when the last valid one stays. */
  diagram: LinkedDiagram | undefined;
  /** What the control being used changes: drawn stronger, the rest receding. */
  active?: readonly LinkedElement[];
} = $props();

// A requested value that gives no section changes nothing: the last valid construction stays drawn.
let shown = $state.raw<LinkedDiagram>();
$effect.pre(() => {
  if (diagram !== undefined) shown = diagram;
});

// Seen from above, x to the right and y up: SVG's y runs down.
const at = ({ x, y }: LinkedPoint) => ({ x, y: -y });
// A point's label just outside the circle, along its radius.
const labelAt = ({ x, y }: LinkedPoint) => {
  const norm = Math.hypot(x, y) || 1;
  return { x: (x / norm) * 1.24, y: (-y / norm) * 1.24 };
};

const emphasis = (element: LinkedElement) => (active.length === 0 ? undefined : active.includes(element) ? 'active' : 'receding');
// The same colours as the preview: the first, second and third plane; the shared generatrix in the outlines' colour.
const [first, second, third] = LINKED_PREVIEW_COLORS.planes;
</script>

<figure
  class="diagram"
  style:--first-color={first}
  style:--second-color={second}
  style:--third-color={third}
>
  <svg viewBox="-1.45 -1.45 2.9 2.9" role="img" aria-labelledby="linked-diagram-caption">
    <circle class="base" cx="0" cy="0" r="1" />
    {#if shown !== undefined}
      {@const a = at(shown.a)}
      {@const b = at(shown.b)}
      {@const c = at(shown.c)}
      {#if shown.third}
        <line class={['chord', 'third', emphasis('BC')]} x1={b.x} y1={b.y} x2={c.x} y2={c.y} />
      {/if}
      <line class={['chord', 'first', emphasis('AB')]} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line class={['chord', 'second', emphasis('AC')]} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />
      {#if shown.alternative !== undefined && active.includes('alternative')}
        {@const other = at(shown.alternative)}
        <line class="chord second alternative" x1={a.x} y1={a.y} x2={other.x} y2={other.y} />
        <circle class="point second alternative" cx={other.x} cy={other.y} r="0.05" />
      {/if}
      {#each [['A', shown.a, 'shared'], ['B', shown.b, 'first'], ['C', shown.c, 'second']] as const as [name, point, tone] (name)}
        {@const place = at(point)}
        {@const label = labelAt(point)}
        <circle class={['point', tone, emphasis(name)]} cx={place.x} cy={place.y} r="0.055" />
        <text class={['label', emphasis(name)]} x={label.x} y={label.y}>{name}</text>
      {/each}
    {/if}
  </svg>
  <figcaption id="linked-diagram-caption">
    Нижня основа згори: A — спільна твірна, AB — перший переріз, AC — другий{#if shown?.third}, BC — третій{/if}.
  </figcaption>
</figure>

<style>
  /* The planes' lines a shade darker on the light theme, where their pale colours fade; the shared generatrix as the outlines. */
  .diagram {
    --first-line: color-mix(in oklch, var(--first-color), black var(--section-line-shade));
    --second-line: color-mix(in oklch, var(--second-color), black var(--section-line-shade));
    --third-line: color-mix(in oklch, var(--third-color), black var(--section-line-shade));
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  svg {
    width: min(100%, 13rem);
    height: auto;
    overflow: visible;
  }

  figcaption {
    color: var(--color-text-muted);
    font-size: var(--text-small);
    text-align: center;
  }

  .base {
    fill: none;
    stroke: var(--color-border-strong);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }

  .chord {
    stroke-width: 2.5px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
    transition: opacity 200ms, stroke-width 200ms;
  }

  .chord.first {
    stroke: var(--first-line);
  }

  .chord.second {
    stroke: var(--second-line);
  }

  .chord.third {
    stroke: var(--third-line);
  }

  .point.shared {
    fill: var(--color-model-outline);
  }

  .point.first {
    fill: var(--first-line);
  }

  .point.second {
    fill: var(--second-line);
  }

  .point {
    transition: opacity 200ms;
  }

  .label {
    fill: var(--color-text);
    font-family: var(--font-heading);
    font-size: 0.2px;
    text-anchor: middle;
    dominant-baseline: central;
    transition: opacity 200ms;
  }

  .active.chord {
    stroke-width: 4.5px;
  }

  .active.point {
    stroke: var(--color-text);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }

  .receding {
    opacity: 0.35;
  }

  .alternative {
    opacity: 0.7;
  }

  .alternative.chord {
    stroke-dasharray: 4 4;
  }

  @media (prefers-reduced-motion: reduce) {
    .chord,
    .point,
    .label {
      transition: none;
    }
  }
</style>
