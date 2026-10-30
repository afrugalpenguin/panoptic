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
    onClose: () => void;
  } = $props();

  const MODES: { value: UpdateCheckMode; label: string; help: string }[] = [
    { value: "startup", label: "On startup", help: "Checks GitHub Releases once each time Panoptic starts." },
    { value: "hourly", label: "Hourly", help: "Checks at startup and then every hour while Panoptic is open." },
    { value: "never", label: "Never", help: "Panoptic never contacts GitHub on its own. Use Check now when you want to." },
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

  const help = $derived(MODES.find((m) => m.value === updateCheck)!.help);
  const status = $derived.by(() => {
    switch (update?.kind) {
      case "checking":
        return "Checking...";
      case "upToDate":
        return `Up to date (v${update.current}), checked ${new Date(update.checkedAt).toLocaleTimeString()}`;
      case "available":
        return `v${update.next} is available on GitHub Releases`;
      case "downloading":
        return `Downloading v${update.next}...`;
      case "ready":
        return `v${update.next} is ready; restart from the status bar`;
      case "error":
        return `Check failed: ${update.message}`;
      case "installFailed":
        return `Update failed: ${update.message}`;
      default:
        return update ? `v${update.current}, not checked yet this session` : "";
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

<Dialog title="Settings" {onClose}>
  <label for="s-updates">Check for updates</label>
  <select id="s-updates" bind:value={updateCheck}>
    {#each MODES as m}<option value={m.value}>{m.label}</option>{/each}
  </select>

  <span></span>
  <p class="help muted">{help}</p>

  <span></span>
  <div class="check-now">
    <button type="button" disabled={update?.kind === "checking" || update?.kind === "downloading"} onclick={onCheckNow}>Check now</button>
    <button
      type="button"
      disabled={!hasChangelog}
      title={hasChangelog ? "Release notes for every version" : "This build has no release notes"}
      onclick={onWhatsNew}>What's new</button
    >
    <span class="muted">{status}</span>
  </div>

  <h3 class="full">Explorer</h3>

  <span></span>
  <label class="check"><input type="checkbox" bind:checked={showKindBadge} /> Show kind badges (S, C, Sy...) on connections</label>

  <label for="s-font">Row font</label>
  <select id="s-font" bind:value={rowFont}>
    <option value="mono">Monospace</option>
    <option value="ui">UI font</option>
  </select>


  <h3 class="full">Query editor</h3>

  <span></span>
  <label class="check"><input type="checkbox" bind:checked={editor.intellisense} /> IntelliSense: complete names and show details on hover</label>

  <label for="s-case">Keyword case</label>
  <select id="s-case" bind:value={editor.keywordCase} disabled={!editor.intellisense}>
    <option value="default">Default (lower for SQL, upper for Cosmos)</option>
    <option value="lower">lower</option>
    <option value="upper">UPPER</option>
    <option value="preserve">As listed</option>
  </select>

  <span></span>
  <label class="check"
    ><input type="checkbox" bind:checked={editor.autoRefreshOnDdl} disabled={!editor.intellisense} /> Refresh IntelliSense after running CREATE, ALTER or DROP</label
  >

  <label for="s-sample">Cosmos sample size</label>
  <input id="s-sample" type="number" min="10" max="500" step="10" bind:value={editor.catalogSampleDocs} disabled={!editor.intellisense} />

  <span></span>
  <p class="help muted">Documents read from each Cosmos container to learn its property paths.</p>

  {#if error}<p class="full error">{error}</p>{/if}

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={saving} onclick={save}>Save</button>
  {/snippet}
</Dialog>

<style>
  .help {
    margin: -4px 0 0;
    font-size: 12px;
  }
  .check-now {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  h3 {
    margin: 8px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text) !important;
  }
</style>
