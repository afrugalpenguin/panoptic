using System.Text.RegularExpressions;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Node meta "dragText", the text dragging a node into the editor inserts. These are the cases of the UI's
/// drag-text.test.ts with the same expected strings: the rule moved from drag-text.ts into the backends unchanged.
/// </summary>
public sealed class DragTextTests
{
    private static string SqlObject(string schema, string name) => $"{SqlBackend.DragName(schema)}.{SqlBackend.DragName(name)}";

    [Fact]
    public void Sql_objects_are_schema_qualified_quoting_only_the_parts_that_need_it()
    {
        Assert.Equal("dbo.Orders", SqlObject("dbo", "Orders"));
        Assert.Equal("[my schema].[Order Lines]", SqlObject("my schema", "Order Lines"));
        Assert.Equal("dbo.[Order]", SqlObject("dbo", "Order"));
        Assert.Equal("dbo.[a]]b]", SqlObject("dbo", "a]b"));
        Assert.Equal("dbo.[2024]", SqlObject("dbo", "2024"));
    }

    [Fact]
    public void Columns_and_databases_insert_their_names_on_their_own()
    {
        Assert.Equal("Id", SqlBackend.DragName("Id"));
        Assert.Equal("[Unit Price]", SqlBackend.DragName("Unit Price"));
        Assert.Equal("[Sales-UK]", SqlBackend.DragName("Sales-UK"));
    }

    [Fact]
    public void Javascript_end_of_string_semantics_hold()
    {
        // JS's /...$/ does not match before a trailing newline; .NET's $ would, so the sidecar uses \z.
        Assert.Equal("[a\n]", SqlBackend.DragName("a\n"));
        Assert.Null(CosmosBackend.DragText("orders\n"));
    }

    [Fact]
    public void Cosmos_containers_and_udfs_skip_names_that_are_not_identifiers()
    {
        Assert.Equal("orders", CosmosBackend.DragText("orders"));
        Assert.Equal("udf.tax", CosmosBackend.DragText("udf.tax"));
        Assert.Null(CosmosBackend.DragText("order-lines"));
    }

    [Fact]
    public void The_keyword_list_matches_the_uis()
    {
        var file = Path.Combine(RepoRoot(), "apps", "desktop", "src", "query", "intellisense", "tsql-words.ts");
        var source = File.ReadAllText(file);
        var block = Regex.Match(source, @"export const TSQL_KEYWORDS = \[(.*?)\];", RegexOptions.Singleline);
        Assert.True(block.Success, "TSQL_KEYWORDS not found in tsql-words.ts");
        var ui = Regex.Matches(block.Groups[1].Value, "\"([^\"]*)\"").Select(m => m.Groups[1].Value).ToArray();

        Assert.Equal(ui, TsqlKeywords.All);
    }

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (Directory.Exists(Path.Combine(dir.FullName, "apps", "desktop", "src"))) return dir.FullName;
        throw new InvalidOperationException("Repository root not found above " + AppContext.BaseDirectory);
    }

    [SqlFact(NeedsWindows = false), Trait("Category", "SqlIntegration")]
    public async Task Sql_tree_nodes_carry_drag_text_only_where_the_ui_dragged()
    {
        var backend = new SqlBackend(new Credentials(_ => { }));
        var conn = new ConnectionConfig("sql1", "dev", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);
        var root = NodePath.Parse("env:e/conn:sql1");
        Task<TreeNode[]> Expand(NodePath path) => backend.ChildrenAsync(conn, SqlFactAttribute.Password, path, 2, default);

        var orders = (await Expand(root)).Single(n => n.Label == "Orders");
        Assert.Equal("Orders", orders.Meta!["dragText"]);
        var dbPath = NodePath.Parse(orders.Id);
        var folders = await Expand(dbPath);
        Assert.All(folders, f => Assert.Null(f.Meta));

        var tables = await Expand(dbPath.Child("f", "tables"));
        Assert.All(tables, t => Assert.Equal(SqlObject(t.Meta!["schema"], t.Meta!["name"]), t.Meta!["dragText"]));
        var synonym = Assert.Single(await Expand(dbPath.Child("f", "synonyms")));
        Assert.Equal(SqlObject(synonym.Meta!["schema"], synonym.Meta!["name"]), synonym.Meta!["dragText"]);

        var table = NodePath.Parse(tables.First().Id);
        var columns = await Expand(table.Child("f", "columns"));
        Assert.All(columns, c => Assert.Equal(SqlBackend.DragName(c.Meta!["name"]), c.Meta!["dragText"]));
        Assert.All(await Expand(table.Child("f", "keys")), k => Assert.Null(k.Meta));
        Assert.All(await Expand(table.Child("f", "indexes")), i => Assert.Null(i.Meta));
    }
}
