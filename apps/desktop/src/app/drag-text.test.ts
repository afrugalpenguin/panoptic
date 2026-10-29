import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { dragText } from "./drag-text";

const node = (kind: string, label: string, meta?: Record<string, string>): TreeNode => ({
  id: `env:e/conn:c/${kind}:${label}`,
  kind,
  label,
  icon: kind,
  hasChildren: false,
  actions: [],
  meta,
});

describe("dragText", () => {
  it("schema-qualifies SQL objects, quoting only the parts that need it", () => {
    expect(dragText(node("table", "dbo.Orders", { schema: "dbo", name: "Orders" }), "sql")).toBe("dbo.Orders");
    expect(dragText(node("view", "my schema.Order Lines", { schema: "my schema", name: "Order Lines" }), "sql")).toBe(
      "[my schema].[Order Lines]",
    );
    expect(dragText(node("procedure", "dbo.Order", { schema: "dbo", name: "Order" }), "synapse")).toBe("dbo.[Order]");
    expect(dragText(node("table", "dbo.a]b", { schema: "dbo", name: "a]b" }), "sql")).toBe("dbo.[a]]b]");
    expect(dragText(node("table", "dbo.2024", { schema: "dbo", name: "2024" }), "sql")).toBe("dbo.[2024]");
  });

  it("inserts column and database names on their own", () => {
    expect(dragText(node("column", "Id (PK, int, not null)", { name: "Id", type: "int" }), "sql")).toBe("Id");
    expect(dragText(node("column", "Unit Price (money, null)", { name: "Unit Price", type: "money" }), "sql")).toBe("[Unit Price]");
    expect(dragText(node("database", "Sales-UK", { system: "false" }), "sql")).toBe("[Sales-UK]");
  });

  it("inserts Cosmos container names and UDF calls, skipping names that are not identifiers", () => {
    expect(dragText(node("container", "orders", { partitionKey: "/tenantId" }), "cosmos")).toBe("orders");
    expect(dragText(node("udf", "tax"), "cosmos")).toBe("udf.tax");
    expect(dragText(node("container", "order-lines"), "cosmos")).toBeUndefined();
    expect(dragText(node("database", "app"), "cosmos")).toBeUndefined();
  });

  it("gives nothing for rows without a name to insert", () => {
    expect(dragText(node("folder", "Tables"), "sql")).toBeUndefined();
    expect(dragText(node("environment", "Dev"), undefined)).toBeUndefined();
    expect(dragText(node("connection", "server.x.com"), "sql")).toBeUndefined();
    expect(dragText(node("definition", "Definition"), "sql")).toBeUndefined();
  });
});
