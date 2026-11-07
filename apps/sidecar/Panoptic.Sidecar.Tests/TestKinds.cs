namespace Panoptic.Sidecar.Tests;

/// <summary>A plain description for test backends, which only need to say which auths they accept.</summary>
public static class TestKinds
{
    public static KindDescription Describe(string kind, params string[] auths) => new(
        kind, kind, "Server", "", auths.Select(AuthKinds.Option).ToList(), new KindBadge("T", "#6a6a6a", kind),
        new ConnectionFields(Database: true, CertificateOptions: true, EntraUser: false, TrustLocalOnly: false));
}
