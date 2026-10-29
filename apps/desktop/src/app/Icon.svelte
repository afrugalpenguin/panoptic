<script lang="ts">
  // Compact glyph badges per node kind. Real icons can replace this map without touching the tree.
  const GLYPHS: Record<string, [string, string]> = {
    sql: ["S", "#1971c2"],
    cosmos: ["C", "#7048e8"],
    database: ["D", "#2f9e44"],
    folder: ["", "#868e96"],
    table: ["T", "#0c8599"],
    view: ["V", "#6741d9"],
    proc: ["P", "#e8590c"],
    function: ["f", "#d6336c"],
    synonym: ["=", "#868e96"],
    column: ["c", "#868e96"],
    key: ["K", "#f59f00"],
    index: ["I", "#868e96"],
    definition: ["{}", "#868e96"],
    container: ["C", "#0c8599"],
    document: ["d", "#868e96"],
    sproc: ["P", "#e8590c"],
    trigger: ["t", "#d6336c"],
    udf: ["f", "#d6336c"],
    policy: ["{}", "#7048e8"],
    property: ["i", "#868e96"],
  };

  let { icon }: { icon: string } = $props();
  const glyph = $derived(GLYPHS[icon] ?? ["?", "#868e96"]);
</script>

{#if icon === "folder"}
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill="none" stroke={glyph[1]} stroke-width="1.2" />
  </svg>
{:else}
  <span class="icon badge" style:--c={glyph[1]} aria-hidden="true">{glyph[0]}</span>
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
