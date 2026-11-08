<script lang="ts">
import { GLB_MEDIA_TYPE } from '@diploma-3d/engine';
import { onMount, untrack } from 'svelte';

let {
  glb,
  viewKey,
  alt,
  onload,
  onerror,
  oncamerachange,
}: {
  glb: Uint8Array<ArrayBuffer>;
  /**
   * The shape of `glb`: a model of another shape is shown from the default direction. An edited one keeps the view, also
   * when its section changes: the new parts are placed in the GLB, and the camera has no part in that.
   */
  viewKey: string;
  alt: string;
  onload: (glb: Uint8Array<ArrayBuffer>) => void;
  onerror: (glb: Uint8Array<ArrayBuffer>) => void;
  /** The camera's direction in radians: θ around the vertical axis from the model's −Y side, φ from straight above. */
  oncamerachange?: (direction: { theta: number; phi: number }) => void;
} = $props();

/** The parts of model-viewer's camera API used here. */
type CameraElement = HTMLElement & {
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
  readonly updateComplete: Promise<boolean>;
  getCameraOrbit(): { theta: number; phi: number };
  jumpCameraToGoal(): void;
  requestUpdate(name?: string): void;
};

const DEFAULT_ORBIT = '35deg 62deg auto';

let elementDefined = $state(false);
let viewer = $state<CameraElement>();
let framedKey: string | undefined;

/**
 * Frames the whole model from `orbit`: radius, target and field of view return to "auto", which model-viewer derives
 * from the model's bounds and the element's current size. Unchanged attribute values would not be applied again, so the
 * properties are marked for update explicitly. Waiting for a pending update first lets the one that follows a model
 * load, which keeps the previous direction, finish before this one replaces it.
 */
async function frame(element: CameraElement, orbit: string) {
  await element.updateComplete;
  element.cameraOrbit = orbit;
  element.cameraTarget = 'auto auto auto';
  element.fieldOfView = 'auto';
  for (const property of ['cameraOrbit', 'cameraTarget', 'fieldOfView']) element.requestUpdate(property);
  await element.updateComplete;
  element.jumpCameraToGoal();
}

/** "Вписати модель": the complete model, seen from the current direction. */
export function fit(): void {
  if (viewer === undefined) return;
  const { theta, phi } = viewer.getCameraOrbit();
  void frame(viewer, `${theta}rad ${phi}rad auto`);
}

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

$effect(() => {
  if (viewer === undefined || oncamerachange === undefined) return;
  const [element, report] = [viewer, oncamerachange];
  const handleChange = () => {
    const { theta, phi } = element.getCameraOrbit();
    report({ theta, phi });
  };
  element.addEventListener('camera-change', handleChange);
  element.addEventListener('load', handleChange);
  return () => {
    element.removeEventListener('camera-change', handleChange);
    element.removeEventListener('load', handleChange);
  };
});

// The element stays mounted while models are replaced, so the camera and WebGL context are kept. A load event names
// the URL it loaded, which ties it to its GLB even when the source changes again before loading finishes.
$effect(() => {
  if (viewer === undefined) return;
  const element = viewer;
  const current = glb;
  const key = untrack(() => viewKey);
  const url = URL.createObjectURL(new Blob([current], { type: GLB_MEDIA_TYPE }));
  const handleLoad = (event: Event) => {
    if ((event as CustomEvent<{ url?: string }>).detail?.url !== url) return;
    // model-viewer itself keeps the viewing direction and refits the zoom whenever the model is replaced. The first
    // model already starts from the default orbit attribute.
    if (framedKey !== undefined && framedKey !== key) void frame(element, DEFAULT_ORBIT);
    framedKey = key;
    onload(current);
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
    camera-orbit={DEFAULT_ORBIT}
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
