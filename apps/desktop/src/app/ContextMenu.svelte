<script lang="ts" module>
  export interface MenuItem {
    label: string;
    run: () => void;
    danger?: boolean;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let { x, y, items, onClose }: { x: number; y: number; items: (MenuItem | "separator")[]; onClose: () => void } = $props();

  let menu: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);

  onMount(() => {
    // Keep the menu on screen.
    const r = menu.getBoundingClientRect();
    left = Math.min(x, window.innerWidth - r.width - 4);
    top = Math.min(y, window.innerHeight - r.height - 4);
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const close = (e: Event) => {
      if (!menu.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  });

  function move(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
</script>

<div class="menu" role="menu" tabindex="-1" bind:this={menu} style:left="{left || x}px" style:top="{top || y}px" onkeydown={move}>
  {#each items as item}
    {#if item === "separator"}
      <div class="sep"></div>
    {:else}
      <button
        role="menuitem"
        class:danger={item.danger}
        disabled={item.disabled}
        onclick={() => {
          onClose();
          item.run();
        }}>{item.label}</button
      >
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 100;
    min-width: 180px;
    padding: 4px;
    background: var(--bg-pane);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.25);
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 4px 10px;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--border);
  }
</style>
