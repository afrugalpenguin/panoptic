using Panoptic.Sidecar.Catalog;

namespace Panoptic.Sidecar.Tests;

public class SqlCatalogTests
{
    private static readonly SqlCatalog.ObjectRow[] Objects =
    [
        new(1, "Customers", "dbo", "U "),
        new(2, "Orders", "sales", "U "),
        new(3, "GetOrders", "sales", "P "),
    ];

    [Fact]
    public void Assemble_groups_columns_and_params_under_their_objects()
    {
        var catalog = SqlCatalog.Assemble("stamp", ["dbo", "sales"], Objects,
            [
                new(1, "Id", "int", 4, 10, 0, false),
                new(1, "Name", "nvarchar", 100, 0, 0, true),
                new(2, "Id", "int", 4, 10, 0, false),
            ],
            [new(3, "@since", "date", 3, 10, 0, false)],
            ["date", "int", "nvarchar"]);

        Assert.Equal("stamp", catalog.Stamp);
        var customers = catalog.Objects.Single(o => o.Name == "Customers");
        Assert.Equal(["Id", "Name"], customers.Columns!.Select(c => c.Name));
        Assert.Null(customers.Params);
        var proc = catalog.Objects.Single(o => o.Name == "GetOrders");
        Assert.Null(proc.Columns);
        Assert.Equal(new ParamRef("@since", "date", false), Assert.Single(proc.Params!));
        Assert.Null(catalog.Containers);
    }

    [Fact]
    public void Assemble_keeps_objects_sorted_by_schema_then_name()
    {
        var catalog = SqlCatalog.Assemble("s", [], [new(1, "b", "x", "V "), new(2, "a", "x", "V "), new(3, "z", "a", "V ")], [], [], []);
        Assert.Equal(["a.z", "x.a", "x.b"], catalog.Objects.Select(o => $"{o.Schema}.{o.Name}"));
    }

    [Theory]
    [InlineData("U ", ObjectKinds.Table)]
    [InlineData("V ", ObjectKinds.View)]
    [InlineData("P ", ObjectKinds.Proc)]
    [InlineData("FN", ObjectKinds.Fn)]
    [InlineData("IF", ObjectKinds.Fn)]
    [InlineData("TF", ObjectKinds.Fn)]
    [InlineData("SN", ObjectKinds.Synonym)]
    public void Assemble_maps_object_types_to_kinds(string type, string kind)
    {
        var catalog = SqlCatalog.Assemble("s", [], [new(1, "o", "dbo", type)], [], [], []);
        Assert.Equal(kind, catalog.Objects[0].Kind);
    }

    [Fact]
    public void Assemble_formats_types_like_the_tree()
    {
        var catalog = SqlCatalog.Assemble("s", [], [new(1, "t", "dbo", "U ")],
            [
                new(1, "a", "nvarchar", 100, 0, 0, true),
                new(1, "b", "nvarchar", -1, 0, 0, true),
                new(1, "c", "decimal", 9, 18, 2, false),
            ], [], []);
        Assert.Equal(["nvarchar(50)", "nvarchar(max)", "decimal(18, 2)"], catalog.Objects[0].Columns!.Select(c => c.Type));
        Assert.Equal([true, true, false], catalog.Objects[0].Columns!.Select(c => c.Nullable));
    }

    [Fact]
    public void Views_and_table_functions_get_columns_and_functions_get_params()
    {
        var catalog = SqlCatalog.Assemble("s", [], [new(1, "v", "dbo", "V "), new(2, "f", "dbo", "IF"), new(3, "s", "dbo", "FN")],
            [new(1, "x", "int", 4, 10, 0, false), new(2, "y", "int", 4, 10, 0, false)],
            [new(2, "@p", "int", 4, 10, 0, false), new(3, "@q", "int", 4, 10, 0, false)], []);
        Assert.Single(catalog.Objects.Single(o => o.Name == "v").Columns!);
        Assert.Single(catalog.Objects.Single(o => o.Name == "f").Columns!);
        Assert.Single(catalog.Objects.Single(o => o.Name == "f").Params!);
        Assert.Null(catalog.Objects.Single(o => o.Name == "s").Columns);
    }
}

public class CosmosCatalogTests
{
    private static System.Text.Json.JsonElement Doc(string json) => System.Text.Json.JsonDocument.Parse(json).RootElement;

    [Fact]
    public void FlattenPaths_collapses_arrays_and_merges_types()
    {
        var paths = CosmosCatalog.FlattenPaths([Doc("""{"a":1,"b":{"c":"x"},"t":[{"s":1}]}"""), Doc("""{"a":"y","t":[]}""")]);
        Assert.Equal(
            ["a:number,string", "b:object", "b.c:string", "t:array", "t[]:object", "t[].s:number"],
            paths.Select(p => $"{p.Path}:{string.Join(',', p.Types)}"));
    }

    [Fact]
    public void FlattenPaths_skips_system_properties_but_keeps_id()
    {
        var paths = CosmosCatalog.FlattenPaths([Doc("""{"id":"1","_rid":"r","_self":"s","_etag":"e","_attachments":"a","_ts":1,"n":null}""")]);
        Assert.Equal(["id:string", "n:null"], paths.Select(p => $"{p.Path}:{string.Join(',', p.Types)}"));
    }

    [Fact]
    public void FlattenPaths_records_scalar_array_elements()
    {
        var paths = CosmosCatalog.FlattenPaths([Doc("""{"tags":["a","b",3]}""")]);
        Assert.Equal(["tags:array", "tags[]:number,string"], paths.Select(p => $"{p.Path}:{string.Join(',', p.Types)}"));
    }
}

public sealed class CatalogCacheTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "panoptic-catalog-" + Guid.NewGuid().ToString("N"));
    private static readonly DatabaseCatalog Sample = new("s1", ["dbo"], [new("T", "dbo", ObjectKinds.Table, [new("Id", "int", false)], null)], ["int"], null);

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, true);
    }

    [Fact]
    public void Cache_round_trips()
    {
        var cache = new CatalogCache(_folder);
        var key = CatalogCache.KeyOf("conn1", "Orders");
        Assert.Null(cache.Read(key));
        cache.Write(key, Sample);
        var read = cache.Read(key)!;
        Assert.Equal("s1", read.Stamp);
        Assert.Equal("Id", read.Objects[0].Columns![0].Name);
    }

    [Fact]
    public void Cache_returns_null_for_a_corrupt_file()
    {
        var cache = new CatalogCache(_folder);
        var key = CatalogCache.KeyOf("conn1", null);
        Directory.CreateDirectory(_folder);
        File.WriteAllBytes(Path.Combine(_folder, key + ".bin"), [1, 2, 3]);
        Assert.Null(cache.Read(key));
    }

    [Fact]
    public void Cache_file_is_encrypted()
    {
        var cache = new CatalogCache(_folder);
        var key = CatalogCache.KeyOf("conn1", "Orders");
        cache.Write(key, Sample);
        var bytes = File.ReadAllBytes(Path.Combine(_folder, key + ".bin"));
        Assert.DoesNotContain("dbo", System.Text.Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public void Key_has_no_clear_text_names_and_depends_on_both_parts()
    {
        var key = CatalogCache.KeyOf("conn1", "Orders");
        Assert.DoesNotContain("conn1", key);
        Assert.DoesNotContain("Orders", key, StringComparison.OrdinalIgnoreCase);
        Assert.Matches("^[0-9a-f]{32}$", key);
        Assert.NotEqual(key, CatalogCache.KeyOf("conn1", "Other"));
        Assert.NotEqual(key, CatalogCache.KeyOf("conn2", "Orders"));
    }
}
