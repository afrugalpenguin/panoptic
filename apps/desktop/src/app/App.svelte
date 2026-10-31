<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { RpcClient } from "../rpc";
  import { connectSidecar, readyText, type PingResult, type SidecarStatus } from "../sidecar";
  import { finishBenchmark, firstPaintEpochMs, nowEpochMs, type StartupInfo } from "../startup";
  import { sidecarView } from "../sidecar-status";
  import { scheduleUpdateChecks } from "../update-schedule";
  import { createUpdateChecker, currentVersion, type UpdateState } from "../updates";
  import { parseChangelog, sectionsSince, type ChangelogSection } from "../whats-new";
  import { createApi, type Api, type AppConfig, type AppSettings, type ConnectionConfig, type DeviceCodePrompt, type EnvironmentConfig, type TreeNode } from "./api";
  import ConnectionDialog from "./ConnectionDialog.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import DetailPane from "./DetailPane.svelte";
  import EnvironmentDialog from "./EnvironmentDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import IconButton from "./IconButton.svelte";
  import KindChips from "./KindChips.svelte";
  import Landing from "./Landing.svelte";
  import type { SeekEnv, SeekHost, SeekIndex, SeekRow } from "./seek";
  import { globalShortcut } from "./shortcuts";
  import { loadUsage, recordUse, saveUsage, type Place } from "./usage";
  import { actionItems, actionLabel, queryItems, shortcutAction, type NodeActionHandlers } from "./node-menu";
  import Workspace from "../query/Workspace.svelte";
  import { preloadMonaco } from "../query/preload";
  import { intellisense, syncCatalogs } from "../query/intellisense/shared";
  import { QueryWorkspace, type QueryTab } from "../query/store.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import StatusBar from "./StatusBar.svelte";
  import Tree from "./Tree.svelte";
  import { environmentOrder, moveEnvironment, TreeModel, type KindSummary, type LoadReport, type Row } from "./tree-model";
  import { errorText, type Problem } from "./problems";

  let { info }: { info: StartupInfo } = $props();

  let api = $state.raw<Api>();
  let sidecar = $state<"connecting" | "connected" | "disconnected">("connecting");
  let sidecarText = $state("Starting database engine...");
  let config = $state<AppConfig>({ environments: [] });
  let rows = $state.raw<Row[]>([]);
  let problems = $state.raw<Problem[]>([]);
  let kinds = $state.raw<KindSummary[]>([]);
  let kindFilter = $state<string>();
  let selectedKey = $state<string>();
  let lastLoad = $state<LoadReport>();
  let inFlight = $state<{ id: string; label: string; startedAt: number }>();
  let startup = $state("");
  let update = $state<UpdateState>();
  let deviceCode = $state<DeviceCodePrompt>();
  let menu = $state<{ x: number; y: number; items: (MenuItem | "separator")[] }>();
  /** Context menu labels for node action ids, from the sidecar (node.actionLabels). */
  let actionLabels = $state.raw<Record<string, string>>({});
  let dialog = $state<
    | { kind: "environment"; initial?: EnvironmentConfig }
    | { kind: "connection"; environmentId: string; initial?: ConnectionConfig }
    | { kind: "import" }
    | { kind: "settings" }
  >();
  /** The bundled changelog, parsed once at start-up; empty when the build has none. */
  let changelog = $state.raw<ChangelogSection[]>([]);
  let settings = $state<AppSettings>({
    updateCheck: "startup",
    explorer: { showKindBadge: true, rowFont: "mono", envOrder: [] },
    editor: { intellisense: true, catalogSampleDocs: 50, autoRefreshOnDdl: true, warnUnknownNames: true },
  });
  const checkForUpdates = createUpdateChecker((s) => (update = s));
  let stopUpdateSchedule = () => {};
  let treeWidth = $state(readWidth());
  /** Where the user has been, for Seek and Reopen (docs/landing.md, "Usage"). */
  let usage = $state.raw(loadUsage());
  /** Launch to engine ready, shown on the landing. */
  let openedMs = $state<number>();
  let tree = $state<Tree>();
  let landing = $state<Landing>();

  const model = new TreeModel(
    (id, signal) => api!.children(id, signal),
    () => {
      rows = model.rows();
      problems = model.problems();
      workspace.setProblems(problems);
      kinds = model.kinds();
      kindFilter = model.activeKind();
      const loading = model.inFlight()[0];
      inFlight = loading ? { id: loading.id, label: model.node(loading.id)?.label ?? "tree", startedAt: loading.startedAt } : undefined;
    },
    undefined,
    (report) => {
      lastLoad = report;
      if (!report.error && report.id) deviceCode = undefined;
    },
  );

  const selectedRow = $derived(rows.find((r) => r.key === selectedKey));
  const version = $derived(update?.current);

  /** Loaded environments and their connections. Reads rows so it follows every tree change; preload loads all connections at start. */
  function seekEnvs(): SeekEnv[] {
    void rows;
    return model.childIds("").flatMap((envId) => {
      const env = model.node(envId);
      if (!env) return [];
      const hosts: SeekHost[] = model
        .childIds(envId)
        .map((id) => model.node(id))
        .filter((n): n is TreeNode => n?.kind === "connection")
        .map((n) => ({ id: n.id, name: n.label, envId }));
      return [{ id: envId, name: env.label, color: env.meta?.color, hosts }];
    });
  }
  const seekIndex = $derived<SeekIndex>({ envs: seekEnvs(), usage });

  /** An environment node's colour band and read-only flag, as its rows get them. */
  const envLook = (envId: string) => {
    const meta = model.node(envId)?.meta;
    return { envColor: meta?.color, readOnly: meta?.readOnly === "true" };
  };

  const workspace = new QueryWorkspace({
    executeQuery: (request) => api!.executeQuery(request),
    cancelQuery: (queryId) => api!.cancelQuery(queryId),
    catalogGet: (nodeId, database) => api!.catalogGet(nodeId, database),
    catalogRefresh: (nodeId, database) => api!.catalogRefresh(nodeId, database),
    databases: async (connection) => (await api!.children(connection)).filter((n) => n.kind === "database").map((n) => n.label),
    suggest: async (request, info) => {
      syncCatalogs(info);
      return (await intellisense.suggest(request, info.keys)).suggestion;
    },
  });

  // Editor settings apply to open tabs without a restart (docs/query-editor.md, "Settings").
  $effect(() => {
    workspace.editor = settings.editor;
  });

  // Fetch Monaco once a connection, or anything below one (any node but an environment), is selected, ahead of the
  // first query tab.
  $effect(() => {
    if (selectedRow?.type === "node" && selectedRow.node.kind !== "environment") preloadMonaco();
  });

  onMount(() => {
    start();
  });

  let rpc: RpcClient | undefined;
  let runningBeforeConnected = false;
  let initialised = false;

  async function start() {
    rpc = await connectSidecar(onSidecarStatus, (method, params) => {
      if (method === "auth.deviceCode") deviceCode = params as DeviceCodePrompt;
      else if (method.startsWith("query.") || method.startsWith("catalog.")) workspace.handle(method, params);
    });
    api = createApi(rpc);
    if (runningBeforeConnected) await onRunning();
  }

  /**
   * The shell supervises the sidecar: it may take a while to start the first time, and restarts it if it
   * exits. Once it has gone, every connection shows disconnected until it answers ping again (ADR 0005).
   */
  function onSidecarStatus(status: SidecarStatus) {
    if (status.state === "running") {
      if (rpc) void onRunning();
      else runningBeforeConnected = true;
      return;
    }
    const view = sidecarView(sidecar, status)!;
    sidecar = view.indicator;
    sidecarText = view.text;
    // Its caches went with the process: drop what was loaded below the connections.
    if (view.lost) model.forgetConnections();
    if (status.state === "failed") lastLoad = { id: "", label: "Database engine", count: 0, ms: 0, error: `${status.error}. Restart Panoptic.` };
  }

  async function onRunning() {
    let ping: PingResult;
    try {
      // Generous: the first run after install or update can be slow (antivirus scan, .NET unpacking).
      ping = await rpc!.request<PingResult>("ping", undefined, 120_000);
    } catch {
      return; // An exited/failed status follows and says what happened.
    }
    sidecar = "connected";
    sidecarText = readyText(ping);
    api!.actionLabels().then(
      (labels) => (actionLabels = labels),
      () => {},
    );
    if (initialised) {
      // Restarted: requests in flight at the exit may have landed errors since, so forget again, then
      // refresh environments and connections.
      model.forgetConnections();
      await configChanged();
      return;
    }
    initialised = true;
    await firstLoad(ping);
  }

  async function firstLoad(ping: PingResult) {
    const sidecarReadyEpochMs = nowEpochMs();
    config = await api!.config();
    await model.loadRoot();
    await model.preload(model.childIds(""));

    const fcp = await firstPaintEpochMs();
    openedMs = Math.round(sidecarReadyEpochMs - info.mainStartEpochMs);
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
    startup = `First paint ${timings.mainToFirstPaintMs} ms, engine ready ${timings.mainToSidecarReadyMs} ms (engine ${ping.startupMs} ms, ${ping.mode}, v${ping.version})`;
    if (info.benchMode === "startup") await finishBenchmark(timings);
    if (info.benchMode) return;
    settings = await api!.settings();
    model.setEnvOrder(settings.explorer.envOrder);
    const current = await currentVersion();
    update = { kind: "idle", current };
    // After the tree has loaded, so release notes never delay first paint (ADR 0013).
    changelog = parseChangelog(await invoke<string>("changelog_markdown").catch(() => ""));
    await recordVersionSeen(current);
    stopUpdateSchedule = scheduleUpdateChecks(settings.updateCheck, checkForUpdates, { atLaunch: true });
  }

  /**
   * First launch after a version change: open What's new with the sections since the last version the
   * user saw (none on a first install, when nothing has been seen), then record this version either way.
   */
  async function recordVersionSeen(current: string) {
    if (settings.lastSeenVersion === current) return;
    const unseen = sectionsSince(changelog, settings.lastSeenVersion);
    if (unseen.length > 0) workspace.openWhatsNew(unseen, "launch");
    try {
      settings = await api!.saveSettings({ ...settings, lastSeenVersion: current });
    } catch {
      // Not recorded: the tab shows again next launch, which is better than failing start-up.
    }
  }

  async function moveEnv(id: string, by: -1 | 1) {
    const envOrder = moveEnvironment(settings.explorer.envOrder, config.environments.map((e) => e.id), id, by);
    await saveSettings({ ...settings, explorer: { ...settings.explorer, envOrder } });
  }

  async function saveSettings(next: AppSettings) {
    settings = await api!.saveSettings(next);
    // Explorer settings re-render the tree once; nothing is reloaded.
    model.setEnvOrder(settings.explorer.envOrder);
    stopUpdateSchedule();
    stopUpdateSchedule = scheduleUpdateChecks(settings.updateCheck, checkForUpdates, { atLaunch: false });
  }

  /** Re-reads environments and connections after a config change without losing expanded subtrees. */
  async function configChanged(next?: AppConfig) {
    config = next ?? (await api!.config());
    await model.reload("");
    for (const id of model.childIds("")) await model.reload(id);
    await model.preload(model.childIds(""));
  }

  const envOf = (id: string) => config.environments.find((e) => e.id === id);
  const connectionOf = (id: string) => {
    for (const env of config.environments) {
      const c = env.connections.find((x) => x.id === id);
      if (c) return { env, connection: c };
    }
  };

  /** Runs an action a backend adds in the sidecar and copies the text it returns, if any. */
  async function invokeAction(node: TreeNode, actionId: string) {
    try {
      const result = await api!.invokeNode(node.id, actionId);
      if (result.text != null) navigator.clipboard.writeText(result.text).catch(() => {});
    } catch (e) {
      lastLoad = { id: node.id, label: node.label, count: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Explorer refresh on a connection or database also rebuilds the catalogs of query tabs open against it. */
  function refreshQueryTabs(nodeId: string) {
    api!.queryScope(nodeId).then(
      (scope) => workspace.refreshForScope(scope),
      () => {},
    );
  }

  function addConnection(environmentId?: string) {
    const envId = environmentId ?? config.environments[0]?.id;
    if (!envId) dialog = { kind: "environment" };
    else dialog = { kind: "connection", environmentId: envId };
  }

  function openMenu(row: Row, x: number, y: number) {
    const items: (MenuItem | "separator")[] = [];
    if (row.type === "error") {
      items.push({ label: "Copy error", run: () => navigator.clipboard.writeText(errorText(row.error)).catch(() => {}) });
      if (row.error.retryable) items.push({ label: "Retry", run: () => model.refresh(row.parentId) });
      items.push({ label: "Open Problems", run: () => openProblems(row.parentId) });
    } else if (row.type !== "node") {
      items.push({ label: "Retry", run: () => model.refresh(row.parentId) });
    } else {
      const n = row.node;
      const on: NodeActionHandlers = {
        openQuery: (action) => openQuery(row, action),
        refresh: () => (model.refresh(n.id), n.kind === "database" && refreshQueryTabs(n.id)),
        invoke: (actionId) => invokeAction(n, actionId),
        copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
      };
      items.push(...queryItems(n, actionLabels, on));
      // Environments and connections are Panoptic's own config, so their menus also edit, move and delete them.
      if (n.kind === "environment") {
        const env = envOf(n.meta!.environmentId);
        items.push({ label: "New connection...", run: () => addConnection(env?.id) });
        items.push({ label: "Edit environment...", run: () => env && (dialog = { kind: "environment", initial: env }) });
        const order = environmentOrder(settings.explorer.envOrder, config.environments.map((e) => e.id));
        const position = env ? order.indexOf(env.id) : -1;
        items.push({ label: "Move up", disabled: position <= 0, run: () => env && moveEnv(env.id, -1) });
        items.push({ label: "Move down", disabled: position < 0 || position >= order.length - 1, run: () => env && moveEnv(env.id, 1) });
        items.push({ label: actionLabel("refresh", actionLabels), run: () => model.refresh(n.id) });
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
        items.push(...actionItems(n, actionLabels, { ...on, refresh: () => (model.refresh(n.id), refreshQueryTabs(n.id)) }));
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
        items.push(...actionItems(n, actionLabels, on));
      }
    }
    if (items.length) menu = { x, y, items };
  }

  /** Opens a query tab against a row's node: New query, or Select top 1000 which also runs it. */
  function openQuery(row: Row, action: "newQuery" | "selectTop") {
    if (row.type !== "node") return;
    return openQueryOn(row.node, row.envColor, row.readOnly, action);
  }

  /**
   * Opens a query tab against a node, rendered or not (Seek reopens places the tree may not have loaded). Only nodes
   * that carry the action open a tab: the sidecar never offers it on a backend that cannot query. A node that is not
   * loaded has no actions to check; the sidecar's template refuses one it cannot query.
   */
  async function openQueryOn(
    n: { id: string; label: string; actions?: string[] },
    envColor: string | undefined,
    readOnly: boolean,
    action: "newQuery" | "selectTop",
  ) {
    if (!api || (n.actions && !n.actions.includes(action))) return;
    try {
      // The sidecar resolves the tab's scope (connection, database, container) and names from the node id.
      const template = await api.queryTemplate(n.id, action);
      const scope = template.scope;
      const tab = workspace.open(
        {
          nodeId: n.id,
          label: action === "selectTop" ? n.label : (scope?.label ?? n.label),
          connection: scope?.connectionLabel ?? "",
          envColor,
          readOnly,
          language: template.language,
          scope,
        },
        template.text ?? "",
      );
      remember(n.id, n.label);
      if (action === "selectTop") void workspace.run(tab);
    } catch (e) {
      lastLoad = { id: n.id, label: n.label, count: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** The node's environment and connection, walking up the loaded tree; undefined above connection level. */
  function placeFor(nodeId: string, label: string): Place | undefined {
    let host: TreeNode | undefined;
    let env: TreeNode | undefined;
    for (let id: string | undefined = nodeId; id; id = model.parentOf(id)) {
      const n = model.node(id);
      if (n?.kind === "connection") host = n;
      else if (n?.kind === "environment") env = n;
    }
    if (!host || !env) return undefined;
    return { envId: env.id, hostId: host.id, hostName: host.label, nodeId, label, kind: model.node(nodeId)?.kind ?? "object" };
  }

  function remember(nodeId: string, label: string) {
    const place = placeFor(nodeId, label);
    if (!place) return;
    usage = recordUse(usage, place, Date.now());
    saveUsage(usage);
  }

  /** Reopen last session / Pick up where you left off: the place only, in the tree and in a new query tab. */
  async function reopen(place: Place) {
    await model.focus(place.envId, place.hostId);
    selectedKey = place.hostId;
    const { envColor, readOnly } = envLook(place.envId);
    await openQueryOn(model.node(place.nodeId) ?? { id: place.nodeId, label: place.label }, envColor, readOnly, "newQuery");
  }

  /** Seek's Enter: scope the tree to the row, or reopen a place. */
  function seekOpen(row: SeekRow) {
    if (row.kind === "env") {
      selectedKey = row.env.id;
      void model.focus(row.env.id);
    } else if (row.kind === "host") {
      selectedKey = row.host.id;
      void model.focus(row.host.envId, row.host.id);
    } else if (row.kind === "resume" || row.kind === "recent") void reopen(row.place);
  }

  /** Seek's Ctrl+Enter: a new query tab on the connection (an environment's first one); a place reopens. */
  function seekQuery(row: SeekRow) {
    if (row.kind === "resume" || row.kind === "recent") return void reopen(row.place);
    const host = row.kind === "host" ? row.host : row.kind === "env" ? row.env.hosts[0] : undefined;
    if (!host) return;
    const { envColor, readOnly } = envLook(host.envId);
    void openQueryOn(model.node(host.id) ?? { id: host.id, label: host.name }, envColor, readOnly, "newQuery");
  }

  /** The unconnected tab's picker chose a connection: connect it in place, keeping its text. */
  async function connectTab(tab: QueryTab, host: SeekHost) {
    if (!api) return;
    try {
      const template = await api.queryTemplate(host.id, "newQuery");
      const scope = template.scope;
      workspace.connect(tab, {
        nodeId: host.id,
        label: scope?.label ?? host.name,
        connection: scope?.connectionLabel ?? "",
        ...envLook(host.envId),
        language: template.language,
        scope,
      });
      remember(host.id, host.name);
    } catch (e) {
      lastLoad = { id: host.id, label: host.name, count: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** The landing's Restart: starts the engine again after the supervisor gave up or it was stopped. */
  function restartEngine() {
    invoke("sidecar_start").catch((e) => (lastLoad = { id: "", label: "Database engine", count: 0, ms: 0, error: String(e) }));
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const action = selectedRow?.type === "node" ? shortcutAction(e, selectedRow.node) : undefined;
    if (action && selectedRow) {
      e.preventDefault();
      void openQuery(selectedRow, action);
      return;
    }
    // Not while a dialog is open: its fields keep their keys.
    if (dialog) return;
    const global = globalShortcut(e, !!(e.target as Element | null)?.closest?.(".monaco-editor"));
    if (!global) return;
    e.preventDefault();
    if (global === "newQuery") workspace.openUnconnected();
    else if (global === "newConnection") {
      if (sidecar === "connected") addConnection();
    }
    else if (global === "import") {
      if (sidecar === "connected") dialog = { kind: "import" };
    } else void focusSeek();
  }

  /** Ctrl+P: the landing's Seek. With tabs open there is nothing to focus yet (a palette comes later). */
  async function focusSeek() {
    selectedKey = undefined;
    if (workspace.tabs.length > 0) return;
    await tick();
    landing?.focus();
  }

  function activate(row: Row) {
    if (row.type === "node" && row.node.hasChildren) model.toggle(row.node.id);
    else if (row.type === "error") openProblems(row.parentId);
  }

  function openProblems(nodeId?: string) {
    workspace.openProblems(problems, nodeId);
  }

  /** Expand or collapse all from the toolbar; a selection that gets hidden moves up to its nearest shown ancestor. */
  async function expandOrCollapseAll(change: () => void | Promise<void>) {
    const before = selectedRow;
    await change();
    if (!before || rows.some((r) => r.key === before.key)) return;
    let id = before.type === "node" ? model.parentOf(before.node.id) : before.parentId;
    while (id && !rows.some((r) => r.key === id)) id = model.parentOf(id);
    selectedKey = id || undefined;
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

<svelte:window onkeydown={onGlobalKeydown} />

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
      <IconButton icon="expand-all" label="Expand all" disabled={rows.length === 0} onclick={() => expandOrCollapseAll(() => model.expandEnvironments())} />
      <IconButton icon="collapse-all" label="Collapse all" disabled={rows.length === 0} onclick={() => expandOrCollapseAll(() => model.collapseAll())} />
      <IconButton icon="import" label="Import from SSMS, Azure Data Studio or VS Code" disabled={sidecar !== "connected"} onclick={() => (dialog = { kind: "import" })} />
      <IconButton icon="environment" label="New environment" onclick={() => (dialog = { kind: "environment" })} />
      <IconButton icon="connection" label="New connection" disabled={sidecar !== "connected"} onclick={() => addConnection()} />
      <IconButton icon="settings" label="Settings" disabled={sidecar !== "connected"} onclick={() => (dialog = { kind: "settings" })} />
    </div>
    {#if kinds.length > 1}
      <KindChips
        {kinds}
        active={kindFilter}
        onSelect={(kind) => {
          kindFilter = kind;
          model.setKindFilter(kind);
        }}
      />
    {/if}
    <div class="tree-host">
      {#if sidecar === "connected" && config.environments.length === 0}
        <p class="hint muted">No environments yet.</p>
      {/if}
      <Tree
        bind:this={tree}
        {model}
        {rows}
        bind:selectedKey
        onContextMenu={openMenu}
        onActivate={activate}
        onOpenProblem={openProblems}
        disconnected={sidecar === "disconnected"}
        showKindBadge={settings.explorer.showKindBadge}
        rowFont={settings.explorer.rowFont}
      />
    </div>
  </aside>

  <div class="splitter" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>

  <main class="content">
    {#if workspace.tabs.length > 0}
      <Workspace
        {workspace}
        {seekIndex}
        onConnect={connectTab}
        onLinkError={(error) => (lastLoad = { id: "", label: "Open link", count: 0, ms: 0, error })}
      />
    {:else if !selectedRow}
      <Landing
        bind:this={landing}
        index={seekIndex}
        envCount={config.environments.length}
        {version}
        engine={sidecar}
        {openedMs}
        onSeekOpen={seekOpen}
        onSeekQuery={seekQuery}
        onSeekLeave={() => tree?.focus()}
        onReopen={() => seekIndex.usage.last && reopen(seekIndex.usage.last)}
        onNewQuery={() => workspace.openUnconnected()}
        onNewConnection={() => sidecar === "connected" && addConnection()}
        onImport={() => sidecar === "connected" && (dialog = { kind: "import" })}
        onRestart={restartEngine}
      />
    {:else}
      <DetailPane row={selectedRow} />
    {/if}
  </main>

  <div class="status-host">
    <StatusBar {sidecar} {sidecarText} {inFlight} {lastLoad} {startup} {update} problems={problems.length} onOpenProblems={() => openProblems()} onCancelLoad={(id) => model.cancel(id)} />
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
{:else if dialog?.kind === "settings"}
  <SettingsDialog {settings} {update} onSave={saveSettings} onCheckNow={() => checkForUpdates()}
    hasChangelog={changelog.length > 0}
    onWhatsNew={() => {
      workspace.openWhatsNew(changelog, "settings");
      dialog = undefined;
    }}
    onClose={() => (dialog = undefined)} />
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
    gap: 2px;
    height: 40px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--border);
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
