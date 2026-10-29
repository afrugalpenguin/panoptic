<script lang="ts" module>
  /** 16px stroke icons, drawn in currentColor. */
  const PATHS = {
    import: "M8 2.5v7 M5 6.5 8 9.5l3-3 M2.5 10.5v3h11v-3",
    environment: "M1.5 4.5h4l1.5 1.5h7.5v7.5h-13z M8 8v3.5 M6.25 9.75h3.5",
    connection: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2z M3 4v8c0 1.1 2.2 2 5 2 M13 4v4 M12 10v4 M10 12h4",
    settings:
      "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4",
  } as const;

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { icon, label, disabled = false, onclick }: { icon: IconName; label: string; disabled?: boolean; onclick: () => void } = $props();
</script>

<button class="icon-button" type="button" aria-label={label} title={label} {disabled} {onclick}>
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d={PATHS[icon]} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</button>

<style>
  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-muted);
  }
  .icon-button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  svg {
    width: 16px;
    height: 16px;
  }
</style>
