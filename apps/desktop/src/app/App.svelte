<script lang="ts">
  import { onMount } from "svelte";
  import { connectSidecar, type PingResult } from "../sidecar";
  import { finishBenchmark, firstPaintEpochMs, nowEpochMs, type StartupInfo } from "../startup";
  import { checkForUpdates, type UpdateState } from "../updates";
  import { createApi, type Api, type AppConfig, type ConnectionConfig, type DeviceCodePrompt, type EnvironmentConfig } from "./api";
  import ConnectionDialog from "./ConnectionDialog.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import DetailPane from "./DetailPane.svelte";
  import EnvironmentDialog from "./EnvironmentDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import StatusBar from "./StatusBar.svelte";
  import Tree from "./Tree.svelte";
  import { TreeModel, type LoadReport, type Row } from "./tree-model";

  let { info }: { info: StartupInfo } = $props();

  let api = $state.raw<Api>();
  let sidecar = $state<"connecting" | "connected" | "disconnected">("connecting");
  let config = $state<AppConfig>({ environments: [] });
  let rows = $state.raw<Row[]>([]);
  let selectedKey = $state<string>();
  let lastLoad = $state<LoadReport>();
  let inFlight = $state<{ label: string; startedAt: number }>();
  let startup = $state("");
  let update = $state<UpdateState>();
  let deviceCode = $state<DeviceCodePrompt>();
  let menu = $state<{ x: number; y: number; items: (MenuItem | "separator")[] }>();
  let dialog = $state<
    | { kind: "environment"; initial?: EnvironmentConfig }
    | { kind: "connection"; environmentId: string; initial?: ConnectionConfig }
    | { kind: "import" }
  >();
  let treeWidth = $state(readWidth());

  const model = new TreeModel(
    (id) => api!.children(id),
    () => {
      rows = model.rows();
      const loading = model.inFlight()[0];
      inFlight = loading ? { label: model.node(loading.id)?.label ?? "tree", startedAt: loading.startedAt } : undefined;
    },
    undefined,
    (report) => {
      lastLoad = report;
      if (!report.error && report.id) deviceCode = undefined;
    },
  );

  const selectedRow = $derived(rows.find((r) => r.key === selectedKey));

  onMount(() => {
    start();
  });

  async function start() {
    const rpc = await connectSidecar(
      (code) => {
        sidecar = "disconnected";
        lastLoad = { id: "", label: "Sidecar", count: 0, ms: 0, error: `exited (code ${code ?? "unknown"}). Restart Panoptic.` };
      },
      (method, params) => {
        if (method === "auth.deviceCode") deviceCode = params as DeviceCodePrompt;
      },
    );
    api = createApi(rpc);

    let ping: PingResult;
    try {
      ping = await rpc.request<PingResult>("ping");
    } catch {
      sidecar = "disconnected";
      return;
    }
    const sidecarReadyEpochMs = nowEpochMs();
    sidecar = "connected";

    config = await api.config();
    await model.loadRoot();

    const fcp = await firstPaintEpochMs();
    const timings = {
      kind: "startup",
      mainStartEpochMs: info.mainStartEpochMs,
      firstPaintEpochMs: fcp,
      sidecarReadyEpochMs,
      mainToFirstPaintMs: Math.round(fcp - info.mainStartEpochMs),
      mainToSidecarReadyMs: Math.round(sidecarReadyEpochMs - info.mainStartEpochMs),
      sidecarStartupMs: ping.startupMs,
      sidecarMode: ping.mode,
    };
    startup = `First paint ${timings.mainToFirstPaintMs} ms, sidecar ready ${timings.mainToSidecarReadyMs} ms (sidecar ${ping.startupMs} ms, ${ping.mode}, v${ping.version})`;
    if (info.benchMode === "startup") await finishBenchmark(timings);
    if (!info.benchMode) checkForUpdates((s) => (update = s));
  }

  /** Re-reads environments and connections after a config change without losing expanded subtrees. */
  async function configChanged(next?: AppConfig) {
    config = next ?? (await api!.config());
    await model.reload("");
    for (const env of config.environments) await model.reload(`env:${encodeURIComponent(env.id)}`);
  }

  const envOf = (id: string) => config.environments.find((e) => e.id === id);
  const connectionOf = (id: string) => {
    for (const env of config.environments) {
      const c = env.connections.find((x) => x.id === id);
      if (c) return { env, connection: c };
    }
  };

  function copyName(row: Row) {
    if (row.type !== "node") return;
    const m = row.node.meta;
    const text = m?.schema && m?.name ? `[${m.schema}].[${m.name}]` : (m?.name ?? row.node.label);
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function addConnection(environmentId?: string) {
    const envId = environmentId ?? config.environments[0]?.id;
    if (!envId) dialog = { kind: "environment" };
    else dialog = { kind: "connection", environmentId: envId };
  }

  function openMenu(row: Row, x: number, y: number) {
    const items: (MenuItem | "separator")[] = [];
    if (row.type !== "node") {
      items.push({ label: "Retry", run: () => model.refresh(row.parentId) });
    } else {
      const n = row.node;
      if (n.kind === "environment") {
        const env = envOf(n.meta!.environmentId);
        items.push({ label: "New connection...", run: () => addConnection(env?.id) });
        items.push({ label: "Edit environment...", run: () => env && (dialog = { kind: "environment", initial: env }) });
        items.push({ label: "Refresh", run: () => model.refresh(n.id) });
        items.push("separator");
        items.push({
          label: "Delete environment",
          danger: true,
          run: async () => {
            if (env && confirm(`Delete environment "${env.name}" and its ${env.connections.length} connection(s)?`))
              await configChanged(await api!.deleteEnvironment(env.id));
          },
        });
      } else if (n.kind === "connection") {
        const found = connectionOf(n.meta!.connectionId);
        items.push({
          label: "Edit connection...",
          run: () => found && (dialog = { kind: "connection", environmentId: found.env.id, initial: found.connection }),
        });
        items.push({ label: "Refresh", run: () => model.refresh(n.id) });
        items.push({ label: "Copy name", run: () => copyName(row) });
        items.push("separator");
        items.push({
          label: "Remove connection",
          danger: true,
          run: async () => {
            if (found && confirm(`Remove connection "${found.connection.name}"?`))
              await configChanged(await api!.deleteConnection(found.connection.id));
          },
        });
      } else {
        if (n.actions.includes("refresh")) items.push({ label: "Refresh", run: () => model.refresh(n.id) });
        if (n.actions.includes("copyName")) items.push({ label: "Copy name", run: () => copyName(row) });
      }
    }
    if (items.length) menu = { x, y, items };
  }

  function activate(row: Row) {
    if (row.type === "node" && row.node.hasChildren) model.toggle(row.node.id);
  }

  function readWidth(): number {
    try {
      return Number(localStorage.getItem("panoptic.treeWidth")) || 360;
    } catch {
      return 360;
    }
  }

  function startResize(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => (treeWidth = Math.max(200, Math.min(window.innerWidth - 240, ev.clientX)));
    const up = () => {
      target.removeEventListener("pointermove", move);
      try {
        localStorage.setItem("panoptic.treeWidth", String(treeWidth));
      } catch {}
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up, { once: true });
  }
</script>

<div class="shell" style:--tree-w="{treeWidth}px">
  {#if deviceCode}
    <div class="banner">
      <span>Sign in at <strong>{deviceCode.verificationUri}</strong> with code <code>{deviceCode.userCode}</code></span>
      <button onclick={() => navigator.clipboard.writeText(deviceCode!.userCode)}>Copy code</button>
      <button onclick={() => (deviceCode = undefined)}>Dismiss</button>
    </div>
  {/if}

  <aside class="explorer">
    <div class="toolbar">
      <span class="title">Explorer</span>
      <span style:flex="1"></span>
      <button title="Import from SSMS, Azure Data Studio or VS Code" disabled={sidecar !== "connected"} onclick={() => (dialog = { kind: "import" })}>Import</button>
      <button title="New environment" onclick={() => (dialog = { kind: "environment" })}>+ Env</button>
      <button title="New connection" disabled={sidecar !== "connected"} onclick={() => addConnection()}>+ Connection</button>
    </div>
    <div class="tree-host">
      {#if sidecar === "connected" && config.environments.length === 0}
        <p class="hint muted">No environments yet.</p>
      {/if}
      <Tree {model} {rows} bind:selectedKey onContextMenu={openMenu} onActivate={activate} />
    </div>
  </aside>

  <div class="splitter" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>

  <main class="content">
    <DetailPane row={selectedRow} onAddEnvironment={() => (dialog = { kind: "environment" })} onImport={() => (dialog = { kind: "import" })} />
  </main>

  <div class="status-host">
    <StatusBar {sidecar} {inFlight} {lastLoad} {startup} {update} />
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = undefined)} />
{/if}

{#if dialog?.kind === "environment"}
  <EnvironmentDialog
    initial={dialog.initial}
    onSave={async (env) => configChanged(await api!.saveEnvironment(env))}
    onClose={() => (dialog = undefined)}
  />
{:else if dialog?.kind === "import" && api}
  <ImportDialog
    {api}
    {config}
    onImported={(n) => {
      if (n > 0) configChanged();
      lastLoad = { id: "", label: "Import", count: n, ms: 0 };
    }}
    onClose={() => (dialog = undefined)}
  />
{:else if dialog?.kind === "connection" && api}
  <ConnectionDialog
    {api}
    environments={config.environments}
    environmentId={dialog.environmentId}
    initial={dialog.initial}
    onSaved={() => configChanged()}
    onClose={() => (dialog = undefined)}
  />
{/if}

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--tree-w) 4px 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "banner banner banner"
      "explorer splitter content"
      "status status status";
    height: 100vh;
  }
  .banner {
    grid-area: banner;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-pane));
    border-bottom: 1px solid var(--border);
    user-select: text;
  }
  .banner span {
    flex: 1;
  }
  .explorer {
    grid-area: explorer;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-pane);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--border);
  }
  .toolbar button {
    padding: 1px 8px;
    font-size: 12px;
  }
  .title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tree-host {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .hint {
    position: absolute;
    inset: 12px auto auto 16px;
    margin: 0;
    pointer-events: none;
  }
  .splitter {
    grid-area: splitter;
    cursor: col-resize;
    background: var(--border);
    background-clip: content-box;
    padding: 0 1.5px;
  }
  .splitter:hover {
    background-color: var(--accent);
  }
  .content {
    grid-area: content;
    min-width: 0;
    min-height: 0;
  }
  .status-host {
    grid-area: status;
  }
</style>
