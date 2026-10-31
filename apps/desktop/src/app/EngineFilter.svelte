<script lang="ts">
  import { tick } from "svelte";
  import KindBadge from "./rows/KindBadge.svelte";
  import type { EngineSummary } from "./tree-model";

  /**
   * The engine filter (docs/explorer-ux.md, "Filter bar"): icon toggles, or an "Engine n/total" button with a
   * popover when they would not fit. Both forms read and write the same hidden set, so switching on resize loses
   * nothing. The parent leaves it out when there is only one engine.
   */
  let {
    engines,
    hidden,
    form,
    onChange,
  }: {
    engines: EngineSummary[];
    /** Engines switched off (the model's Set<kind>). */
    hidden: ReadonlySet<string>;
    form: "toggles" | "menu";
    onChange: (hidden: Set<string>) => void;
  } = $props();

  /** The find box appears from this many engines. */
  const FIND_FROM = 8;

  let open = $state(false);
  let find = $state("");
  let root = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();

  const selected = $derived(engines.filter((e) => !hidden.has(e.kind)).length);
  const listed = $derived(find.trim() ? engines.filter((e) => e.badge.name.toLowerCase().includes(find.trim().toLowerCase())) : engines);

  // Back to toggles (the panel got wider) closes the popover.
  $effect(() => {
    if (form === "toggles") open = false;
  });

  function toggle(kind: string) {
    const next = new Set(hidden);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange(next);
  }

  async function openPopover() {
    open = !open;
    if (!open) return;
    find = "";
    await tick();
    popover?.querySelector<HTMLElement>("input")?.focus();
  }

  function close(refocus: boolean) {
    open = false;
    if (refocus) button?.focus();
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) close(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="engines" bind:this={root}>
  {#if form === "toggles"}
    <div class="toggles" role="group" aria-label="Engines">
      {#each engines as e (e.kind)}
        <button
          type="button"
          class="toggle"
          aria-pressed={!hidden.has(e.kind)}
          aria-label={e.badge.name}
          title="{e.badge.name} ({e.count})"
          onclick={() => toggle(e.kind)}
        >
          <KindBadge badge={e.badge} />
          <span class="name">{e.badge.name}</span>
        </button>
      {/each}
    </div>
  {:else}
    <button
      type="button"
      class="menu-button"
      bind:this={button}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Filter by engine"
      onclick={openPopover}
    >
      <span>Engine</span>
      <span class="ratio">{selected}/{engines.length}</span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
    {#if open}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="popover"
        role="dialog"
        aria-label="Engines"
        tabindex="-1"
        bind:this={popover}
        onkeydown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          close(true);
        }}
      >
        {#if engines.length >= FIND_FROM}
          <input class="find" type="text" placeholder="Find engine" aria-label="Find engine" bind:value={find} />
        {/if}
        <div class="links">
          <button type="button" onclick={() => onChange(new Set())}>All</button>
          <button type="button" onclick={() => onChange(new Set(engines.map((e) => e.kind)))}>None</button>
          <button type="button" onclick={() => onChange(new Set(engines.filter((e) => !hidden.has(e.kind)).map((e) => e.kind)))}>Invert</button>
        </div>
        <ul class="list">
          {#each listed as e (e.kind)}
            <li>
              <label>
                <input type="checkbox" checked={!hidden.has(e.kind)} onchange={() => toggle(e.kind)} />
                <KindBadge badge={e.badge} />
                <span class="name">{e.badge.name}</span>
                <span class="count">{e.count}</span>
              </label>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .engines {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
  }
  .toggles {
    display: flex;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    flex: none;
    min-width: 22px;
    height: 22px;
    padding: 0 4px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 11.5px;
    opacity: 0.45;
  }
  .toggle[aria-pressed="true"] {
    opacity: 1;
    background: var(--engine-toggle-on);
  }
  .toggle:hover {
    opacity: 1;
  }
  .toggle .name {
    display: none;
    white-space: nowrap;
  }
  /* Over 380px each toggle also names its engine; the names give way before the filter does. */
  @container filter-bar (width > 380px) {
    .toggle {
      flex: 0 1 auto;
      min-width: 22px;
      overflow: hidden;
      justify-content: flex-start;
      padding: 0 6px 0 4px;
    }
    .toggle .name {
      display: inline;
      overflow: hidden;
    }
  }
  .menu-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .menu-button:hover,
  .menu-button[aria-expanded="true"] {
    background: var(--bg-hover);
  }
  .ratio {
    color: var(--text-muted);
  }
  .chevron::before {
    content: "\25BE";
    font-size: 10px;
    color: var(--text-muted);
  }
  .popover {
    position: absolute;
    top: calc(100% + 2px);
    right: 6px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* Never wider than 240px or the panel; never taller than the panel above the footer. */
    width: min(240px, calc(100cqw - 12px));
    max-height: calc(100cqh - 36px - 30px - 8px);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-pane);
    box-shadow: 0 6px 18px var(--explorer-sticky-shadow);
    outline: none;
  }
  .find {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin-bottom: 4px;
  }
  .links {
    display: flex;
    gap: 10px;
    padding: 2px 4px 4px;
  }
  .links button {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 11.5px;
  }
  .links button:hover {
    text-decoration: underline;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 0;
  }
  .list label {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
  }
  .list label:hover {
    background: var(--bg-hover);
  }
  .list input {
    margin: 0;
    flex: none;
  }
  .list .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .count {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
