<script lang="ts">
  import { onMount } from "svelte";
  import type * as Monaco from "monaco-editor/editor/editor.api";
  import { models, quickFixes, type ModelInfo, type QuickFix } from "./intellisense/providers";
  import type { QueryMessage } from "./store.svelte";
  import type { QueryLanguage } from "./types";

  let {
    text = $bindable(),
    language,
    intellisense,
    onRun,
    messages = [],
    reveal,
    warnUnknownNames = false,
  }: {
    text: string;
    language: QueryLanguage;
    /** What completions and hover read; called on every request, so it always sees current settings. */
    intellisense?: () => ModelInfo | undefined;
    /** Called with the selected text and where it starts, or undefined to run everything. */
    onRun: (selection?: string, offset?: number) => void;
    /** The tab's Messages: errors with a place are marked in the editor (docs/query-editor.md, "Error location"). */
    messages?: QueryMessage[];
    /** A message to move the cursor to; seq changes on every click. */
    reveal?: { id: number; seq: number };
    /** Only read to re-check when the setting changes; the check itself reads intellisense(). */
    warnUnknownNames?: boolean;
  } = $props();

  const MONACO_LANGUAGE: Record<QueryLanguage, string> = { sql: "tsql", cosmos: "cosmos-sql", pgsql: "pgsql" };
  /** Like the editor's own diagnostics would be: after typing pauses, never per keystroke (docs/query-editor.md). */
  const LINT_DELAY_MS = 500;

  let host: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monaco: typeof Monaco | undefined;
  let lintNow: (() => void) | undefined;
  let loading = $state(true);
  /** Run error marks: message id to the decoration that tracks its range through edits. */
  let marks = new Map<number, string>();
  /** Fixes from the last lint (T-SQL habits), valid only while the text is the version they were computed for. */
  let lintFixes: { version: number; fixes: QuickFix[] } | undefined;

  onMount(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");

    import("./monaco").then((m) => {
      if (disposed) return;
      monaco = m.monaco;
      editor = monaco.editor.create(host, {
        value: text,
        language: MONACO_LANGUAGE[language],
        theme: dark.matches ? "vs-dark" : "vs",
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "Cascadia Mono, Consolas, monospace",
        fontSize: 13,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        tabSize: 4,
        wordWrap: "off",
        // Run errors get an icon in the gutter.
        glyphMargin: true,
        // Explorer rows drop their name as plain text; there is nothing else to offer, so no "drop as" picker.
        dropIntoEditor: { enabled: true, showDropSelector: "never" },
      });
      const model = editor.getModel();
      if (model && intellisense) models.set(model, intellisense);
      if (model) quickFixes.set(model, fixes);

      // Unknown-name warnings for the statement at the cursor, from the worker's catalogs; never the sidecar.
      const client = m.intellisense;
      lintNow = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (!editor || !model || model.isDisposed()) return;
          const info = intellisense?.();
          // Postgres tabs always get the T-SQL habit warnings; the setting covers the unknown-name check.
          const habits = info?.options.language === "pgsql";
          if (!info?.enabled || (!info.warnUnknownNames && !habits)) {
            lintFixes = undefined;
            return monaco!.editor.setModelMarkers(model, "panoptic-lint", []);
          }
          for (const c of info.catalogs) client.sync(c.key, c.catalog, c.version);
          const version = model.getVersionId();
          const position = editor.getPosition();
          if (!position) return;
          const { warnings } = await client.lint(model.getValue(), model.getOffsetAt(position), info.keys, info.options.language, info.warnUnknownNames);
          if (model.isDisposed() || model.getVersionId() !== version) return;
          lintFixes = {
            version,
            fixes: warnings.flatMap((w) =>
              w.fix ? [{ range: range(model, w.start, w.end), label: w.fix.label, edits: w.fix.edits.map((e) => ({ range: range(model, e.start, e.end), text: e.text })) }] : [],
            ),
          };
          monaco!.editor.setModelMarkers(model, "panoptic-lint", warnings.map((w) => ({ ...range(model, w.start, w.end), severity: monaco!.MarkerSeverity.Warning, message: w.message })));
        }, LINT_DELAY_MS);
      };
      editor.onDidChangeModelContent(() => {
        text = editor!.getValue();
        pruneMarks();
        lintNow?.();
      });
      editor.onDidChangeCursorPosition(() => lintNow?.());

      const run = () => {
        const selection = editor!.getSelection();
        if (!selection || selection.isEmpty()) return onRun();
        const model = editor!.getModel()!;
        onRun(model.getValueInRange(selection), model.getOffsetAt(selection.getStartPosition()));
      };
      // F5 and Ctrl+Enter, as in SSMS and Azure Data Studio.
      editor.addCommand(monaco.KeyCode.F5, run);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
      editor.focus();
      loading = false;
      lintNow();
    });

    const themeChanged = () => monaco?.editor.setTheme(dark.matches ? "vs-dark" : "vs");
    dark.addEventListener("change", themeChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      dark.removeEventListener("change", themeChanged);
      editor?.dispose();
    };
  });

  function range(model: Monaco.editor.ITextModel, start: number, end: number): Monaco.IRange {
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(end);
    return { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
  }

  /** The error messages that have a place in the editor. */
  const placed = $derived(messages.filter((m) => m.kind === "error" && m.at));

  /** Fixes for the current marks, at the ranges their decorations have moved to, and the last lint's if still current. */
  function fixes(): QuickFix[] {
    const model = editor?.getModel();
    if (!model) return [];
    const errors = placed.flatMap((m) => {
      const range = m.fix && marks.has(m.id) ? model.getDecorationRange(marks.get(m.id)!) : null;
      return range && m.fix ? [{ range, label: m.fix.label, edits: [{ range, text: m.fix.insertText }] }] : [];
    });
    return lintFixes?.version === model.getVersionId() ? [...errors, ...lintFixes.fixes] : errors;
  }

  /**
   * Marks each placed error: a squiggle and a gutter icon on the name, or on the reported line when the name was not
   * found. A mark keeps its decoration across updates (a suggestion arriving), so it stays on the name as the user
   * edits. A mark whose text is replaced (its quick fix) or deleted goes; a new run clears them all.
   */
  $effect(() => {
    const errors = placed.map((m) => ({ id: m.id, at: m.at!, located: m.located, text: m.text }));
    if (loading) return;
    if (errors.length === 0) cleared.clear();
    drawMarks(errors);
  });

  /** Messages whose mark collapsed to nothing under an edit: not drawn again until the next run. */
  const cleared = new Set<number>();

  /** After an edit: drops the marks whose text is gone. */
  function pruneMarks(): void {
    const model = editor?.getModel();
    if (!model) return;
    const gone = [...marks].filter(([, decoration]) => model.getDecorationRange(decoration)?.isEmpty() ?? true);
    if (gone.length === 0) return;
    for (const [id] of gone) cleared.add(id);
    drawMarks(placed.map((m) => ({ id: m.id, at: m.at!, located: m.located, text: m.text })));
  }

  function drawMarks(all: { id: number; at: { start: number; end: number }; located?: boolean; text: string }[]): void {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const errors = all.filter((e) => !cleared.has(e.id));
    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
    const markers: Monaco.editor.IMarkerData[] = [];
    for (const e of errors) {
      const tracked = marks.has(e.id) ? model.getDecorationRange(marks.get(e.id)!) : null;
      let r = tracked ?? range(model, e.at.start, e.at.end);
      if (!tracked && !e.located) r = { ...r, endColumn: model.getLineMaxColumn(r.startLineNumber) };
      decorations.push({ range: r, options: { glyphMarginClassName: "panoptic-error-glyph", glyphMarginHoverMessage: { value: e.text }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } });
      markers.push({ ...r, severity: monaco.MarkerSeverity.Error, message: e.text });
    }
    const ids = model.deltaDecorations([...marks.values()], decorations);
    marks = new Map(errors.map((e, i) => [e.id, ids[i]]));
    monaco.editor.setModelMarkers(model, "panoptic-run", markers);
  }

  /** A clicked Messages row: select the name, or put the cursor at the start of its line. */
  $effect(() => {
    if (!reveal || loading || !editor) return;
    const model = editor.getModel();
    const id = marks.get(reveal.id);
    const r = id && model ? model.getDecorationRange(id) : null;
    if (!r) return;
    const message = placed.find((m) => m.id === reveal.id);
    if (message?.located) editor.setSelection(r);
    else editor.setPosition({ lineNumber: r.startLineNumber, column: r.startColumn });
    editor.revealRangeInCenterIfOutsideViewport(r);
    editor.focus();
  });

  /** The setting changed: check again now, or clear the warnings. */
  $effect(() => {
    void warnUnknownNames;
    lintNow?.();
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
  /* Monaco renders the gutter outside this component's scope. */
  .editor :global(.panoptic-error-glyph)::before {
    content: "";
    display: block;
    width: 8px;
    height: 8px;
    margin: 6px auto 0;
    border-radius: 50%;
    background: var(--bad);
  }
</style>
