using System.Collections.Concurrent;
using Azure.Core;
using Azure.Identity;
using Azure.Identity.Broker;
using Microsoft.Identity.Client;

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

    /// <summary>
    /// Uses the primary (broker) credential until it reports the broker cannot run in this process, then
    /// the fallback from then on. Any other failure (dialog closed, network, cancellation) is rethrown so
    /// the next attempt tries the broker again.
    /// </summary>
    internal sealed class FallbackCredential(TokenCredential primary, TokenCredential fallback) : TokenCredential
    {
        private volatile bool _primaryUnavailable;

        public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext context, CancellationToken cancellationToken)
        {
            if (!_primaryUnavailable)
            {
                try
                {
                    return await primary.GetTokenAsync(context, cancellationToken);
                }
                catch (Exception ex) when (IsBrokerUnavailable(ex))
                {
                    Console.Error.WriteLine($"WAM sign-in unavailable, falling back to device code: {ex.Message}");
                    _primaryUnavailable = true;
                }
            }
            return await fallback.GetTokenAsync(context, cancellationToken);
        }

        /// <summary>
        /// A standalone InteractiveBrowserCredential wraps every MSAL error in AuthenticationFailedException,
        /// so "broker unavailable" is told apart by the inner MSAL error code, not the exception type:
        /// the WAM runtime failed to load, no parent window handle, or WAM rejected the configuration
        /// (MSAL marks that one non-retryable). If WAM is simply not supported on the OS, MSAL itself
        /// falls back to the system browser and nothing is thrown.
        /// </summary>
        private static bool IsBrokerUnavailable(Exception ex) =>
            ex is CredentialUnavailableException
            || ex is AuthenticationFailedException { InnerException: MsalException msal }
                && (msal.ErrorCode is "wam_runtime_init_failed" or "window_handle_required"
                    || msal.ErrorCode?.StartsWith("WAM_provider_error_", StringComparison.Ordinal) == true);

        public override AccessToken GetToken(TokenRequestContext context, CancellationToken cancellationToken) =>
            GetTokenAsync(context, cancellationToken).AsTask().GetAwaiter().GetResult();
    }
}
