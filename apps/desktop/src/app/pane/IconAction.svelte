<script lang="ts">
  // A detail pane's icon header action (Refresh, Copy name) with its key chip beside it.
  import type { GlyphName } from "../glyphs";
  import Kbd from "../Kbd.svelte";
  import Glyph from "./Glyph.svelte";

  let { glyph, label, keys, onclick }: { glyph: GlyphName; label: string; keys: string; onclick: () => void } = $props();
</script>

<button type="button" class="ghost icon-action" aria-label={label} title="{label} ({keys})" {onclick}><Glyph name={glyph} /></button>
<Kbd {keys} />

<style>
  .icon-action {
    --glyph-size: 16px;
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 6px;
    color: var(--text-muted);
  }
  .icon-action:hover {
    color: var(--text);
  }
</style>
