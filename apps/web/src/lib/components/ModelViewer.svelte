<script lang="ts">
import { GLB_MEDIA_TYPE, type VertexLabel } from '@diploma-3d/engine';
import { onMount, untrack } from 'svelte';
import type { PreviewHighlight } from '../shapes.ts';

const NO_HIGHLIGHT: PreviewHighlight = { materials: [], labels: [] };

let {
  glb,
  viewKey,
  alt,
  onload,
  onerror,
  oncamerachange,
  labels = [],
  highlight: givenHighlight,
}: {
  glb: Uint8Array<ArrayBuffer>;
  /**
   * Named points of `glb`, in its glTF coordinates, such as a cube's vertices, each copy where its part is shown; they are
   * shown with the model they belong to once it has loaded, and turn with it.
   */
  labels?: readonly VertexLabel[];
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
  /**
   * What the control in use changes, shown stronger: the GLB's materials by name, a section's planes (`plane-…`) lit and its
   * guides (`guide-…`) kept bright while the others recede, and the labels by their shown names.
   */
  highlight?: PreviewHighlight | undefined;
} = $props();

/** The parts of model-viewer's camera and hotspot API used here. */
type CameraElement = HTMLElement & {
  updateHotspot(config: { name: string; position: string }): void;
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
  readonly updateComplete: Promise<boolean>;
  getCameraOrbit(): { theta: number; phi: number };
  jumpCameraToGoal(): void;
  requestUpdate(name?: string): void;
};

const DEFAULT_ORBIT = '35deg 62deg auto';

/** The parts of model-viewer's scene-graph API used to highlight materials. */
type SceneMaterial = {
  readonly name: string;
  readonly pbrMetallicRoughness: { readonly baseColorFactor: readonly number[] };
  ensureLoaded(): Promise<void>;
  setEmissiveFactor(rgb: [number, number, number]): void;
};

// How strongly a highlighted plane glows in its own colour, and how far the guides not concerned recede.
const LIT_PLANE = 0.55;
const RECEDING_GUIDE = 0.25;

/**
 * Lights the highlighted materials in their own colour: a plane's faces glow, the guides concerned stay bright and the others
 * recede; with nothing highlighted, every guide is bright and no plane glows. Only display materials change.
 */
async function applyHighlight(element: CameraElement, { materials: names }: PreviewHighlight): Promise<void> {
  const materials = (element as unknown as { model?: { materials: readonly SceneMaterial[] } }).model?.materials ?? [];
  const lit = new Set(names);
  for (const material of materials) {
    const guide = material.name.startsWith('guide-');
    if (!guide && !material.name.startsWith('plane-')) continue;
    // model-viewer loads a material's properties on demand; reading them before throws.
    await material.ensureLoaded();
    const [r = 0, g = 0, b = 0] = material.pbrMetallicRoughness.baseColorFactor;
    const factor = guide
      ? lit.size === 0 || lit.has(material.name)
        ? 1
        : RECEDING_GUIDE
      : lit.has(material.name)
        ? LIT_PLANE
        : 0;
    material.setEmissiveFactor([r * factor, g * factor, b * factor]);
  }
}

/** The highlight, never in the way of showing the model: a model replaced meanwhile only loses its emphasis. */
const highlightSafely = (element: CameraElement, shown: PreviewHighlight) =>
  applyHighlight(element, shown).catch(() => undefined);

const highlight = $derived(givenHighlight ?? NO_HIGHLIGHT);

let elementDefined = $state(false);
// The labels of the model on screen: a new model's are shown with it, not over the one it replaces; see `start`.
let shownLabels = $state.raw<readonly VertexLabel[]>([]);

// One hotspot per copy: model-viewer gives all hotspots of one slot name a single position.
const slotOf = ({ name, parts }: VertexLabel) => `hotspot-${name}-${parts.join('-') || 'whole'}`;
const positionOf = ({ position }: VertexLabel) => position.map((value) => `${value}m`).join(' ');
// The direction towards the camera, glTF axes; the labels of corners whose faces all turn away from it are dimmed.
let towardsCamera = $state.raw<readonly [number, number, number]>([0, 0, 1]);

const inView = ({ faceNormals }: VertexLabel) =>
  faceNormals.some(([x, y, z]) => x * towardsCamera[0] + y * towardsCamera[1] + z * towardsCamera[2] > 0);

// model-viewer reads a hotspot's data-position only when the hotspot is added; a kept one is moved explicitly.
$effect(() => {
  if (viewer === undefined) return;
  for (const label of shownLabels) viewer.updateHotspot({ name: slotOf(label), position: positionOf(label) });
});

$effect(() => {
  if (viewer === undefined || shownLabels.length === 0) return;
  const element = viewer;
  // model-viewer's orbit: θ about the vertical axis from +Z towards +X, φ from straight above.
  const update = () => {
    const { theta, phi } = element.getCameraOrbit();
    towardsCamera = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
  };
  update();
  element.addEventListener('camera-change', update);
  element.addEventListener('load', update);
  return () => {
    element.removeEventListener('camera-change', update);
    element.removeEventListener('load', update);
  };
});
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

/** A model to show: its GLB, its labels, and the shape it is of, which decides whether the view is reset. */
type Shown = { readonly glb: Uint8Array<ArrayBuffer>; readonly labels: readonly VertexLabel[]; readonly key: string };

/**
 * The element stays mounted while models are replaced, so the camera and WebGL context are kept. One model loads at a time:
 * one asked for meanwhile waits, and only the latest one waiting is loaded, as nothing ever shows the others. So each of
 * model-viewer's events belongs to the model last given to it, also its "before-render", which names no model: it follows the
 * new scene's placement and comes before its first frame, and the labels of that very model take their places there. Its
 * "load" comes two frames after that frame, too late for them.
 */
let loading: (Shown & { readonly url: string }) | undefined;
let waiting: Shown | undefined;
let shownUrl: string | undefined;

function start(element: CameraElement, next: Shown) {
  const url = URL.createObjectURL(new Blob([next.glb], { type: GLB_MEDIA_TYPE }));
  loading = { ...next, url };
  element.setAttribute('src', url);
}

function finish(element: CameraElement) {
  loading = undefined;
  const next = waiting;
  waiting = undefined;
  if (next !== undefined) start(element, next);
}

$effect(() => {
  if (viewer === undefined) return;
  const element = viewer;
  const showLabels = () => {
    if (loading === undefined || element.getAttribute('src') !== loading.url) return;
    const { labels: next } = loading;
    // The hotspots kept move now, before the frame; new ones are added with their positions when Svelte adds them.
    for (const label of next) element.updateHotspot({ name: slotOf(label), position: positionOf(label) });
    shownLabels = next;
  };
  const handleLoad = (event: Event) => {
    if (loading === undefined || (event as CustomEvent<{ url?: string }>).detail?.url !== loading.url) return;
    const { glb: current, key, url } = loading;
    showLabels();
    // model-viewer itself keeps the viewing direction and refits the zoom whenever the model is replaced. The first
    // model already starts from the default orbit attribute.
    if (framedKey !== undefined && framedKey !== key) void frame(element, DEFAULT_ORBIT);
    framedKey = key;
    if (shownUrl !== undefined) URL.revokeObjectURL(shownUrl);
    shownUrl = url;
    finish(element);
    onload(current);
    void highlightSafely(
      element,
      untrack(() => highlight),
    );
  };
  const handleError = () => {
    if (loading === undefined) return;
    const { glb: current, url } = loading;
    URL.revokeObjectURL(url);
    finish(element);
    onerror(current);
  };
  element.addEventListener('before-render', showLabels);
  element.addEventListener('load', handleLoad);
  element.addEventListener('error', handleError);
  return () => {
    element.removeEventListener('before-render', showLabels);
    element.removeEventListener('load', handleLoad);
    element.removeEventListener('error', handleError);
  };
});

$effect(() => {
  if (viewer !== undefined) void highlightSafely(viewer, highlight);
});

$effect(() => {
  if (viewer === undefined) return;
  const next = { glb, labels: untrack(() => labels), key: untrack(() => viewKey) };
  if (loading === undefined) start(viewer, next);
  else waiting = next;
});

onMount(() => () => {
  for (const url of [shownUrl, loading?.url]) if (url !== undefined) URL.revokeObjectURL(url);
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
    {#each shownLabels as label (slotOf(label))}
      <!-- Decorative for screen readers: the panel names the vertices a section uses in its own fields. -->
      <span
        {...{ slot: slotOf(label) }}
        class="vertex-label"
        class:hidden={!inView(label)}
        class:highlighted={highlight.labels.includes(label.name)}
        data-position={positionOf(label)}
        data-parts={label.parts.join(' ')}
        aria-hidden="true">{label.name}</span
      >
    {/each}
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

  /* model-viewer centres each hotspot on its point; the label stays small and readable over either face colour. */
  .vertex-label {
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

  .vertex-label.hidden {
    opacity: 0.35;
  }

  .vertex-label.highlighted {
    border-color: var(--color-accent);
  }
</style>
