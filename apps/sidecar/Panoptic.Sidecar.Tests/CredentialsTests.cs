using Azure.Core;
using Azure.Identity;
using Microsoft.Identity.Client;
using Panoptic.Sidecar;

namespace Panoptic.Sidecar.Tests;

public class CredentialsTests
{
    private static readonly TokenRequestContext Context = new(["https://database.windows.net/.default"]);
    private static readonly AccessToken BrokerToken = new("broker", DateTimeOffset.UtcNow.AddHours(1));
    private static readonly AccessToken DeviceCodeToken = new("device-code", DateTimeOffset.UtcNow.AddHours(1));

    /// <summary>Returns its token, or throws the next queued exception. Counts calls.</summary>
    private sealed class FakeCredential(AccessToken token, params Exception[] failures) : TokenCredential
    {
        private readonly Queue<Exception> _failures = new(failures);
        public int Calls { get; private set; }

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext context, CancellationToken cancellationToken)
        {
            Calls++;
            return _failures.TryDequeue(out var ex) ? ValueTask.FromException<AccessToken>(ex) : ValueTask.FromResult(token);
        }

        public override AccessToken GetToken(TokenRequestContext context, CancellationToken cancellationToken) =>
            GetTokenAsync(context, cancellationToken).AsTask().GetAwaiter().GetResult();
    }

    /// <summary>What a standalone InteractiveBrowserCredential throws: MSAL errors wrapped in AuthenticationFailedException.</summary>
    private static AuthenticationFailedException Wrapped(MsalException inner) =>
        new($"InteractiveBrowserCredential authentication failed: {inner.Message}", inner);

    [Fact]
    public async Task Broker_success_never_touches_device_code()
    {
        var broker = new FakeCredential(BrokerToken);
        var deviceCode = new FakeCredential(DeviceCodeToken);
        var credential = new Credentials.FallbackCredential(broker, deviceCode);

        Assert.Equal("broker", (await credential.GetTokenAsync(Context, default)).Token);
        Assert.Equal("broker", (await credential.GetTokenAsync(Context, default)).Token);
        Assert.Equal(2, broker.Calls);
        Assert.Equal(0, deviceCode.Calls);
    }

    public static TheoryData<Exception> Unavailable => new()
    {
        new CredentialUnavailableException("broker unavailable"),
        Wrapped(new MsalClientException("wam_runtime_init_failed", "Unable to load DLL 'msalruntime'.")),
        Wrapped(new MsalClientException("window_handle_required", "A window handle must be configured.")),
        Wrapped(new MsalServiceException("WAM_provider_error_3399614473", "IncorrectConfiguration")),
    };

    [Theory]
    [MemberData(nameof(Unavailable))]
    public async Task Broker_unavailable_falls_back_and_stays_on_device_code(Exception unavailable)
    {
        var broker = new FakeCredential(BrokerToken, unavailable);
        var deviceCode = new FakeCredential(DeviceCodeToken);
        var credential = new Credentials.FallbackCredential(broker, deviceCode);

        Assert.Equal("device-code", (await credential.GetTokenAsync(Context, default)).Token);
        Assert.Equal("device-code", (await credential.GetTokenAsync(Context, default)).Token);
        Assert.Equal(1, broker.Calls);
        Assert.Equal(2, deviceCode.Calls);
    }

    public static TheoryData<Exception> Retryable => new()
    {
        // User closed the WAM dialog.
        Wrapped(new MsalClientException("authentication_canceled", "User canceled authentication.")),
        // WAM NoNetwork / NetworkTemporarilyUnavailable.
        Wrapped(new MsalServiceException("2148073494", "Possible cause: no Internet connection")),
        new AuthenticationFailedException("InteractiveBrowserCredential authentication failed: connection reset", new HttpRequestException("connection reset")),
        new OperationCanceledException(),
    };

    [Theory]
    [MemberData(nameof(Retryable))]
    public async Task Broker_failure_is_rethrown_and_the_broker_is_tried_again(Exception failure)
    {
        var broker = new FakeCredential(BrokerToken, failure);
        var deviceCode = new FakeCredential(DeviceCodeToken);
        var credential = new Credentials.FallbackCredential(broker, deviceCode);

        var thrown = await Assert.ThrowsAnyAsync<Exception>(() => credential.GetTokenAsync(Context, default).AsTask());
        Assert.Same(failure, thrown);

        Assert.Equal("broker", (await credential.GetTokenAsync(Context, default)).Token);
        Assert.Equal(2, broker.Calls);
        Assert.Equal(0, deviceCode.Calls);
    }

    [Fact]
    public void Sync_GetToken_follows_the_same_rule()
    {
        var broker = new FakeCredential(BrokerToken, new CredentialUnavailableException("broker unavailable"));
        var deviceCode = new FakeCredential(DeviceCodeToken);
        var credential = new Credentials.FallbackCredential(broker, deviceCode);

        Assert.Equal("device-code", credential.GetToken(Context, default).Token);
        Assert.Equal(1, deviceCode.Calls);
    }

    [Fact]
    public void One_credential_per_tenant_and_client_id()
    {
        var made = new List<CredentialKey>();
        var credentials = new Credentials(_ => { }, k => { made.Add(k); return new FakeCredential(new AccessToken("t", DateTimeOffset.UtcNow.AddHours(1))); });
        const string Tenant = "00000000-0000-0000-0000-000000000001";
        const string ClientA = "11111111-1111-1111-1111-111111111111";

        var plain = credentials.For(Tenant);
        Assert.Same(plain, credentials.For(Tenant, null));
        Assert.Same(plain, credentials.For(Tenant, "  "));
        var a = credentials.For(Tenant, ClientA);
        Assert.Same(a, credentials.For(Tenant, $" {ClientA} "));
        Assert.NotSame(plain, a);
        Assert.Equal([new CredentialKey(Tenant, null), new CredentialKey(Tenant, ClientA)], made);
    }
}

public sealed class ClientIdValidationTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");
    public void Dispose() { if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true); }

    private TreeService Tree() => new(new ConfigStore(Path.Combine(_dir, "store.bin")), Panoptic.Sidecar.Backends.BackendRegistry.Create(new Credentials(_ => { })));
    private static readonly ConnectionConfig EntraSql = new("c1", "Fabrikam", ConnectionKinds.Sql, "orders.fabrikam.test", AuthKinds.Entra);

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("11111111-1111-1111-1111-11111111111")]
    [InlineData("https://evil.example/11111111-1111-1111-1111-111111111111")]
    public void A_client_id_that_is_not_a_guid_is_refused(string clientId)
    {
        var ex = Assert.Throws<RpcException>(() => Tree().Validate(EntraSql with { ClientId = clientId }));
        Assert.Contains("client id", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" 11111111-2222-3333-4444-555555555555 ")]
    public void Blank_or_a_guid_is_accepted(string? clientId)
    {
        Tree().Validate(EntraSql with { ClientId = clientId });
    }
}