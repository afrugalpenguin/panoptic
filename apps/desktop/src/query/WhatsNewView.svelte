<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import logo from "../../src-tauri/icons/128x128@2x.png";
  import { bullets, category, inlineTokens, openLink, shortDate, subtitle } from "../whats-new";
  import type { WhatsNewTab } from "./store.svelte";

  let { tab, onLinkError }: { tab: WhatsNewTab; onLinkError: (message: string) => void } = $props();

  const RELEASES = "https://github.com/afrugalpenguin/panoptic/releases";
  const open = (href: string) => void openLink(href, openUrl, onLinkError);
</script>

{#snippet inline(text: string)}
  {#each inlineTokens(text) as t}
    {#if t.type === "bold"}<strong>{t.text}</strong>
    {:else if t.type === "code"}<code>{t.text}</code>
    {:else if t.type === "link"}<a href={t.href} onclick={(e) => (e.preventDefault(), open(t.href))}>{t.text}</a>
    {:else}{t.text}{/if}
  {/each}
{/snippet}

{#snippet lines(text: string)}
  {#each text.split("\n") as line, i}{#if i > 0}<br />{/if}{@render inline(line)}{/each}
{/snippet}

<article class="whats-new">
  <header>
    <img src={logo} alt="" />
    <div class="heading">
      <h1>Panoptic {#if tab.sections.length}<span class="version">{tab.sections[0].version}</span>{/if}</h1>
      <p class="muted">{subtitle(tab.sections, tab.opened, new Date())}</p>
    </div>
    <button onclick={() => open(RELEASES)}>Releases on GitHub</button>
  </header>
  <div class="timeline">
    {#each tab.sections as section, i (section.version)}
      {@const items = bullets(section.body)}
      <section class:current={i === 0}>
        <div class="gutter">
          <div class="number">{section.version}</div>
          {#if section.date}<div class="date">{shortDate(section.date)}</div>{/if}
          {#if i === 0}<span class="pill">current</span>{/if}
        </div>
        <div class="notes">
          {#each items as item}
            {@const note = category(item)}
            <div class="note">
              <span class="tag {note.category?.toLowerCase()}">{note.category ?? ""}</span>
              <span>{@render lines(note.text)}</span>
            </div>
          {:else}
            <p>{@render inline(section.body)}</p>
          {/each}
        </div>
      </section>
      {#if i === 0 && tab.sections.length > 1}<hr />{/if}
    {:else}
      <p class="muted">No release notes in this build.</p>
    {/each}
  </div>
</article>

<style>
  .whats-new {
    height: 100%;
    overflow: auto;
    font: 13px var(--font-ui);
    user-select: text;
  }
  header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 30px 40px 26px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-pane);
    /* The two-stripe edge: cyan, then amber, the logo's colours. */
    box-shadow:
      inset 4px 0 0 var(--brand-cyan),
      inset 8px 0 0 var(--brand-amber);
  }
  header img {
    width: 64px;
    height: 64px;
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.25;
  }
  .version {
    color: var(--brand-amber);
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
  }
  .timeline {
    padding: 8px 40px 24px;
  }
  section {
    display: flex;
    /* Earlier releases read a step lighter than the current one, but not as faint as muted text. */
    color: color-mix(in srgb, var(--text) 80%, var(--bg-pane));
  }
  section.current {
    color: var(--text);
  }
  .gutter {
    flex: none;
    width: 120px;
    padding: 14px 16px 14px 0;
    border-right: 2px solid var(--border);
    text-align: right;
  }
  .current .gutter {
    border-right-color: var(--accent);
  }
  .number {
    font-size: 14px;
    font-weight: 600;
  }
  .date {
    font-size: 11px;
    color: var(--text-muted);
  }
  .pill {
    display: inline-block;
    margin-top: 4px;
    padding: 0 7px;
    border-radius: 8px;
    background: var(--bg-selected);
    color: var(--text);
    font-size: 11px;
  }
  .notes {
    flex: 1;
    min-width: 0;
    padding: 14px 0 14px 22px;
    line-height: 1.6;
  }
  .note {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .note + .note {
    margin-top: 10px;
  }
  .tag {
    flex: none;
    width: 64px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    color: var(--c);
    /* No --c (a note without a category) leaves the tag blank and transparent. */
    background: color-mix(in srgb, var(--c) 15%, var(--bg-pane));
  }
  .added {
    --c: var(--ok);
  }
  .changed {
    --c: var(--brand-amber);
  }
  .fixed {
    --c: var(--brand-cyan);
  }
  .removed {
    --c: var(--bad);
  }
  hr {
    margin: 14px 0;
    border: none;
    border-top: 1px solid var(--border);
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
