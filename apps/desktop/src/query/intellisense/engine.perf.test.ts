import { expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { complete, hover, Index } from "./engine";
import { unknownNames } from "./lint";
import { contextAt } from "./scanner";

// docs/query-editor.md budgets: index in under 100 ms and complete in under 16 ms for 5,000 objects and 100,000
// columns. Asserted at those numbers locally and at twice them on CI, whose runners are noisy; the measured
// numbers are logged.
const slack = import.meta.env.CI ? 2 : 1;
const INDEX_MS = 100 * slack;
const COMPLETE_MS = 16 * slack;

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

function p95(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length * 0.95)];
}

it("meets the indexing and completion budgets on a 5,000 object, 100,000 column catalog", () => {
  const start = performance.now();
  const index = new Index(catalog);
  const indexMs = performance.now() - start;

  const text = "select | from schema1.Table1 a join schema2.Table2 b on a.Column1 = b.Column1 join schema3.Table3 c on c.Column2 = b.Column2 where a.Column3 > 0";
  const offset = text.indexOf("|");
  const source = text.replace("|", "");
  const columns = p95(() => complete(() => index, contextAt(source, offset, "tsql").context, { language: "tsql" }));

  const objects = complete(() => index, contextAt("select * from ", 14, "tsql").context, { language: "tsql" });
  console.log(`IntelliSense perf: index ${indexMs.toFixed(1)} ms, columns p95 ${columns.toFixed(2)} ms, ${objects.items.length} objects listed`);
  expect(indexMs).toBeLessThan(INDEX_MS);
  expect(columns).toBeLessThan(COMPLETE_MS);
});

it("meets the completion budget in a 5,000 line script", () => {
  const index = new Index(catalog);
  const block = (i: number) =>
    [
      `-- block ${i}: 'not a string; GO`,
      `declare @v${i} int = ${i};`,
      `select a.Column1, b.Column2, 'x;y' as s`,
      `from schema${i % 20}.Table${i} a`,
      `join schema${(i + 1) % 20}.Table${i + 1} b on a.Column1 = b.Column1`,
      `where a.Column3 > @v${i}`,
      `order by 1;`,
      ``,
      `GO`,
      ``,
    ].join("\n");
  const blocks = Array.from({ length: 500 }, (_, i) => block(i));
  const middle = "select a.| from schema1.Table1 a join schema2.Table2 b on a.Column1 = b.Column1";
  blocks.splice(250, 0, middle);
  const text = blocks.join("\n");
  expect(text.split("\n").length).toBeGreaterThanOrEqual(5000);
  const offset = text.indexOf("|");
  const source = text.replace("|", "");
  const end = source.length;

  const options = { language: "tsql" as const };
  const middleMs = p95(() => complete(() => index, contextAt(source, offset, "tsql").context, options));
  const endMs = p95(() => complete(() => index, contextAt(source, end, "tsql").context, options));
  const hoverAt = source.indexOf("Column1", offset);
  const hoverMs = p95(() => hover(() => index, source, hoverAt, options));
  const lintMs = p95(() => unknownNames(() => index, source, offset));

  expect(complete(() => index, contextAt(source, offset, "tsql").context, options).items).toHaveLength(20);
  expect(hover(() => index, source, hoverAt, options)).toContain("Column1");
  expect(unknownNames(() => index, source, offset)).toEqual([]);
  console.log(`IntelliSense perf, 5,000 line script: middle p95 ${middleMs.toFixed(2)} ms, end p95 ${endMs.toFixed(2)} ms, hover p95 ${hoverMs.toFixed(2)} ms, unknown names p95 ${lintMs.toFixed(2)} ms`);
  expect(middleMs).toBeLessThan(COMPLETE_MS);
  expect(endMs).toBeLessThan(COMPLETE_MS);
  expect(hoverMs).toBeLessThan(COMPLETE_MS);
  expect(lintMs).toBeLessThan(COMPLETE_MS);
});
