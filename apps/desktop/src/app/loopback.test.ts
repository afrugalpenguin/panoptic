import { describe, expect, it } from "vitest";
import { isLoopback } from "./loopback";

describe("isLoopback", () => {
  it.each([
    "localhost",
    "LOCALHOST,1433",
    "localhost\\SQLEXPRESS",
    "127.0.0.1,14333",
    "127.0.0.1:15432",
    "127.1.2.3",
    "::1",
    "[::1]:5432",
    "https://localhost:8081",
    "https://127.0.0.1:8081/",
    ".",
    ".\\SQLEXPRESS",
    "(local)",
    "(localdb)\\MSSQLLocalDB",
  ])("treats %s as this machine", (endpoint) => {
    expect(isLoopback(endpoint)).toBe(true);
  });

  it.each([
    "orders.fabrikam.test",
    "orders.fabrikam.test,1433",
    "10.0.0.5",
    "https://fabrikam.documents.azure.com:443/",
    "localhost.fabrikam.test",
    "127.0.0.1.fabrikam.test",
    "",
  ])("treats %s as another machine", (endpoint) => {
    expect(isLoopback(endpoint)).toBe(false);
  });
});
