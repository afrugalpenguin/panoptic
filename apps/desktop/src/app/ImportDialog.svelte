<script lang="ts">
  import { onMount } from "svelte";
  import type { Api, AppConfig, EnvironmentConfig, ImportCandidate, ImportSource } from "./api";
  import Dialog from "./Dialog.svelte";
  import { candidateKey, envStyleFor, planGroups, type PlanGroup } from "./import-plan";

  let { api, config, onImported, onClose }: { api: Api; config: AppConfig; onImported: (count: number) => void; onClose: () => void } =
    $props();

  const AUTH_LABEL: Record<string, string> = { entra: "Entra", sql: "SQL login", windows: "Windows", key: "Key" };

  let scanning = $state(true);
  let sources = $state<ImportSource[]>([]);
  let plan = $state<PlanGroup[]>([]);
  let selected = $state<Record<string, boolean>>({});
  let target = $state<Record<string, string>>({});
  let names = $state<Record<string, string>>({});
  let importing = $state(false);
  let byPattern = $state(false);
  const hasOwnGroups = $derived(sources.some((s) => s.source !== "ssms-recent" && s.groups.some((g) => g.connections.length > 0)));
  let error = $state("");

  // Selection is per connection, so it follows a connection when it is moved to another group.
  const keyOf = (c: ImportCandidate) => candidateKey(c);
  const examined = $derived(
    sources.map((s) => ({
      label: s.label,
      path: s.path,
      count: s.groups.reduce((n, g) => n + g.connections.length, 0),
      error: s.error,
    })),
  );
  const total = $derived(plan.reduce((n, g) => n + g.candidates.filter((c) => !c.alreadyAdded).length, 0));
  const count = $derived(
    plan.reduce((n, g) => n + g.candidates.filter((c) => !c.alreadyAdded && selected[keyOf(c)]).length, 0),
  );

  onMount(async () => {
    try {
      sources = await api.scanImports();
      replan();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      scanning = false;
    }
  });

  /** Builds the proposed groups and resets choices for them. */
  function replan() {
    plan = planGroups(sources, { byPattern });
    for (const g of plan) {
      const match = config.environments.find((e) => e.name.toLowerCase() === g.name.toLowerCase());
      target[g.key] = match?.id ?? "new";
      names[g.key] = g.name;
      g.candidates.forEach((c) => (selected[keyOf(c)] = !c.alreadyAdded));
    }
  }

  /** Moves a connection to another proposed group; empty groups disappear. */
  function moveTo(c: ImportCandidate, from: PlanGroup, toKey: string) {
    const to = plan.find((g) => g.key === toKey);
    if (!to || to === from) return;
    plan = plan
      .map((g) =>
        g === from ? { ...g, candidates: g.candidates.filter((x) => x !== c) } : g === to ? { ...g, candidates: [...g.candidates, c] } : g,
      )
      .filter((g) => g.candidates.length > 0);
  }

  function toggleGroup(g: PlanGroup, on: boolean) {
    g.candidates.forEach((c) => {
      if (!c.alreadyAdded) selected[keyOf(c)] = on;
    });
  }

  const groupState = (g: PlanGroup) => {
    const open = g.candidates.map((c) => (c.alreadyAdded ? undefined : selected[keyOf(c)])).filter((v) => v !== undefined);
    return { all: open.length > 0 && open.every(Boolean), some: open.some(Boolean) };
  };

  async function runImport() {
    importing = true;
    error = "";
    let imported = 0;
    // Environments created during this import, by lower-cased name, so two groups can share one.
    const created = new Map<string, string>();
    try {
      for (const [index, g] of plan.entries()) {
        const chosen = g.candidates.filter((c) => !c.alreadyAdded && selected[keyOf(c)]);
        if (chosen.length === 0) continue;

        let envId = target[g.key];
        if (envId === "new") {
          const name = (names[g.key] ?? g.name).trim() || g.name;
          const existing = config.environments.find((e) => e.name.toLowerCase() === name.toLowerCase());
          envId = existing?.id ?? created.get(name.toLowerCase()) ?? "";
          if (!envId) {
            const env: EnvironmentConfig = { id: crypto.randomUUID(), name, ...envStyleFor(name, index), connections: [] };
            await api.saveEnvironment(env);
            created.set(name.toLowerCase(), env.id);
            envId = env.id;
          }
        }

        for (const c of chosen) {
          await api.saveConnection(envId, toConnection(c));
          imported++;
        }
      }
      onImported(imported);
      onClose();
    } catch (e) {
      error = `Imported ${imported}, then failed: ${e instanceof Error ? e.message : e}`;
      onImported(imported);
    } finally {
      importing = false;
    }
  }

  function toConnection(c: ImportCandidate) {
    return {
      id: crypto.randomUUID(),
      name: c.name,
      kind: c.kind,
      endpoint: c.endpoint,
      auth: c.auth,
      user: c.user ?? null,
      database: c.database ?? null,
      tenantId: null,
      trustServerCertificate: c.trustServerCertificate,
    };
  }
</script>

<Dialog title="Import connections" {onClose} wide>
  <div class="full content">
    {#if scanning}
      <p class="muted">Looking for saved connections in SSMS, Azure Data Studio and VS Code...</p>
    {:else if plan.length === 0}
      <p>No saved connections found.</p>
      <p class="muted">
        Panoptic looks for SSMS connection history and Registered Servers, Azure Data Studio and the VS Code mssql extension in
        your user profile.
      </p>
    {:else}
      <p class="muted intro">
        Found {total} connection{total === 1 ? "" : "s"}. Passwords are never imported: SQL logins ask once when you first connect.
        Environments marked <em>suggested</em> come from your server naming pattern; rename or retarget them as you like.
      </p>
      {#if hasOwnGroups}
        <label class="pattern">
          <input type="checkbox" bind:checked={byPattern} onchange={replan} />
          Group by server naming pattern instead of the groups saved in SSMS
        </label>
      {/if}
      {#each plan as g (g.key)}
        {@const s = groupState(g)}
        <section class="group">
          <header>
            <input
              type="checkbox"
              checked={s.all}
              indeterminate={s.some && !s.all}
              aria-label="Select all in {g.name}"
              onchange={(e) => toggleGroup(g, e.currentTarget.checked)}
            />
            <span class="arrow">Into</span>
            <select bind:value={target[g.key]} aria-label="Target environment for {g.name}">
              <option value="new">New environment</option>
              {#each config.environments as env}<option value={env.id}>{env.name}</option>{/each}
            </select>
            {#if target[g.key] === "new"}
              <input class="name" bind:value={names[g.key]} aria-label="New environment name" />
            {/if}
            {#if g.suggested}<span class="tag">suggested</span>{/if}
            <span class="source muted">{g.sourceLabel}</span>
          </header>
          <ul>
            {#each g.candidates as c (keyOf(c))}
              <li class:added={c.alreadyAdded}>
                <label>
                  <input type="checkbox" bind:checked={selected[keyOf(c)]} disabled={c.alreadyAdded} />
                  <span class="cname">{c.name}</span>
                  {#if c.name !== c.endpoint}<span class="muted endpoint">{c.endpoint}</span>{/if}
                  <span class="auth">{AUTH_LABEL[c.auth] ?? c.auth}{c.user ? ` (${c.user})` : ""}</span>
                  {#if c.kind === "synapse"}<span class="tag">Synapse</span>{/if}
                  {#if c.alreadyAdded}<span class="muted">already added</span>{:else if c.note}<span class="note">{c.note}</span>{/if}
                </label>
                {#if !c.alreadyAdded && plan.length > 1}
                  <select class="move" aria-label="Move {c.name} to another group" value="" onchange={(e) => moveTo(c, g, e.currentTarget.value)}>
                    <option value="" disabled>Move to...</option>
                    {#each plan.filter((o) => o !== g) as o (o.key)}<option value={o.key}>{names[o.key] ?? o.name}</option>{/each}
                  </select>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}

    {#if !scanning}
      <details class="examined" open={plan.length === 0}>
        <summary>Looked in {examined.length} file{examined.length === 1 ? "" : "s"}</summary>
        {#if examined.length === 0}
          <p class="muted">No SSMS, Azure Data Studio or VS Code settings files were found in your profile.</p>
        {:else}
          <ul>
            {#each examined as f}
              <li>
                <span class:error={f.error}>{f.error ? "error" : `${f.count} connection${f.count === 1 ? "" : "s"}`}</span>
                <span class="muted">{f.label}</span>
                <code title={f.path}>{f.path}</code>
                {#if f.error}<div class="error">{f.error}</div>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  {#snippet footer()}
    <span class="muted">{count} selected</span>
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={importing || count === 0} onclick={runImport}>
      {importing ? "Importing..." : `Import ${count}`}
    </button>
  {/snippet}
</Dialog>

<style>
  .content {
    max-height: 60vh;
    overflow: auto;
    margin: -4px -4px 0;
    padding: 4px;
  }
  .intro {
    margin-top: 0;
  }
  .pattern {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px 0 12px;
    color: var(--text) !important;
  }
  .group {
    margin-bottom: 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .group header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    border-radius: 6px 6px 0 0;
  }
  .group header .name {
    width: 180px;
  }
  .arrow {
    color: var(--text-muted);
  }
  .source {
    margin-left: auto;
    font-size: 11px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }
  li {
    display: flex;
    align-items: center;
    padding-right: 8px;
  }
  li label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    color: var(--text) !important;
    white-space: nowrap;
    overflow: hidden;
  }
  li:hover {
    background: var(--bg-hover);
  }
  .move {
    flex: none;
    font-size: 11px;
    padding: 1px 4px;
  }
  li.added {
    opacity: 0.55;
  }
  .cname {
    font-weight: 500;
  }
  .endpoint,
  .auth {
    font-size: 12px;
  }
  .auth {
    color: var(--text-muted);
  }
  .endpoint {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 8px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .note {
    font-size: 11px;
    color: var(--warn);
  }
  .error {
    color: var(--bad);
  }
  .examined {
    margin-top: 12px;
    font-size: 12px;
  }
  .examined summary {
    cursor: pointer;
    color: var(--text-muted);
  }
  .examined ul {
    padding: 4px 0 0 4px;
  }
  .examined li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    padding: 2px 0;
  }
  .examined code {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
