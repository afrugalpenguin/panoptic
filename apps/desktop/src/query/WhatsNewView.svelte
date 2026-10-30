<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import logo from "../../src-tauri/icons/128x128.png";
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
  <header>
    <h1>
      <img src={logo} alt="" />What's new
      {#if tab.sections.length}<span class="muted">v{tab.sections[0].version}</span>{/if}
    </h1>
  </header>
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
    padding: 20px 10px 40px;
    font: 13px/1.7 var(--font-ui);
    user-select: text;
  }
  header {
    margin-bottom: 20px;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.3;
  }
  h1 img {
    height: 0.8em;
  }
  h1 .muted {
    font-size: 13px;
    font-weight: 400;
  }
  section + section {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  h2 {
    margin: 0 0 8px;
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
    margin-top: 8px;
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
