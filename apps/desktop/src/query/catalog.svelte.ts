// The catalog records come generated from the sidecar's Catalog/CatalogModel.cs (sidecar-types.generated.ts), narrowed
// here; the catalog.* notifications are documented in Catalog/CatalogService.cs (docs/query-editor.md, "Catalog").
import type { Narrow } from "../narrow";
import type * as Sidecar from "../sidecar-types.generated";

export type ObjectKind = "table" | "view" | "proc" | "fn" | "synonym";

export type ColumnRef = Sidecar.ColumnRef;
export type ParamRef = Sidecar.ParamRef;
export type CatalogObject = Narrow<Sidecar.CatalogObject, { kind: ObjectKind }>;
/** A Cosmos property path: dotted, array elements as [] (lines[].sku). */
export type PathRef = Sidecar.PathRef;
export type ContainerRef = Sidecar.ContainerRef;
/** One database's metadata, flat and sorted by schema then name. Cosmos sets containers only. */
export type DatabaseCatalog = Narrow<Sidecar.DatabaseCatalog, { objects: CatalogObject[] }>;

export type CatalogState = "cached" | "current" | "building" | "error";

/** catalog.get and catalog.refresh results, and catalog.state / catalog.updated notifications. */
export type CatalogNotice = Narrow<Sidecar.CatalogNotice, { state: CatalogState; catalog?: DatabaseCatalog | null }>;

export class CatalogEntry {
  state = $state<CatalogState>("building");
  /** Raw: a catalog can hold 100k columns and must never be made deeply reactive. */
  catalog = $state.raw<DatabaseCatalog>();
  /** Bumped whenever catalog is replaced, so the worker knows to re-index. */
  version = $state(0);
  message = $state<string>();
}

/** Catalogs by key (connection and database), as far as the UI knows them. */
export class CatalogStore {
  private entries = $state<Record<string, CatalogEntry>>({});

  get(key: string): CatalogEntry | undefined {
    return this.entries[key];
  }

  /** A catalog.get or catalog.refresh result. "building" keeps whatever catalog is already here. */
  apply(result: CatalogNotice): void {
    const entry = (this.entries[result.key] ??= new CatalogEntry());
    this.update(entry, result);
  }

  /** Feed for catalog.state and catalog.updated notifications. Keys nobody asked for are ignored. */
  handle(method: string, params: unknown): void {
    if (method !== "catalog.state" && method !== "catalog.updated") return;
    const notice = params as CatalogNotice;
    const entry = this.entries[notice.key];
    if (entry) this.update(entry, notice);
  }

  private update(entry: CatalogEntry, notice: CatalogNotice): void {
    entry.state = notice.state;
    entry.message = notice.message ?? undefined;
    if (notice.catalog) {
      entry.catalog = notice.catalog;
      entry.version++;
    }
  }
}
