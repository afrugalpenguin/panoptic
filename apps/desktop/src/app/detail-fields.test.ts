import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import { detailFields } from "./detail-fields";
import { registerKinds } from "./kinds";

registerKinds(BUILTIN_KINDS);

const node = (kind: string, meta: Record<string, string>): TreeNode => ({ id: "n", kind, label: "n", icon: kind, hasChildren: true, actions: [], meta });

describe("detailFields", () => {
  it("names a connection's engine and its endpoint as the engine calls it", () => {
    const cosmos = node("connection", { connectionKind: "cosmos", endpoint: "https://shop.documents.example.test:443/", connectionId: "c1", copyText: "shop" });
    expect(detailFields(cosmos)).toEqual([
      { label: "Engine", value: "Cosmos" },
      { label: "Account URI", value: "https://shop.documents.example.test:443/" },
    ]);
    const sql = node("connection", { connectionKind: "sql", endpoint: "orders.example.test", trustServerCertificate: "true" });
    expect(detailFields(sql)).toEqual([
      { label: "Engine", value: "SQL" },
      { label: "Server", value: "orders.example.test" },
      { label: "Trust server certificate", value: "Yes" },
    ]);
  });

  it("labels other keys in sentence case and hides the ones that are not for reading", () => {
    expect(detailFields(node("container", { partitionKey: "/tenantId", json: "{}", dragText: "c", system: "false" }))).toEqual([
      { label: "Partition key", value: "/tenantId" },
      { label: "System", value: "No" },
    ]);
  });
});
