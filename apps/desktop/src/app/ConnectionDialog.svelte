<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Api, AppConfig, ConnectionConfig, ConnectionKind, EnvironmentConfig, KindDescription, TestConnectionResult } from "./api";
  import Dialog from "./Dialog.svelte";
  import { NEW_ENV, NO_ENV, toEnvironmentId } from "./env-picker";
  import EnvPicker from "./EnvPicker.svelte";
  import SignInFields from "./SignInFields.svelte";
  import { keepsSecret, SignInDraft } from "./sign-in.svelte";
  import TrustFields from "./TrustFields.svelte";

  let {
    api,
    kinds,
    environments,
    environmentId: initialEnvironmentId,
    initial,
    onSaved,
    onEnvironmentCreated,
    onClose,
  }: {
    api: Api;
    /** The connection kinds the sidecar serves (backends.describe), in Type list order. */
    kinds: KindDescription[];
    environments: EnvironmentConfig[];
    /** Preselected environment; null or absent preselects None. */
    environmentId?: string | null;
    initial?: ConnectionConfig;
    /** The saved connection and its environment (null for none), so the tree can select a new one. */
    onSaved: (connection: ConnectionConfig, environmentId: string | null) => void;
    /** New environment... saved one: the new config, so the picker lists it. */
    onEnvironmentCreated: (config: AppConfig) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const editing = initial !== undefined;
  // svelte-ignore state_referenced_locally
  let environment = $state(initialEnvironmentId ?? NO_ENV);
  // svelte-ignore state_referenced_locally
  let name = $state(initial?.name ?? "");
  // svelte-ignore state_referenced_locally
  let kind = $state<ConnectionKind>(initial?.kind ?? kinds[0]?.kind ?? "");
  // svelte-ignore state_referenced_locally
  let endpoint = $state(initial?.endpoint ?? "");
  // svelte-ignore state_referenced_locally
  let database = $state(initial?.database ?? "");

  let busy = $state<"" | "testing" | "saving">("");
  let test = $state<TestConnectionResult | null>(null);
  let error = $state("");
  /** Closing the dialog mid-test cancels the test in the sidecar instead of leaving it to run out. */
  const testAbort = new AbortController();
  onDestroy(() => testAbort.abort());

  /** The picked kind; a saved connection of a kind the sidecar no longer serves falls back to the first. */
  const described = $derived(kinds.find((k) => k.kind === kind) ?? kinds[0]);
  const fields = $derived(described.fields);
  // svelte-ignore state_referenced_locally
  const draft = new SignInDraft(() => described, () => endpoint, initial);
  const placeholder = $derived(described.endpointPlaceholder);

  // A test result describes the settings it ran with: any edit to them makes it stale, so it goes (#263).
  $effect(() => {
    void [kind, endpoint, database, ...draft.touch()];
    test = null;
  });

  function config(): ConnectionConfig {
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim() || endpoint.trim(),
      kind,
      endpoint: endpoint.trim(),
      ...draft.config(),
      database: fields.database && database.trim() ? database.trim() : null,
    };
  }

  /** A saved secret can be kept only while the edit still points where it was saved for (keepsSecret). */
  const keepsSavedSecret = $derived(initial ? keepsSecret(initial, config()) : false);

  /** Blank secret means "keep the stored one" while that is allowed. */
  const secretArg = () => draft.secretArg(keepsSavedSecret);

  function validate(): string {
    if (!endpoint.trim()) return `${described.endpointLabel} is required`;
    return draft.validate(keepsSavedSecret, editing);
  }

  async function runTest() {
    test = null;
    error = validate();
    if (error) return;
    busy = "testing";
    try {
      test = await api.testConnection(config(), secretArg(), testAbort.signal);
    } catch (e) {
      test = { ok: false, elapsedMs: 0, error: String(e instanceof Error ? e.message : e) };
    } finally {
      busy = "";
    }
  }

  async function save() {
    error = environment === NEW_ENV ? "Create the new environment, or pick another." : validate();
    if (error) return;
    busy = "saving";
    try {
      const saved = config();
      await api.saveConnection(toEnvironmentId(environment), saved, secretArg());
      onSaved(saved, toEnvironmentId(environment));
      onClose();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      busy = "";
    }
  }
</script>

<Dialog title={editing ? "Edit connection" : "New connection"} {onClose}>
  <label for="c-env">Environment <span class="muted">(optional)</span></label>
  <EnvPicker {api} {environments} bind:value={environment} id="c-env" onCreated={onEnvironmentCreated} />

  <label for="c-kind">Type</label>
  <select id="c-kind" bind:value={kind}>
    {#each kinds as k}<option value={k.kind}>{k.label}</option>{/each}
  </select>

  <label for="c-endpoint">{described.endpointLabel}</label>
  <input id="c-endpoint" bind:value={endpoint} {placeholder} spellcheck="false" data-autofocus />

  <SignInFields {draft} keepsSaved={keepsSavedSecret} />

  {#if fields.database}
    <label for="c-db">Database <span class="muted">(optional)</span></label>
    <input id="c-db" bind:value={database} placeholder="Only show this database" spellcheck="false" />
  {/if}

  <label for="c-name">Display name</label>
  <input id="c-name" bind:value={name} placeholder={endpoint || "Defaults to the server"} />

  <TrustFields {draft} />

  {#if test}
    <p class="full result" class:ok={test.ok}>
      {test.ok ? `Connected in ${test.elapsedMs} ms` : `Failed after ${test.elapsedMs} ms: ${test.error}`}
    </p>
  {/if}
  {#if error}<p class="full result">{error}</p>{/if}

  {#snippet footer()}
    <button type="button" disabled={busy !== ""} onclick={runTest}>{busy === "testing" ? "Testing..." : "Test"}</button>
    {#if draft.entra && busy === "testing"}<span class="muted">A Microsoft sign-in window may open.</span>{/if}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <!-- The form's submit button, so Enter in a field saves (#217). -->
    <button type="submit" class="primary" disabled={busy !== ""} onclick={save}>Save</button>
  {/snippet}
</Dialog>

<style>
  .result {
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, transparent);
    user-select: text;
    overflow-wrap: anywhere;
  }
  .result.ok {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }
</style>
