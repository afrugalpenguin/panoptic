<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { bullets, inlineTokens, openLink } from "../whats-new";
  import type { WhatsNewTab } from "./store.svelte";

  let { tab, onLinkError }: { tab: WhatsNewTab; onLinkError: (message: string) => void } = $props();
</script>

{#snippet inline(text: string)}
  {#each inlineTokens(text) as t}
    {#if t.type === "bold"}<strong>{t.text}</strong>
    {:else if t.type === "code"}<code>{t.text}</code>
    {:else if t.type === "link"}<a href={t.href} onclick={(e) => (e.preventDefault(), void openLink(t.href, openUrl, onLinkError))}>{t.text}</a>
    {:else}{t.text}{/if}
  {/each}
{/snippet}

<article class="whats-new">
  {#each tab.sections as section (section.version)}
    {@const items = bullets(section.body)}
    <section>
      <h2>v{section.version} {#if section.date}<span class="date">{section.date}</span>{/if}</h2>
      {#if items.length}
        <ul>
          {#each items as item}
            <li>
              {#each item.split("\n") as line, i}{#if i > 0}<br />{/if}{@render inline(line)}{/each}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{@render inline(section.body)}</p>
      {/if}
    </section>
  {:else}
    <p class="muted">No release notes in this build.</p>
  {/each}
</article>

<style>
  .whats-new {
    height: 100%;
    overflow: auto;
    padding: 20px 28px 40px;
    font: 13px/1.6 var(--font-ui);
    user-select: text;
  }
  section {
    max-width: 72ch;
  }
  section + section {
    margin-top: 22px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .date {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-muted);
  }
  ul {
    margin: 0;
    padding-left: 20px;
  }
  li + li {
    margin-top: 3px;
  }
  code {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-hover);
  }
  a {
    color: var(--accent);
  }
  p {
    margin: 0;
  }
</style>
