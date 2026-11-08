using System.Security.Authentication;
using Amazon.Runtime;
using Npgsql;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Postgres sign-in to Amazon RDS with an IAM token (#121): a SigV4-presigned connect request for the host, port and
/// user, signed with the AWS credentials of a profile, as the password. Nothing here calls AWS or reads the machine's
/// own AWS config: profiles come from synthetic files, and the keys are AWS's documented examples.
/// </summary>
public sealed class RdsIamTests(RdsIamTests.SyntheticAwsFiles aws) : IClassFixture<RdsIamTests.SyntheticAwsFiles>
{
    private const string Host = "orders.abc123example.eu-west-2.rds.amazonaws.com";
    private const string AccessKey = "AKIAIOSFODNN7EXAMPLE";
    private const string SecretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    private static readonly DateTime SignedAt = new(2026, 11, 8, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// Points the AWS SDK at synthetic config and credentials files, never the machine's own. Written once for the
    /// class: the SDK keeps the files' location once it has read them.
    /// </summary>
    public sealed class SyntheticAwsFiles : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");
        private readonly Dictionary<string, string?> _env = [];

        public SyntheticAwsFiles()
        {
            Directory.CreateDirectory(_dir);
            Write("AWS_CONFIG_FILE", "config", "[profile orders-ro]\nregion = eu-west-2\n");
            Write("AWS_SHARED_CREDENTIALS_FILE", "credentials", $"[orders-ro]\naws_access_key_id = {AccessKey}\naws_secret_access_key = {SecretKey}\n");
        }

        private void Write(string variable, string name, string text)
        {
            var path = Path.Combine(_dir, name);
            File.WriteAllText(path, text);
            _env.TryAdd(variable, Environment.GetEnvironmentVariable(variable));
            Environment.SetEnvironmentVariable(variable, path);
        }

        public void Dispose()
        {
            foreach (var (name, value) in _env) Environment.SetEnvironmentVariable(name, value);
            if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
        }
    }

    private static ConnectionConfig Iam(string endpoint = Host, string? user = "reader", string? profile = null, string? region = null) =>
        new("c1", "Orders", ConnectionKinds.Postgres, endpoint, AuthKinds.AwsIam, User: user, AwsProfile: profile, AwsRegion: region);

    private static TreeService Tree() => new(null!, BackendRegistry.Create(new Credentials(_ => { })));

    private static ImmutableCredentials Keys => new(AccessKey, SecretKey, null);

    // --- Region from the host name ----------------------------------------------------------------------

    [Theory]
    [InlineData("orders.abc123example.eu-west-2.rds.amazonaws.com", "eu-west-2")]
    [InlineData("orders.cluster-abc123example.us-east-1.rds.amazonaws.com", "us-east-1")]
    [InlineData("orders.cluster-ro-abc123example.ap-southeast-2.rds.amazonaws.com", "ap-southeast-2")]
    [InlineData("orders-proxy.proxy-abc123example.eu-central-1.rds.amazonaws.com", "eu-central-1")]
    [InlineData("orders.abc123example.cn-north-1.rds.amazonaws.com.cn", "cn-north-1")]
    [InlineData("orders.abc123example.us-gov-west-1.rds.amazonaws.com", "us-gov-west-1")]
    [InlineData("Orders.ABC123EXAMPLE.EU-WEST-2.RDS.AMAZONAWS.COM.", "eu-west-2")]
    public void The_region_is_read_from_an_RDS_host_name(string host, string region)
    {
        Assert.Equal(region, RdsIam.RegionFromHost(host));
    }

    [Theory]
    [InlineData("localhost")]
    [InlineData("127.0.0.1")]
    [InlineData("orders.example.test")]
    [InlineData("rds.amazonaws.com")]
    [InlineData("eu-west-2.rds.amazonaws.com")]
    [InlineData("orders.abc123example.not_a_region.rds.amazonaws.com")]
    [InlineData("orders.abc123example.eu-west-2.rds.amazonaws.com.example.test")]
    public void Other_host_names_have_no_region(string host)
    {
        Assert.Null(RdsIam.RegionFromHost(host));
    }

    [Fact]
    public void A_set_region_wins_and_a_tunnel_signs_for_the_certificate_host_name()
    {
        Assert.Equal("us-east-1", RdsIam.Region(Iam(region: "us-east-1")));
        Assert.Equal("eu-west-2", RdsIam.Region(Iam()));
        Assert.Null(RdsIam.Region(Iam("localhost:5432")));

        var tunnel = Iam("localhost:5432") with { CertificateHostName = Host };
        Assert.Equal((Host, 5432), RdsIam.SigningTarget(tunnel));
        Assert.Equal("eu-west-2", RdsIam.Region(tunnel));
        Assert.Equal(("localhost", 5432), RdsIam.SigningTarget(Iam("localhost:5432")));
    }

    // --- The token ---------------------------------------------------------------------------------------

    [Fact]
    public void The_token_is_a_presigned_connect_request_for_the_host_port_and_user()
    {
        var token = RdsIam.Token(Keys, "eu-west-2", Host, 5432, "reader", SignedAt);

        // Checked against the AWS SDK's own presigner with the same inputs: a change here breaks every sign-in.
        Assert.Equal(
            $"{Host}:5432/?Action=connect&DBUser=reader&X-Amz-Expires=900&X-Amz-Algorithm=AWS4-HMAC-SHA256" +
            "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261108%2Feu-west-2%2Frds-db%2Faws4_request&X-Amz-Date=20261108T120000Z" +
            "&X-Amz-SignedHeaders=host&X-Amz-Signature=775044dd78ebeabf6ecedf515af519126a353d121e3ed26a77cfdf70da2542e5",
            token);
    }

    [Fact]
    public void The_token_has_no_scheme_and_carries_every_signing_field()
    {
        var token = RdsIam.Token(Keys, "us-gov-west-1", "orders.abc123example.us-gov-west-1.rds.amazonaws.com", 6432, "app user@example.test", SignedAt);

        Assert.StartsWith("orders.abc123example.us-gov-west-1.rds.amazonaws.com:6432/?", token);
        Assert.DoesNotContain("://", token);
        Assert.Contains("Action=connect", token);
        Assert.Contains("DBUser=app%20user%40example.test", token);
        Assert.Contains("X-Amz-Expires=900", token);
        Assert.Contains("X-Amz-Algorithm=AWS4-HMAC-SHA256", token);
        Assert.Contains("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261108%2Fus-gov-west-1%2Frds-db%2Faws4_request", token);
        Assert.Contains("X-Amz-Date=20261108T120000Z", token);
        Assert.Contains("X-Amz-SignedHeaders=host", token);
        Assert.Matches("X-Amz-Signature=[0-9a-f]{64}$", token);
        Assert.DoesNotContain(SecretKey, token);
    }

    [Fact]
    public void Temporary_credentials_add_their_session_token()
    {
        var token = RdsIam.Token(new ImmutableCredentials("ASIAIOSFODNN7EXAMPLE", SecretKey, "FQoGZXIvYXdzEXAMPLETOKEN"), "eu-west-2", Host, 5432, "reader", SignedAt);

        Assert.Contains("X-Amz-Security-Token=FQoGZXIvYXdzEXAMPLETOKEN", token);
    }

    [Fact]
    public void The_connection_string_carries_no_password()
    {
        var settings = PostgresBackend.Settings(Iam(), null, "reader");

        Assert.Equal("reader", settings.Username);
        Assert.Null(settings.Password);
        Assert.Equal(SslMode.VerifyFull, settings.SslMode);
    }

    // --- Profiles ----------------------------------------------------------------------------------------

    [Fact]
    public void A_named_profile_is_read_from_the_shared_AWS_files()
    {
        Assert.NotNull(aws);

        var credentials = RdsIam.CredentialsFor(Iam(profile: "orders-ro"), null);

        Assert.Equal(AccessKey, credentials.GetCredentials().AccessKey);
    }

    [Fact]
    public void A_missing_profile_is_named_in_its_own_message()
    {
        Assert.NotNull(aws);

        var ex = Assert.Throws<RpcException>(() => RdsIam.CredentialsFor(Iam(profile: "orders-rw"), "orders"));

        Assert.Contains("'orders-rw'", ex.Message);
        Assert.Equal("aws-profile", ex.NodeError!.Code);
        Assert.Contains("orders-rw", ex.NodeError.Summary);
        Assert.False(ex.NodeError.Retryable);
    }

    // --- Errors ------------------------------------------------------------------------------------------

    [Fact]
    public void An_expired_SSO_session_says_to_log_in_with_the_profile()
    {
        var ex = RdsIam.ToRpc(new AmazonClientException("No valid SSO Token could be found."), Iam(profile: "orders-sso"), "orders", sso: true);

        Assert.Equal("aws-sso", ex.NodeError!.Code);
        Assert.Contains("aws sso login --profile orders-sso", ex.NodeError.Summary);
        Assert.Contains("aws sso login --profile orders-sso", ex.Message);
        Assert.Contains("No valid SSO Token could be found.", ex.NodeError.Detail);
        Assert.Contains("Server: " + Host, ex.NodeError.Detail);
    }

    [Fact]
    public void No_credentials_at_all_get_their_own_message()
    {
        var ex = RdsIam.ToRpc(new AmazonClientException("Failed to resolve AWS credentials."), Iam(), null, sso: false);

        Assert.Equal("aws-credentials", ex.NodeError!.Code);
        Assert.Contains("No AWS credentials", ex.NodeError.Summary);
        Assert.Contains("Failed to resolve AWS credentials.", ex.NodeError.Detail);
    }

    [Fact]
    public void A_profile_that_fails_otherwise_is_named()
    {
        var ex = RdsIam.ToRpc(new AmazonClientException("credential_process exited with 1"), Iam(profile: "orders-ro"), null, sso: false);

        Assert.Equal("aws-sign-in", ex.NodeError!.Code);
        Assert.Contains("orders-ro", ex.NodeError.Summary);
    }

    [Fact]
    public void An_untrusted_RDS_certificate_points_at_the_RDS_bundle()
    {
        var failed = new NpgsqlException("TLS failed", new AuthenticationException("The remote certificate was rejected by the provided RemoteCertificateValidationCallback."));

        var rds = PostgresErrors.ToRpc(failed, Iam(), null).NodeError!;
        var tunnel = PostgresErrors.ToRpc(failed, Iam("localhost:5432") with { CertificateHostName = Host }, null).NodeError!;
        var other = PostgresErrors.ToRpc(failed, Iam("orders.example.test"), null).NodeError!;

        Assert.Equal("tls", rds.Code);
        Assert.Contains("RDS certificate bundle", rds.Summary);
        Assert.Contains("RDS certificate bundle", tunnel.Summary);
        Assert.Equal(PostgresErrors.Untrusted, other.Summary);
    }

    [Fact]
    public void The_identity_names_the_user_and_profile()
    {
        Assert.Equal("User reader, AWS IAM (profile orders-ro)", NodeErrors.Identity(Iam(profile: "orders-ro")));
        Assert.Equal("User reader, AWS IAM (default credentials)", NodeErrors.Identity(Iam()));
    }

    // --- Allowlist and validation ------------------------------------------------------------------------

    [Fact]
    public void Postgres_offers_AWS_IAM_and_no_other_kind_does()
    {
        var kinds = Tree().Describe().ToDictionary(d => d.Kind);

        Assert.Contains(kinds[ConnectionKinds.Postgres].Auths, a => a is { Id: AuthKinds.AwsIam, Label: "AWS IAM (RDS)" });
        foreach (var kind in new[] { ConnectionKinds.Sql, ConnectionKinds.Synapse, ConnectionKinds.Cosmos })
        {
            Assert.DoesNotContain(kinds[kind].Auths, a => a.Id == AuthKinds.AwsIam);
            var c = Iam() with { Kind = kind };
            Assert.Throws<RpcException>(() => Tree().Validate(c));
        }
    }

    [Fact]
    public void Validation_accepts_an_RDS_host_or_a_region()
    {
        Tree().Validate(Iam());
        Tree().Validate(Iam(profile: "orders-ro"));
        Tree().Validate(Iam("localhost:15432", region: "eu-west-2"));
        Tree().Validate(Iam("localhost:5432") with { CertificateHostName = Host });
        Tree().Validate(Iam("orders.abc123example.cn-north-1.rds.amazonaws.com.cn:5432"));
    }

    [Theory]
    [InlineData(Host, "", null, null, "User")]
    [InlineData("localhost:5432", "reader", null, null, "region")]
    [InlineData("orders.example.test", "reader", null, null, "region")]
    [InlineData(Host, "reader", null, "eu west 2", "region")]
    [InlineData(Host, "reader", "orders ro]", null, "profile")]
    public void Validation_refuses_what_cannot_sign_in(string endpoint, string user, string? profile, string? region, string expected)
    {
        var ex = Assert.Throws<RpcException>(() => Tree().Validate(Iam(endpoint, user, profile, region)));

        Assert.Contains(expected, ex.Message);
        Assert.Equal(RpcException.InvalidParams, ex.Code);
    }

    [Fact]
    public void AWS_fields_are_refused_with_another_sign_in()
    {
        var c = Iam(profile: "orders-ro", region: "eu-west-2") with { Auth = AuthKinds.Password };

        var ex = Assert.Throws<RpcException>(() => Tree().Validate(c));

        Assert.Contains("AWS", ex.Message);
    }
}
