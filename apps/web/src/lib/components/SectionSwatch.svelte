<script lang="ts">
import { SECTION_COLORS } from '@diploma-3d/engine';

let {
  tone,
}: {
  /** The section's first (0) or second (1) plane, whose colour its cut faces have in the preview. */
  tone: 0 | 1;
} = $props();
</script>

<!-- Decorative: the text next to it names the section; the colour only matches the preview. -->
<span class="swatch" style:--swatch-color={SECTION_COLORS[tone]} aria-hidden="true"></span>

<style>
  .swatch {
    display: inline-block;
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    background: var(--swatch-color);
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
    vertical-align: -0.05em;
  }
</style>
