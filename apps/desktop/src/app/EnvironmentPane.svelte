<script lang="ts">
  // The environment detail pane (docs/environment-pane.md): live facts and in-place properties, saved as they change.
  // The frame, header, cards and property controls are shared with the connection pane (pane/).
  import { onDestroy, untrack } from "svelte";
  import type { ProbeResult } from "./api";
  import { ENV_PICKER } from "./env-palette";
  import type { EnvironmentConfig } from "./api";
  import { engineCounts, formatMs, parseHex, plural, probeState, reachability, statusColor, textOn, type EnvironmentPaneProps } from "./env-pane";
  import KindBadge from "./rows/KindBadge.svelte";
  import SegmentedLabel from "./rows/SegmentedLabel.svelte";
  import Card from "./pane/Card.svelte";
  import DangerAction from "./pane/DangerAction.svelte";
  import Dot from "./pane/Dot.svelte";
  import IconAction from "./pane/IconAction.svelte";
  import InlineText from "./pane/InlineText.svelte";
  import PaneFrame from "./pane/PaneFrame.svelte";
  import PaneHeader from "./pane/PaneHeader.svelte";
  import PositionControl from "./pane/PositionControl.svelte";
  import PrimaryAction from "./pane/PrimaryAction.svelte";
  import PropertyList from "./pane/PropertyList.svelte";
  import RecentRows from "./pane/RecentRows.svelte";
  import ValueMenu from "./pane/ValueMenu.svelte";

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

  let nameField = $state<InlineText>();

  // Colour and Write policy: each a popover; a click elsewhere or Escape closes it.
  let colourOpen = $state(false);
  let policyOpen = $state(false);
  let hexDraft = $state("");
  let hexBad = $state(false);

  $effect.pre(() => {
    if (colourOpen) {
      hexDraft = untrack(() => env.color);
      hexBad = false;
    }
  });

  async function pickColour(color: string) {
    colourOpen = false;
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
    policyOpen = false;
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
  });

  /** N, R and F2 while focus is in the pane and not in a field. */
  function paneKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey || (e.target as Element).closest("input")) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onNewConnection();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      refresh();
    } else if (e.key === "F2") {
      e.preventDefault();
      nameField?.focusSelect();
    }
  }
</script>

<PaneFrame color={env.color} name="env-pane" label="Environment {env.name}" timing="{env.name}: {plural(built.list.length, 'item')} in {took} ms" onkeydown={paneKey}>
  {#snippet header()}
    <PaneHeader tileText={env.name.charAt(0).toUpperCase()} tileBackground="var(--env)" tileColor={textOn(env.color)} place="Environment · {position} of {total}">
      {#snippet title()}{env.name}{/snippet}
      {#snippet summary()}
        <span><b>{built.list.length}</b> {built.list.length === 1 ? "connection" : "connections"}</span>
        <span class="sep">|</span>
        <span><b>{engines.length}</b> {engines.length === 1 ? "engine" : "engines"}</span>
        <span class="sep">|</span>
        {#if reach.checking}
          <span class="reach"><Dot color={statusColor("checking").color} size={7} />checking</span>
        {:else}
          <span class="reach"><Dot color={statusColor("reachable").color} size={7} /><b>{reach.reachable}</b> reachable</span>
        {/if}
        <span class="sep">|</span>
        <span>{env.readOnly ? "read-only" : "writes allowed"}</span>
      {/snippet}
      {#snippet actions()}
        <PrimaryAction label="New connection" keys="N" onclick={onNewConnection} />
        <IconAction glyph="refresh" label="Refresh" keys="R" onclick={refresh} />
      {/snippet}
    </PaneHeader>
  {/snippet}

  {#snippet main()}
    <Card label="Connections" onkeydown={rowKey}>
      {#snippet head()}
        <span class="mono dim timing">{built.list.length} listed in {took} ms</span>
        <span class="pills">
          {#each engines as e (e.kind)}
            <span class="pill" style:--badge={e.badge.color}>{e.badge.name} {e.count}</span>
          {/each}
        </span>
      {/snippet}
      <div class="cols" aria-hidden="true">
        <span></span><span>Host</span><span>Engine</span><span>Status</span><span class="right">Ping</span>
      </div>
      {#each built.list as c (c.id)}
        {@const p = probeState(probes[c.connectionId])}
        {@const s = statusColor(p.state)}
        <button type="button" class="conn" title={`${c.label.prefix}${c.label.core}${c.label.suffix}`}
          onclick={(e) => rowClick(e, c.id)} ondblclick={() => rowDoubleClick(c.id)} oncontextmenu={(e) => rowMenu(e, c.id)}>
          <KindBadge badge={c.badge} size={22} />
          <span class="host"><SegmentedLabel label={c.label} /></span>
          <span class="engine">{c.badge.name}</span>
          <span class="status {p.state}" title={p.title}><Dot color={s.color} ring={s.ring} />{p.label}</span>
          <span class="ping mono {p.state}" style:color={s.color}>{p.ping}</span>
        </button>
      {:else}
        <p class="empty dim">No connections. Drag one onto this environment in the explorer, or add one with New connection.</p>
      {/each}
    </Card>
  {/snippet}

  {#snippet rail()}
    <Card label="Properties" overflow>
      <PropertyList error={saveError}>
        <dt><label for="env-pane-name">Name</label></dt>
        <dd><InlineText bind:this={nameField} id="env-pane-name" value={env.name} onCommit={(name) => save({ ...env, name })} /></dd>

        <dt>Colour</dt>
        <dd>
          <ValueMenu label="Colour {env.color}" popup="dialog" popoverLabel="Colour" bind:open={colourOpen}>
            {#snippet value()}<span class="swatch"></span><span class="mono">{env.color}</span>{/snippet}
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
          </ValueMenu>
        </dd>

        <dt>Write policy</dt>
        <dd>
          <ValueMenu label="Write policy {env.readOnly ? 'Read-only' : 'Allowed'}" popup="menu" popoverLabel="Write policy" bind:open={policyOpen}>
            {#snippet value()}<Dot color={env.readOnly ? "var(--warn)" : "var(--ok)"} />{env.readOnly ? "Read-only" : "Allowed"}{/snippet}
            <button type="button" class="ghost" role="menuitemradio" aria-checked={!env.readOnly} onclick={() => pickPolicy(false)}>
              <Dot color="var(--ok)" />Allowed
            </button>
            <button type="button" class="ghost" role="menuitemradio" aria-checked={env.readOnly} onclick={() => pickPolicy(true)}>
              <Dot color="var(--warn)" />Read-only
            </button>
          </ValueMenu>
        </dd>

        <dt>Position</dt>
        <dd><PositionControl {position} {total} {onMove} /></dd>
      </PropertyList>
    </Card>

    {#if recent.length}
      <Card label="Recent">
        <RecentRows
          rows={recent.map((r) => ({
            key: r.place.nodeId,
            context: r.connection,
            label: r.place.label,
            title: `Open ${r.place.label} on ${r.place.hostName}`,
            at: r.place.at,
            open: () => onOpenRecent(r.place),
          }))}
        />
      </Card>
    {/if}

    <DangerAction label="Delete environment" note="Removes the environment and its {plural(built.list.length, 'connection')}. Saved secrets are deleted." onclick={onDelete} />
  {/snippet}
</PaneFrame>

<style>
  .mono {
    font-family: var(--font-mono);
  }
  .dim {
    color: var(--tree-dim);
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
  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .ping {
    font-size: 12.5px;
    text-align: right;
  }
  .empty {
    margin: 0;
    padding: 14px 16px;
    border-top: 1px solid var(--border);
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--env);
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
</style>
