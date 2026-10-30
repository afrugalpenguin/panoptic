<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Api, AuthKind, ConnectionConfig, ConnectionKind, EnvironmentConfig, TestConnectionResult } from "./api";
  import Dialog from "./Dialog.svelte";

  let {
    api,
    environments,
    environmentId: initialEnvironmentId,
    initial,
    onSaved,
    onClose,
  }: {
    api: Api;
    environments: EnvironmentConfig[];
    environmentId: string;
    initial?: ConnectionConfig;
    onSaved: () => void;
    onClose: () => void;
  } = $props();

  const KINDS: { value: ConnectionKind; label: string; placeholder: string }[] = [
    { value: "sql", label: "SQL Server / Azure SQL", placeholder: "myserver.database.windows.net" },
    { value: "synapse", label: "Azure Synapse SQL", placeholder: "myworkspace.sql.azuresynapse.net or ...-ondemand..." },
    { value: "cosmos", label: "Cosmos DB (NoSQL)", placeholder: "https://myaccount.documents.azure.com:443/" },
    { value: "postgres", label: "PostgreSQL / Azure Database for PostgreSQL", placeholder: "myserver.postgres.database.azure.com or host:5432" },
  ];

  // svelte-ignore state_referenced_locally
  const editing = initial !== undefined;
  // svelte-ignore state_referenced_locally
  let environmentId = $state(initialEnvironmentId);
  // svelte-ignore state_referenced_locally
  let name = $state(initial?.name ?? "");
  // svelte-ignore state_referenced_locally
  let kind = $state<ConnectionKind>(initial?.kind ?? "sql");
  // svelte-ignore state_referenced_locally
  let endpoint = $state(initial?.endpoint ?? "");
  // svelte-ignore state_referenced_locally
  let auth = $state<AuthKind>(initial?.auth ?? "entra");
  // svelte-ignore state_referenced_locally
  let user = $state(initial?.user ?? "");
  // svelte-ignore state_referenced_locally
  let database = $state(initial?.database ?? "");
  // svelte-ignore state_referenced_locally
  let tenantId = $state(initial?.tenantId ?? "");
  // svelte-ignore state_referenced_locally
  let trust = $state(initial?.trustServerCertificate ?? false);
  let secret = $state("");

  let busy = $state<"" | "testing" | "saving">("");
  let test = $state<TestConnectionResult | null>(null);
  let error = $state("");
  /** Closing the dialog mid-test cancels the test in the sidecar instead of leaving it to run out. */
  const testAbort = new AbortController();
  onDestroy(() => testAbort.abort());

  const authOptions = $derived<{ value: AuthKind; label: string }[]>(
    kind === "cosmos"
      ? [
          { value: "entra", label: "Microsoft Entra ID" },
          { value: "key", label: "Account key" },
        ]
      : kind === "sql"
        ? [
            { value: "entra", label: "Microsoft Entra ID" },
            { value: "sql", label: "SQL login" },
            { value: "windows", label: "Windows" },
          ]
        : kind === "postgres"
          ? [
              { value: "entra", label: "Microsoft Entra ID" },
              { value: "password", label: "Username and password" },
            ]
          : [
              { value: "entra", label: "Microsoft Entra ID" },
              { value: "sql", label: "SQL login" },
            ],
  );
  const login = $derived(auth === "sql" || auth === "password");
  const needsSecret = $derived(login || auth === "key");
  /** Postgres signs Entra users in under their Entra name; blank means the name from the sign-in. */
  const entraUser = $derived(kind === "postgres" && auth === "entra");
  const placeholder = $derived(KINDS.find((k) => k.value === kind)!.placeholder);

  $effect(() => {
    if (!authOptions.some((o) => o.value === auth)) auth = authOptions[0].value;
  });

  function config(): ConnectionConfig {
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim() || endpoint.trim(),
      kind,
      endpoint: endpoint.trim(),
      auth,
      user: login || (entraUser && user.trim()) ? user.trim() : null,
      database: kind !== "cosmos" && database.trim() ? database.trim() : null,
      tenantId: auth === "entra" && tenantId.trim() ? tenantId.trim() : null,
      trustServerCertificate: trust,
    };
  }

  /** Blank secret while editing means "keep the stored one". */
  const secretArg = () => (needsSecret ? (secret || (editing ? undefined : "")) : "");

  function validate(): string {
    if (!endpoint.trim()) return kind === "cosmos" ? "Account URI is required" : "Server is required";
    if (login && !user.trim()) return "User is required";
    if (needsSecret && !secret && !editing) return auth === "key" ? "Account key is required" : "Password is required";
    return "";
  }

  async function runTest() {
    error = validate();
    if (error) return;
    busy = "testing";
    test = null;
    try {
      test = await api.testConnection(config(), secretArg(), testAbort.signal);
    } catch (e) {
      test = { ok: false, elapsedMs: 0, error: String(e instanceof Error ? e.message : e) };
    } finally {
      busy = "";
    }
  }

  async function save() {
    error = validate();
    if (error) return;
    busy = "saving";
    try {
      await api.saveConnection(environmentId, config(), secretArg());
      onSaved();
      onClose();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      busy = "";
    }
  }
</script>

<Dialog title={editing ? "Edit connection" : "New connection"} {onClose}>
  <label for="c-env">Environment</label>
  <select id="c-env" bind:value={environmentId}>
    {#each environments as env}<option value={env.id}>{env.name}</option>{/each}
  </select>

  <label for="c-kind">Type</label>
  <select id="c-kind" bind:value={kind}>
    {#each KINDS as k}<option value={k.value}>{k.label}</option>{/each}
  </select>

  <label for="c-endpoint">{kind === "cosmos" ? "Account URI" : "Server"}</label>
  <input id="c-endpoint" bind:value={endpoint} {placeholder} spellcheck="false" />

  <label for="c-auth">Authentication</label>
  <select id="c-auth" bind:value={auth}>
    {#each authOptions as o}<option value={o.value}>{o.label}</option>{/each}
  </select>

  {#if login}
    <label for="c-user">User</label>
    <input id="c-user" bind:value={user} spellcheck="false" autocomplete="off" />
  {:else if entraUser}
    <label for="c-user">User <span class="muted">(optional)</span></label>
    <input id="c-user" bind:value={user} placeholder="Defaults to the account you sign in with" spellcheck="false" autocomplete="off" />
  {/if}

  {#if needsSecret}
    <label for="c-secret">{auth === "key" ? "Account key" : "Password"}</label>
    <input
      id="c-secret"
      type="password"
      bind:value={secret}
      autocomplete="off"
      placeholder={editing ? "Leave blank to keep the saved one" : ""}
    />
  {/if}

  {#if auth === "entra"}
    <label for="c-tenant">Tenant <span class="muted">(optional)</span></label>
    <input id="c-tenant" bind:value={tenantId} placeholder="Defaults to your work account's tenant" spellcheck="false" />
  {/if}

  {#if kind !== "cosmos"}
    <label for="c-db">Database <span class="muted">(optional)</span></label>
    <input id="c-db" bind:value={database} placeholder="Only show this database" spellcheck="false" />
  {/if}

  <label for="c-name">Display name</label>
  <input id="c-name" bind:value={name} placeholder={endpoint || "Defaults to the server"} />

  <span></span>
  <label class="check">
    <input type="checkbox" bind:checked={trust} />
    {kind === "cosmos" ? "Skip certificate validation (localhost emulator only)" : "Trust server certificate"}
  </label>

  {#if test}
    <p class="full result" class:ok={test.ok}>
      {test.ok ? `Connected in ${test.elapsedMs} ms` : `Failed after ${test.elapsedMs} ms: ${test.error}`}
    </p>
  {/if}
  {#if error}<p class="full result">{error}</p>{/if}

  {#snippet footer()}
    <button type="button" disabled={busy !== ""} onclick={runTest}>{busy === "testing" ? "Testing..." : "Test"}</button>
    {#if auth === "entra" && busy === "testing"}<span class="muted">A Microsoft sign-in window may open.</span>{/if}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={busy !== ""} onclick={save}>Save</button>
  {/snippet}
</Dialog>

<style>
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text) !important;
  }
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
