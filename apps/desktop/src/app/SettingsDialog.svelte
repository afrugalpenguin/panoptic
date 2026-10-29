<script lang="ts">
  import type { UpdateCheckMode } from "../update-schedule";
  import type { UpdateState } from "../updates";
  import type { AppSettings } from "./api";
  import Dialog from "./Dialog.svelte";

  let {
    settings,
    update,
    onSave,
    onCheckNow,
    onClose,
  }: {
    settings: AppSettings;
    update: UpdateState | undefined;
    onSave: (settings: AppSettings) => Promise<void>;
    onCheckNow: () => void;
    onClose: () => void;
  } = $props();

  const MODES: { value: UpdateCheckMode; label: string; help: string }[] = [
    { value: "startup", label: "On startup", help: "Checks GitHub Releases once each time Panoptic starts." },
    { value: "hourly", label: "Hourly", help: "Checks at startup and then every hour while Panoptic is open." },
    { value: "never", label: "Never", help: "Panoptic never contacts GitHub on its own. Use Check now when you want to." },
  ];

  // svelte-ignore state_referenced_locally
  let updateCheck = $state<UpdateCheckMode>(settings.updateCheck);
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
      default:
        return update ? `v${update.current}, not checked yet this session` : "";
    }
  });

  async function save() {
    saving = true;
    error = "";
    try {
      await onSave({ ...settings, updateCheck });
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
    <span class="muted">{status}</span>
  </div>

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
</style>
