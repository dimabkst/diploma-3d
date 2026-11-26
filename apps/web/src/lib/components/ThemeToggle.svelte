<script lang="ts">
import type { Theme } from '../model/theme.ts';
import Button from './Button.svelte';

let { theme, ontoggle }: { theme: Theme; ontoggle: () => void } = $props();

// The button says what it does: switch to the other theme.
const labels = { light: 'Темна тема', dark: 'Світла тема' } as const;
const label = $derived(labels[theme]);
</script>

<!-- On a phone only the icon shows; the label stays the button's accessible name and its tooltip. -->
<Button variant="secondary" title={label} onclick={ontoggle}>
  {#snippet leadingIcon()}
    {#if theme === 'light'}
      <svg class="theme-icon" viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" /></svg>
    {:else}
      <svg class="theme-icon" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    {/if}
  {/snippet}
  <!-- Both labels share one cell, the other one invisible and unread, so that the button keeps the longer one's width in either
       theme and nothing beside it moves. -->
  <span class="theme-label">
    {#each Object.entries(labels) as [shownIn, text] (shownIn)}
      <span class={['label-text', shownIn !== theme && 'reserved']} aria-hidden={shownIn !== theme || undefined}>{text}</span>
    {/each}
  </span>
</Button>

<style>
  .theme-icon {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .theme-label {
    display: inline-grid;
  }

  .label-text {
    grid-area: 1 / 1;
  }

  .reserved {
    visibility: hidden;
  }

  @media (max-width: 480px) {
    /* Visually hidden, still read out. */
    .theme-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
