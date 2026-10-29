import { describe, expect, it } from "vitest";
import { bullets, compareVersions, inlineTokens, parseChangelog, sectionsSince } from "./whats-new";

const FIXTURE = `# Panoptic changelog

## v0.2.13 (2026-10-29)

- Added: What's new tab
- Fixed: Crash when **expanding** a \`master\` database
  that had no tables

## v0.2.10 (2026-10-28)

No user-facing changes.

## v0.2.9 (2026-10-27)

- Changed: See [the docs](https://example.com/docs)
`;

describe("parseChangelog", () => {
  it("splits on version headings, newest first, keeping each body", () => {
    const sections = parseChangelog(FIXTURE);
    expect(sections.map((s) => [s.version, s.date])).toEqual([
      ["0.2.13", "2026-10-29"],
      ["0.2.10", "2026-10-28"],
      ["0.2.9", "2026-10-27"],
    ]);
    expect(sections[1].body).toBe("No user-facing changes.");
  });

  it("returns nothing for an empty or heading-only file", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("# Panoptic changelog\n")).toEqual([]);
  });

  it("handles a single section, with or without a date, and CRLF line endings", () => {
    expect(parseChangelog("# Panoptic changelog\r\n\r\n## v1.0.0 (2027-03-31)\r\n\r\n- Added: v1\r\n")).toEqual([
      { version: "1.0.0", date: "2027-03-31", body: "- Added: v1" },
    ]);
    expect(parseChangelog("## v0.0.0\n\nNo release history available.")[0]).toEqual({
      version: "0.0.0",
      date: "",
      body: "No release history available.",
    });
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.2.9", "0.3.0")).toBeLessThan(0);
  });
});

describe("sectionsSince", () => {
  const sections = parseChangelog(FIXTURE);

  it("returns every section newer than the last seen version, newest first", () => {
    expect(sectionsSince(sections, "0.2.9").map((s) => s.version)).toEqual(["0.2.13", "0.2.10"]);
  });

  it("returns nothing on a first install (never seen) or when already up to date", () => {
    expect(sectionsSince(sections, null)).toEqual([]);
    expect(sectionsSince(sections, "0.2.13")).toEqual([]);
  });
});

describe("bullets", () => {
  it("joins continuation lines into their bullet", () => {
    expect(bullets(parseChangelog(FIXTURE)[0].body)).toEqual([
      "Added: What's new tab",
      "Fixed: Crash when **expanding** a `master` database\nthat had no tables",
    ]);
  });

  it("returns nothing for a body that is not a list", () => {
    expect(bullets("No user-facing changes.")).toEqual([]);
  });
});

describe("inlineTokens: the markdown subset", () => {
  it("reads bold, code and https links; everything else is text", () => {
    expect(inlineTokens("A **bold** and `code` and [docs](https://example.com) end")).toEqual([
      { type: "text", text: "A " },
      { type: "bold", text: "bold" },
      { type: "text", text: " and " },
      { type: "code", text: "code" },
      { type: "text", text: " and " },
      { type: "link", text: "docs", href: "https://example.com" },
      { type: "text", text: " end" },
    ]);
  });

  it("leaves non-https links, html and other markdown as plain text", () => {
    expect(inlineTokens("[x](javascript:alert(1)) <b>hi</b> _em_ # h")).toEqual([
      { type: "text", text: "[x](javascript:alert(1)) <b>hi</b> _em_ # h" },
    ]);
  });

  it("leaves unclosed markers as text", () => {
    expect(inlineTokens("2 ** 3 and `open")).toEqual([{ type: "text", text: "2 ** 3 and `open" }]);
  });
});
