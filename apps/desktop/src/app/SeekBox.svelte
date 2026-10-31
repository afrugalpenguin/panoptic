<script lang="ts">
  // The Seek box (docs/landing.md, "Seek"): an input over seek()'s rows. Ranking and keys live in seek.ts; this only
  // renders and forwards. Used by the landing (scope "all") and the unconnected query tab's picker ("connections").
  import { onMount } from "svelte";
  import { seek, seekKey, selectable, type SeekIndex, type SeekRow } from "./seek";

  let {
    index,
    scope = "all",
    query = $bindable(""),
    placeholder,
    label,
    chip,
    autofocus = false,
    onOpen,
    onQuery,
    onLeave,
  }: {
    index: SeekIndex;
    scope?: "all" | "connections";
    query?: string;
    placeholder: string;
    /** The input's accessible name. */
    label: string;
    /** A shortcut hint shown in the box, e.g. "Ctrl P". */
    chip?: string;
    autofocus?: boolean;
    onOpen: (row: SeekRow) => void;
    onQuery: (row: SeekRow) => void;
    onLeave: () => void;
  } = $props();

  const uid = $props.id();
  let input = $state<HTMLInputElement>();
  let active = $state(0);

  const rows = $derived(seek(index, query, scope));
  const list = $derived(rows.filter(selectable));

  // A new query starts at the top again.
  $effect(() => {
    void query;
    active = 0;
  });

  onMount(() => {
    if (autofocus) input?.focus();
  });

  export function focus() {
    input?.focus();
  }

  const optionId = (i: number) => `${uid}-opt-${i}`;
  const placePath = (p: { envId: string; hostName: string; label: string }) =>
    [index.envs.find((e) => e.id === p.envId)?.name ?? p.envId, p.hostName, p.label].join(" / ");

  function onkeydown(e: KeyboardEvent) {
    const r = seekKey(e, rows, active, query);
    if (!r) return;
    e.preventDefault();
    if (r.kind === "move") active = r.index;
    else if (r.kind === "open") onOpen(r.row);
    else if (r.kind === "query") onQuery(r.row);
    else if (r.kind === "clear") query = "";
    else onLeave();
  }

  function click(e: MouseEvent, row: SeekRow) {
    active = list.findIndex((r) => r === row);
    if (e.ctrlKey || e.metaKey) onQuery(row);
    else onOpen(row);
  }
</script>

<div class="seek">
  <label class="box">
    <svg class="glass" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <input
      bind:this={input}
      bind:value={query}
      role="combobox"
      aria-label={label}
      aria-expanded={list.length > 0}
      aria-controls="{uid}-list"
      aria-activedescendant={list.length ? optionId(active) : undefined}
      aria-autocomplete="list"
      autocomplete="off"
      spellcheck="false"
      {placeholder}
      {onkeydown}
    />
    {#if chip}<kbd>{chip}</kbd>{/if}
  </label>
  {#if rows.length > 0}
    <ul id="{uid}-list" role="listbox" aria-label={label}>
      {#each rows as row, i (i)}
        {#if row.kind === "more"}
          <li class="hint" role="option" aria-selected="false" aria-disabled="true">{row.count} more, type to find</li>
        {:else}
          {@const n = list.indexOf(row)}
          <!-- Keyboard use is through the combobox input (aria-activedescendant); the click is the pointer shortcut. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li id={optionId(n)} role="option" aria-selected={n === active} class:on={n === active} onclick={(e) => click(e, row)}>
            {#if row.kind === "resume"}
              <span class="main">Pick up where you left off</span>
              <span class="sub mono">{placePath(row.place)}</span>
            {:else if row.kind === "env"}
              <span class="swatch" style:--c={row.env.color ?? "transparent"}></span>
              <span class="main">{row.env.name}</span>
            {:else if row.kind === "host"}
              <span class="main mono">{row.host.name}</span>
              <span class="sub">{row.env.name}</span>
            {:else}
              <span class="main mono">{row.place.label}</span>
              <span class="sub mono">{row.place.hostName}</span>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .seek {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 56px;
    padding: 0 14px;
    border: 1px solid var(--brand-cyan);
    border-radius: 12px;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand-cyan) 10%, transparent);
    background: var(--bg-pane);
    cursor: text;
  }
  .glass {
    flex: none;
    color: var(--brand-cyan);
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    color: var(--text);
    font: 15px var(--font-ui);
  }
  /* The box's cyan border and ring already show focus; the app-wide blue input outline (app.css) would double it. */
  input:focus {
    outline: none;
  }
  input::placeholder {
    color: var(--text-muted);
  }
  kbd {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--kbd-border);
    border-radius: 4px;
    background: var(--kbd-bg);
    color: var(--text-muted);
    font: 11px var(--font-mono);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  li.on {
    background: var(--bg-hover);
  }
  li.hint {
    color: var(--text-muted);
    font-size: 12px;
    cursor: default;
  }
  .main {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    margin-left: auto;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 12px like the tree's rows: at 13px the mono names read heavier than the UI text beside them. */
  .main.mono {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .swatch {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--c);
  }
</style>
