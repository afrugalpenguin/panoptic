import { describe, expect, it } from "vitest";
import type { ImportCandidate, ImportSource } from "./api";
import { envStyleFor, planGroups, suggestEnvironment } from "./import-plan";

const c = (endpoint: string, extra: Partial<ImportCandidate> = {}): ImportCandidate => ({
  name: endpoint,
  kind: "sql",
  endpoint,
  auth: "entra",
  trustServerCertificate: false,
  alreadyAdded: false,
  ...extra,
});

describe("suggestEnvironment", () => {
  it.each([
    ["orders-prod.database.windows.net", "Prod"],
    ["sqlprd01.example.local", "Prod"],
    ["app-production-sql.database.windows.net", "Prod"],
    ["orders-uat.database.windows.net", "UAT"],
    ["dev-sql.example.local", "Dev"],
    ["myapp.dev.example.local", "Dev"],
    ["qa-sql01", "Test"],
    ["orders-test.database.windows.net", "Test"],
    ["reporting.example.local", undefined],
    ["devonshire-sql.example.local", undefined],
    ["product-catalog.database.windows.net", undefined],
  ])("%s -> %s", (endpoint, expected) => {
    expect(suggestEnvironment(c(endpoint))).toBe(expected);
  });

  it("also looks at the database and display name", () => {
    expect(suggestEnvironment(c("shared-sql.example.local", { database: "Orders_UAT" }))).toBe("UAT");
  });
});

describe("planGroups", () => {
  const history: ImportSource = {
    source: "ssms-recent",
    label: "SSMS connection history (21.0)",
    path: "x",
    groups: [{ name: "Connection history", connections: [c("a-prod"), c("b-dev"), c("c-prod"), c("reporting")] }],
  };
  const registered: ImportSource = {
    source: "ssms-registered",
    label: "SSMS Registered Servers",
    path: "y",
    groups: [{ name: "Team", connections: [c("x-prod")] }],
  };

  it("splits ungrouped history into suggested environments, leftovers last", () => {
    const groups = planGroups([history]);
    expect(groups.map((g) => [g.name, g.candidates.length, g.suggested])).toEqual([
      ["Prod", 2, true],
      ["Dev", 1, true],
      ["Other connections", 1, false],
    ]);
  });

  it("keeps groups that the source tool already defined", () => {
    expect(planGroups([registered]).map((g) => g.name)).toEqual(["Team"]);
  });

  it("drops a connection already seen in an earlier source", () => {
    const dup: ImportSource = { ...registered, groups: [{ name: "Team", connections: [c("a-prod")] }] };
    expect(planGroups([history, dup]).find((g) => g.name === "Team")).toBeUndefined();
  });
});

describe("envStyleFor", () => {
  it("makes Prod red and read-only, others writable", () => {
    expect(envStyleFor("Prod")).toEqual({ color: "#e03131", readOnly: true });
    expect(envStyleFor("Dev").readOnly).toBe(false);
  });
});
