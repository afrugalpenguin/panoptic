import { describe, expect, it } from "vitest";
import type { ImportCandidate, ImportSource } from "./api";
import { envStyleFor, hostLabel, planGroups, suggestEnvironments } from "./import-plan";

const c = (endpoint: string, extra: Partial<ImportCandidate> = {}): ImportCandidate => ({
  name: endpoint,
  kind: endpoint.includes("azuresynapse") ? "synapse" : "sql",
  endpoint,
  auth: "entra",
  trustServerCertificate: false,
  alreadyAdded: false,
  ...extra,
});

// Invented names in a common convention: a shared prefix with the environment glued on the end.
const family = [
  "acmedwhuat.database.windows.net",
  "acmedwhsupport.database.windows.net",
  "acmedwhuk.database.windows.net",
  "acmedwhsandbox.database.windows.net",
  "acmedwhdev.database.windows.net",
  "acmedwhstage-us.database.windows.net",
  "acmesandbox-ondemand.sql.azuresynapse.net",
];

const suggest = (endpoints: string[]) => suggestEnvironments(endpoints.map((e) => c(e)));

describe("hostLabel", () => {
  it.each([
    ["tcp:Orders-Dev.database.windows.net,1433", "orders-dev"],
    [String.raw`BOX\SQL2019`, "box"],
    ["myws-ondemand.sql.azuresynapse.net", "myws"],
    ["10.0.0.5,1433", "10.0.0.5"],
  ])("%s -> %s", (endpoint, label) => expect(hostLabel(endpoint)).toBe(label));
});

describe("suggestEnvironments", () => {
  it("groups by whatever follows the shared prefix, including names not on any keyword list", () => {
    expect(suggest(family)).toEqual(["UAT", "Support", "UK", "Sandbox", "Dev", "Stage US", "Sandbox"]);
  });

  it("does not split on a prefix only two servers share", () => {
    // acmedwhuat and acmedwhuk share "acmedwhu", but the family prefix is "acmedwh".
    expect(suggest(["acmedwhuat.x", "acmedwhuk.x", "acmedwhdev.x"])).toEqual(["UAT", "UK", "Dev"]);
  });

  it("is case-insensitive", () => {
    expect(suggest(["AcmeDwhUAT.x", "acmedwhSupport.x", "ACMEDWHDEV.x"])).toEqual(["UAT", "Support", "Dev"]);
  });

  it("falls back to keywords for servers without a family, including glued suffixes", () => {
    expect(suggest(["orders-prod.x", "billingprod.x", "reporting.x", "qa-sql01.x"])).toEqual(["Prod", "Prod", undefined, "Test"]);
  });

  it("does not mistake words that merely contain a keyword", () => {
    expect(suggest(["product-catalog.x", "devonshire-sql.x"])).toEqual([undefined, undefined]);
  });

  it("names local servers Local", () => {
    expect(suggest(["localhost", "127.0.0.1,14333", ".", "(local)"])).toEqual(["Local", "Local", "Local", "Local"]);
  });

  it("looks at the database name when the server says nothing", () => {
    expect(suggestEnvironments([c("shared-sql.x", { database: "Orders_UAT" })])).toEqual(["UAT"]);
  });

  it("leaves the bare family name unassigned rather than guessing it is prod", () => {
    expect(suggest(["acmedwh.x", "acmedwhuat.x", "acmedwhdev.x", "acmedwhtest.x"])[0]).toBeUndefined();
  });
});

describe("planGroups", () => {
  const history: ImportSource = {
    source: "ssms-recent",
    label: "SSMS connection history (20.0)",
    path: "x",
    groups: [{ name: "Connection history", connections: [...family.map((e) => c(e)), c("reporting.x")] }],
  };
  const registered: ImportSource = {
    source: "ssms-registered",
    label: "SSMS saved connections (RegSrvr17.xml)",
    path: "y",
    groups: [{ name: "Team", connections: [c("acmedwhqa.database.windows.net"), c("acmedwhuat2.database.windows.net")] }],
  };

  it("splits ungrouped connections into suggested environments, leftovers last", () => {
    const groups = planGroups([history]);
    expect(groups.map((g) => [g.name, g.candidates.length, g.suggested])).toEqual([
      ["Dev", 1, true],
      ["UAT", 1, true],
      ["Sandbox", 2, true],
      ["Stage US", 1, true],
      ["Support", 1, true],
      ["UK", 1, true],
      ["Other connections", 1, false],
    ]);
  });

  it("keeps the source tool's own groups by default", () => {
    expect(planGroups([registered]).map((g) => g.name)).toEqual(["Team"]);
  });

  it("regroups everything by naming pattern when asked, merging across sources", () => {
    const groups = planGroups([history, registered], { byPattern: true });
    expect(groups.find((g) => g.name === "UAT")!.candidates.map((x) => x.endpoint)).toEqual([
      "acmedwhuat.database.windows.net",
      "acmedwhuat2.database.windows.net",
    ]);
    expect(groups.find((g) => g.name === "Test")!.candidates).toHaveLength(1);
    expect(groups.find((g) => g.name === "Team")).toBeUndefined();
  });

  it("drops a connection already seen in an earlier source", () => {
    const dup: ImportSource = { ...registered, groups: [{ name: "Team", connections: [c("acmedwhuat.database.windows.net")] }] };
    expect(planGroups([history, dup]).find((g) => g.name === "Team")).toBeUndefined();
  });
});

describe("envStyleFor", () => {
  it("makes Prod red and read-only, others writable", () => {
    expect(envStyleFor("Prod")).toEqual({ color: "#e03131", readOnly: true });
    expect(envStyleFor("Dev").readOnly).toBe(false);
  });
});
