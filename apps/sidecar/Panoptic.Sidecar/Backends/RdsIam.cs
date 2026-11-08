using System.Text.RegularExpressions;
using Amazon;
using Amazon.Runtime;
using Amazon.Runtime.CredentialManagement;
using Amazon.Runtime.Credentials;
using Amazon.Runtime.Signing;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Postgres sign-in to Amazon RDS and Aurora with an IAM token (#121, docs/plans/2026-11-08-postgres-rds-iam-design.md).
/// The token is a SigV4-presigned <c>connect</c> request for one host, port and database user, signed with the
/// caller's AWS credentials and sent as the password. It is valid for 15 minutes and only checked when a connection
/// opens, so each physical open signs a new one. Signing is local; only resolving the credentials may call AWS.
/// </summary>
public static partial class RdsIam
{
    /// <summary>How long a token is valid: the most RDS accepts.</summary>
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(15);

    private const string Service = "rds-db";

    /// <summary>The public and partition suffixes of an RDS endpoint: commercial and GovCloud, then China.</summary>
    private static readonly string[] RdsSuffixes = [".rds.amazonaws.com", ".rds.amazonaws.com.cn"];

    [GeneratedRegex(@"^[a-z]{2}(-[a-z]+)+-\d+$")]
    private static partial Regex RegionName();

    /// <summary>An AWS region name such as eu-west-2, us-gov-west-1 or cn-north-1.</summary>
    public static bool IsRegion(string? region) => region is not null && RegionName().IsMatch(region);

    /// <summary>
    /// The region in an RDS host name, <c>&lt;name&gt;.&lt;id&gt;.&lt;region&gt;.rds.amazonaws.com</c>, which also
    /// covers cluster, reader and proxy endpoints (their id starts cluster-, cluster-ro- or proxy-). Null for any
    /// other name: a tunnel, localhost or a custom DNS name needs the region set.
    /// </summary>
    public static string? RegionFromHost(string? host)
    {
        var name = host?.Trim().TrimEnd('.').ToLowerInvariant() ?? "";
        foreach (var suffix in RdsSuffixes)
        {
            if (!name.EndsWith(suffix, StringComparison.Ordinal)) continue;
            var labels = name[..^suffix.Length].Split('.');
            return labels.Length >= 3 && IsRegion(labels[^1]) ? labels[^1] : null;
        }
        return null;
    }

    /// <summary>
    /// The host and port a token is signed for: the endpoint's, or the certificate host name's when it is set. That
    /// name already names the real RDS host for TLS when the endpoint is a tunnel or another DNS name, and RDS checks
    /// the token against its own name.
    /// </summary>
    public static (string Host, int Port) SigningTarget(ConnectionConfig c)
    {
        var (host, port) = PostgresBackend.ParseEndpoint(c.Endpoint);
        return (string.IsNullOrWhiteSpace(c.CertificateHostName) ? host : c.CertificateHostName.Trim(), port);
    }

    /// <summary>The region a token is signed for: the one set, else the one in the signing host's name, else null.</summary>
    public static string? Region(ConnectionConfig c) =>
        string.IsNullOrWhiteSpace(c.AwsRegion) ? RegionFromHost(SigningTarget(c).Host) : c.AwsRegion.Trim();

    /// <summary>Whether the connection reaches an RDS host, for the certificate bundle hint. Never throws.</summary>
    public static bool IsRdsServer(ConnectionConfig c)
    {
        try
        {
            return RegionFromHost(SigningTarget(c).Host) is not null;
        }
        catch (RpcException)
        {
            return false;
        }
    }

    private static string? Profile(ConnectionConfig c) => string.IsNullOrWhiteSpace(c.AwsProfile) ? null : c.AwsProfile.Trim();

    /// <summary>
    /// The token: the presigned request without its scheme (<c>host:port/?Action=connect&amp;DBUser=...</c>), as
    /// AWSSDK.RDS's RDSAuthTokenGenerator makes it, through the same AWSSDK.Core presigner.
    /// </summary>
    /// <param name="signedAt">The signing time; the current time when null. Fixed only by tests.</param>
    public static string Token(ImmutableCredentials keys, string region, string host, int port, string user, DateTime? signedAt = null)
    {
        var request = new AWSSigningRequest
        {
            HttpMethod = HttpMethod.Get,
            RequestUri = new UriBuilder(Uri.UriSchemeHttps, host, port) { Query = $"Action=connect&DBUser={Uri.EscapeDataString(user)}" }.Uri,
        };
        var parameters = new AWSSigV4Parameters
        {
            // Already resolved, so wrapped as credentials that never refresh: the presigner only reads them back.
            Credentials = keys.UseToken ? new SessionAWSCredentials(keys.AccessKey, keys.SecretKey, keys.Token) : new BasicAWSCredentials(keys.AccessKey, keys.SecretKey),
            Region = RegionEndpoint.GetBySystemName(region),
            Service = Service,
            SignedAt = signedAt,
        };
        var uri = AWSSigV4Signer.Presign(request, parameters, TokenLifetime).Uri.AbsoluteUri;
        return uri[$"{Uri.UriSchemeHttps}{Uri.SchemeDelimiter}".Length..];
    }

    /// <summary>
    /// The connection's AWS credentials: the named profile from the shared AWS config and credentials files, or the
    /// SDK's default chain (environment variables, then the default profile) when none is named. Not yet resolved:
    /// an SSO or assume-role profile only calls AWS when its keys are asked for.
    /// </summary>
    public static AWSCredentials CredentialsFor(ConnectionConfig c, string? database)
    {
        var profile = Profile(c);
        if (profile is null)
        {
            try
            {
                return DefaultAWSCredentialsIdentityResolver.GetCredentials(null);
            }
            catch (AmazonClientException ex)
            {
                throw ToRpc(ex, c, database, sso: false);
            }
        }
        if (new CredentialProfileStoreChain().TryGetAWSCredentials(profile, out var credentials)) return credentials;

        var summary = $"AWS profile '{profile}' was not found. Check its name in your AWS config file.";
        var detail = $"No profile named '{profile}' in the AWS config or credentials file (AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE, else the .aws folder in your user profile).";
        throw new RpcException(RpcException.OperationFailed, summary, NodeErrors.Mapped((summary, false), detail, "aws-profile", Extra(c, database)));
    }

    /// <summary>
    /// A failure to get AWS credentials, in plain words: an expired IAM Identity Center (SSO) session says how to log
    /// in again (Panoptic does not open the SSO login itself), and no credentials at all say where they come from.
    /// The SDK's own message is the detail.
    /// </summary>
    public static RpcException ToRpc(Exception ex, ConnectionConfig c, string? database, bool sso)
    {
        var profile = Profile(c);
        var (summary, code) = sso
            ? ($"The AWS SSO session has expired. Run aws sso login --profile {profile ?? Environment.GetEnvironmentVariable("AWS_PROFILE") ?? "default"}, then retry.", "aws-sso")
            : profile is null
                ? ("No AWS credentials found. Choose an AWS profile, or set up the default one with the AWS CLI.", "aws-credentials")
                : ($"AWS sign-in failed for profile {profile}. Check the profile in your AWS config.", "aws-sign-in");
        return new RpcException(RpcException.OperationFailed, summary, NodeErrors.Mapped((summary, false), ex.Message, code, Extra(c, database)));
    }

    private static string Extra(ConnectionConfig c, string? database) =>
        NodeErrors.Lines(("Server", c.Endpoint), ("Database", database), ("Identity", NodeErrors.Identity(c)));

    /// <summary>
    /// One connection's signing: its region, the host and port tokens are signed for, and its credentials, looked up
    /// once and then cached and refreshed by the SDK.
    /// </summary>
    public sealed class Signer
    {
        private readonly ConnectionConfig _connection;
        private AWSCredentials? _credentials;

        public Signer(ConnectionConfig c)
        {
            _connection = c;
            Target = SigningTarget(c);
            Region = RdsIam.Region(c) ?? throw new RpcException(RpcException.InvalidParams,
                $"Enter the AWS region: it can't be read from the server name {Target.Host}.");
        }

        public string Region { get; }

        public (string Host, int Port) Target { get; }

        /// <summary>
        /// Gets the keys before connecting, under the request's cancellation and <paramref name="budget"/>, as Entra
        /// sign-in does (<see cref="PostgresBackend.SignInAsync"/>): an SSO or assume-role refresh can outlast the 15 s
        /// connect timeout, and the password provider Npgsql then calls is a cache hit.
        /// </summary>
        public async Task SignInAsync(TimeSpan budget, string? database, CancellationToken ct)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(budget);
            try
            {
                // On the thread pool: the default chain can block on the instance metadata service.
                await Task.Run(() => KeysAsync(database), cts.Token).WaitAsync(cts.Token);
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                var message = $"AWS sign-in did not finish within {budget.TotalMinutes:0.#} minutes. Check the network and the AWS profile, then retry.";
                throw new RpcException(RpcException.OperationFailed, message,
                    NodeErrors.Mapped(("AWS sign-in timed out. Check the network, then retry.", true), message, "signin-timeout", Extra(_connection, database)));
            }
        }

        /// <summary>A new token for <paramref name="user"/>, for one physical open.</summary>
        public async ValueTask<string> TokenAsync(string user, string? database) =>
            Token(await KeysAsync(database), Region, Target.Host, Target.Port, user);

        private async Task<ImmutableCredentials> KeysAsync(string? database)
        {
            var credentials = _credentials ??= CredentialsFor(_connection, database);
            try
            {
                // Refreshed early if they would expire before the token does, as RDSAuthTokenGenerator does.
                return credentials is RefreshingAWSCredentials refreshing
                    ? await refreshing.GetCredentialsAsync(TokenLifetime)
                    : await credentials.GetCredentialsAsync();
            }
            catch (Exception ex) when (ex is not OperationCanceledException and not RpcException)
            {
                throw ToRpc(ex, _connection, database, sso: credentials is SSOAWSCredentials);
            }
        }
    }
}
