<script lang="ts">
import { GLB_MEDIA_TYPE, type VertexLabel } from '@diploma-3d/engine';
import { onMount, untrack } from 'svelte';
import { CONSTRUCTION_HOVER_ATTRIBUTE, type ConstructionPick, type ConstructionView } from '../model/throughPoint.ts';
import type { PreviewHighlight } from '../shapes.ts';
import ConstructionOverlay from './ConstructionOverlay.svelte';
import PointLabel from './PointLabel.svelte';

const NO_HIGHLIGHT: PreviewHighlight = { materials: [], labels: [] };

let {
  glb,
  viewKey,
  alt,
  onshow,
  onload,
  onerror,
  oncamerachange,
  labels = [],
  highlight: givenHighlight,
  construction,
  onconstructionpick,
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
  /** A model replaces the one on screen: called just before its first frame, with its own look and labels already in place. */
  onshow?: ((glb: Uint8Array<ArrayBuffer>) => void) | undefined;
  /** A model has loaded and is drawn. */
  onload: (glb: Uint8Array<ArrayBuffer>) => void;
  onerror: (glb: Uint8Array<ArrayBuffer>) => void;
  /** The camera's direction in radians: θ around the vertical axis from the model's −Y side, φ from straight above. */
  oncamerachange?: (direction: { theta: number; phi: number }) => void;
  /**
   * What the control in use changes, shown stronger: the GLB's materials by name, a section's planes (`plane-…`) lit and its
   * guides (`guide-…`) kept bright while the others recede, and the labels by their shown names.
   */
  highlight?: PreviewHighlight | undefined;
  /**
   * The construction view: the assembled solid drawn translucent, its edges, the segment, M and the section over it, and a tap
   * choosing an element; undefined for the ordinary preview. See `ConstructionOverlay`.
   */
  construction?: ConstructionView | undefined;
  onconstructionpick?: ((pick: ConstructionPick) => void) | undefined;
} = $props();

/** The parts of model-viewer's scene-graph API the construction view changes, to set every material back afterwards. */
type LookMaterial = {
  readonly name: string;
  readonly pbrMetallicRoughness: {
    readonly baseColorFactor: readonly number[];
    setBaseColorFactor(rgba: [number, number, number, number]): void;
  };
  readonly isLoaded: boolean;
  ensureLoaded(): Promise<void>;
  getAlphaMode(): string;
  setAlphaMode(mode: 'OPAQUE' | 'BLEND' | 'MASK'): void;
};

/**
 * How opaque each kind of material stays in the construction view: the original solid's faces faint; the mesh's own outlines,
 * the cut faces and their outlines gone, as the view draws the solid's real edges and the sections of the construction being
 * edited itself. So every model built for the construction looks the same there, the original translucent solid, whichever
 * section it was cut by. BLEND also stops a material writing depth, so a material gone hides nothing behind it.
 */
const constructionAlpha = (name: string): number | undefined =>
  name === 'surface' ? 0.18 : name === 'edges' || name === 'cut' || /^plane-\d(-edges)?$/.test(name) ? 0 : undefined;

const originalLook = new WeakMap<object, { readonly alpha: number; readonly mode: string }>();

function setLook(material: LookMaterial, alpha: number, translucent: boolean): void {
  const [r = 0, g = 0, b = 0, a = 1] = material.pbrMetallicRoughness.baseColorFactor;
  const original = originalLook.get(material) ?? { alpha: a, mode: material.getAlphaMode() };
  originalLook.set(material, original);
  material.setAlphaMode(translucent ? 'BLEND' : (original.mode as 'OPAQUE' | 'BLEND' | 'MASK'));
  material.pbrMetallicRoughness.setBaseColorFactor([r, g, b, translucent ? alpha : original.alpha]);
}

/**
 * Every material translucent for the construction view, or back as it was; nothing of the model or its files changes. Loaded
 * materials, those a model draws, change at once, so that a model's first frame already has its look; others once loaded.
 */
function applyLook(element: HTMLElement, translucent: boolean): Promise<void> {
  const materials = (element as unknown as { model?: { materials: readonly LookMaterial[] } }).model?.materials ?? [];
  const later: Promise<void>[] = [];
  for (const material of materials) {
    const alpha = constructionAlpha(material.name);
    if (alpha === undefined) continue;
    if (material.isLoaded) setLook(material, alpha, translucent);
    else later.push(material.ensureLoaded().then(() => setLook(material, alpha, translucent)));
  }
  return Promise.all(later).then(() => undefined);
}

const lookSafely = (element: HTMLElement, translucent: boolean) => {
  try {
    void applyLook(element, translucent).catch(() => undefined);
  } catch {
    // A model replaced meanwhile only loses its look until the next one.
  }
};

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
  readonly isLoaded: boolean;
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
function applyHighlight(element: CameraElement, { materials: names }: PreviewHighlight): Promise<void> {
  const materials = (element as unknown as { model?: { materials: readonly SceneMaterial[] } }).model?.materials ?? [];
  const lit = new Set(names);
  const light = (material: SceneMaterial, guide: boolean) => {
    const [r = 0, g = 0, b = 0] = material.pbrMetallicRoughness.baseColorFactor;
    const factor = guide
      ? lit.size === 0 || lit.has(material.name)
        ? 1
        : RECEDING_GUIDE
      : lit.has(material.name)
        ? LIT_PLANE
        : 0;
    material.setEmissiveFactor([r * factor, g * factor, b * factor]);
  };
  const later: Promise<void>[] = [];
  for (const material of materials) {
    const guide = material.name.startsWith('guide-');
    if (!guide && !material.name.startsWith('plane-')) continue;
    // model-viewer loads a material's properties on demand; reading them before throws. A loaded one changes at once.
    if (material.isLoaded) light(material, guide);
    else later.push(material.ensureLoaded().then(() => light(material, guide)));
  }
  return Promise.all(later).then(() => undefined);
}

/** The highlight, never in the way of showing the model: a model replaced meanwhile only loses its emphasis. */
const highlightSafely = (element: CameraElement, shown: PreviewHighlight) => {
  try {
    void applyHighlight(element, shown).catch(() => undefined);
  } catch {
    // As for the look.
  }
};

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
// Over an element of the construction that a tap would choose, the pointer cursor; model-viewer sets its grab cursor inline
// on that element, which only an important rule overrides.
const SHADOW_STYLES = `.userInput:focus { outline: none; }
.userInput:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
:host([${CONSTRUCTION_HOVER_ATTRIBUTE}]) .userInput { cursor: pointer !important; }`;

$effect(() => {
  const shadowRoot = viewer?.shadowRoot;
  if (shadowRoot == null) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHADOW_STYLES);
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
  // Before the new model's first frame: its labels, its look and the page's construction drawn on it all take their places, so
  // that the frame shows them together.
  const show = () => {
    if (loading === undefined || element.getAttribute('src') !== loading.url) return;
    const { labels: next, glb: current } = loading;
    // The hotspots kept move now, before the frame; new ones are added with their positions when Svelte adds them.
    for (const label of next) element.updateHotspot({ name: slotOf(label), position: positionOf(label) });
    shownLabels = next;
    lookSafely(
      element,
      untrack(() => constructing),
    );
    highlightSafely(
      element,
      untrack(() => highlight),
    );
    onshow?.(current);
  };
  const handleLoad = (event: Event) => {
    if (loading === undefined || (event as CustomEvent<{ url?: string }>).detail?.url !== loading.url) return;
    const { glb: current, key, url } = loading;
    show();
    // model-viewer itself keeps the viewing direction and refits the zoom whenever the model is replaced. The first
    // model already starts from the default orbit attribute.
    if (framedKey !== undefined && framedKey !== key) void frame(element, DEFAULT_ORBIT);
    framedKey = key;
    if (shownUrl !== undefined) URL.revokeObjectURL(shownUrl);
    shownUrl = url;
    finish(element);
    onload(current);
  };
  const handleError = () => {
    if (loading === undefined) return;
    const { glb: current, url } = loading;
    URL.revokeObjectURL(url);
    finish(element);
    onerror(current);
  };
  element.addEventListener('before-render', show);
  element.addEventListener('load', handleLoad);
  element.addEventListener('error', handleError);
  return () => {
    element.removeEventListener('before-render', show);
    element.removeEventListener('load', handleLoad);
    element.removeEventListener('error', handleError);
  };
});

$effect(() => {
  if (viewer !== undefined) highlightSafely(viewer, highlight);
});

const constructing = $derived(construction !== undefined);
$effect(() => {
  if (viewer !== undefined) lookSafely(viewer, constructing);
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
  <!-- The built-in "legacy" environment has a directional key light, so adjacent flat faces get clearly different tones.
       With panning on, model-viewer by default makes a short click a "tap" that moves the centre of rotation to the
       clicked point, or zooms out on a click beside the model; disable-tap turns off only that, keeping turning, zooming
       and panning. -->
  <model-viewer
    bind:this={viewer}
    class="viewer"
    {alt}
    camera-controls
    disable-tap
    camera-orbit={DEFAULT_ORBIT}
    environment-image="legacy"
    tone-mapping="neutral"
    interaction-prompt="none"
  >
    <div slot="progress-bar"></div>
    {#each shownLabels as label (slotOf(label))}
      <!-- While constructing, the overlay draws the labels above its own lines and fills instead: these stay in place, hidden. -->
      <PointLabel
        {...{ slot: slotOf(label) }}
        text={label.name}
        tone={inView(label) ? 'visible' : 'faded'}
        highlighted={highlight.labels.includes(label.name)}
        style={constructing ? 'visibility: hidden' : undefined}
        data-position={positionOf(label)}
        data-parts={label.parts.join(' ')}
      />
    {/each}
  </model-viewer>
  {#if construction !== undefined && viewer !== undefined}
    <ConstructionOverlay {viewer} view={construction} onpick={(pick) => onconstructionpick?.(pick)} />
  {/if}
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
