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
  onload: (glb: Uint8Array<ArrayBuffer>) => void;
  onerror: (glb: Uint8Array<ArrayBuffer>) => void;
} = $props();

let elementDefined = $state(false);
let viewer = $state<HTMLElement>();

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
      if (active) onerror(glb);
    },
  );
  return () => {
    active = false;
  };
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

// The element stays mounted while models are replaced, so the camera and WebGL context are kept. A load event names
// the URL it loaded, which ties it to its GLB even when the source changes again before loading finishes.
$effect(() => {
  if (viewer === undefined) return;
  const element = viewer;
  const current = glb;
  const url = URL.createObjectURL(new Blob([current], { type: GLB_MEDIA_TYPE }));
  const handleLoad = (event: Event) => {
    if ((event as CustomEvent<{ url?: string }>).detail?.url === url) onload(current);
  };
  const handleError = () => onerror(current);
  element.addEventListener('load', handleLoad);
  element.addEventListener('error', handleError);
  element.setAttribute('src', url);
  return () => {
    element.removeEventListener('load', handleLoad);
    element.removeEventListener('error', handleError);
    URL.revokeObjectURL(url);
  };
});
</script>

{#if elementDefined}
  <!-- The built-in "legacy" environment has a directional key light, so adjacent flat faces get clearly different tones. -->
  <model-viewer
    bind:this={viewer}
    class="viewer"
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
