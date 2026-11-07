using System.Net;
using System.Text;
using Azure.Core;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Cosmos account keys fetched through Azure Resource Manager with the user's Entra sign-in (#65), against a fake
/// ARM. Synthetic account names, subscription ids and keys only.
/// </summary>
public sealed class CosmosAccountKeysTests
{
    private const string Endpoint = "https://orders-dev.documents.azure.com:443/";
    private const string Id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-orders/providers/Microsoft.DocumentDB/databaseAccounts/orders-dev";
    private const string ReadOnlyKey = "c3ludGhldGljLXJlYWQtb25seS1rZXk=";

    private sealed class FakeCredential : TokenCredential
    {
        public List<string[]> Scopes { get; } = [];

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext context, CancellationToken cancellationToken)
        {
            Scopes.Add(context.Scopes);
            return ValueTask.FromResult(new AccessToken("arm-token", DateTimeOffset.UtcNow.AddHours(1)));
        }

        public override AccessToken GetToken(TokenRequestContext context, CancellationToken cancellationToken) =>
            GetTokenAsync(context, cancellationToken).AsTask().GetAwaiter().GetResult();
    }

    /// <summary>Answers each request with the first route whose path fragment it contains, and records what was asked.</summary>
    private sealed class FakeArm(params (string PathPart, HttpStatusCode Status, string Body)[] routes) : HttpMessageHandler
    {
        public List<(HttpMethod Method, Uri Uri, string? Auth, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add((request.Method, request.RequestUri!, request.Headers.Authorization?.ToString(), body));
            var (_, status, text) = routes.First(r => request.RequestUri!.AbsolutePath.Contains(r.PathPart, StringComparison.OrdinalIgnoreCase));
            return new HttpResponseMessage(status) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
        }
    }

    private static (string, HttpStatusCode, string) Graph(string rows) => ("Microsoft.ResourceGraph", HttpStatusCode.OK, $$"""{"count":1,"data":[{{rows}}]}""");

    private static (string, HttpStatusCode, string) Keys(HttpStatusCode status = HttpStatusCode.OK, string? body = null) =>
        ("/readonlykeys", status, body ?? $$"""{"primaryReadonlyMasterKey":"{{ReadOnlyKey}}","secondaryReadonlyMasterKey":"other"}""");

    private static async Task<(string? Key, RpcException? Error, FakeArm Arm, FakeCredential Credential)> Fetch(string endpoint, params (string, HttpStatusCode, string)[] routes)
    {
        var arm = new FakeArm(routes);
        var credential = new FakeCredential();
        try
        {
            return (await new CosmosAccountKeys(arm).FetchAsync(credential, endpoint, CancellationToken.None), null, arm, credential);
        }
        catch (RpcException ex)
        {
            return (null, ex, arm, credential);
        }
    }

    [Fact]
    public async Task Finds_the_account_and_returns_its_read_only_key()
    {
        var (key, error, arm, credential) = await Fetch(Endpoint, Graph($$"""{"id":"{{Id}}","disableLocalAuth":false}"""), Keys());

        Assert.Null(error);
        Assert.Equal(ReadOnlyKey, key);
        Assert.Equal(["https://management.azure.com/.default"], Assert.Single(credential.Scopes));
        Assert.Equal(2, arm.Requests.Count);
        Assert.All(arm.Requests, r => Assert.Equal("Bearer arm-token", r.Auth));
        Assert.All(arm.Requests, r => Assert.Equal(HttpMethod.Post, r.Method));
        Assert.Equal("management.azure.com", arm.Requests[0].Uri.Host);
        var query = System.Text.Json.JsonDocument.Parse(arm.Requests[0].Body).RootElement.GetProperty("query").GetString();
        Assert.Contains("name =~ 'orders-dev'", query);
        Assert.Contains("microsoft.documentdb/databaseaccounts", query);
        // Read-only keys: Panoptic's Cosmos queries cannot write, so it never asks for the full keys.
        Assert.Equal($"{Id}/readonlykeys", arm.Requests[1].Uri.AbsolutePath);
        Assert.DoesNotContain(arm.Requests, r => r.Uri.AbsolutePath.EndsWith("/listKeys", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task An_account_no_subscription_shows_says_so()
    {
        var (_, error, arm, _) = await Fetch(Endpoint, ("Microsoft.ResourceGraph", HttpStatusCode.OK, """{"count":0,"data":[]}"""));

        Assert.NotNull(error);
        Assert.Contains("No Cosmos DB account named orders-dev", error.Message);
        Assert.Single(arm.Requests);
    }

    [Fact]
    public async Task An_account_with_key_access_disabled_points_at_data_plane_roles()
    {
        var (_, error, arm, _) = await Fetch(Endpoint, Graph($$"""{"id":"{{Id}}","disableLocalAuth":true}"""), Keys());

        Assert.NotNull(error);
        Assert.Contains("key access disabled", error.Message);
        Assert.Contains("Microsoft Entra ID", error.Message);
        Assert.Single(arm.Requests); // never asks for keys it cannot use
    }

    [Fact]
    public async Task No_permission_to_list_keys_names_the_permission()
    {
        var (_, error, _, _) = await Fetch(Endpoint, Graph($$"""{"id":"{{Id}}","disableLocalAuth":false}"""),
            Keys(HttpStatusCode.Forbidden, """{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization."}}"""));

        Assert.NotNull(error);
        Assert.Contains("cannot list its keys", error.Message);
        Assert.Contains("readonlykeys/action", error.Message);
    }

    [Fact]
    public async Task Resource_graph_refusing_the_sign_in_is_reported()
    {
        var (_, error, _, _) = await Fetch(Endpoint, ("Microsoft.ResourceGraph", HttpStatusCode.Unauthorized, """{"error":{"code":"InvalidAuthenticationToken","message":"The token is invalid."}}"""));

        Assert.NotNull(error);
        Assert.Contains("401", error.Message);
        Assert.Contains("InvalidAuthenticationToken", error.Message);
    }

    [Theory]
    [InlineData("https://localhost:8081/")]
    [InlineData("https://orders-dev.documents.azure.us:443/")]
    [InlineData("https://orders-dev.example.test/")]
    [InlineData("not a uri")]
    public async Task Only_public_cloud_account_uris_are_looked_up(string endpoint)
    {
        var (_, error, arm, credential) = await Fetch(endpoint, Graph(""));

        Assert.NotNull(error);
        Assert.Contains("documents.azure.com", error.Message);
        Assert.Empty(arm.Requests);
        Assert.Empty(credential.Scopes);
    }

    [Theory]
    [InlineData("https://orders'or'1.documents.azure.com/")]
    [InlineData("https://ab.documents.azure.com/")]
    public async Task An_account_name_that_cannot_exist_is_refused_before_any_query(string endpoint)
    {
        var (_, error, arm, _) = await Fetch(endpoint, Graph(""));

        Assert.NotNull(error);
        Assert.Empty(arm.Requests);
    }

    [Fact]
    public async Task A_resource_id_that_is_not_a_cosmos_account_is_not_followed()
    {
        var (_, error, arm, _) = await Fetch(Endpoint, Graph("""{"id":"https://elsewhere.example.test/x","disableLocalAuth":false}"""), Keys());

        Assert.NotNull(error);
        Assert.Single(arm.Requests);
    }

    [Fact]
    public async Task The_backend_fetches_the_key_once_and_again_after_the_client_is_dropped()
    {
        var arm = new FakeArm(Graph($$"""{"id":"{{Id}}","disableLocalAuth":false}"""), Keys());
        var backend = new CosmosBackend(new Credentials(_ => { }, _ => new FakeCredential()), new CosmosAccountKeys(arm));
        var connection = new ConnectionConfig("cos1", "dev", ConnectionKinds.Cosmos, Endpoint, AuthKinds.EntraKeys);

        var first = await backend.ClientForAsync(connection, null, CancellationToken.None);
        var again = await backend.ClientForAsync(connection, null, CancellationToken.None);
        Assert.Same(first, again);
        Assert.Equal(2, arm.Requests.Count);

        backend.Forget(connection.Id);
        await backend.ClientForAsync(connection, null, CancellationToken.None);
        Assert.Equal(4, arm.Requests.Count);
    }

    [Fact]
    public void Cosmos_offers_the_fetched_key_sign_in()
    {
        var auths = new CosmosBackend(new Credentials(_ => { })).Describe(ConnectionKinds.Cosmos).Auths.Select(a => a.Id);

        Assert.Equal([AuthKinds.Entra, AuthKinds.EntraKeys, AuthKinds.Key], auths);
    }

    [Fact]
    public async Task The_key_never_appears_in_an_error()
    {
        var (_, error, _, _) = await Fetch(Endpoint, Graph($$"""{"id":"{{Id}}","disableLocalAuth":false}"""),
            Keys(HttpStatusCode.OK, $$"""{"secondaryReadonlyMasterKey":"{{ReadOnlyKey}}"}"""));

        Assert.NotNull(error);
        Assert.DoesNotContain(ReadOnlyKey, error.Message);
        Assert.DoesNotContain(ReadOnlyKey, error.NodeError?.Detail ?? "");
    }
}
