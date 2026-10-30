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

    // --- Sign-in before open ------------------------------------------------------------------------

    private static ConnectionConfig Entra => new("e1", "entra", ConnectionKinds.Sql, "sql.example.invalid", AuthKinds.Entra, Database: "app");

    [Fact]
    public async Task Sign_in_asks_for_the_sql_scope_under_the_request_token()
    {
        IReadOnlyList<string>? scopes = null;
        CancellationToken seen = default;
        var prompt = new TaskCompletionSource<AccessToken>();
        var credential = new FakeCredential((context, ct) =>
        {
            scopes = context.Scopes;
            seen = ct;
            return prompt.Task;
        });
        using var request = new CancellationTokenSource();

        var signIn = SqlBackend.SignInAsync(credential, SqlBackend.SignInBudget, Entra, "app", request.Token);

        Assert.Equal(["https://database.windows.net/.default"], scopes);
        Assert.False(seen.IsCancellationRequested);
        request.Cancel();
        Assert.True(seen.IsCancellationRequested);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => signIn);
        Assert.Equal(1, credential.Calls);
    }

    [Fact]
    public async Task Sign_in_waits_for_a_slow_prompt_that_the_connect_budget_would_cut_off()
    {
        // Scaled down: a 200 ms connect budget stands in for SqlClient's 15 s, the prompt takes longer than that.
        Assert.True(SqlBackend.SignInBudget >= TimeSpan.FromMinutes(2), "a person needs minutes for device code");
        var prompt = new TaskCompletionSource<AccessToken>();
        var credential = new FakeCredential((_, _) => prompt.Task);
        using var connectBudget = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        await Assert.ThrowsAsync<TimeoutException>(() => SqlBackend.TokenCallback(credential)(Params(), connectBudget.Token));

        var signIn = SqlBackend.SignInAsync(credential, SqlBackend.SignInBudget, Entra, "app", CancellationToken.None);
        await Task.Delay(500);
        Assert.False(signIn.IsCompleted);
        prompt.SetResult(new AccessToken("tok", DateTimeOffset.UtcNow.AddHours(1)));
        await signIn.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Cancelling_the_request_cancels_sign_in_even_if_the_credential_ignores_it()
    {
        var never = new TaskCompletionSource<AccessToken>();
        var credential = new FakeCredential((_, _) => never.Task);
        using var request = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                SqlBackend.SignInAsync(credential, SqlBackend.SignInBudget, Entra, "app", request.Token))
            .WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Sign_in_that_outlasts_the_budget_is_a_retryable_sign_in_node_error()
    {
        var never = new TaskCompletionSource<AccessToken>();
        var credential = new FakeCredential((_, _) => never.Task);

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
                SqlBackend.SignInAsync(credential, TimeSpan.FromMilliseconds(200), Entra, "app", CancellationToken.None))
            .WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(RpcException.OperationFailed, ex.Code);
        Assert.Contains("sign-in", ex.Message);
        Assert.NotNull(ex.NodeError);
        Assert.Equal("signin-timeout", ex.NodeError.Code);
        Assert.Contains("sign-in", ex.NodeError.Summary);
        Assert.True(ex.NodeError.Retryable);
        Assert.Contains("Server: sql.example.invalid", ex.NodeError.Detail);
    }

    [Fact]
    public async Task Sign_in_with_a_cached_token_is_one_quick_call_per_open()
    {
        var credential = new FakeCredential((_, _) => Task.FromResult(new AccessToken("tok", DateTimeOffset.UtcNow.AddHours(1))));
        var clock = System.Diagnostics.Stopwatch.StartNew();
        for (var i = 0; i < 1000; i++)
            await SqlBackend.SignInAsync(credential, SqlBackend.SignInBudget, Entra, "app", CancellationToken.None);
        Assert.Equal(1000, credential.Calls);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(1), $"1000 cached sign-ins took {clock.Elapsed}");
    }

    [Fact]
    public async Task Open_signs_in_with_the_tenant_credential_and_request_token_before_connecting()
    {
        using var request = new CancellationTokenSource();
        string? tenant = null;
        var credential = new FakeCredential((_, ct) =>
        {
            // Cancel here so the open stops before any network; the token proves it was the request's.
            request.Cancel();
            Assert.True(ct.IsCancellationRequested);
            return Task.FromResult(new AccessToken("tok", DateTimeOffset.UtcNow.AddHours(1)));
        });
        var backend = new SqlBackend(new Credentials(_ => { }, t => { tenant = t; return credential; }));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            backend.OpenAsync(Entra with { TenantId = " 00000000-0000-0000-0000-000000000001 " }, null, "app", request.Token));
        Assert.Equal(1, credential.Calls);
        Assert.Equal("00000000-0000-0000-0000-000000000001", tenant);
    }

    [Theory]
    [InlineData(AuthKinds.Sql)]
    [InlineData(AuthKinds.Windows)]
    public async Task Open_without_entra_never_touches_the_credential(string auth)
    {
        var credential = new FakeCredential((_, _) => throw new InvalidOperationException("no sign-in expected"));
        var backend = new SqlBackend(new Credentials(_ => { }, _ => credential));
        using var request = new CancellationTokenSource();
        request.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            backend.OpenAsync(Entra with { Auth = auth, User = "sa" }, "pw", "app", request.Token));
        Assert.Equal(0, credential.Calls);
    }

    private sealed class FakeCredential(Func<TokenRequestContext, CancellationToken, Task<AccessToken>> get) : TokenCredential
    {
        private int _calls;
        public int Calls => _calls;

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            return new(get(requestContext, cancellationToken));
        }

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            get(requestContext, cancellationToken).GetAwaiter().GetResult();
    }
}
