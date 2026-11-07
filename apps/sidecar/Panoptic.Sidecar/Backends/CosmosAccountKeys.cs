using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Azure.Core;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Fetches a Cosmos account's read-only key through Azure Resource Manager with the user's Entra sign-in (#65), as
/// Cosmos Data Explorer does: Azure roles such as Contributor or Cosmos DB Account Reader can list keys without a
/// data-plane role. The account is found by name with Azure Resource Graph across every subscription the sign-in can
/// see. Only read-only keys are asked for, since Panoptic's Cosmos queries cannot write. The key is returned to the
/// backend, which holds it in memory in its client; it is never stored or sent to the UI, and no error carries it.
/// </summary>
public sealed partial class CosmosAccountKeys(HttpMessageHandler? handler = null)
{
    private const string ArmScope = "https://management.azure.com/.default";
    private const string GraphApi = "2022-10-01";
    private const string CosmosApi = "2024-11-15";

    private readonly HttpClient _http = new(handler ?? new HttpClientHandler())
    {
        BaseAddress = new Uri("https://management.azure.com/"),
        Timeout = TimeSpan.FromSeconds(30),
    };

    /// <summary>Cosmos account names: 3 to 44 lowercase letters, digits and hyphens, starting and ending with a letter or digit.</summary>
    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,42}[a-z0-9]$")]
    private static partial Regex AccountNamePattern();

    /// <summary>A Cosmos account's ARM resource id, as Resource Graph returns it.</summary>
    [GeneratedRegex(@"^/subscriptions/[0-9a-f-]{36}/resourceGroups/[-\w.()]{1,90}/providers/Microsoft\.DocumentDB/databaseAccounts/[a-z0-9-]{3,44}$", RegexOptions.IgnoreCase)]
    private static partial Regex AccountIdPattern();

    public async Task<string> FetchAsync(TokenCredential credential, string endpoint, CancellationToken ct)
    {
        var name = AccountName(endpoint);
        var token = await credential.GetTokenAsync(new TokenRequestContext([ArmScope]), ct);
        var (id, localAuthDisabled) = await FindAsync(name, token.Token, ct);
        if (localAuthDisabled)
            throw Failed("local-auth-disabled",
                $"The Cosmos DB account {name} has key access disabled (disableLocalAuth), so its keys cannot be used. Use Microsoft Entra ID instead, with a Cosmos DB data-plane role such as Built-in Data Reader.");
        return await ReadOnlyKeyAsync(name, id, token.Token, ct);
    }

    /// <summary>The account name from its URI. Only the Azure public cloud is looked up: other clouds have their own ARM.</summary>
    internal static string AccountName(string endpoint)
    {
        const string Suffix = ".documents.azure.com";
        if (!Uri.TryCreate(endpoint.Trim(), UriKind.Absolute, out var uri) || !uri.Host.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase))
            throw new RpcException(RpcException.InvalidParams,
                "Fetching account keys through Entra needs an account URI in the Azure public cloud, such as https://myaccount.documents.azure.com:443/. Use Account key for the emulator or another cloud.");
        var name = uri.Host[..^Suffix.Length].ToLowerInvariant();
        // Also what keeps the name safe to put in the Resource Graph query below.
        if (!AccountNamePattern().IsMatch(name))
            throw new RpcException(RpcException.InvalidParams, $"{name} is not a Cosmos DB account name.");
        return name;
    }

    private async Task<(string Id, bool LocalAuthDisabled)> FindAsync(string name, string token, CancellationToken ct)
    {
        var query = "Resources | where type =~ 'microsoft.documentdb/databaseaccounts' and name =~ '" + name
            + "' | project id, disableLocalAuth = properties.disableLocalAuth";
        var body = new JsonObject { ["query"] = query }.ToJsonString();
        using var doc = await PostAsync($"providers/Microsoft.ResourceGraph/resources?api-version={GraphApi}", body, token,
            status => $"Azure Resource Graph refused the search for {name} (HTTP {(int)status})", ct);

        var rows = doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array ? data : default;
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() == 0)
            throw Failed("account-not-found",
                $"No Cosmos DB account named {name} in any subscription your sign-in can see. Check the tenant, and that you have an Azure role such as Reader on the account.");
        var row = rows[0];
        var id = row.TryGetProperty("id", out var idValue) && idValue.ValueKind == JsonValueKind.String ? idValue.GetString()! : "";
        if (!AccountIdPattern().IsMatch(id))
            throw Failed("unexpected-response", $"Azure Resource Graph returned an unexpected resource id for {name}.");
        var disabled = row.TryGetProperty("disableLocalAuth", out var flag) && flag.ValueKind == JsonValueKind.True;
        return (id, disabled);
    }

    private async Task<string> ReadOnlyKeyAsync(string name, string id, string token, CancellationToken ct)
    {
        using var doc = await PostAsync($"{id.TrimStart('/')}/readonlykeys?api-version={CosmosApi}", null, token,
            status => status == HttpStatusCode.Forbidden
                ? $"Your sign-in can see the Cosmos DB account {name} but cannot list its keys. That needs Microsoft.DocumentDB/databaseAccounts/readonlykeys/action, granted by roles such as Cosmos DB Account Reader or Contributor"
                : $"Azure Resource Manager refused to list the keys of {name} (HTTP {(int)status})", ct);
        if (doc.RootElement.TryGetProperty("primaryReadonlyMasterKey", out var key) && key.ValueKind == JsonValueKind.String && key.GetString() is { Length: > 0 } value)
            return value;
        throw Failed("unexpected-response", $"Azure Resource Manager returned no read-only key for {name}.");
    }

    /// <summary>
    /// POSTs to ARM and parses the reply. A failure becomes <paramref name="refused"/> plus ARM's error code and message;
    /// a failure's body never holds a key, and a success's body is never put in an error.
    /// </summary>
    private async Task<JsonDocument> PostAsync(string path, string? body, string token, Func<HttpStatusCode, string> refused, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(body ?? "", Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await _http.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            var (code, message) = ArmError(text);
            var summary = refused(response.StatusCode);
            throw Failed(code ?? $"{(int)response.StatusCode}", code is null ? $"{summary}." : $"{summary}: {code}. {message}".TrimEnd());
        }
        try
        {
            return JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            throw Failed("unexpected-response", "Azure Resource Manager returned a reply that is not JSON.");
        }
    }

    private static (string? Code, string? Message) ArmError(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (!doc.RootElement.TryGetProperty("error", out var error) || error.ValueKind != JsonValueKind.Object) return (null, null);
            string? Text(string property) => error.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            return (Text("code"), Text("message"));
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    private static RpcException Failed(string code, string message) =>
        new(RpcException.OperationFailed, message, NodeErrors.Mapped((NodeErrors.FirstSentence(message), false), message, code, null));
}
