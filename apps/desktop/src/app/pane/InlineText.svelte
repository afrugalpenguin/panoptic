<script lang="ts">
  // A text property edited in place (docs/environment-pane.md, "Properties card"): plain text until hovered or focused.
  // Blur and Enter save, Escape reverts, empty is refused with the previous value restored and the field flashing once.
  import { onDestroy, tick } from "svelte";

  let {
    id,
    value,
    mono = false,
    onCommit,
  }: {
    id: string;
    /** The saved value; the field follows it while not being edited. */
    value: string;
    /** Host names and other identifiers in the mono stack; names in the UI font, 600. */
    mono?: boolean;
    /** Saves the trimmed, changed, non-empty text; resolves false when the write failed, which puts the value back. */
    onCommit: (next: string) => Promise<boolean>;
  } = $props();

  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let focused = false;
  let bad = $state(false);
  let badTimer: ReturnType<typeof setTimeout> | undefined;
  $effect.pre(() => {
    const v = value;
    if (!focused) draft = v;
  });

  /** F2: focus the field with its text selected. */
  export function focusSelect() {
    input?.focus();
    input?.select();
  }

  function flashBad() {
    bad = false;
    clearTimeout(badTimer);
    // A tick between, so a second refusal flashes again.
    void tick().then(() => {
      bad = true;
      badTimer = setTimeout(() => (bad = false), 600);
    });
  }

  async function commit() {
    focused = false;
    const next = draft.trim();
    if (next === value) {
      draft = value;
      return;
    }
    if (!next) {
      draft = value;
      flashBad();
      return;
    }
    if (!(await onCommit(next))) draft = value;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      input?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      draft = value;
      input?.blur();
    }
  }

  onDestroy(() => clearTimeout(badTimer));
</script>

<input
  {id}
  class="inline-text"
  class:mono
  class:bad
  title={mono ? value : undefined}
  bind:this={input}
  bind:value={draft}
  spellcheck="false"
  autocomplete="off"
  onfocus={() => (focused = true)}
  onblur={commit}
  {onkeydown}
/>

<style>
  .inline-text {
    width: 100%;
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    text-align: right;
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .inline-text.mono {
    font-family: var(--font-mono);
    font-weight: 500;
  }
  .inline-text:hover,
  .inline-text:focus {
    border-color: var(--border);
    background: var(--bg);
  }
  .bad {
    animation: flash-bad 600ms ease-out;
    border-color: var(--bad);
  }
  @keyframes flash-bad {
    0% {
      background: color-mix(in srgb, var(--bad) 35%, transparent);
    }
    100% {
      background: transparent;
    }
  }
</style>
