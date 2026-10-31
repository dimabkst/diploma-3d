<script lang="ts">
import { GLB_MEDIA_TYPE } from '@diploma-3d/engine';
import { onMount } from 'svelte';

let {
  glb,
  alt,
  onload,
  onerror,
}: {
  glb: Uint8Array<ArrayBuffer>;
  alt: string;
  onload: () => void;
  onerror: () => void;
} = $props();

let elementDefined = $state(false);
let viewer = $state<HTMLElement>();
let src = $state<string>();

onMount(() => {
  let active = true;
  // Loaded on demand: three.js and model-viewer are by far the largest part of the bundle.
  import('@google/model-viewer').then(
    ({ ModelViewerElement }) => {
      // Every model gets a fresh blob URL, so cached entries could never be reused and would only keep replaced models
      // and their GPU resources alive.
      ModelViewerElement.modelCacheSize = 0;
      if (active) elementDefined = true;
    },
    () => {
      if (active) onerror();
    },
  );
  return () => {
    active = false;
  };
});

$effect(() => {
  const url = URL.createObjectURL(new Blob([glb], { type: GLB_MEDIA_TYPE }));
  src = url;
  return () => URL.revokeObjectURL(url);
});

// Keyboard focus lands on an element inside model-viewer's shadow root that exposes no CSS part; without this rule it
// shows the browser's default ring instead of the shared focus outline. It is inset because the viewer clips overflow.
const FOCUS_STYLES = `.userInput:focus { outline: none; }
.userInput:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }`;

$effect(() => {
  const shadowRoot = viewer?.shadowRoot;
  if (shadowRoot == null) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(FOCUS_STYLES);
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
});

$effect(() => {
  if (viewer === undefined) return;
  const element = viewer;
  const handleLoad = () => onload();
  const handleError = () => onerror();
  element.addEventListener('load', handleLoad);
  element.addEventListener('error', handleError);
  return () => {
    element.removeEventListener('load', handleLoad);
    element.removeEventListener('error', handleError);
  };
});
</script>

{#if elementDefined}
  <!-- The built-in "legacy" environment has a directional key light, so adjacent flat faces get clearly different tones. -->
  <model-viewer
    bind:this={viewer}
    class="viewer"
    {src}
    {alt}
    camera-controls
    camera-orbit="35deg 62deg auto"
    environment-image="legacy"
    tone-mapping="neutral"
    interaction-prompt="none"
  >
    <div slot="progress-bar"></div>
  </model-viewer>
{/if}

<style>
  .viewer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    --poster-color: transparent;
  }
</style>
