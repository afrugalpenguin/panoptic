<script lang="ts">
  import { kindDescription } from "./kinds";
  import KindBadge from "./rows/KindBadge.svelte";

  // Compact glyph badges per node kind. Real icons can replace this map without touching the tree. Connection
  // kinds are not here: they draw with the sidecar's badge (kinds.ts), as the tree's connection rows do (#208).
  // Colours are the --glyph-* tokens in app.css.
  const GLYPHS: Record<string, [string, string]> = {
    database: ["D", "database"],
    folder: ["", "neutral"],
    table: ["T", "table"],
    view: ["V", "view"],
    matview: ["M", "view"],
    sequence: ["#", "neutral"],
    proc: ["P", "proc"],
    function: ["f", "function"],
    synonym: ["=", "neutral"],
    column: ["c", "neutral"],
    key: ["K", "key"],
    index: ["I", "neutral"],
    definition: ["{}", "neutral"],
    container: ["{ }", "table"],
    document: ["d", "neutral"],
    sproc: ["P", "proc"],
    trigger: ["t", "function"],
    udf: ["f", "function"],
    policy: ["{}", "policy"],
    property: ["i", "neutral"],
  };

  let { icon }: { icon: string } = $props();
  const engine = $derived(kindDescription(icon));
  const glyph = $derived(GLYPHS[icon] ?? ["?", "neutral"]);
  const color = $derived(`var(--glyph-${glyph[1]})`);
</script>

{#if engine}
  <KindBadge badge={engine.badge} />
{:else if icon === "folder"}
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill="none" style:stroke={color} stroke-width="1.2" />
  </svg>
{:else}
  <span class="icon badge" style:--c={color} aria-hidden="true">{glyph[0]}</span>
{/if}

<style>
  .icon {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .badge {
    display: inline-grid;
    place-items: center;
    border-radius: 3px;
    font: 600 10px/1 var(--font-ui);
    color: var(--c);
    background: color-mix(in srgb, var(--c) 16%, transparent);
  }
</style>
