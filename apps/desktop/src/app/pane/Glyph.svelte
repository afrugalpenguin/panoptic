<script lang="ts">
  // A stroke glyph from glyphs.ts in currentColor, 14px unless the parent sizes it.
  import { GLYPHS, type GlyphName } from "../glyphs";

  let { name }: { name: GlyphName } = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true">
  <path d={GLYPHS[name]} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  svg {
    width: var(--glyph-size, 14px);
    height: var(--glyph-size, 14px);
    flex: none;
  }
</style>
