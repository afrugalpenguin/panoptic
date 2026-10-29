import { describe, expect, it } from "vitest";
import { CatalogStore, type DatabaseCatalog } from "./catalog.svelte";

const catalog = (stamp: string): DatabaseCatalog => ({ stamp, schemas: ["dbo"], objects: [], types: ["int"] });

describe("CatalogStore", () => {
  it("records a get result, with or without a catalog", () => {
    const store = new CatalogStore();
    store.apply({ key: "k", state: "building" });
    expect(store.get("k")?.state).toBe("building");
    expect(store.get("k")?.catalog).toBeUndefined();

    store.apply({ key: "k", state: "cached", catalog: catalog("s1") });
    expect(store.get("k")?.state).toBe("cached");
    expect(store.get("k")?.catalog?.stamp).toBe("s1");
  });

  it("keeps the catalog it has while a refresh builds", () => {
    const store = new CatalogStore();
    store.apply({ key: "k", state: "current", catalog: catalog("s1") });
    const version = store.get("k")!.version;
    store.apply({ key: "k", state: "building" });
    expect(store.get("k")?.state).toBe("building");
    expect(store.get("k")?.catalog?.stamp).toBe("s1");
    expect(store.get("k")?.version).toBe(version);
  });

  it("replaces the catalog on catalog.updated and bumps the version", () => {
    const store = new CatalogStore();
    store.apply({ key: "k", state: "cached", catalog: catalog("s1") });
    const version = store.get("k")!.version;
    store.handle("catalog.updated", { key: "k", state: "current", catalog: catalog("s2") });
    expect(store.get("k")?.state).toBe("current");
    expect(store.get("k")?.catalog?.stamp).toBe("s2");
    expect(store.get("k")!.version).toBeGreaterThan(version);
  });

  it("changes only the state on catalog.state", () => {
    const store = new CatalogStore();
    store.apply({ key: "k", state: "cached", catalog: catalog("s1") });
    store.handle("catalog.state", { key: "k", state: "error", message: "Login failed" });
    expect(store.get("k")?.state).toBe("error");
    expect(store.get("k")?.message).toBe("Login failed");
    expect(store.get("k")?.catalog?.stamp).toBe("s1");
  });

  it("ignores notices for keys nobody asked for", () => {
    const store = new CatalogStore();
    store.handle("catalog.updated", { key: "nobody", state: "current", catalog: catalog("s1") });
    store.handle("catalog.state", { key: "nobody", state: "current" });
    expect(store.get("nobody")).toBeUndefined();
  });
});
