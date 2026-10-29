<script lang="ts">
  import type { UpdateCheckMode } from "../update-schedule";
  import type { UpdateState } from "../updates";
  import type { AppSettings, EnvironmentConfig } from "./api";
  import Dialog from "./Dialog.svelte";

  let {
    settings,
    update,
    environments,
    onSave,
    onCheckNow,
    hasChangelog,
    onWhatsNew,
    onClose,
  }: {
    settings: AppSettings;
    update: UpdateState | undefined;
    environments: EnvironmentConfig[];
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
  /** Environment ids in display order: the saved manual order first, then any not in it, in order added. */
  // svelte-ignore state_referenced_locally
  let envOrder = $state(orderedIds(settings.explorer.envOrder));
  let saving = $state(false);

  function orderedIds(saved: string[]): string[] {
    const known = environments.map((e) => e.id);
    return [...saved.filter((id) => known.includes(id)), ...known.filter((id) => !saved.includes(id))];
  }

  function moveEnv(index: number, by: -1 | 1) {
    const next = [...envOrder];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    envOrder = next;
  }

  const envName = (id: string) => environments.find((e) => e.id === id)?.name ?? id;
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
      await onSave({ ...settings, updateCheck, explorer: { showKindBadge, rowFont, envOrder } });
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

  {#if envOrder.length > 1}
    <span class="muted top">Environment order</span>
    <ol class="env-order">
      {#each envOrder as id, i (id)}
        <li>
          <span class="env-name">{envName(id)}</span>
          <button type="button" aria-label="Move {envName(id)} up" disabled={i === 0} onclick={() => moveEnv(i, -1)}>Up</button>
          <button type="button" aria-label="Move {envName(id)} down" disabled={i === envOrder.length - 1} onclick={() => moveEnv(i, 1)}>Down</button>
        </li>
      {/each}
    </ol>
  {/if}

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
  .top {
    align-self: start;
    padding-top: 4px;
  }
  .env-order {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 180px;
    overflow: auto;
  }
  .env-order li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }
  .env-name {
    flex: 1;
  }
  .env-order button {
    padding: 0 8px;
    font-size: 11px;
  }
</style>
