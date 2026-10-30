namespace Panoptic.Sidecar.Tests;

/// <summary>
/// A test against the dev SQL Server from scripts/dev-db.ps1. Reported as skipped, not passed, unless
/// PANOPTIC_TEST_SQL_PASSWORD is set. Tag it [Trait("Category", "SqlIntegration")] so CI can run it alone.
/// </summary>
public sealed class SqlFactAttribute : FactAttribute
{
    public static string? Password => Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");

    /// <summary>The test also needs Windows (it goes through the DPAPI config store).</summary>
    public bool NeedsWindows { get; set; }

    public override string? Skip
    {
        get => string.IsNullOrEmpty(Password)
            ? "Set PANOPTIC_TEST_SQL_PASSWORD to the SA password from docker\\.env (start the DB with scripts\\dev-db.ps1)."
            : NeedsWindows && !OperatingSystem.IsWindows() ? "Needs Windows: the config store uses DPAPI." : base.Skip;
        set => base.Skip = value;
    }
}

/// <summary>
/// A test against the Cosmos emulator from scripts/dev-db.ps1. Reported as skipped, not passed, unless
/// PANOPTIC_TEST_COSMOS=1.
/// </summary>
public sealed class CosmosFactAttribute : FactAttribute
{
    public override string? Skip
    {
        get => Environment.GetEnvironmentVariable("PANOPTIC_TEST_COSMOS") != "1"
            ? "Set PANOPTIC_TEST_COSMOS=1 with the Cosmos emulator running (start it with scripts\\dev-db.ps1)."
            : base.Skip;
        set => base.Skip = value;
    }
}

/// <summary>
/// A test against the dev PostgreSQL from scripts/dev-db.ps1. Reported as skipped, not passed, unless
/// PANOPTIC_TEST_PG_PASSWORD is set. Tag it [Trait("Category", "PgIntegration")] so CI can run it alone.
/// </summary>
public sealed class PgFactAttribute : FactAttribute
{
    public static string? Password => Environment.GetEnvironmentVariable("PANOPTIC_TEST_PG_PASSWORD");

    public override string? Skip
    {
        get => string.IsNullOrEmpty(Password)
            ? "Set PANOPTIC_TEST_PG_PASSWORD to PANOPTIC_DEV_PG_PASSWORD from docker\\.env (start the DB with scripts\\dev-db.ps1)."
            : base.Skip;
        set => base.Skip = value;
    }
}
