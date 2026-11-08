<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import logo from "../../src-tauri/icons/icon.svg";
  import { onMount } from "svelte";
  import { bullets, category, inlineTokens, openLink, sentenceCase, shortDate, subtitle } from "../whats-new";
  import type { WhatsNewTab } from "./store.svelte";

  let { tab, onLinkError }: { tab: WhatsNewTab; onLinkError: (message: string) => void } = $props();

  const RELEASES = "https://github.com/afrugalpenguin/panoptic/releases";
  const open = (href: string) => void openLink(href, openUrl, onLinkError);

  // Focus starts on the heading, so a screen reader announces the tab and keys scroll it (#230).
  let heading = $state<HTMLHeadingElement>();
  onMount(() => heading?.focus());

  // The section marked current is the running version's, not the newest: a dev build or an outdated install runs
  // an older one (#246). None is marked when no section matches, or outside the shell.
  let running = $state<string>();
  onMount(() => void getVersion().then((v) => (running = v), () => {}));
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
      <h1 bind:this={heading} tabindex="-1">Panoptic {#if tab.sections.length}<span class="version">{tab.sections[0].version}</span>{/if}</h1>
      <p class="muted">{subtitle(tab.sections, tab.opened, new Date())}</p>
    </div>
    <button onclick={() => open(RELEASES)}>Releases on GitHub</button>
  </header>
  <div class="timeline">
    {#each tab.sections as section, i (section.version)}
      {@const items = bullets(section.body)}
      <section class:current={section.version === running}>
        <div class="gutter">
          <div class="number">{section.version}</div>
          {#if section.date}<div class="date">{shortDate(section.date)}</div>{/if}
          {#if section.version === running}<span class="pill">current</span>{/if}
        </div>
        <div class="notes">
          {#each items as item}
            {@const note = category(item)}
            <div class="note">
              <span class="tag {note.category?.toLowerCase()}">{note.category ?? ""}</span>
              <span>{@render lines(sentenceCase(note.text))}</span>
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
    font: var(--fs-md) var(--font-ui);
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
      inset 4px 0 0 var(--brand-primary),
      inset 8px 0 0 var(--brand-secondary);
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
    font-size: var(--fs-3xl);
    font-weight: 600;
    line-height: 1.25;
  }
  .version {
    color: var(--text-brand-secondary);
  }
  header p {
    margin: 4px 0 0;
    font-size: var(--fs-md);
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
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .date {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .pill {
    display: inline-block;
    margin-top: 4px;
    padding: 0 7px;
    border-radius: 8px;
    background: var(--bg-selected);
    color: var(--text);
    font-size: var(--fs-xs);
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
    font-size: var(--fs-xs);
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
    --c: var(--text-brand-secondary);
  }
  .fixed {
    --c: var(--text-brand-primary);
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
