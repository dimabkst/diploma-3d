<script lang="ts">
import { tick } from 'svelte';
import { formatSteppedDecimal } from '../decimal.ts';
import { formatPhysical, shownText, storedText } from '../model/connectorScale.ts';
import {
  alignedTrapezoidShift,
  isScaledConnectorKey,
  type ParameterChoices,
  type ParameterErrors,
  type ParameterKey,
  type ParameterTexts,
  type ParameterValues,
  type TrapezoidAlignment,
} from '../model/parameters.ts';
import type { TiltMode, TiltSolid } from '../model/tilt.ts';
import {
  type ActionField,
  type NoteField,
  type NumericField,
  type PanelAction,
  type ParameterSection as Section,
  type ShapePanel,
  sectionNumberFields,
  type TiltGroup,
  type TrapezoidGroup,
  trapezoidKindName,
} from '../shapes.ts';
import Button from './Button.svelte';
import Checkbox from './Checkbox.svelte';
import Field from './Field.svelte';
import FieldDisclosure from './FieldDisclosure.svelte';
import HelpToggle from './HelpToggle.svelte';
import NumberField from './NumberField.svelte';
import ParameterSection from './ParameterSection.svelte';
import SegmentedControl from './SegmentedControl.svelte';
import Select from './Select.svelte';

let {
  panel,
  texts = $bindable(),
  choices = $bindable(),
  values,
  errors,
  canReset,
  onreset,
  ontiltmode,
  pinsReady,
  trialReady,
  onaction,
  onroundedit,
}: {
  panel: ShapePanel;
  texts: ParameterTexts;
  choices: ParameterChoices;
  values: ParameterValues;
  errors: ParameterErrors;
  /** Whether "Скинути параметри фігури" would change anything, an invalid draft of the shape's fields included. */
  canReset: boolean;
  onreset: () => void;
  /** Asks to enter the solid's displacement in the given mode; the page converts the values without changing the solid. */
  ontiltmode: (solid: TiltSolid, mode: TiltMode) => void;
  /** Whether the current model's dowels can be downloaded now. */
  pinsReady: boolean;
  /** Whether the current model's trial joint can be downloaded now. */
  trialReady: boolean;
  onaction: (action: PanelAction) => void;
  /** Called before a round connector's field changes by hand, while its other values are still as shown. */
  onroundedit: () => void;
} = $props();

// Per group, across shapes: a group keeps its open state and its fields keep their values while collapsed.
let openSections = $state<Record<string, boolean>>({});

// The same for the collapsed further fields within a group, which start closed.
let openDisclosures = $state<Record<string, boolean>>({});

/**
 * What is being typed into a field shown in millimetres, while it differs from how the stored value is shown, such as
 * "2,0" for 2 mm or a partial "2,". The stored text holds the converted value, so the model follows every keystroke;
 * the draft only keeps the entry as typed until it loses focus.
 */
let drafts = $state<Partial<Record<ParameterKey, string>>>({});

function enterMillimetres(field: NumericField, typed: string, unit: number) {
  const { key } = field;
  if (!isScaledConnectorKey(key)) return;
  if (field.editsRoundConnector) onroundedit();
  texts[key] = storedText(typed, unit);
  if (shownText(texts[key], unit) === typed) delete drafts[key];
  else drafts[key] = typed;
}

const hasError = (section: Section) =>
  sectionNumberFields(section).some((field) => errors[field.key] !== undefined) ||
  section.fields.some((field) => field.type === 'note' && field.tone === 'alert');

/** Opens the group of the field, which may have been collapsed after the error appeared, and moves focus to it. */
export async function focusField(key: ParameterKey): Promise<void> {
  const sections = panel.type === 'parameters' ? panel.sections : [];
  const owner = sections.find((section) => sectionNumberFields(section).some((field) => field.key === key));
  if (owner !== undefined) openSections[owner.key] = true;
  const disclosure = owner?.fields.find(
    (field) => field.type === 'disclosure' && field.fields.some((inner) => inner.type === 'number' && inner.key === key),
  );
  if (disclosure !== undefined) openDisclosures[disclosure.key] = true;
  await tick();
  document.getElementById(key)?.focus();
}

/** Centred when every offset is zero, moved otherwise; undefined while any is not valid, in either input mode. */
function offsetState(group: TiltGroup): 'centred' | 'moved' | undefined {
  const positions = group.offsetKeys.map((key) => values[key]);
  if (positions.some((value) => value === undefined)) return undefined;
  return positions.every((value) => value === 0) ? 'centred' : 'moved';
}

const tiltOf = (section: Section) => section.fields.find((field): field is TiltGroup => field.type === 'tilt');

function removeTilt(group: TiltGroup) {
  for (const [key, text] of group.centredTexts) texts[key] = text;
}

const tiltModes = (group: TiltGroup) =>
  (['offset', 'angle'] as const).map((mode) => ({ value: mode, label: group.modeLabels[mode] }));

function alignSideB(group: TrapezoidGroup, alignment: TrapezoidAlignment) {
  const [side, , shift] = group.fields;
  const sideRatio = values[side.key];
  if (alignment === 'centre' || sideRatio !== undefined) {
    texts[shift.key] = formatSteppedDecimal(alignedTrapezoidShift(sideRatio ?? 1, alignment));
  }
}

const alignments: readonly { readonly alignment: TrapezoidAlignment; readonly label: string }[] = [
  { alignment: 'left', label: 'Вирівняти зліва' },
  { alignment: 'centre', label: 'По центру' },
  { alignment: 'right', label: 'Вирівняти справа' },
];
</script>

{#snippet numberField(field: NumericField)}
  {#if field.unit === undefined}
    <NumberField
      id={field.key}
      label={field.label}
      bind:text={
        () => texts[field.key],
        (typed) => {
          if (field.editsRoundConnector) onroundedit();
          texts[field.key] = typed;
        }
      }
      value={values[field.key]}
      range={field.range}
      suffix={field.suffix}
      error={errors[field.key]}
      disabled={field.disabled}
      describedBy={field.describedBy}
    />
  {:else}
    {@const unit = field.unit}
    {@const value = values[field.key]}
    <!-- The value generated, which may differ from the stored one when the model no longer leaves room for that. -->
    <NumberField
      id={field.key}
      label={field.label}
      bind:text={
        () => drafts[field.key] ?? (value === undefined ? shownText(texts[field.key], unit) : formatPhysical(value, unit)),
        (typed) => enterMillimetres(field, typed, unit)
      }
      value={value === undefined ? undefined : Number((value * unit).toFixed(9))}
      range={field.range}
      suffix={field.suffix}
      error={errors[field.key]}
      onentryblur={() => delete drafts[field.key]}
    />
  {/if}
{/snippet}

{#snippet noteView(field: NoteField)}
  <p
    class={['group-status', field.tone === 'alert' && 'alert']}
    id={field.key}
    role={field.tone === 'alert' ? 'alert' : field.tone === 'status' ? 'status' : undefined}
  >
    {field.text}
  </p>
{/snippet}

{#snippet actionView(field: ActionField)}
  <div class="group-actions">
    <Button
      variant="secondary"
      disabled={field.disabled === true ||
        (field.action === 'download-pins' && !pinsReady) ||
        (field.action === 'download-trial' && !trialReady)}
      onclick={() => onaction(field.action)}
    >
      {field.label}
    </Button>
  </div>
{/snippet}

<aside class="controls-panel" aria-label="Налаштування моделі">
  <div class="controls-scroll">
  <!-- Stays in view while the form scrolls, so the reset is one click away at any field. -->
  <div class="panel-header">
    <h2 class="panel-title">Параметри фігури</h2>
    <!-- Solids with fixed proportions have nothing of their own to reset; the shared print size is never reset. -->
    {#if panel.type === 'parameters'}
      <Button variant="secondary" disabled={!canReset} aria-label="Скинути параметри фігури" onclick={onreset}>
        Скинути
      </Button>
    {/if}
  </div>
  {#if panel.type === 'fixed'}
    <p class="note">{panel.note}</p>
  {:else}
    {#if panel.note !== undefined}<p class="note">{panel.note}</p>{/if}
    {#if panel.help !== undefined}<HelpToggle id="reference-help" help={panel.help} />{/if}
    <div class="sections">
      {#each panel.sections as section (section.key)}
        {@const tilt = tiltOf(section)}
        {@const state = tilt === undefined ? undefined : offsetState(tilt)}
        <!-- The panel is rebuilt with every value, as the inclination's range follows the height. Reading only these
             unchanged primitives keeps the binding from re-applying a stale state before the element's toggle event
             has recorded a click on the summary. -->
        {@const sectionKey = section.key}
        {@const initiallyOpen = section.initiallyOpen}
        <ParameterSection
          title={section.title}
          bind:open={() => openSections[sectionKey] ?? initiallyOpen, (open) => (openSections[sectionKey] = open)}
          status={section.status?.text ?? (tilt === undefined || state === undefined ? undefined : tilt.status[state])}
          highlighted={section.status?.highlighted ?? state === 'moved'}
          invalid={hasError(section)}
        >
          {#each section.fields as field (field.key)}
            {#if field.type === 'choice'}
              <Field label={field.label} forId={field.key}>
                <Select id={field.key} bind:value={choices[field.key]} options={field.options} />
              </Field>
            {:else if field.type === 'note'}
              {@render noteView(field)}
            {:else if field.type === 'action'}
              {@render actionView(field)}
            {:else if field.type === 'disclosure'}
              {@const disclosureKey = field.key}
              <FieldDisclosure
                id={`${field.key}-fields`}
                label={field.label}
                bind:open={() => openDisclosures[disclosureKey] ?? false, (open) => (openDisclosures[disclosureKey] = open)}
              >
                {#each field.fields as inner (inner.key)}
                  {#if inner.type === 'note'}
                    {@render noteView(inner)}
                  {:else if inner.type === 'action'}
                    {@render actionView(inner)}
                  {:else}
                    {@render numberField(inner)}
                  {/if}
                {/each}
              </FieldDisclosure>
            {:else if field.type === 'toggle'}
              <Checkbox
                id={field.key}
                label={field.label}
                bind:checked={choices[field.key]}
                disabled={field.disabled}
                describedBy={field.describedBy}
              />
            {:else if field.type === 'tilt'}
              <SegmentedControl
                legend="Спосіб задання"
                name={`${field.key}-mode`}
                value={field.mode}
                options={tiltModes(field)}
                disabled={!field.canSwitch}
                describedBy={field.canSwitch ? undefined : `${field.key}-mode-note`}
                onchange={(mode) => ontiltmode(field.solid, mode)}
              />
              {#if !field.canSwitch}
                <p class="group-status" id={`${field.key}-mode-note`}>
                  Перемкнути спосіб можна, коли висоту й поля нижче задано правильно.
                </p>
              {/if}
              {#each field.fields as tiltField (tiltField.key)}
                {@render numberField(tiltField)}
              {/each}
              <div class="group-actions">
                <!-- Also enabled while a value is invalid: resetting is a way to correct it. -->
                <Button variant="secondary" disabled={state === 'centred'} onclick={() => removeTilt(field)}>
                  {field.resetLabel}
                </Button>
              </div>
            {:else if field.type === 'trapezoid'}
              {@const sideRatio = values[field.fields[0].key]}
              {@const kindName = trapezoidKindName(sideRatio, values[field.fields[2].key])}
              {#each field.fields as trapezoidField (trapezoidField.key)}
                {@render numberField(trapezoidField)}
              {/each}
              <div class="group-actions" role="group" aria-label="Вирівнювання сторони b">
                {#each alignments as { alignment, label } (alignment)}
                  <Button
                    variant="secondary"
                    disabled={alignment !== 'centre' && sideRatio === undefined}
                    onclick={() => alignSideB(field, alignment)}
                  >
                    {label}
                  </Button>
                {/each}
              </div>
              <p class="group-status" aria-live="polite">{#if kindName !== undefined}Зараз: {kindName}{/if}</p>
            {:else}
              {@render numberField(field)}
            {/if}
          {/each}
          {#if section.help !== undefined}
            <HelpToggle id={`${section.key}-help`} help={section.help} />
          {/if}
        </ParameterSection>
      {/each}
    </div>
  {/if}
  </div>
</aside>

<style>
  /*
   * The outline follows the content up to the height the page allows. The vertical padding equals the corner radius,
   * so a scrollbar of the inner element runs along the straight part of the border and its ends stay inside the
   * rounded outline. `clip`, unlike `hidden`, does not make the panel a scroll container.
   */
  .controls-panel {
    display: flex;
    flex-direction: column;
    align-self: start;
    min-width: 0;
    min-height: 0;
    max-height: 100%;
    padding-block: var(--radius-card);
    overflow: clip;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
  }

  /*
   * Scrolls only where the page asks for it with --controls-overflow-y: auto, in the two-column layout. Elsewhere it
   * is no scroll container at all, so a touch gesture that starts on the controls scrolls the page. The small vertical
   * padding keeps focus outlines of the first and last controls clear of the clipping edge.
   */
  .controls-scroll {
    min-height: 0;
    padding: var(--space-1) var(--space-6);
    overflow-y: var(--controls-overflow-y, visible);
    scrollbar-gutter: stable;
  }

  .note {
    margin: 0;
    padding-block: var(--space-4) var(--space-2);
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  .panel-header {
    position: sticky;
    z-index: 1;
    top: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding-block: var(--space-2);
    background: var(--color-surface);
  }



  .panel-title {
    margin: 0;
    font-size: var(--text-small);
    color: var(--color-text-dim);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sections {
    border-bottom: 1px solid var(--color-border);
  }

  .group-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .group-status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .group-status.alert {
    color: var(--color-error);
  }

  @media (max-width: 420px) {
    .controls-scroll {
      padding-inline: var(--space-4);
    }
  }
</style>
