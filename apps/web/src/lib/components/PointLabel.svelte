<script lang="ts">
import type { HTMLAttributes } from 'svelte/elements';

let {
  text,
  tone = 'visible',
  highlighted = false,
  ...rest
}: Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> & {
  /** The point's name as a textbook writes it, such as A₁ or M. */
  text: string;
  /**
   * `visible`: on the near side of the solid. `hidden`: behind it, still readable, in dimmer text. `faded`: behind an opaque solid,
   * where it only hints at the point.
   */
  tone?: 'visible' | 'hidden' | 'faded';
  /** Named by the control in use. */
  highlighted?: boolean;
} = $props();
</script>

<!-- Decorative for screen readers: the panel names the points a section uses in its own fields. -->
<span {...rest} class={['point-label', tone, highlighted && 'highlighted']} aria-hidden="true">{text}</span>

<style>
  /* Small and readable over any face, fill or line, on its own background. */
  .point-label {
    padding: 0 var(--space-1);
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
    line-height: 1.5;
    color: var(--color-text);
    background: var(--color-bg);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-input);
    pointer-events: none;
    white-space: nowrap;
  }

  .point-label.hidden {
    color: var(--color-text-muted);
    border-color: var(--color-border);
  }

  .point-label.faded {
    opacity: 0.35;
  }

  .point-label.highlighted {
    border-color: var(--color-accent);
  }
</style>
