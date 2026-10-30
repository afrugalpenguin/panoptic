using Azure.Core;
using Microsoft.Data.SqlClient;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

public class SqlTokenCallbackTests
{
    // The callback asks for a fixed scope and ignores what SqlClient passes here.
    private static SqlAuthenticationParameters Params() => null!;

    [Fact]
    public void Same_tenant_reuses_one_callback_so_sqlclient_reuses_one_pool()
    {
        // SqlClient's pool key compares the callback with ==, so each open must hand it the same delegate.
        var backend = new SqlBackend(new Credentials(_ => { }));
        var first = backend.TokenCallbackFor("00000000-0000-0000-0000-000000000001");
        var second = backend.TokenCallbackFor(" 00000000-0000-0000-0000-000000000001 ");
        Assert.Same(first, second);
        Assert.Same(backend.TokenCallbackFor(null), backend.TokenCallbackFor(""));
    }

    [Fact]
    public void Different_tenants_get_different_callbacks()
    {
        var backend = new SqlBackend(new Credentials(_ => { }));
        Assert.NotSame(backend.TokenCallbackFor("00000000-0000-0000-0000-000000000001"), backend.TokenCallbackFor("00000000-0000-0000-0000-000000000002"));
        Assert.NotSame(backend.TokenCallbackFor(null), backend.TokenCallbackFor("00000000-0000-0000-0000-000000000001"));
    }

    [Fact]
    public async Task Callback_returns_the_credential_token_for_the_sql_scope()
    {
        var expires = DateTimeOffset.UtcNow.AddHours(1);
        var credential = new FakeCredential((context, _) =>
        {
            Assert.Equal(["https://database.windows.net/.default"], context.Scopes);
            return Task.FromResult(new AccessToken("tok", expires));
        });

        var token = await SqlBackend.TokenCallback(credential)(Params(), CancellationToken.None);
        Assert.Equal("tok", token.AccessToken);
        Assert.Equal(expires, token.ExpiresOn);
    }

    [Fact]
    public async Task Callback_gives_up_with_a_clear_error_when_sqlclient_cancels_even_if_the_credential_ignores_it()
    {
        // A sign-in prompt nobody answers, from a credential that never observes cancellation.
        var never = new TaskCompletionSource<AccessToken>();
        var credential = new FakeCredential((_, _) => never.Task);
        using var connectBudget = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        var ex = await Assert.ThrowsAsync<TimeoutException>(() => SqlBackend.TokenCallback(credential)(Params(), connectBudget.Token))
            .WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Contains("sign-in", ex.Message);
    }

    [Fact]
    public async Task Callback_passes_sqlclient_cancellation_to_the_credential()
    {
        CancellationToken seen = default;
        var credential = new FakeCredential(async (_, ct) =>
        {
            seen = ct;
            await Task.Delay(Timeout.Infinite, ct);
            throw new InvalidOperationException("unreachable");
        });
        using var connectBudget = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        await Assert.ThrowsAsync<TimeoutException>(() => SqlBackend.TokenCallback(credential)(Params(), connectBudget.Token));
        Assert.Equal(connectBudget.Token, seen);
    }

    private sealed class FakeCredential(Func<TokenRequestContext, CancellationToken, Task<AccessToken>> get) : TokenCredential
    {
        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new(get(requestContext, cancellationToken));

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            get(requestContext, cancellationToken).GetAwaiter().GetResult();
    }
}
