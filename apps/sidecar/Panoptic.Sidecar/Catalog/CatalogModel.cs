namespace Panoptic.Sidecar.Catalog;

public static class ObjectKinds
{
    public const string Table = "table";
    public const string View = "view";
    public const string Proc = "proc";
    public const string Fn = "fn";
    public const string Synonym = "synonym";
}

public static class CatalogStates
{
    /// <summary>Read from the disk cache; the stamp has not been checked yet.</summary>
    public const string Cached = "cached";
    public const string Current = "current";
    /// <summary>No cached copy; a build is running and catalog.updated follows.</summary>
    public const string Building = "building";
    public const string Error = "error";
}

public sealed record ColumnRef(string Name, string Type, bool Nullable);
public sealed record ParamRef(string Name, string Type, bool Output);
public sealed record CatalogObject(string Name, string Schema, string Kind, ColumnRef[]? Columns, ParamRef[]? Params);
/// <param name="Path">Dotted, with array indices collapsed to [] (items[].sku).</param>
/// <param name="Types">JSON types seen at this path in the sample.</param>
public sealed record PathRef(string Path, string[] Types);
public sealed record ContainerRef(string Name, string PartitionKey, PathRef[] Paths);

/// <summary>
/// One database's metadata (docs/query-editor.md): flat, pre-sorted (objects by schema then name), sent to the
/// UI once and replaced whole on refresh. Containers is set for Cosmos only.
/// </summary>
public sealed record DatabaseCatalog(string Stamp, string[] Schemas, CatalogObject[] Objects, string[] Types, ContainerRef[]? Containers);

/// <param name="Database">Overrides the database the node resolves to (a query tab's database picker).</param>
public sealed record CatalogParams(string NodeId, string? Database = null);
public sealed record CatalogResult(string Key, string State, DatabaseCatalog? Catalog);
/// <summary>Body of the catalog.state and catalog.updated notifications.</summary>
public sealed record CatalogNotice(string Key, string State, DatabaseCatalog? Catalog = null, string? Message = null);
