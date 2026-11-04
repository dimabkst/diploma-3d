<script lang="ts" generics="Value extends string">
let {
  legend,
  name,
  value,
  options,
  disabled = false,
  describedBy,
  onchange,
}: {
  legend: string;
  /** The radio group's name, unique on the page. */
  name: string;
  value: Value;
  options: readonly { readonly value: Value; readonly label: string }[];
  disabled?: boolean;
  describedBy?: string | undefined;
  onchange: (value: Value) => void;
} = $props();
</script>

<!-- Native radio buttons: arrow keys move between the options and assistive technology announces the selected one. -->
<fieldset class="segmented" {disabled} aria-describedby={describedBy}>
  <legend class="legend">{legend}</legend>
  <div class="options">
    {#each options as option (option.value)}
      <label class="option">
        <input
          class="input"
          type="radio"
          {name}
          value={option.value}
          checked={option.value === value}
          onchange={() => onchange(option.value)}
        />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .segmented {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .legend {
    margin-bottom: var(--space-2);
    padding: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .options {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-button);
  }

  /* The selected option is filled like a primary button, so it differs in lightness, not only in hue. */
  .option {
    position: relative;
    display: grid;
    min-height: 36px;
    place-items: center;
    padding: 0 var(--space-3);
    color: var(--color-text-muted);
    border-radius: calc(var(--radius-button) - var(--space-1));
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    line-height: 1.2;
    text-align: center;
    cursor: pointer;
    transition:
      background-color 200ms ease,
      color 200ms ease;
  }

  .option:hover {
    color: var(--color-text);
    background: var(--color-border);
  }

  .option:has(.input:checked) {
    color: var(--color-on-primary);
    background: var(--color-primary);
  }

  .option:has(.input:focus-visible) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .segmented:disabled .option {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .segmented:disabled .option:not(:has(.input:checked)) {
    color: var(--color-text-muted);
    background: transparent;
  }

  /* Transparent over the whole option, so that a click or tap lands on the radio itself; still focusable and announced. */
  .input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
</style>
