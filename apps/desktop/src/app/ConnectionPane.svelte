<script lang="ts">
  // The connection detail pane, phase 1 (docs/connection-pane.md): a status board about the server and its properties,
  // edited in place and saved as they change. Shares the environment pane's frame, cards and controls (pane/). One
  // component for every engine: everything engine-specific comes from the node or the sidecar's kind description.
  import { onDestroy, untrack } from "svelte";
  import type { ConnectionConfig, ProbeResult } from "./api";
  import { authLabel, databases, paneNotices, placeText, secretPlace, writePolicy, type ConnectionPaneProps } from "./conn-pane";
  import { formatMs, plural, probeState, statusColor } from "./env-pane";
  import KindBadge from "./rows/KindBadge.svelte";
  import SegmentedLabel from "./rows/SegmentedLabel.svelte";
  import SignInFields from "./SignInFields.svelte";
  import { keepsSecret, SignInDraft, storesSecret } from "./sign-in.svelte";
  import TrustFields from "./TrustFields.svelte";
  import Card from "./pane/Card.svelte";
  import DangerAction from "./pane/DangerAction.svelte";
  import Dot from "./pane/Dot.svelte";
  import Glyph from "./pane/Glyph.svelte";
  import IconAction from "./pane/IconAction.svelte";
  import InlineText from "./pane/InlineText.svelte";
  import PaneFrame from "./pane/PaneFrame.svelte";
  import PaneHeader from "./pane/PaneHeader.svelte";
  import PositionControl from "./pane/PositionControl.svelte";
  import PrimaryAction from "./pane/PrimaryAction.svelte";
  import PropertyList from "./pane/PropertyList.svelte";
  import ValueMenu from "./pane/ValueMenu.svelte";

  let {
    connection,
    env,
    label,
    badge,
    kind,
    position,
    total,
    environments,
    children,
    copyText,
    canQuery,
    probe,
    onSave,
    onMoveTo,
    onMove,
    onNewQuery,
    onCopyName,
    onRefresh,
    onRemove,
  }: ConnectionPaneProps = $props();

  // The time to list the connection's children from the store, measured on every rebuild, never a constant.
  const built = $derived.by(() => {
    const start = performance.now();
    const list = children();
    return { list, ms: performance.now() - start };
  });
  const took = $derived(formatMs(built.ms));
  const dbs = $derived(databases(built.list));
  const policy = $derived(writePolicy(env));
  const host = $derived(`${label.prefix}${label.core}${label.suffix}`);
  const secret = $derived(secretPlace(connection.auth));

  // Reachability: the environment pane's probe, cache and thresholds, when the connection is shown or its host
  // changes, and past the cache on Refresh. Nothing waits on it: the tile reads "-" and the header "checking".
  let probed = $state<ProbeResult>();
  let probeRun = 0;
  const reach = $derived(probeState(probed));
  const reachColor = $derived(statusColor(reach.state));

  function runProbe(fresh: boolean) {
    const run = ++probeRun;
    probed = undefined;
    const id = connection.id;
    probe(fresh).then(
      (results) => {
        if (run === probeRun) probed = results.find((r) => r.connectionId === id) ?? { connectionId: id, status: "unknown" };
      },
      (e) => {
        if (run === probeRun) probed = { connectionId: id, status: "unknown", error: e instanceof Error ? e.message : String(e) };
      },
    );
  }

  $effect(() => {
    void [connection.id, connection.endpoint];
    untrack(() => runProbe(false));
  });

  function refresh() {
    onRefresh();
    runProbe(true);
  }

  /** The last store write's failure, shown in the Properties card until the next edit; notice is a note after a save. */
  let saveError = $state("");
  // svelte-ignore state_referenced_locally
  let notice = $state(paneNotices.get(connection.id) ?? "");

  async function write(run: () => Promise<unknown>): Promise<boolean> {
    saveError = "";
    notice = "";
    paneNotices.delete(connection.id);
    try {
      await run();
      return true;
    } catch (e) {
      saveError = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  const save = (next: ConnectionConfig, secret?: string) => write(() => onSave(next, secret));

  // Host: saving it lets the sidecar drop the saved secret (it never follows a connection to another host), forget
  // its cached children and catalogs, and probe the new host past the old one's cache. A display name that was the
  // host follows it; one the user chose stays.
  let hostField = $state<InlineText>();

  async function saveHost(next: string): Promise<boolean> {
    const named = connection.name === connection.endpoint;
    const id = connection.id;
    const note = storesSecret(connection.auth)
      ? `Enter the ${connection.auth === "key" ? "account key" : "password"} again under Authentication: the saved one is not sent to a new host.`
      : "";
    const ok = await write(async () => {
      // Noted before the write: the tree reloads during it, which can mount a new pane that reads the note.
      if (note) paneNotices.set(id, note);
      try {
        await onSave({ ...connection, endpoint: next, name: named ? next : connection.name });
      } catch (e) {
        paneNotices.delete(id);
        throw e;
      }
    });
    if (ok) notice = note;
    return ok;
  }

  // Environment: picking one moves the connection there; None makes it loose.
  let envOpen = $state(false);
  async function pickEnvironment(id: string | null) {
    envOpen = false;
    if (id === (env?.id ?? null)) return;
    await write(() => onMoveTo(id));
  }

  // Default database: the tree's databases, or none (every database is listed).
  let dbOpen = $state(false);
  async function pickDatabase(database: string | null) {
    dbOpen = false;
    if (database !== (connection.database ?? null)) await save({ ...connection, database });
  }

  // Authentication: the New connection dialog's sign-in editor in a popover, filled from the saved connection.
  let authOpen = $state(false);
  let draft = $state.raw<SignInDraft>();
  let authError = $state("");
  let authBusy = $state(false);

  $effect.pre(() => {
    if (!authOpen) return;
    untrack(() => {
      const saved = connection;
      draft = new SignInDraft(() => kind!, () => saved.endpoint, saved);
      authError = "";
    });
  });

  async function saveAuth(e: SubmitEvent) {
    e.preventDefault();
    if (!draft || authBusy) return;
    const next: ConnectionConfig = { ...connection, ...draft.config() };
    const keeps = keepsSecret(connection, next);
    authError = draft.validate(keeps, true);
    if (authError) return;
    authBusy = true;
    try {
      if (await save(next, draft.secretArg(keeps))) authOpen = false;
      else {
        // Shown in the popover, where the edit is, rather than under the rows as well.
        authError = saveError;
        saveError = "";
      }
    } finally {
      authBusy = false;
    }
  }

  onDestroy(() => {
    // A late answer for a pane that has gone is dropped.
    probeRun++;
  });

  /** C, R, F2 and Delete while focus is in the pane and not in a field or a popover. Ctrl+N is the app's. */
  function paneKey(e: KeyboardEvent) {
    const target = e.target as Element;
    if (e.ctrlKey || e.altKey || e.metaKey || target.closest("input, select, textarea, [role=dialog], [role=menu]")) return;
    if ((e.key === "c" || e.key === "C") && copyText !== undefined) {
      e.preventDefault();
      onCopyName();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      refresh();
    } else if (e.key === "F2") {
      e.preventDefault();
      hostField?.focusSelect();
    } else if (e.key === "Delete") {
      e.preventDefault();
      onRemove();
    }
  }
</script>

<PaneFrame color={env?.color} name="connection-pane" label="Connection {host}" timing="{label.core}: {plural(built.list?.length ?? 0, 'item')} in {took} ms" onkeydown={paneKey}>
  {#snippet header()}
    <PaneHeader tileText={badge.letters} tileBackground={badge.color} tileColor="var(--on-badge)" tileMono tileDot={!!env} mono place={placeText(env, position, total)}>
      {#snippet title()}<SegmentedLabel {label} />{/snippet}
      {#snippet summary()}
        {#if built.list}
          <span><b>{dbs.length}</b> {dbs.length === 1 ? "database" : "databases"}</span>
        {:else}
          <span>databases not listed</span>
        {/if}
        <span class="sep">|</span>
        <span class="reach" title={reach.title}><Dot color={reachColor.color} size={7} />{reach.label.toLowerCase()}</span>
        <span class="sep">|</span>
        <span>{badge.name}</span>
        <span class="sep">|</span>
        <span>{policy.summary}</span>
      {/snippet}
      {#snippet actions()}
        <PrimaryAction label="New query" keys="Ctrl+N" disabled={!canQuery} onclick={onNewQuery} />
        {#if copyText !== undefined}<IconAction glyph="copy" label="Copy name" keys="C" onclick={onCopyName} />{/if}
        <IconAction glyph="refresh" label="Refresh" keys="R" onclick={refresh} />
      {/snippet}
    </PaneHeader>
  {/snippet}

  {#snippet main()}
    <div class="left">
      <!-- Server strip: only tiles whose source exists. Ping is the environment pane's probe; Connected, Catalog and
           Session come with their sources (docs/connection-pane.md, phases 2 and 3). -->
      <Card label="Server" name="server">
        {#snippet head()}<span class="mono dim next">next on refresh</span>{/snippet}
        <div class="tiles">
          <div class="tile">
            <span class="key">Ping</span>
            <span class="value mono" style:color={reachColor.color}>{reach.ping}</span>
            <span class="sub" title={reach.title}><Dot color={reachColor.color} size={7} />{reach.label}</span>
          </div>
        </div>
      </Card>
      <!-- Slot: About this server card (describeServer, phase 2). Hidden until a session has opened. -->
      <!-- Slot: Needs attention strip (exceptions, phase 2). Rendered only when there is at least one. -->
    </div>
  {/snippet}

  {#snippet rail()}
    <Card label="Properties" overflow>
      <PropertyList error={saveError}>
        <dt><label for="connection-pane-host">Host</label></dt>
        <dd><InlineText bind:this={hostField} id="connection-pane-host" mono value={connection.endpoint} onCommit={saveHost} /></dd>

        <dt>Engine</dt>
        <dd class="engine"><KindBadge {badge} size={16} /><span>{kind?.label ?? badge.name}</span></dd>

        <dt>Environment</dt>
        <dd>
          <ValueMenu label="Environment {env?.name ?? 'None'}" popup="menu" popoverLabel="Environment" bind:open={envOpen}>
            {#snippet value()}
              {#if env}<Dot color={env.color} />{env.name}{:else}<span class="dim">None (loose)</span>{/if}
            {/snippet}
            {#each environments as e (e.id)}
              <button type="button" class="ghost" role="menuitemradio" aria-checked={e.id === env?.id} onclick={() => pickEnvironment(e.id)}>
                <Dot color={e.color} />{e.name}
              </button>
            {/each}
            <hr />
            <button type="button" class="ghost" role="menuitemradio" aria-checked={!env} onclick={() => pickEnvironment(null)}>None (loose)</button>
          </ValueMenu>
        </dd>

        <dt>Authentication</dt>
        <dd>
          <ValueMenu label="Authentication {authLabel(kind, connection.auth)}" popup="dialog" popoverLabel="Authentication" bind:open={authOpen}>
            {#snippet value()}<span class="ellipsis">{authLabel(kind, connection.auth)}</span>{/snippet}
            {#if draft && kind}
              <form class="auth" onsubmit={saveAuth}>
                <div class="grid">
                  <SignInFields {draft} keepsSaved={keepsSecret(connection, { ...connection, ...draft.config() })} idPrefix="cp" />
                  <TrustFields {draft} idPrefix="cp" />
                </div>
                {#if authError}<p class="auth-error" role="alert">{authError}</p>{/if}
                <div class="buttons">
                  <button type="button" onclick={() => (authOpen = false)}>Cancel</button>
                  <button type="submit" class="primary" disabled={authBusy}>Save</button>
                </div>
              </form>
            {/if}
          </ValueMenu>
        </dd>

        {#if kind?.fields.database}
          <dt>Default database</dt>
          <dd>
            <ValueMenu label="Default database {connection.database ?? 'None'}" popup="menu" popoverLabel="Default database" bind:open={dbOpen}>
              {#snippet value()}
                {#if connection.database}<span class="mono ellipsis">{connection.database}</span>{:else}<span class="dim">none</span>{/if}
              {/snippet}
              <button type="button" class="ghost" role="menuitemradio" aria-checked={!connection.database} onclick={() => pickDatabase(null)}>
                <span class="dim">None (list every database)</span>
              </button>
              <hr />
              {#each dbs as db (db.id)}
                <button type="button" class="ghost mono" role="menuitemradio" aria-checked={db.label === connection.database} onclick={() => pickDatabase(db.label)}>{db.label}</button>
              {:else}
                <button type="button" class="ghost" disabled>{built.list ? "No databases listed" : "Not listed yet: press R"}</button>
              {/each}
            </ValueMenu>
          </dd>
        {/if}

        <dt>Write policy</dt>
        <dd>
          <span class="value-text"><Dot color={policy.readOnly ? "var(--warn)" : "var(--ok)"} />{policy.value}<span class="tag">{policy.tag}</span></span>
        </dd>

        <dt>Secret</dt>
        <dd>
          <span class="value-text" title={secret.title}><Glyph name="lock" />{secret.value}</span>
        </dd>

        {#if env}
          <dt>Position</dt>
          <dd><PositionControl {position} {total} {onMove} /></dd>
        {/if}
      </PropertyList>
      {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    </Card>

    <DangerAction label="Remove connection" note="Deletes the saved connection and its secret. Nothing on the server is touched." onclick={onRemove} />
  {/snippet}
</PaneFrame>

<style>
  .mono {
    font-family: var(--font-mono);
  }
  .dim {
    color: var(--tree-dim);
  }
  .ellipsis {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .next {
    margin-left: auto;
    font-size: var(--fs-xs);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--border);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px;
  }
  .tile:not(:first-child) {
    border-left: 1px solid var(--border);
  }
  .key {
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--tree-dim);
  }
  .tile .value {
    font-size: 20px;
    font-weight: 600;
  }
  .sub {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .engine {
    gap: 8px;
  }
  .value-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-right: 6px;
  }
  .tag {
    margin-left: 2px;
    font-size: var(--fs-xs);
    color: var(--tree-dim);
  }
  .auth {
    width: 420px;
  }
  .grid {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    align-items: center;
    gap: 10px 12px;
  }
  .grid :global(label) {
    color: var(--text-muted);
  }
  .grid :global(.full) {
    grid-column: 1 / -1;
  }
  .auth-error {
    margin: 10px 0 0;
    padding: 6px 10px;
    border-radius: 4px;
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, transparent);
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .notice {
    margin: 0;
    padding: 0 16px 14px;
    color: var(--warn);
    overflow-wrap: anywhere;
  }
</style>
