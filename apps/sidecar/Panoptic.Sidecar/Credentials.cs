using System.Collections.Concurrent;
using Azure.Core;
using Azure.Identity;
using Azure.Identity.Broker;

namespace Panoptic.Sidecar;

/// <summary>
/// One Entra credential per tenant, shared by SQL and Cosmos connections (ADR 0007).
/// Tries the WAM broker first, which can reuse the account signed in to Windows silently, and
/// falls back to device-code flow if the broker is unavailable. Tokens are cached by MSAL in the
/// user profile, encrypted with DPAPI.
/// </summary>
public sealed class Credentials(Action<DeviceCodePrompt> onDeviceCode)
{
    private readonly ConcurrentDictionary<string, TokenCredential> _byTenant = new();

    public TokenCredential For(string? tenantId) =>
        _byTenant.GetOrAdd(string.IsNullOrWhiteSpace(tenantId) ? "" : tenantId.Trim(), Create);

    private TokenCredential Create(string tenantId)
    {
        var tenant = tenantId.Length == 0 ? null : tenantId;
        var cache = new TokenCachePersistenceOptions { Name = "panoptic" };

        var broker = new InteractiveBrowserCredential(new InteractiveBrowserCredentialBrokerOptions(ParentWindow())
        {
            TenantId = tenant,
            TokenCachePersistenceOptions = cache,
            UseDefaultBrokerAccount = true,
        });

        var deviceCode = new DeviceCodeCredential(new DeviceCodeCredentialOptions
        {
            TenantId = tenant,
            TokenCachePersistenceOptions = cache,
            DeviceCodeCallback = (info, _) =>
            {
                onDeviceCode(new DeviceCodePrompt(info.Message, info.UserCode, info.VerificationUri.ToString()));
                return Task.CompletedTask;
            },
        });

        return new FallbackCredential(broker, deviceCode);
    }

    /// <summary>The Tauri window handle, passed by the shell so WAM dialogs parent to it.</summary>
    private static IntPtr ParentWindow() =>
        long.TryParse(Environment.GetEnvironmentVariable("PANOPTIC_PARENT_HWND"), out var hwnd) ? new IntPtr(hwnd) : IntPtr.Zero;

    /// <summary>Uses the primary credential until it fails once, then the fallback from then on.</summary>
    private sealed class FallbackCredential(TokenCredential primary, TokenCredential fallback) : TokenCredential
    {
        private volatile bool _primaryFailed;

        public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext context, CancellationToken cancellationToken)
        {
            if (!_primaryFailed)
            {
                try
                {
                    return await primary.GetTokenAsync(context, cancellationToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    Console.Error.WriteLine($"WAM sign-in failed, falling back to device code: {ex.Message}");
                    _primaryFailed = true;
                }
            }
            return await fallback.GetTokenAsync(context, cancellationToken);
        }

        public override AccessToken GetToken(TokenRequestContext context, CancellationToken cancellationToken) =>
            GetTokenAsync(context, cancellationToken).AsTask().GetAwaiter().GetResult();
    }
}
