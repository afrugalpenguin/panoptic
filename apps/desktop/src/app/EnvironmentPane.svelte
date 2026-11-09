<script lang="ts">
  // The environment detail pane, phase 1 (docs/environment-pane.md): live facts and in-place properties, saved as they
  // change. Reachability, ping, Recent and Catalog come in later phases.
  import { onDestroy, tick, untrack } from "svelte";
  import type { ProbeResult } from "./api";
  import { ENV_PICKER } from "./env-palette";
  import type { EnvironmentConfig } from "./api";
  import { engineCounts, formatMs, parseHex, plural, probeState, reachability, textOn, type EnvironmentPaneProps } from "./env-pane";
  import { GLYPHS, type GlyphName } from "./glyphs";
  import Kbd from "./Kbd.svelte";
  import KindBadge from "./rows/KindBadge.svelte";
  import SegmentedLabel from "./rows/SegmentedLabel.svelte";
  import { age } from "./usage";

  let {
    env,
    position,
    total,
    connections,
    onSave,
    onMove,
    onNewConnection,
    onRefresh,
    onDelete,
    onSelectConnection,
    onExpandConnection,
    onConnectionMenu,
    probe,
    recent,
    onOpenRecent,
  }: EnvironmentPaneProps = $props();

  // The time to build the list from the store, measured on every rebuild, never a constant.
  const built = $derived.by(() => {
    const start = performance.now();
    const list = connections();
    return { list, ms: performance.now() - start };
  });
  const engines = $derived(engineCounts(built.list));
  const took = $derived(formatMs(built.ms));

  // Reachability (docs/environment-pane.md, "Reachability probes"): every connection at once, each filling in as it
  // lands, when the environment is shown or its connections change, and past the cache on Refresh. Never on a timer.
  // Nothing waits on them: the rows paint first, reading Checking.
  let probes = $state<Record<string, ProbeResult>>({});
  let probeRun = 0;
  const probeKey = $derived(JSON.stringify([env.id, ...built.list.map((c) => c.connectionId)]));
  const reach = $derived(reachability(built.list.map((c) => probes[c.connectionId])));

  function runProbes(fresh: boolean) {
    const run = ++probeRun;
    probes = {};
    for (const { connectionId } of built.list) {
      probe([connectionId], fresh).then(
        (results) => {
          const result = results.find((r) => r.connectionId === connectionId);
          if (run === probeRun && result) probes = { ...probes, [connectionId]: result };
        },
        (e) => {
          if (run === probeRun) probes = { ...probes, [connectionId]: { connectionId, status: "unknown", error: e instanceof Error ? e.message : String(e) } };
        },
      );
    }
  }

  $effect(() => {
    void probeKey;
    untrack(() => runProbes(false));
  });

  function refresh() {
    onRefresh();
    runProbes(true);
  }

  /** The last store write's failure, shown in the Properties card until the next edit. */
  let saveError = $state("");

  async function save(next: EnvironmentConfig): Promise<boolean> {
    saveError = "";
    try {
      await onSave(next);
      return true;
    } catch (e) {
      saveError = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  // Name: plain text until hovered or focused. Blur and Enter save, Escape reverts, empty is refused.
  let nameInput = $state<HTMLInputElement>();
  let nameDraft = $state("");
  let nameFocused = false;
  let nameBad = $state(false);
  let badTimer: ReturnType<typeof setTimeout> | undefined;
  $effect.pre(() => {
    const name = env.name;
    if (!nameFocused) nameDraft = name;
  });

  function flashBad() {
    nameBad = false;
    clearTimeout(badTimer);
    // A tick between, so a second refusal flashes again.
    void tick().then(() => {
      nameBad = true;
      badTimer = setTimeout(() => (nameBad = false), 600);
    });
  }

  async function commitName() {
    nameFocused = false;
    const next = nameDraft.trim();
    if (next === env.name) {
      nameDraft = env.name;
      return;
    }
    if (!next) {
      nameDraft = env.name;
      flashBad();
      return;
    }
    if (!(await save({ ...env, name: next }))) nameDraft = env.name;
  }

  function nameKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      nameInput?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      nameDraft = env.name;
      nameInput?.blur();
    }
  }

  // Colour and Write policy open one popover at a time; a click elsewhere or Escape closes it.
  let open = $state<"colour" | "policy">();
  let hexDraft = $state("");
  let hexBad = $state(false);
  let colourRoot = $state<HTMLElement>();
  let policyRoot = $state<HTMLElement>();

  function toggle(which: "colour" | "policy") {
    open = open === which ? undefined : which;
    if (open === "colour") {
      hexDraft = env.color;
      hexBad = false;
    }
  }

  function onWindowPointer(e: PointerEvent) {
    const root = open === "colour" ? colourRoot : open === "policy" ? policyRoot : undefined;
    if (root && !root.contains(e.target as Node)) open = undefined;
  }

  async function pickColour(color: string) {
    open = undefined;
    if (color !== env.color) await save({ ...env, color });
  }

  function hexKey(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const hex = parseHex(hexDraft);
    if (hex) void pickColour(hex);
    else hexBad = true;
  }

  async function pickPolicy(readOnly: boolean) {
    open = undefined;
    if (readOnly !== env.readOnly) await save({ ...env, readOnly });
  }

  // A row's click selects the connection in the tree, which replaces this pane; it waits out a double-click, which
  // expands it instead.
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const DOUBLE_CLICK_MS = 250;

  function rowClick(e: MouseEvent, id: string) {
    clearTimeout(clickTimer);
    // Enter or Space on a focused row: no double-click to wait for.
    if (e.detail === 0) onSelectConnection(id);
    else clickTimer = setTimeout(() => onSelectConnection(id), DOUBLE_CLICK_MS);
  }

  /** Right-click, or the menu key (no pointer position: the menu opens under the row). */
  function rowMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    clearTimeout(clickTimer);
    const row = e.currentTarget as HTMLElement;
    if (e.clientX || e.clientY) return onConnectionMenu(id, e.clientX, e.clientY);
    const box = row.getBoundingClientRect();
    onConnectionMenu(id, Math.round(box.left + 16), Math.round(box.bottom));
  }

  /** Up, Down, Home and End move focus between the connection rows. */
  function rowKey(e: KeyboardEvent) {
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(".conn")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, to))].focus();
  }

  function rowDoubleClick(id: string) {
    clearTimeout(clickTimer);
    onExpandConnection(id);
  }

  onDestroy(() => {
    // Late answers for a pane that has gone are dropped.
    probeRun++;
    clearTimeout(clickTimer);
    clearTimeout(badTimer);
  });

  /** N, R and F2 while focus is in the pane and not in a field. */
  function paneKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey || (e.target as Element).closest("input")) return;
    if (e.key === "Escape" && open) {
      open = undefined;
      e.preventDefault();
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onNewConnection();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      refresh();
    } else if (e.key === "F2") {
      e.preventDefault();
      nameInput?.focus();
      nameInput?.select();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

{#snippet glyph(name: GlyphName)}
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d={GLYPHS[name]} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="env-pane" style:--env={env.color} aria-label="Environment {env.name}" onkeydown={paneKey}>
  <div class="rule"></div>
  <div class="scroll">
    <header>
      <span class="tile" style:color={textOn(env.color)} aria-hidden="true">{env.name.charAt(0).toUpperCase()}</span>
      <div class="identity">
        <div class="title">
          <h2>{env.name}</h2>
          <span class="place">Environment · {position} of {total}</span>
        </div>
        <p class="summary">
          <span><b>{built.list.length}</b> {built.list.length === 1 ? "connection" : "connections"}</span>
          <span class="sep">|</span>
          <span><b>{engines.length}</b> {engines.length === 1 ? "engine" : "engines"}</span>
          <span class="sep">|</span>
          {#if reach.checking}
            <span class="reach"><span class="dot-status checking"></span>checking</span>
          {:else}
            <span class="reach"><span class="dot-status reachable"></span><b>{reach.reachable}</b> reachable</span>
          {/if}
          <span class="sep">|</span>
          <span>{env.readOnly ? "read-only" : "writes allowed"}</span>
        </p>
      </div>
      <div class="actions">
        <button type="button" class="new" onclick={onNewConnection}>New connection <Kbd keys="N" /></button>
        <button type="button" class="ghost refresh" aria-label="Refresh" title="Refresh (R)" onclick={refresh}>{@render glyph("refresh")}</button>
        <Kbd keys="R" />
      </div>
    </header>

    <div class="body">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <section class="card connections" aria-label="Connections" onkeydown={rowKey}>
        <div class="card-head">
          <span class="label">Connections</span>
          <span class="mono dim timing">{built.list.length} listed in {took} ms</span>
          <span class="pills">
            {#each engines as e (e.kind)}
              <span class="pill" style:--badge={e.badge.color}>{e.badge.name} {e.count}</span>
            {/each}
          </span>
        </div>
        <div class="cols" aria-hidden="true">
          <span></span><span>Host</span><span>Engine</span><span>Status</span><span class="right">Ping</span>
        </div>
        {#each built.list as c (c.id)}
          {@const p = probeState(probes[c.connectionId])}
          <button type="button" class="conn" title={`${c.label.prefix}${c.label.core}${c.label.suffix}`}
            onclick={(e) => rowClick(e, c.id)} ondblclick={() => rowDoubleClick(c.id)} oncontextmenu={(e) => rowMenu(e, c.id)}>
            <KindBadge badge={c.badge} size={22} />
            <span class="host"><SegmentedLabel label={c.label} /></span>
            <span class="engine">{c.badge.name}</span>
            <span class="status {p.state}" title={p.title}><span class="dot-status {p.state}"></span>{p.label}</span>
            <span class="ping mono {p.state}">{p.ping}</span>
          </button>
        {:else}
          <p class="empty dim">No connections. Drag one onto this environment in the explorer, or add one with New connection.</p>
        {/each}
      </section>

      <div class="rail">
        <section class="card props" aria-label="Properties">
          <div class="card-head"><span class="label">Properties</span></div>
          <dl>
            <dt><label for="env-pane-name">Name</label></dt>
            <dd>
              <input
                id="env-pane-name"
                class="name"
                class:bad={nameBad}
                bind:this={nameInput}
                bind:value={nameDraft}
                spellcheck="false"
                autocomplete="off"
                onfocus={() => (nameFocused = true)}
                onblur={commitName}
                onkeydown={nameKey}
              />
            </dd>

            <dt>Colour</dt>
            <dd class="anchor" bind:this={colourRoot}>
              <button type="button" class="ghost value" aria-label="Colour {env.color}" aria-haspopup="dialog" aria-expanded={open === "colour"} onclick={() => toggle("colour")}>
                <span class="swatch"></span><span class="mono">{env.color}</span>{@render glyph("chevron")}
              </button>
              {#if open === "colour"}
                <div class="popover" role="dialog" aria-label="Colour">
                  <div class="swatches" role="radiogroup" aria-label="Colours">
                    {#each ENV_PICKER as c}
                      <button type="button" class="swatch-pick" class:chosen={c === env.color} style:background={c}
                        role="radio" aria-checked={c === env.color} aria-label={c} onclick={() => pickColour(c)}></button>
                    {/each}
                  </div>
                  <label class="hex">
                    <span class="dim">Hex</span>
                    <input class="mono" class:bad={hexBad} bind:value={hexDraft} spellcheck="false" autocomplete="off"
                      oninput={() => (hexBad = false)} onkeydown={hexKey} aria-invalid={hexBad} />
                  </label>
                </div>
              {/if}
            </dd>

            <dt>Write policy</dt>
            <dd class="anchor" bind:this={policyRoot}>
              <button type="button" class="ghost value" aria-label="Write policy {env.readOnly ? 'Read-only' : 'Allowed'}" aria-haspopup="menu" aria-expanded={open === "policy"} onclick={() => toggle("policy")}>
                <span class="dot" class:ro={env.readOnly}></span>{env.readOnly ? "Read-only" : "Allowed"}{@render glyph("chevron")}
              </button>
              {#if open === "policy"}
                <div class="popover menu" role="menu" aria-label="Write policy">
                  <button type="button" class="ghost" role="menuitemradio" aria-checked={!env.readOnly} onclick={() => pickPolicy(false)}>
                    <span class="dot"></span>Allowed
                  </button>
                  <button type="button" class="ghost" role="menuitemradio" aria-checked={env.readOnly} onclick={() => pickPolicy(true)}>
                    <span class="dot ro"></span>Read-only
                  </button>
                </div>
              {/if}
            </dd>

            <dt>Position</dt>
            <dd class="position">
              <span class="mono">{position} of {total}</span>
              <button type="button" class="ghost arrow" aria-label="Move up" title="Move up" disabled={position <= 1} onclick={() => onMove(-1)}>{@render glyph("arrow-up")}</button>
              <button type="button" class="ghost arrow" aria-label="Move down" title="Move down" disabled={position >= total} onclick={() => onMove(1)}>{@render glyph("arrow-down")}</button>
            </dd>
          </dl>
          {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
        </section>

        {#if recent.length}
          <section class="card recent" aria-label="Recent">
            <div class="card-head"><span class="label">Recent</span></div>
            {#each recent as r (r.place.nodeId)}
              <button type="button" class="ghost recent-row" title="Open {r.place.label} on {r.place.hostName}" onclick={() => onOpenRecent(r.place)}>
                <span class="what"><span class="dim">{r.connection} ·</span> {r.place.label}</span>
                <span class="mono dim">{age(Date.now() - r.place.at)}</span>
              </button>
            {/each}
          </section>
        {/if}

        <div class="delete">
          <button type="button" class="ghost danger" onclick={onDelete}>Delete environment</button>
          <p class="dim">Removes the environment and its {plural(built.list.length, "connection")}. Saved secrets are deleted.</p>
        </div>
      </div>
    </div>
  </div>

  <footer>
    <span class="ready"><span class="ok-dot"></span>Ready</span>
    <span class="mono">{env.name}: {plural(built.list.length, "item")} in {took} ms</span>
    <span class="saves">Changes save as you make them</span>
  </footer>
</section>

<style>
  .env-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .rule {
    flex: none;
    height: 3px;
    background: linear-gradient(90deg, var(--env) 0 40%, transparent 100%);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    padding: 22px 28px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .dim {
    color: var(--tree-dim);
  }
  svg {
    width: 14px;
    height: 14px;
    flex: none;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--env);
    font-size: 17px;
    font-weight: 700;
  }
  .identity {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-3xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
  .place {
    flex: none;
    font: var(--fs-xs) var(--font-mono);
    text-transform: uppercase;
    color: var(--tree-dim);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 0;
    font-size: var(--fs-md);
    color: var(--text-muted);
  }
  .summary b {
    font-weight: 600;
    color: var(--text);
  }
  .sep {
    color: var(--border);
  }
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  button.new {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 12px;
    border: none;
    border-radius: 6px;
    background: var(--action-primary);
    color: var(--on-action-primary);
    font-weight: 600;
  }
  button.new:hover:not(:disabled) {
    background: var(--action-primary);
    filter: brightness(1.08);
  }
  button.new :global(kbd) {
    background: rgb(0 0 0 / 0.12);
    border-color: rgb(0 0 0 / 0.2);
    color: var(--on-action-primary);
  }
  .refresh {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 6px;
    color: var(--text-muted);
  }
  .refresh svg {
    width: 16px;
    height: 16px;
  }
  .refresh:hover {
    color: var(--text);
  }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    margin-top: 24px;
    min-height: 0;
  }
  .card {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-pane);
    overflow: hidden;
  }
  .connections {
    align-self: start;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .timing {
    font-size: var(--fs-xs);
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    margin-left: auto;
  }
  .pill {
    padding: 1px 7px;
    border: 1px solid color-mix(in srgb, var(--badge) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--badge) 22%, transparent);
    font-size: var(--fs-xs);
    color: var(--text);
    white-space: nowrap;
  }
  .cols,
  .conn {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 100px 96px 70px;
    gap: 14px;
    align-items: center;
    padding: 0 16px;
  }
  .cols {
    height: 30px;
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--tree-dim);
  }
  .conn {
    width: 100%;
    height: 42px;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: none;
    text-align: left;
  }
  .conn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .host {
    display: flex;
    min-width: 0;
    font: 12.5px/1 var(--font-mono);
  }
  .host :global(.segmented) {
    text-overflow: ellipsis;
  }
  .host :global(.core) {
    font-weight: 600;
  }
  .engine {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .right {
    text-align: right;
  }
  /* Status colours (docs/environment-pane.md): the theme's ok, warn and bad; Checking and Unknown are dim. */
  .reachable {
    --status: var(--ok);
  }
  .slow {
    --status: var(--warn);
  }
  .unreachable {
    --status: var(--bad);
  }
  .checking,
  .unknown {
    --status: var(--tree-dim);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .dot-status {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--status) 15%, transparent);
  }
  .dot-status.checking,
  .dot-status.unknown {
    box-shadow: none;
  }
  .ping {
    font-size: 12.5px;
    text-align: right;
    color: var(--status);
  }
  .reach {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .reach .dot-status {
    width: 7px;
    height: 7px;
    box-shadow: none;
  }
  .empty {
    margin: 0;
    padding: 14px 16px;
    border-top: 1px solid var(--border);
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }
  .props {
    overflow: visible;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    row-gap: 10px;
    column-gap: 16px;
    margin: 0;
    padding: 0 16px 14px;
    font-size: var(--fs-md);
  }
  dt {
    display: flex;
    align-items: center;
    min-height: 22px;
    color: var(--tree-dim);
  }
  dt label {
    color: inherit;
  }
  dd {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-height: 22px;
    margin: 0;
  }
  .anchor {
    position: relative;
  }
  input.name {
    width: 100%;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    text-align: right;
    font-weight: 600;
  }
  input.name:hover,
  input.name:focus {
    border-color: var(--border);
    background: var(--bg);
  }
  input.bad {
    animation: flash-bad 600ms ease-out;
    border-color: var(--bad);
  }
  @keyframes flash-bad {
    0% {
      background: color-mix(in srgb, var(--bad) 35%, transparent);
    }
    100% {
      background: transparent;
    }
  }
  button.value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 4px 0 6px;
    border-radius: 4px;
    color: var(--text);
  }
  button.value:hover {
    background: var(--bg-hover);
  }
  button.value svg {
    color: var(--text-muted);
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--env);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }
  .dot.ro {
    background: var(--warn);
  }
  .popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-pane);
    box-shadow: var(--shadow-popover);
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch-pick {
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid transparent;
  }
  .swatch-pick.chosen {
    border-color: var(--text);
  }
  .hex {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .hex input {
    flex: 1;
    min-width: 0;
    width: 0;
  }
  .hex input.bad {
    border-color: var(--bad);
  }
  .menu {
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 4px;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    text-align: left;
  }
  .menu button:hover {
    background: var(--bg-hover);
  }
  .position {
    gap: 2px;
  }
  .position .mono {
    margin-right: 6px;
  }
  button.arrow {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    color: var(--text-muted);
  }
  button.arrow:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  .error {
    margin: 0;
    padding: 0 16px 14px;
    color: var(--bad);
    overflow-wrap: anywhere;
  }
  .recent {
    padding-bottom: 6px;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 28px;
    padding: 0 16px;
    border-radius: 0;
    text-align: left;
    font-size: var(--fs-md);
  }
  .recent-row:hover {
    background: var(--bg-hover);
  }
  .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-row .mono {
    flex: none;
    font-size: var(--fs-xs);
  }
  .delete {
    margin-top: auto;
  }
  .delete button {
    width: 100%;
    height: 32px;
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    border-radius: 6px;
    color: var(--bad);
  }
  .delete button:hover {
    background: color-mix(in srgb, var(--bad) 12%, transparent);
  }
  .delete p {
    margin: 8px 0 0;
    font-size: var(--fs-sm);
    text-align: center;
  }

  footer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 30px;
    padding: 0 28px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--tree-dim);
  }
  .ready {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ok-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .saves {
    margin-left: auto;
  }
</style>
