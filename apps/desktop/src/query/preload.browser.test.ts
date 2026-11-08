// The idle warm-up ahead of the first query tab (#190). Runs in headless Chromium (vitest browser project): it needs
// the real Monaco editor.
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import { monaco } from "./monaco";
import { createOptions, warmEditorWhenIdle } from "./preload";

afterEach(() => vi.restoreAllMocks());

describe("warmEditorWhenIdle", () => {
  it("creates one editor with the tabs' options and leaves nothing behind", async () => {
    const create = vi.spyOn(monaco.editor, "create");
    warmEditorWhenIdle();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    // The same font options, so the measurement Monaco caches is the one the tabs' editors look up.
    expect(create.mock.calls[0][1]).toMatchObject(createOptions());
    expect(monaco.editor.getEditors()).toHaveLength(0);
    expect(document.querySelector(".monaco-editor")).toBeNull();
  });
});
