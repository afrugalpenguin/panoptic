<script lang="ts">
  // The READ ONLY pill of a read-only environment: on its tree header and on its rows in Seek. Drawn in the
  // environment's colour, from --env where the row sets it, else from color.
  let { color }: { color?: string } = $props();
</script>

<span class="read-only" style:--env={color}>Read only</span>

<style>
  .read-only {
    flex: none;
    padding: 1px 5px;
    border: 1px solid var(--env);
    border-radius: 3px;
    color: var(--env);
    font: 700 10px/1.2 var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
