import { describe, expect, it } from "vitest";
import type { ImportCandidate, ImportSource } from "./api";
import { envFromText, envStyleFor, planGroups, suggestEnvironments } from "./import-plan";

const c = (endpoint: string, extra: Partial<ImportCandidate> = {}): ImportCandidate => ({
  name: endpoint,
  kind: endpoint.includes("azuresynapse") ? "synapse" : "sql",
  endpoint,
  auth: "entra",
  trustServerCertificate: false,
  alreadyAdded: false,
  ...extra,
});

const suggest = (endpoints: string[]) => suggestEnvironments(endpoints.map((e) => c(e)));

describe("envFromText: the rule table", () => {
  it.each([
    // Separate word, any position
    ["orders-uat", "UAT"],
    ["uat-orders", "UAT"],
    ["sql-orders-prd-01", "Prod"],
    ["orders.uat.corp", "UAT"],
    // Glued onto the end
    ["ordersuat", "UAT"],
    ["reportsprod", "Prod"],
    ["acmepreprod", "Pre-prod"],
    // Spellings normalised, distinct environments kept distinct
    ["a-production", "Prod"],
    ["a-pre-prod", "Pre-prod"],
    ["a-non-prod", "Non-prod"],
    ["a-stg", "Staging"],
    ["a-qa", "QA"],
    ["a-tst", "Test"],
    ["a-sit", "SIT"],
    ["a-sbx", "Sandbox"],
    ["a-uat2", "UAT"],
    // Folder names use the same rules
    ["Lower environments", "Lower"],
    ["Production", "Prod"],
    // Words that merely contain or start with a keyword
    ["product-catalog", undefined],
    ["devonshire-sql", undefined],
    ["testament", undefined],
    ["livechat", undefined],
    ["Acme Ltd", undefined],
  ])("%s -> %s", (text, env) => expect(envFromText(text)).toBe(env));
});

describe("suggestEnvironments", () => {
  it("handles suffix, prefix, middle, subdomain and glued conventions", () => {
    expect(
      suggest(["orders-dev.x.com", "uat-orders.x.com", "sql-billing-prd-01.x.com", "orders.sit.corp.x.com", "billinguat.database.windows.net"]),
    ).toEqual(["Dev", "UAT", "Prod", "SIT", "UAT"]);
  });

  it("adds a region", () => {
    expect(suggest(["orders-prod-uk.x.com", "orders-prod-us.x.com", "orders-uat-uksouth.x.com"])).toEqual(["Prod UK", "Prod US", "UAT UK South"]);
  });

  it("finds house words glued onto a shared family prefix", () => {
    const family = ["acmedwhuat", "acmedwhsupport", "acmedwhuk", "acmedwhsandbox", "acmedwhdev", "acmedwhstage-us"].map((n) => `${n}.database.windows.net`);
    expect(suggest([...family, "acmesandbox-ondemand.sql.azuresynapse.net"])).toEqual(["UAT", "Support", "UK", "Sandbox", "Dev", "Staging US", "Sandbox"]);
  });

  it("does not split a family on a prefix only a sub-family shares", () => {
    expect(suggest(["acmedwhuat.x", "acmedwhuk.x", "acmedwhdev.x"])).toEqual(["UAT", "UK", "Dev"]);
  });

  it("names local servers Local", () => {
    expect(suggest(["localhost", "127.0.0.1,14333", ".", "(local)"])).toEqual(["Local", "Local", "Local", "Local"]);
  });

  it("uses the database or display name when the server says nothing", () => {
    expect(suggestEnvironments([c("shared-sql.x.com", { database: "Orders_UAT" }), c("10.1.2.3", { name: "Billing PROD" })])).toEqual(["UAT", "Prod"]);
  });

  it("leaves unrecognisable servers unassigned", () => {
    expect(suggest(["reporting.x.com", "product-catalog.x.com"])).toEqual([undefined, undefined]);
  });
});

describe("planGroups", () => {
  const history: ImportSource = {
    source: "ssms-recent",
    label: "SSMS connection history (20.0)",
    path: "h",
    groups: [{ name: "Connection history", connections: ["orders-dev.x.com", "orders-uat.x.com", "billing-uat.x.com", "reporting.x.com"].map((e) => c(e)) }],
  };
  const folders: ImportSource = {
    source: "ssms-registered",
    label: "SSMS saved connections (RegSrvr17.xml)",
    path: "r",
    groups: [
      { name: "Production", connections: [c("orders-main.x.com")] },
      { name: "Acme Ltd", connections: [c("acme-orders-qa.x.com"), c("acme-crm.x.com")] },
    ],
  };

  it("splits ungrouped connections into suggested environments in lifecycle order, leftovers last", () => {
    expect(planGroups([history]).map((g) => [g.name, g.candidates.length, g.suggested])).toEqual([
      ["Dev", 1, true],
      ["UAT", 2, true],
      ["Other connections", 1, false],
    ]);
  });

  it("keeps the source tool's folders by default", () => {
    expect(planGroups([folders]).map((g) => g.name)).toEqual(["Production", "Acme Ltd"]);
  });

  it("by pattern: environment-named folders still decide, other folders fall back to name rules", () => {
    const groups = planGroups([history, folders], { byPattern: true });
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.candidates.map((x) => x.endpoint)]));
    expect(byName["Prod"]).toEqual(["orders-main.x.com"]);
    expect(byName["QA"]).toEqual(["acme-orders-qa.x.com"]);
    expect(byName["UAT"]).toEqual(["orders-uat.x.com", "billing-uat.x.com"]);
    expect(byName["Other connections"]).toEqual(["reporting.x.com", "acme-crm.x.com"]);
  });

  it("drops a connection already seen in an earlier source", () => {
    const dup: ImportSource = { ...folders, groups: [{ name: "Acme Ltd", connections: [c("orders-uat.x.com")] }] };
    expect(planGroups([history, dup]).find((g) => g.name === "Acme Ltd")).toBeUndefined();
  });
});

describe("envStyleFor", () => {
  it("makes Prod red and read-only, others writable", () => {
    expect(envStyleFor("Prod")).toEqual({ color: "#e03131", readOnly: true });
    expect(envStyleFor("Prod UK").readOnly).toBe(true);
    expect(envStyleFor("Dev").readOnly).toBe(false);
  });
});
