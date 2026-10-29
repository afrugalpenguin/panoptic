<script lang="ts">
  import { onMount } from "svelte";
  import type * as Monaco from "monaco-editor/editor/editor.api";
  import type { QueryLanguage } from "./types";

  let {
    text = $bindable(),
    language,
    onRun,
  }: {
    text: string;
    language: QueryLanguage;
    /** Called with the selected text, or undefined to run everything. */
    onRun: (selection?: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let loading = $state(true);

  onMount(() => {
    let disposed = false;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let monaco: typeof Monaco | undefined;

    import("./monaco").then((m) => {
      if (disposed) return;
      monaco = m.monaco;
      editor = monaco.editor.create(host, {
        value: text,
        language,
        theme: dark.matches ? "vs-dark" : "vs",
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "Cascadia Mono, Consolas, monospace",
        fontSize: 13,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        tabSize: 4,
        wordWrap: "off",
      });
      editor.onDidChangeModelContent(() => (text = editor!.getValue()));
      const run = () => {
        const selection = editor!.getSelection();
        const selected = selection && !selection.isEmpty() ? editor!.getModel()!.getValueInRange(selection) : undefined;
        onRun(selected);
      };
      // F5 and Ctrl+Enter, as in SSMS and Azure Data Studio.
      editor.addCommand(monaco.KeyCode.F5, run);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
      editor.focus();
      loading = false;
    });

    const themeChanged = () => monaco?.editor.setTheme(dark.matches ? "vs-dark" : "vs");
    dark.addEventListener("change", themeChanged);
    return () => {
      disposed = true;
      dark.removeEventListener("change", themeChanged);
      editor?.dispose();
    };
  });

  /** Keeps the editor in step when the text is replaced from outside (e.g. a template). */
  $effect(() => {
    if (editor && text !== editor.getValue()) editor.setValue(text);
  });
</script>

<div class="editor" bind:this={host}>
  {#if loading}<p class="muted loading">Loading editor...</p>{/if}
</div>

<style>
  .editor {
    position: relative;
    height: 100%;
    min-height: 0;
  }
  .loading {
    position: absolute;
    inset: 8px auto auto 12px;
    margin: 0;
  }
</style>
