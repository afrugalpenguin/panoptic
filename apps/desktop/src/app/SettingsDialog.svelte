<script lang="ts">
  import type { UpdateCheckMode } from "../update-schedule";
  import type { UpdateState } from "../updates";
  import type { AppSettings, EditorSettings } from "./api";
  import Dialog from "./Dialog.svelte";

  let {
    settings,
    update,
    onSave,
    onCheckNow,
    hasChangelog,
    onWhatsNew,
    onExportConnections,
    onImportConnections,
    onClose,
  }: {
    settings: AppSettings;
    update: UpdateState | undefined;
    onSave: (settings: AppSettings) => Promise<void>;
    onCheckNow: () => void;
    /** False when this build carries no release notes; the What's new button is then disabled. */
    hasChangelog: boolean;
    /** Opens the What's new tab with the full history. */
    onWhatsNew: () => void;
    /** Writes a connections backup (#28); resolves to a line saying what was written, or undefined if cancelled. */
    onExportConnections: () => Promise<string | undefined>;
    /** Picks a backup file and opens its import preview; rejects with why when the file cannot be read. */
    onImportConnections: () => Promise<void>;
    onClose: () => void;
  } = $props();

  let backupStatus = $state("");
  async function exportConnections() {
    try {
      backupStatus = (await onExportConnections()) ?? backupStatus;
    } catch (e) {
      backupStatus = `Export failed: ${e instanceof Error ? e.message : e}`;
    }
  }
  async function importConnections() {
    try {
      await onImportConnections();
    } catch (e) {
      backupStatus = `Could not read the backup: ${e instanceof Error ? e.message : e}`;
    }
  }

  const MODES: { value: UpdateCheckMode; label: string }[] = [
    { value: "startup", label: "On startup" },
    { value: "hourly", label: "Hourly" },
    { value: "never", label: "Never" },
  ];

  // svelte-ignore state_referenced_locally
  let updateCheck = $state<UpdateCheckMode>(settings.updateCheck);
  // svelte-ignore state_referenced_locally
  let showKindBadge = $state(settings.explorer.showKindBadge);
  // svelte-ignore state_referenced_locally
  let rowFont = $state(settings.explorer.rowFont);
  // svelte-ignore state_referenced_locally
  let editor = $state<Omit<EditorSettings, "keywordCase"> & { keywordCase: NonNullable<EditorSettings["keywordCase"]> | "default" }>({
    ...settings.editor,
    keywordCase: settings.editor.keywordCase ?? "default",
  });
  let saving = $state(false);

  let error = $state("");

  /** The update row's status: the main text, a muted tail, and whether it gets the check mark. */
  const status = $derived.by((): { text: string; tail?: string; ok?: boolean } => {
    switch (update?.kind) {
      case "checking":
        return { text: "Checking..." };
      case "upToDate": {
        const at = new Date(update.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return { text: `v${update.current}, up to date`, tail: `· checked ${at}`, ok: true };
      }
      case "available":
        return { text: `v${update.next} is available on GitHub Releases` };
      case "downloading":
        return { text: `Downloading v${update.next}...` };
      case "ready":
        return { text: `v${update.next} is downloaded and installs when you close Panoptic, or restart now from the status bar` };
      case "error":
        return { text: `Check failed: ${update.message}` };
      case "installFailed":
        return { text: `Update failed: ${update.message}` };
      default:
        return { text: update ? `v${update.current}, not checked yet this session` : "" };
    }
  });

  async function save() {
    saving = true;
    error = "";
    try {
      const keywordCase = editor.keywordCase === "default" ? null : editor.keywordCase;
      await onSave({ ...settings, updateCheck, explorer: { ...settings.explorer, showKindBadge, rowFont }, editor: { ...editor, keywordCase } });
      onClose();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog title="Settings" wide {onClose}>
  <div class="full settings">
    <section>
      <h3>General</h3>
      <div class="row updates">
        <span class="label">Updates</span>
        <div class="control line">
          <span class="status" title={[status.text, status.tail].filter(Boolean).join(" ")}>
            {#if status.ok}<svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>{/if}{status.text}{#if status.tail}<span class="muted">{" " + status.tail}</span>{/if}
          </span>
          <span class="links">
            <button type="button" class="link" disabled={update?.kind === "checking" || update?.kind === "downloading"} onclick={onCheckNow}>Check now</button>
            <span class="muted" aria-hidden="true">·</span>
            <button
              type="button"
              class="link"
              disabled={!hasChangelog}
              title={hasChangelog ? "Release notes for every version" : "This build has no release notes"}
              onclick={onWhatsNew}>What's new</button
            >
          </span>
        </div>
      </div>
      <div class="row">
        <label class="label" for="s-updates">Check for updates</label>
        <div class="control">
          <select id="s-updates" bind:value={updateCheck}>
            {#each MODES as m}<option value={m.value}>{m.label}</option>{/each}
          </select>
        </div>
      </div>
      <div class="row connections">
        <span class="label">Connections</span>
        <div class="control">
          <span class="links">
            <button type="button" class="link" onclick={exportConnections}>Export to a file</button>
            <span class="muted" aria-hidden="true">·</span>
            <button type="button" class="link" onclick={importConnections}>Import from a backup</button>
          </span>
        </div>
        <p class="help muted">{backupStatus || "Environments and connections only. Passwords and keys are never included."}</p>
      </div>
    </section>

    <section>
      <h3>Explorer</h3>
      <div class="row">
        <label class="label" for="s-badges">Engine badges</label>
        <div class="control">
          <label class="check"><input id="s-badges" type="checkbox" bind:checked={showKindBadge} /> Show S, C, Sy badges on connections</label>
        </div>
      </div>
      <div class="row">
        <label class="label" for="s-font">Row font</label>
        <div class="control">
          <select id="s-font" bind:value={rowFont}>
            <option value="mono">Monospace</option>
            <option value="ui">UI font</option>
          </select>
        </div>
      </div>
    </section>

    <section>
      <h3>Editor</h3>
      <div class="row">
        <label class="label" for="s-intellisense">IntelliSense</label>
        <div class="control">
          <label class="check"
            ><input id="s-intellisense" type="checkbox" bind:checked={editor.intellisense} /> Complete names and show details on hover</label
          >
        </div>
      </div>
      <div class="row">
        <label class="label" for="s-ddl">Refresh after DDL</label>
        <div class="control">
          <label class="check"
            ><input id="s-ddl" type="checkbox" bind:checked={editor.autoRefreshOnDdl} disabled={!editor.intellisense} /> Refresh IntelliSense after CREATE,
            ALTER or DROP</label
          >
        </div>
      </div>
      <div class="row">
        <label class="label" for="s-unknown">Unknown names</label>
        <div class="control">
          <label class="check"
            ><input id="s-unknown" type="checkbox" bind:checked={editor.warnUnknownNames} disabled={!editor.intellisense} /> Warn before running</label
          >
        </div>
      </div>
      <div class="row">
        <label class="label" for="s-case">Keyword case</label>
        <div class="control">
          <select id="s-case" bind:value={editor.keywordCase} disabled={!editor.intellisense}>
            <option value="default">Default (lower for SQL, upper for Cosmos)</option>
            <option value="lower">lower</option>
            <option value="upper">UPPER</option>
            <option value="preserve">As listed</option>
          </select>
        </div>
      </div>
    </section>

    <section>
      <h3>Results</h3>
      <div class="row">
        <label class="label" for="s-max-rows">Row limit</label>
        <div class="control">
          <input id="s-max-rows" type="number" min="1000" max="1000000" step="1000" bind:value={editor.maxRows} />
        </div>
        <p class="help muted">Rows kept per result set; the script still runs to the end. A single SELECT past this can be saved in full with Save all rows.</p>
      </div>
      <div class="row">
        <label class="label" for="s-sample">Cosmos sample size</label>
        <div class="control">
          <input id="s-sample" type="number" min="10" max="500" step="10" bind:value={editor.catalogSampleDocs} disabled={!editor.intellisense} />
        </div>
        <p class="help muted">Documents read from each container to learn its property paths.</p>
      </div>
    </section>
  </div>

  {#if error}<p class="full error">{error}</p>{/if}

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={saving} onclick={save}>Save</button>
  {/snippet}
</Dialog>

<style>
  /* One grid for every row (#360): a fixed label column, then the control. Helper text sits under its control. */
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  section + section {
    padding-top: var(--space-6);
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .row {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-6);
    row-gap: var(--space-1);
  }
  .label {
    color: var(--text-muted);
  }
  .control {
    min-width: 0;
  }
  .control select,
  .control input:not([type="checkbox"]) {
    width: 240px;
    text-overflow: ellipsis;
  }
  .help {
    grid-column: 2;
    margin: 0;
    font-size: var(--fs-sm);
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
  }
  .status {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ok {
    width: 12px;
    height: 12px;
    margin-right: var(--space-2);
    vertical-align: -1px;
    fill: none;
    stroke: var(--ok);
    stroke-width: 2;
  }
  .links {
    display: inline-flex;
    flex: none;
    align-items: baseline;
    gap: var(--space-3);
    white-space: nowrap;
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  .check {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    color: var(--text) !important;
  }
  .check input {
    margin: 0;
  }
</style>
