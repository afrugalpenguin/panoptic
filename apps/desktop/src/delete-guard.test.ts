// Deleting an environment or a connection always asks first (docs/explorer-ux.md, "Destructive actions"). Every way
// in (the tree's menu, the Delete key, the environment and connection panes) goes through App's deleteConfig, which
// asks before it writes anything. This pins that down in the source, so a new delete path cannot skip the question.
import { describe, expect, it } from "vitest";

// Every source file under src, as text. Tests are skipped: they hold these names in string fixtures.
const SOURCES = import.meta.glob<string>(["./**/*.ts", "./**/*.svelte", "!./**/*.test.ts", "!**/node_modules/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Calls of the sidecar's delete methods on the api, outside api.ts where they are defined. (ctx.deleteEnvironment in
 * the row menu is App's deleteEnvironment, which asks.) */
const DELETE_CALL = /\bapi!?\??\.(deleteConnection|deleteEnvironment)\s*\(/g;

describe("deleting an environment or connection", () => {
  const app = SOURCES["./app/App.svelte"];

  it("is only ever done by deleteConfig, in App", () => {
    const calls = Object.entries(SOURCES)
      .filter(([file]) => file !== "./app/api.ts")
      .flatMap(([file, text]) => [...text.matchAll(DELETE_CALL)].map((m) => ({ file, at: m.index!, call: m[0] })));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const { file, at, call } of calls) {
      expect(file, `${call} outside App.svelte`).toBe("./app/App.svelte");
      // The delete is the last argument of a deleteConfig call: the nearest call before it is deleteConfig's.
      const before = app.slice(0, at);
      const opened = before.lastIndexOf("deleteConfig(");
      expect(opened, `${call} at ${at} is not inside deleteConfig(...)`).toBeGreaterThan(-1);
      expect(before.slice(opened), `${call} at ${at} is not the remove argument of deleteConfig`).toMatch(/^deleteConfig\([^;]*\(\) => $/);
    }
  });

  it("asks before anything is written, and stops when the answer is no", () => {
    const body = /async function deleteConfig\([\s\S]*?\)\s*\{([\s\S]*?)\n  \}/.exec(app)?.[1] ?? "";
    expect(body.trim().split("\n")[0].trim()).toBe("if (!(await ask(text))) return;");
  });

  it("drops secrets only through Undo's purge, once the delete can no longer be undone", () => {
    const purges = Object.entries(SOURCES)
      .filter(([file]) => file !== "./app/api.ts")
      .flatMap(([file, text]) => [...text.matchAll(/\bapi!?\??\.purgeSecrets\s*\(/g)].map((m) => ({ file, line: text.slice(text.lastIndexOf("\n", m.index!) + 1, text.indexOf("\n", m.index!)) })));
    expect(purges).toHaveLength(1);
    expect(purges[0].file).toBe("./app/App.svelte");
    expect(purges[0].line.trim()).toMatch(/^purge: /);
  });
});
