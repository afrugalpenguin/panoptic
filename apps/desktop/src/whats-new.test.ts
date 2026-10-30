import { describe, expect, it, vi } from "vitest";
import { bullets, category, compareVersions, inlineTokens, openLink, parseChangelog, sectionsSince, shortDate, subtitle } from "./whats-new";

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

describe("openLink", () => {
  it("opens the url and reports nothing on success", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    await openLink("https://example.com/docs", open, onError);
    expect(open).toHaveBeenCalledWith("https://example.com/docs");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a rejected open, including the string errors Tauri commands reject with", async () => {
    const onError = vi.fn();
    await openLink("https://example.com", () => Promise.reject("Not allowed to open url https://example.com"), onError);
    await openLink("https://example.com", () => Promise.reject(new Error("boom")), onError);
    expect(onError.mock.calls).toEqual([["Not allowed to open url https://example.com"], ["boom"]]);
  });
});

describe("category", () => {
  it("splits each of the four prefixes off the note", () => {
    expect(category("Added: What's new tab")).toEqual({ category: "Added", text: "What's new tab" });
    expect(category("Changed: x")).toEqual({ category: "Changed", text: "x" });
    expect(category("Fixed: a\nsecond line")).toEqual({ category: "Fixed", text: "a\nsecond line" });
    expect(category("Removed: y")).toEqual({ category: "Removed", text: "y" });
  });

  it("leaves a note without a recognised prefix whole", () => {
    expect(category("Deprecated: z")).toEqual({ category: undefined, text: "Deprecated: z" });
    expect(category("added: lower case")).toEqual({ category: undefined, text: "added: lower case" });
    expect(category("Added:no space")).toEqual({ category: undefined, text: "Added:no space" });
  });
});

describe("shortDate", () => {
  it("formats a yyyy-mm-dd date as day and month", () => {
    expect(shortDate("2026-10-30")).toBe("30 Oct");
    expect(shortDate("2026-01-05")).toBe("5 Jan");
  });

  it("is empty when the generator had no date", () => {
    expect(shortDate("")).toBe("");
  });
});

describe("subtitle", () => {
  const today = new Date(2026, 9, 30);
  const at = (date: string) => [{ version: "0.2.44", date, body: "" }];

  it("counts the unseen releases when opened on launch", () => {
    expect(subtitle([...at("2026-10-30"), ...at("2026-10-29")], "launch", today)).toBe("Updated today. 2 releases since you last opened it.");
    expect(subtitle(at("2026-10-30"), "launch", today)).toBe("Updated today. 1 release since you last opened it.");
  });

  it("says every release when opened from Settings", () => {
    expect(subtitle(at("2026-10-30"), "settings", today)).toBe("Updated today. Every release.");
  });

  it("dates an older newest release", () => {
    expect(subtitle(at("2026-10-29"), "settings", today)).toBe("Updated yesterday. Every release.");
    expect(subtitle(at("2026-10-20"), "settings", today)).toBe("Updated 20 Oct. Every release.");
  });

  it("leaves out the update when the newest release has no date, and is empty with no releases", () => {
    expect(subtitle(at(""), "settings", today)).toBe("Every release.");
    expect(subtitle([], "settings", today)).toBe("");
  });
});
