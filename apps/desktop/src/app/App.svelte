<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { RpcClient } from "../rpc";
  import { connectSidecar, ENGINE_STOPPED, readyText, type PingResult, type SidecarStatus } from "../sidecar";
  import { afterPaint, finishBenchmark, firstPaintEpochMs, nowEpochMs, startupText, startupTimings, type StartupInfo } from "../startup";
  import { sidecarView } from "../sidecar-status";
  import { scheduleUpdateChecks } from "../update-schedule";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { createUpdateChecker, currentVersion, installPendingUpdate, type UpdateState } from "../updates";
  import { parseChangelog, sectionsSince, type ChangelogSection } from "../whats-new";
  import { createApi, type Api, type AppConfig, type AppSettings, type ConnectionConfig, type DeviceCodePrompt, type EnvironmentConfig, type KindDescription, type TreeNode } from "./api";
  import { registerKinds } from "./kinds";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { confirmText, readOnlyMoveText, type ConfirmText } from "./confirm";
  import ConnectionDialog from "./ConnectionDialog.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import DetailPane from "./DetailPane.svelte";
  import type { EnvironmentPaneProps } from "./env-pane";
  import EnvironmentDialog from "./EnvironmentDialog.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import BackupImportDialog from "./BackupImportDialog.svelte";
  import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
  import type { BackupPreview } from "../sidecar-types.generated";
  import MoveDialog from "./MoveDialog.svelte";
  import Explorer from "./Explorer.svelte";
  import { explorerWidth, splitterKey } from "./explorer-view";
  import { innerWidth } from "svelte/reactivity/window";
  import Landing from "./Landing.svelte";
  import SeekOverlay from "./SeekOverlay.svelte";
  import { type SeekEnv, type SeekHost, type SeekIndex, type SeekRow } from "./seek";
  import { keyCommand } from "./shortcuts";
  import { loadUsage, recordUse, saveUsage, type Place } from "./usage";
  import { rowMenu, type RowMenuContext } from "./row-menu";
  import Workspace from "../query/Workspace.svelte";
  import { preloadMonaco, warmEditorWhenIdle } from "../query/preload";
  import { intellisense, syncCatalogs } from "../query/intellisense/shared";
  import { QueryWorkspace, type QueryTab } from "../query/store.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import StatusBar from "./StatusBar.svelte";
  import { environmentOrder, moveEnvironment, stepConnection, TreeModel, UNGROUPED, type EngineSummary, type ExplorerSummary, type LoadReport, type Row } from "./tree-model";
  import { appProblem, type Problem } from "./problems";
  import { isAbortError } from "../rpc";
  import { UndoDelete } from "./undo-delete";

  let { info }: { info: StartupInfo } = $props();

  let api = $state.raw<Api>();
  let sidecar = $state<"connecting" | "connected" | "disconnected">("connecting");
  let sidecarText = $state("Starting database engine...");
  let config = $state<AppConfig>({ environments: [], connections: [] });
  let rows = $state.raw<Row[]>([]);
  let problems = $state.raw<Problem[]>([]);
  /** Failures outside the tree (#197): start-up, dropped engine output, unhandled rejections. Kept for the session. */
  let appProblems: Problem[] = [];
  let engines = $state.raw<EngineSummary[]>([]);
  let hiddenEngines = $state.raw<ReadonlySet<string>>(new Set());
  let summary = $state.raw<ExplorerSummary>({ environments: 0, connections: 0, matching: 0 });
  let selectedKey = $state<string>();
  let lastLoad = $state<LoadReport>();
  let inFlight = $state<{ id: string; label: string; startedAt: number }>();
  let startup = $state("");
  let update = $state<UpdateState>();
  let deviceCode = $state<DeviceCodePrompt>();
  let menu = $state<{ x: number; y: number; items: (MenuItem | "separator")[] }>();
  /** Ctrl+P with tabs open: Seek over the workspace. */
  let seeking = $state(false);
  /** Context menu labels for node action ids, from the sidecar (node.actionLabels). */
  let actionLabels = $state.raw<Record<string, string>>({});
  /** Connection kinds as the sidecar describes them (backends.describe). */
  let kinds = $state.raw<KindDescription[]>([]);
  let dialog = $state<
    | { kind: "environment" }
    | { kind: "connection"; environmentId: string | null; initial?: ConnectionConfig }
    | { kind: "move"; connection: ConnectionConfig; from?: string }
    | { kind: "import" }
    | { kind: "backup"; path: string; preview: BackupPreview }
    | { kind: "settings" }
  >();
  /** A destructive action waiting on ConfirmDialog. */
  let confirming = $state<{ text: ConfirmText; resolve: (confirmed: boolean) => void }>();
  /** The last delete, while it can still be undone. */
  let undoText = $state<string>();
  const undoDelete = new UndoDelete({
    restore: async (prior) => showConfig(await api!.restoreConfig(prior)),
    // If this fails the secrets go at the next start instead.
    purge: async (ids) => void (await api!.purgeSecrets(ids).catch(() => {})),
    changed: (text) => (undoText = text),
  });
  /** The bundled changelog, parsed once at start-up; empty when the build has none. */
  let changelog = $state.raw<ChangelogSection[]>([]);
  let settings = $state<AppSettings>({
    updateCheck: "startup",
    explorer: { showKindBadge: true, rowFont: "mono", envOrder: [] },
    editor: { intellisense: true, catalogSampleDocs: 50, autoRefreshOnDdl: true, warnUnknownNames: true, maxRows: 100_000 },
  });
  const checkForUpdates = createUpdateChecker((s) => (update = s));
  let stopUpdateSchedule = () => {};
  let treeWidth = $state(readWidth());
  /** Where the user has been, for Seek and Reopen (docs/landing.md, "Usage"). */
  let usage = $state.raw(loadUsage());
  /** Launch to engine ready, shown on the landing. */
  let openedMs = $state<number>();
  let explorer = $state<Explorer>();
  let landing = $state<Landing>();
  /** The first config has arrived: until then an empty config does not mean a first run. */
  let configLoaded = $state(false);

  const model = new TreeModel(
    (id, signal) => api!.children(id, signal),
    () => {
      rows = model.rows();
      showProblems();
      engines = model.engines();
      hiddenEngines = model.hiddenEngines();
      summary = model.summary();
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

  /** Loaded environments, in the tree's order, and their connections. Reads rows so it follows every tree change; preload loads all connections at start. */
  function seekEnvs(): SeekEnv[] {
    void rows;
    return model.treeEnvIds().flatMap((envId) => {
      const env = model.node(envId);
      if (!env) return [];
      const hosts: SeekHost[] = model
        .childIds(envId)
        .map((id) => model.node(id))
        .filter((n): n is TreeNode => n?.kind === "connection")
        .map((n) => ({ id: n.id, name: n.label, envId, kind: n.meta?.connectionKind }));
      return [{ id: envId, name: env.label, color: env.meta?.color, readOnly: env.meta?.readOnly === "true", hosts }];
    });
  }
  /** Connections in no environment, for Seek. */
  function seekHosts(): SeekHost[] {
    void rows;
    return model.looseIds().flatMap((id) => {
      const n = model.node(id);
      return n ? [{ id, name: n.label, kind: n.meta?.connectionKind }] : [];
    });
  }
  const seekIndex = $derived<SeekIndex>({ envs: seekEnvs(), hosts: seekHosts(), usage });

  /** An environment node's colour band and read-only flag, as its rows get them. None for a connection in no environment. */
  const envLook = (envId: string | undefined) => {
    const meta = envId ? model.node(envId)?.meta : undefined;
    return { envColor: meta?.color, readOnly: meta?.readOnly === "true" };
  };

  const workspace = new QueryWorkspace({
    executeQuery: (request) => api!.executeQuery(request),
    cancelQuery: (queryId) => api!.cancelQuery(queryId),
    catalogGet: (nodeId, database) => api!.catalogGet(nodeId, database),
    catalogRefresh: (nodeId, database) => api!.catalogRefresh(nodeId, database),
    // The explorer's list when it is loaded and fresh, so opening a tab does not ask the server again (#244).
    databases: async (connection) =>
      (model.freshChildren(connection) ?? (await api!.children(connection))).filter((n) => n.kind === "database").map((n) => n.label),
    suggest: async (request, info) => {
      syncCatalogs(info);
      return (await intellisense.suggest(request, info.keys)).suggestion;
    },
    saveAll: (request) => api!.saveAll(request),
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
    // Anything async that failed with no one to catch it still reaches the user (#197). Aborts are deliberate.
    const onUnhandled = (e: PromiseRejectionEvent) => {
      if (!isAbortError(e.reason)) reportProblem("Unexpected error", e.reason);
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    // A downloaded update installs as the window closes, so it is not downloaded again next launch (#42). The window
    // closes once this resolves; installing exits the process first.
    let unlistenClose: (() => void) | undefined;
    try {
      getCurrentWindow()
        .onCloseRequested(async () => void (await installPendingUpdate()))
        .then((u) => (unlistenClose = u), () => {});
    } catch {
      // Not in the desktop shell (the preview): nothing to install.
    }
    start();
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled);
      unlistenClose?.();
    };
  });

  /** Restart now into a downloaded update; a running query would be stopped, so that asks first (#42). */
  async function restartToUpdate() {
    if (update?.kind !== "ready") return;
    const running = workspace.tabs.some((t) => t.kind === "query" && t.running);
    if (running && !(await ask({ title: "Restart to update?", body: "A query is still running. Restarting stops it.", action: "Restart" }))) return;
    await update.install();
  }

  let rpc: RpcClient | undefined;
  let runningBeforeConnected = false;
  let initialised = false;

  /** The tree's problems, then the app's own, into the status bar count and the Problems tab. */
  function showProblems() {
    problems = [...model.problems(), ...appProblems];
    workspace.setProblems(problems);
  }

  /** Files a failure outside the tree in the Problems tab (#197). */
  function reportProblem(what: string, e: unknown) {
    console.warn(`${what}:`, e);
    appProblems = [...appProblems, appProblem(appProblems.length + 1, what, e)];
    showProblems();
  }

  async function start() {
    rpc = await connectSidecar(
      onSidecarStatus,
      (method, params) => {
        if (method === "auth.deviceCode") deviceCode = params as DeviceCodePrompt;
        else if (method.startsWith("query.") || method.startsWith("catalog.")) workspace.handle(method, params);
      },
      (reason) => reportProblem("Database engine output", reason),
    );
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
      // Before the tree loads: its badges and the connection dialog come from these.
      kinds = await api!.describeBackends();
      registerKinds(kinds);
    } catch (e) {
      // The process went away: its exited/failed status says what happened. Anything else (no answer within the
      // timeout, an error reply) means it is running but not responding, which no status will report (#197).
      if (e instanceof Error && e.message === ENGINE_STOPPED) return;
      sidecar = "disconnected";
      sidecarText = "Database engine not responding";
      lastLoad = { id: "", label: "Database engine", count: 0, ms: 0, error: `${e instanceof Error ? e.message : String(e)}. Restart Panoptic.` };
      reportProblem("Starting the database engine", e);
      return;
    }
    sidecar = "connected";
    sidecarText = readyText(ping);
    api!.actionLabels().then(
      (labels) => (actionLabels = labels),
      () => {},
    );
    // onRunning is fired and forgotten from a status event, so its failures must be caught here (#197).
    try {
      if (initialised) {
        // Restarted: requests in flight at the exit may have landed errors since, so forget again, then
        // refresh environments and connections.
        model.forgetConnections();
        await configChanged();
        return;
      }
      initialised = true;
      await firstLoad(ping);
    } catch (e) {
      lastLoad = { id: "", label: "Loading the explorer", count: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
      reportProblem("Loading the explorer", e);
    }
  }

  async function firstLoad(ping: PingResult) {
    const sidecarReadyEpochMs = nowEpochMs();
    config = await api!.config();
    configLoaded = true;
    await model.loadRoot();
    await model.preload(model.envIds());
    // Bench only: waiting for the paint would otherwise delay the rest of start-up for nothing.
    let treeRenderedEpochMs: number | undefined;
    if (info.benchMode === "startup") {
      await tick();
      await afterPaint();
      treeRenderedEpochMs = nowEpochMs();
    }

    const firstPaint = await firstPaintEpochMs();
    openedMs = Math.round(sidecarReadyEpochMs - info.mainStartEpochMs);
    const timings = startupTimings(info, ping, { sidecarReadyEpochMs, firstPaintEpochMs: firstPaint, treeRenderedEpochMs });
    startup = startupText(timings, ping);
    if (info.benchMode === "startup") await finishBenchmark(timings);
    if (info.benchMode === "expand") {
      const { benchExpand } = await import("../bench/expand");
      await finishBenchmark(await benchExpand(model, async () => (await tick(), await afterPaint())));
    }
    if (info.benchMode) return;
    warmEditorWhenIdle();
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
    } catch (e) {
      // Not recorded: the tab shows again next launch, which is better than failing start-up. Still reported, so a
      // store that refuses every settings save is not hidden (#196).
      reportProblem("Saving settings", e);
    }
  }

  async function moveEnv(id: string, by: -1 | 1) {
    await reorderEnvironments(moveEnvironment(settings.explorer.envOrder, config.environments.map((e) => e.id), id, by));
  }

  /** Move up, Move down, Alt+Up/Down and drag on an environment header (#63): saves the order, keeps the row in view. */
  async function reorderEnvironments(envOrder: string[]) {
    try {
      await saveSettings({ ...settings, explorer: { ...settings.explorer, envOrder } });
      await revealSelected();
    } catch (e) {
      reportProblem("Saving settings", e);
    }
  }

  /** After a move the moved row is the selected one (a drag, a key or a menu selects it first): scrolls it into view. */
  async function revealSelected() {
    await tick();
    if (selectedKey !== undefined) explorer?.reveal(selectedKey);
  }

  async function saveSettings(next: AppSettings) {
    settings = await api!.saveSettings(next);
    // Explorer settings re-render the tree once; nothing is reloaded.
    model.setEnvOrder(settings.explorer.envOrder);
    stopUpdateSchedule();
    stopUpdateSchedule = scheduleUpdateChecks(settings.updateCheck, checkForUpdates, { atLaunch: false });
  }

  /** Re-reads environments and connections after a config change without losing expanded subtrees. */
  /** After any config change other than a delete or its undo: a pending delete then stands, so Undo cannot overwrite the change. */
  async function configChanged(next?: AppConfig) {
    void undoDelete.settle();
    await showConfig(next);
  }

  async function showConfig(next?: AppConfig) {
    config = next ?? (await api!.config());
    await model.reload("");
    // Environments' connection lists only: reloading a loose connection's children would call its server.
    for (const id of model.envIds()) await model.reload(id);
    await model.preload(model.envIds());
    // Open tabs follow their connection: a move, or an edited environment, changes their colour and read-only flag.
    workspace.restyle((connection) => {
      const parent = model.parentOf(connection);
      if (parent === undefined || !model.childIds(parent).includes(connection)) return undefined;
      return envLook(parent || undefined);
    });
  }

  const envOf = (id: string) => config.environments.find((e) => e.id === id);
  /** A connection and its environment, which is undefined for one in no environment. */
  const connectionOf = (id: string): { env?: EnvironmentConfig; connection: ConnectionConfig } | undefined => {
    for (const env of config.environments) {
      const c = env.connections.find((x) => x.id === id);
      if (c) return { env, connection: c };
    }
    const loose = config.connections.find((x) => x.id === id);
    return loose && { connection: loose };
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

  /** New connection: always the connection dialog, its environment None unless one is given (docs/explorer-ux.md). */
  function addConnection(environmentId?: string) {
    dialog = { kind: "connection", environmentId: environmentId ?? null };
  }

  /** A connection was added: show it in the tree, selected, with focus on it (#216). */
  async function showAddedConnection(connectionId: string, environmentId: string | null) {
    await configChanged();
    await model.reveal(environmentId);
    await tick();
    const row = rows.find((r) => r.type === "node" && r.node.meta?.connectionId === connectionId);
    if (!row) return;
    explorer?.reveal(row.key);
    explorer?.focus();
  }

  /**
   * Drag onto an environment, Move to environment... and Remove from environment (null): the connection keeps its id.
   * With beforeId (a drag onto another connection, Alt+Up/Down, Move up or Move down) it goes before that connection,
   * or last for null, in its own environment or another (#63); without, it is appended, and its own environment is no
   * move. Only leaving a read-only environment asks.
   */
  async function moveConnection(connectionId: string, environmentId: string | null, beforeId?: string | null) {
    const found = connectionOf(connectionId);
    if (!found || ((found.env?.id ?? null) === environmentId && beforeId === undefined)) return;
    const leaving = readOnlyMoveText(found.connection.name, found.env, environmentId ? envOf(environmentId) : undefined);
    if (leaving && !(await ask(leaving))) return;
    try {
      await configChanged(await api!.moveConnection(connectionId, environmentId, beforeId ?? null));
      await model.reveal(environmentId);
      await revealSelected();
    } catch (e) {
      lastLoad = { id: "", label: found.connection.name, count: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Settings' Export to a file (#28): the sidecar writes it. Returns what was written, for the dialog to show. */
  async function exportConnections(): Promise<string | undefined> {
    const path = await saveFileDialog({ defaultPath: "panoptic-connections.json", filters: [{ name: "Panoptic connections", extensions: ["json"] }] });
    if (!path) return undefined;
    const r = await api!.exportBackup(path);
    const name = path.split(/[\\/]/).pop();
    return `Exported ${r.connections} connection${r.connections === 1 ? "" : "s"} in ${r.environments} environment${r.environments === 1 ? "" : "s"} to ${name}, without passwords or keys.`;
  }

  /** Settings' Import from a backup (#28): pick the file, then preview it in its own dialog. Throws if it cannot be read. */
  async function importConnections() {
    const picked = await openFileDialog({ multiple: false, directory: false, filters: [{ name: "Panoptic connections", extensions: ["json"] }] });
    if (typeof picked !== "string") return;
    dialog = { kind: "backup", path: picked, preview: await api!.readBackup(picked) };
  }

  /** Resolves true only when the user picks the destructive action. */
  function ask(text: ConfirmText): Promise<boolean> {
    return new Promise((resolve) => (confirming = { text, resolve }));
  }

  /** Delete environment and Remove connection: ask, delete, then offer Undo (docs/explorer-ux.md, "Destructive actions"). */
  async function deleteConfig(
    text: ConfirmText,
    undoLabel: string,
    connectionIds: string[],
    remove: () => Promise<AppConfig>,
  ) {
    if (!(await ask(text))) return;
    await undoDelete.settle();
    const prior = $state.snapshot(config);
    await showConfig(await remove());
    undoDelete.offer(undoLabel, prior, connectionIds);
  }

  function deleteEnvironment(env: EnvironmentConfig) {
    return deleteConfig(
      confirmText("environment", env.name, env.connections.length),
      `Deleted environment ${env.name}`,
      env.connections.map((c) => c.id),
      () => api!.deleteEnvironment(env.id),
    );
  }

  /** The selected environment's detail pane (docs/environment-pane.md); undefined for any other row. */
  function environmentPane(row: Row): EnvironmentPaneProps | undefined {
    if (row.type !== "node" || row.node.kind !== "environment") return undefined;
    const env = envOf(row.node.meta?.environmentId ?? "");
    if (!env) return undefined;
    const envNodeId = row.node.id;
    const order = environmentOrder(settings.explorer.envOrder, config.environments.map((e) => e.id));
    return {
      env,
      position: order.indexOf(env.id) + 1,
      total: order.length,
      // Reads rows so the list is rebuilt, and timed again, after every tree change.
      connections: () => (void rows, model.envConnections(envNodeId)),
      onSave: async (next) => configChanged(await api!.saveEnvironment(next)),
      onMove: (by) => void moveEnv(env.id, by),
      onNewConnection: () => sidecar === "connected" && addConnection(env.id),
      onRefresh: () => void model.refresh(envNodeId),
      onDelete: () => void deleteEnvironment(env),
      onSelectConnection: (id) => void selectConnection(envNodeId, id, false),
      onExpandConnection: (id) => void selectConnection(envNodeId, id, true),
      onConnectionMenu: (id, x, y) => void connectionMenu(envNodeId, id, x, y),
      probe: (connectionIds, fresh) => (api ? api.probeConnections(connectionIds, fresh) : Promise.reject(new Error("The database engine is not running"))),
    };
  }

  /** A connection row in the environment pane: selects it in the tree as a click there would, opening its environment first. */
  async function selectConnection(envNodeId: string, id: string, expand: boolean) {
    await model.expand(envNodeId);
    selectedKey = id;
    if (expand) await model.expand(id);
    await tick();
    explorer?.reveal(id);
    explorer?.focus(false);
  }

  /** Right-click on a connection in the environment pane: the tree's menu for it. Its row exists once the environment is open. */
  async function connectionMenu(envNodeId: string, id: string, x: number, y: number) {
    await model.expand(envNodeId);
    await tick();
    const row = rows.find((r) => r.key === id);
    if (row) openMenu(row, x, y);
  }

  function openMenu(row: Row, x: number, y: number) {
    const items = rowMenu(row, menuContext());
    if (items.length) menu = { x, y, items };
  }

  /** What the row menu reads and runs: the right-click menu and the detail pane's buttons. */
  function menuContext(): RowMenuContext {
    return {
      labels: actionLabels,
      envOrder: environmentOrder(settings.explorer.envOrder, config.environments.map((e) => e.id)),
      looseConnections: config.connections,
      environment: envOf,
      connection: connectionOf,
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
      retry: (parentId) => model.refresh(parentId),
      openProblems,
      openQuery,
      refresh: (nodeId) => model.refresh(nodeId),
      refreshQueryTabs,
      invoke: invokeAction,
      newConnection: addConnection,
      moveEnvironment: moveEnv,
      deleteEnvironment,
      editConnection: (found) => (dialog = { kind: "connection", environmentId: found.env?.id ?? null, initial: found.connection }),
      moveConnection: (found) => (dialog = { kind: "move", connection: found.connection, from: found.env?.id }),
      stepConnection: (connectionId, by) => {
        const found = connectionOf(connectionId);
        const ids = (found?.env?.connections ?? config.connections).map((c) => c.id);
        const beforeId = stepConnection(ids, connectionId, by);
        if (found && beforeId !== undefined) moveConnection(connectionId, found.env?.id ?? null, beforeId);
      },
      removeFromEnvironment: (connectionId) => moveConnection(connectionId, null),
      removeConnection: (found) =>
        deleteConfig(
          confirmText("connection", found.connection.name, 1),
          `Removed connection ${found.connection.name}`,
          [found.connection.id],
          () => api!.deleteConnection(found.connection.id),
        ),
    };
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
          capabilities: template.capabilities,
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

  /** The node's connection and environment (if it is in one), walking up the loaded tree; undefined above connection level. */
  function placeFor(nodeId: string, label: string): Place | undefined {
    let host: TreeNode | undefined;
    let env: TreeNode | undefined;
    for (let id: string | undefined = nodeId; id; id = model.parentOf(id)) {
      const n = model.node(id);
      if (n?.kind === "connection") host = n;
      else if (n?.kind === "environment") env = n;
    }
    if (!host) return undefined;
    return { envId: env?.id, hostId: host.id, hostName: host.label, nodeId, label, kind: model.node(nodeId)?.kind ?? "object" };
  }

  function remember(nodeId: string, label: string) {
    const place = placeFor(nodeId, label);
    if (!place) return;
    usage = recordUse(usage, place, Date.now());
    saveUsage(usage);
  }

  /**
   * Reopen last session / Pick up where you left off: the place only, in the tree and in a new query tab. The place
   * is a live one (seek's liveUsage), so its environment is where the connection is now.
   */
  async function reopen(place: Place) {
    await model.focus(place.envId, place.hostId);
    selectedKey = place.hostId;
    const { envColor, readOnly } = envLook(place.envId);
    await openQueryOn(model.node(place.nodeId) ?? { id: place.nodeId, label: place.label }, envColor, readOnly, "newQuery");
  }

  /**
   * Seek's Enter: scope the tree to the row and hand focus to the tree on it, so the arrows carry on from there (the
   * landing unmounts once a row is selected, which used to drop focus to the page). A place reopens.
   */
  async function seekOpen(row: SeekRow) {
    if (row.kind === "env") {
      selectedKey = row.env.id;
      void model.focus(row.env.id);
    } else if (row.kind === "host") {
      selectedKey = row.host.id;
      void model.focus(row.host.envId, row.host.id);
    } else {
      if (row.kind === "resume" || row.kind === "recent") void reopen(row.place);
      return;
    }
    await tick();
    explorer?.focus();
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
        capabilities: template.capabilities,
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
    const command = keyCommand(e, {
      seeking,
      dialogOpen: !!dialog || !!confirming || !!menu,
      inEditor: !!(e.target as Element | null)?.closest?.(".monaco-editor"),
      selectedNode: selectedRow?.type === "node" ? selectedRow.node : undefined,
    });
    if (!command) return;
    e.preventDefault();
    if (command.kind === "nodeQuery") void openQuery(selectedRow!, command.action);
    else if (command.action === "newQuery") workspace.openUnconnected();
    else if (command.action === "newConnection") {
      if (sidecar === "connected") addConnection();
    } else if (command.action === "import") {
      if (sidecar === "connected") dialog = { kind: "import" };
    } else void focusSeek();
  }

  /** Ctrl+P: the landing's Seek; with tabs open (no landing to show), Seek opens over the workspace. */
  async function focusSeek() {
    if (workspace.tabs.length > 0) {
      seeking = true;
      return;
    }
    selectedKey = undefined;
    await tick();
    landing?.focus();
  }

  function activate(row: Row) {
    if (row.type === "group") model.toggle(UNGROUPED);
    else if (row.type === "node" && row.node.hasChildren) model.toggle(row.node.id);
    else if (row.type === "error") openProblems(row.parentId);
  }

  function openProblems(nodeId?: string) {
    workspace.openProblems(problems, nodeId);
  }

  /** Expand or collapse all from the footer; a selection that gets hidden moves up to its nearest shown ancestor. */
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

  function saveWidth() {
    try {
      localStorage.setItem("panoptic.treeWidth", String(treeWidth));
    } catch {}
  }

  function startResize(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => (treeWidth = explorerWidth(ev.clientX, window.innerWidth));
    const up = () => {
      target.removeEventListener("pointermove", move);
      saveWidth();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up, { once: true });
  }

  /** The splitter by keyboard (#226): the arrows, Home and End, saved like a drag. */
  function onSplitterKeydown(e: KeyboardEvent) {
    const next = splitterKey(e, treeWidth, window.innerWidth);
    if (next === undefined) return;
    e.preventDefault();
    treeWidth = next;
    saveWidth();
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
    <Explorer
      bind:this={explorer}
      {model}
      {rows}
      {engines}
      {hiddenEngines}
      {summary}
      bind:selectedKey
      onContextMenu={openMenu}
      onActivate={activate}
      onOpenProblem={openProblems}
      onMoveConnection={moveConnection}
      onReorderEnvironments={reorderEnvironments}
      disconnected={sidecar === "disconnected"}
      showKindBadge={settings.explorer.showKindBadge}
      rowFont={settings.explorer.rowFont}
      connected={sidecar === "connected"}
      emptyHint={sidecar === "connected" && config.environments.length === 0 && config.connections.length === 0}
      onNewConnection={() => addConnection()}
      onNewEnvironment={() => (dialog = { kind: "environment" })}
      onImport={() => (dialog = { kind: "import" })}
      onExpandAll={() => expandOrCollapseAll(() => model.expandEnvironments())}
      onCollapseAll={() => expandOrCollapseAll(() => model.collapseAll())}
      onSettings={() => (dialog = { kind: "settings" })}
    />
  </aside>

  <!-- A focusable separator is a widget in ARIA (moved by keyboard), which the a11y check does not know; its value is the explorer's width in pixels. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="splitter"
    role="separator"
    tabindex="0"
    aria-label="Resize explorer"
    aria-orientation="vertical"
    aria-valuenow={treeWidth}
    aria-valuemin={explorerWidth(0, innerWidth.current ?? 0)}
    aria-valuemax={explorerWidth(Infinity, innerWidth.current ?? 0)}
    onpointerdown={startResize}
    onkeydown={onSplitterKeydown}
  ></div>

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
        connectionCount={config.connections.length + config.environments.reduce((n, e) => n + e.connections.length, 0)}
        {version}
        engine={sidecar}
        {openedMs}
        firstRun={configLoaded && config.environments.length === 0 && config.connections.length === 0}
        onSeekOpen={seekOpen}
        onSeekQuery={seekQuery}
        onSeekLeave={() => explorer?.focus(false)}
        onNewQuery={() => workspace.openUnconnected()}
        onNewConnection={() => sidecar === "connected" && addConnection()}
        onImport={() => sidecar === "connected" && (dialog = { kind: "import" })}
        onRestart={restartEngine}
      />
    {:else}
      <DetailPane row={selectedRow} actions={rowMenu(selectedRow, menuContext())} environment={environmentPane(selectedRow)} />
    {/if}
  </main>

  <div class="status-host">
    <StatusBar {sidecar} {sidecarText} {inFlight} {lastLoad} {startup} {update} onRestartToUpdate={restartToUpdate} problems={problems.length} onOpenProblems={() => openProblems()} onCancelLoad={(id) => model.cancel(id)}
      undo={undoText ? { text: undoText, run: () => undoDelete.undo() } : undefined} />
  </div>
</div>

{#if seeking}
  <SeekOverlay index={seekIndex} onOpen={seekOpen} onQuery={seekQuery} onClose={() => (seeking = false)} />
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = undefined)} />
{/if}

{#if confirming}
  <ConfirmDialog
    text={confirming.text}
    onResult={(ok) => {
      confirming?.resolve(ok);
      confirming = undefined;
    }}
  />
{/if}

{#if dialog?.kind === "environment"}
  <EnvironmentDialog
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
    onExportConnections={exportConnections}
    onImportConnections={importConnections}
    onClose={() => (dialog = undefined)} />
{:else if dialog?.kind === "backup" && api}
  <BackupImportDialog
    {api}
    path={dialog.path}
    preview={dialog.preview}
    onImported={(r) => {
      if (r.connectionsAdded > 0 || r.environmentsCreated > 0) configChanged();
      lastLoad = { id: "", label: "Import from backup", count: r.connectionsAdded, ms: 0 };
    }}
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
    {kinds}
    environments={config.environments}
    environmentId={dialog.environmentId}
    initial={dialog.initial}
    onSaved={(saved, environmentId) => (dialog?.kind === "connection" && !dialog.initial ? showAddedConnection(saved.id, environmentId) : configChanged())}
    onEnvironmentCreated={configChanged}
    onClose={() => (dialog = undefined)}
  />
{:else if dialog?.kind === "move" && api}
  <MoveDialog
    {api}
    environments={config.environments}
    connection={dialog.connection}
    from={dialog.from}
    onMove={(envId) => moveConnection(dialog?.kind === "move" ? dialog.connection.id : "", envId)}
    onEnvironmentCreated={configChanged}
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
    min-width: 0;
    min-height: 0;
    background: var(--bg-pane);
  }
  .splitter {
    grid-area: splitter;
    cursor: col-resize;
    background: var(--border);
    background-clip: content-box;
    padding: 0 1.5px;
  }
  .splitter:hover,
  .splitter:focus-visible {
    background-color: var(--accent);
    outline: none;
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
