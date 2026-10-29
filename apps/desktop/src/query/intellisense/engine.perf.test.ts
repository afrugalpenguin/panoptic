import { expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { complete, Index } from "./engine";
import { contextAt } from "./scanner";

// docs/query-editor.md budgets: index in under 100 ms and complete in under 16 ms for 5,000 objects and 100,000
// columns. Asserted at twice that because CI runners are noisy; the measured numbers are logged.
it("meets the indexing and completion budgets on a 5,000 object, 100,000 column catalog", () => {
  const catalog: DatabaseCatalog = {
    stamp: "perf",
    schemas: Array.from({ length: 20 }, (_, s) => `schema${s}`),
    types: ["int", "nvarchar"],
    objects: Array.from({ length: 5000 }, (_, o) => ({
      name: `Table${o}`,
      schema: `schema${o % 20}`,
      kind: "table" as const,
      columns: Array.from({ length: 20 }, (_, c) => ({ name: `Column${c}`, type: "int", nullable: c % 2 === 0 })),
    })),
  };

  let start = performance.now();
  const index = new Index(catalog);
  const indexMs = performance.now() - start;

  const text = "select | from schema1.Table1 a join schema2.Table2 b on a.Column1 = b.Column1 join schema3.Table3 c on c.Column2 = b.Column2 where a.Column3 > 0";
  const offset = text.indexOf("|");
  const source = text.replace("|", "");
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    start = performance.now();
    const ctx = contextAt(source, offset, "tsql");
    complete(() => index, ctx.context, { language: "tsql" });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];

  const objects = complete(() => index, contextAt("select * from ", 14, "tsql").context, { language: "tsql" });
  console.log(`IntelliSense perf: index ${indexMs.toFixed(1)} ms, columns p95 ${p95.toFixed(2)} ms, ${objects.items.length} objects listed`);
  expect(indexMs).toBeLessThan(200);
  expect(p95).toBeLessThan(32);
});
