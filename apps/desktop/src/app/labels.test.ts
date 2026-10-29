import { describe, expect, it } from "vitest";
import { computeLabels, leafLabel, type LabelInput } from "./labels";

const conn = (id: string, kind: string, endpoint: string, envId = "dev"): LabelInput => ({ id, kind, endpoint, envId });
const parts = (labels: Map<string, { prefix: string; core: string; suffix: string }>, id: string) => {
  const l = labels.get(id)!;
  return [l.prefix, l.core, l.suffix];
};

describe("computeLabels: worked results from the spec", () => {
  const tree = [
    conn("s1", "sql", "acmedwhint-uk.database.windows.net"),
    conn("s2", "sql", "acmedwhuat.database.windows.net", "uat"),
    conn("s3", "sql", "acmedwhsupport.database.windows.net", "support"),
    conn("c1", "cosmos", "acmesuredev.documents.azure.com"),
    conn("c2", "cosmos", "acmesureuat.documents.azure.com", "uat"),
    conn("y1", "synapse", "acmesuresupport-ondemand.sql.azuresynapse.net", "support"),
  ];
  const labels = computeLabels(tree);

  it("SQL: glued family prefix, core, cloud suffix", () => {
    expect(parts(labels, "s1")).toEqual(["acmedwh", "int-uk", ".database.windows.net"]);
  });

  it("Cosmos: same rule per kind, across environments", () => {
    expect(parts(labels, "c1")).toEqual(["acmesure", "dev", ".documents.azure.com"]);
  });

  it("Synapse: single member of its kind, so the whole endpoint is bright", () => {
    expect(parts(labels, "y1")).toEqual(["", "acmesuresupport-ondemand.sql.azuresynapse.net", ""]);
  });
});

describe("computeLabels: boundaries", () => {
  it("cuts the prefix back to the last . or - so a core never starts mid-token", () => {
    const labels = computeLabels([conn("a", "sql", "app-uat1.example.com"), conn("b", "sql", "app-uat2.example.com")]);
    expect(parts(labels, "a")).toEqual(["app-", "uat1", ".example.com"]);
  });

  it("cuts the suffix forward to the first . boundary", () => {
    const labels = computeLabels([conn("a", "sql", "orders-dat2.corp.example.com"), conn("b", "sql", "orders-uat2.corp.example.com")]);
    expect(parts(labels, "a")).toEqual(["orders-", "dat2", ".corp.example.com"]);
  });

  it("is case-insensitive but keeps the endpoint's own casing", () => {
    const labels = computeLabels([conn("a", "sql", "AcmeDwhUAT.database.windows.net"), conn("b", "sql", "acmedwhdev.Database.Windows.net")]);
    expect(parts(labels, "a")).toEqual(["AcmeDwh", "UAT", ".database.windows.net"]);
    expect(parts(labels, "b")).toEqual(["acmedwh", "dev", ".Database.Windows.net"]);
  });

  it("keeps kinds separate", () => {
    const labels = computeLabels([conn("a", "sql", "x-one.example.com"), conn("b", "cosmos", "x-two.example.com")]);
    expect(parts(labels, "a")).toEqual(["", "x-one.example.com", ""]);
  });
});

describe("computeLabels: fallbacks", () => {
  it("leaves an endpoint fully bright when neither the tree nor its env siblings leave a core", () => {
    // Identical endpoints in two environments: tree-wide the prefix and suffix cover the whole name,
    // and each env holds a single member, so the env-sibling fallback has nothing to compare.
    const labels = computeLabels([conn("a", "sql", "shared.example.com", "dev"), conn("b", "sql", "shared.example.com", "uat")]);
    expect(parts(labels, "a")).toEqual(["", "shared.example.com", ""]);
  });

  it("leaves a lone endpoint fully bright", () => {
    expect(parts(computeLabels([conn("a", "sql", "reporting.example.com")]), "a")).toEqual(["", "reporting.example.com", ""]);
  });

  it("treats localhost\\ as a prefix and bare localhost as fully bright, and ignores both in the sets", () => {
    const labels = computeLabels([
      conn("l1", "sql", String.raw`localhost\SQLEXPRESS`),
      conn("l2", "sql", "localhost"),
      conn("l3", "sql", "localhost,14333"),
      conn("s1", "sql", "acmedwhuat.database.windows.net"),
      conn("s2", "sql", "acmedwhdev.database.windows.net"),
    ]);
    expect(parts(labels, "l1")).toEqual([String.raw`localhost\ `.trim(), "SQLEXPRESS", ""]);
    expect(parts(labels, "l2")).toEqual(["", "localhost", ""]);
    expect(parts(labels, "l3")).toEqual(["", "localhost,14333", ""]);
    expect(parts(labels, "s1")).toEqual(["acmedwh", "uat", ".database.windows.net"]);
  });
});

describe("leafLabel", () => {
  it("dims the schema prefix", () => {
    expect(leafLabel("dbo.Customer")).toEqual({ prefix: "dbo.", core: "Customer", suffix: "" });
  });

  it("leaves names without a schema bright", () => {
    expect(leafLabel("Orders")).toEqual({ prefix: "", core: "Orders", suffix: "" });
  });
});
