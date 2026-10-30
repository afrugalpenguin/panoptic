namespace Panoptic.Sidecar;

/// <summary>Shared pieces of the per-backend error mappers (docs/explorer-errors.md).</summary>
public static class NodeErrors
{
    public const int MaxSummary = 80;

    /// <summary>Anything unmapped: the message's first sentence as the summary, the full text as detail.</summary>
    public static NodeError Fallback(string message, string? code = null, string? extra = null) =>
        new(FirstSentence(message), WithExtra(message, extra), code, true);

    public static NodeError Mapped((string Summary, bool Retryable) entry, string message, string code, string? extra) =>
        new(entry.Summary, WithExtra(message, extra), code, entry.Retryable);

    /// <summary>Up to the first sentence end, semicolon or line break, cut at a word to under <see cref="MaxSummary"/> characters.</summary>
    public static string FirstSentence(string message)
    {
        var text = message.Trim();
        var end = text.Length;
        foreach (var stop in new[] { ". ", "; ", "\n", "\r" })
        {
            var i = text.IndexOf(stop, StringComparison.Ordinal);
            if (i >= 0 && i < end) end = stop == ". " ? i + 1 : i;
        }
        text = text[..end].Trim();
        if (text.Length == 0) return "The request failed.";
        if (text.Length < MaxSummary) return text;
        var cut = text.LastIndexOf(' ', MaxSummary - 2);
        return text[..(cut > MaxSummary / 2 ? cut : MaxSummary - 2)].TrimEnd() + "…";
    }

    private static string WithExtra(string message, string? extra) =>
        string.IsNullOrEmpty(extra) ? message : $"{message.TrimEnd()}\n\n{extra}";

    /// <summary>"Name: value" lines for the detail block, skipping empty values.</summary>
    public static string Lines(params (string Name, string? Value)[] fields) =>
        string.Join('\n', fields.Where(f => !string.IsNullOrEmpty(f.Value)).Select(f => $"{f.Name}: {f.Value}"));

    /// <summary>The identity a connection signs in with, for the detail block. Never includes a secret.</summary>
    public static string Identity(ConnectionConfig c) => c.Auth switch
    {
        AuthKinds.Entra => string.IsNullOrWhiteSpace(c.TenantId) ? "Entra ID (default tenant)" : $"Entra ID (tenant {c.TenantId})",
        AuthKinds.Sql => $"SQL login {c.User}",
        AuthKinds.Password => $"User {c.User}",
        AuthKinds.Key => "Account key",
        AuthKinds.Windows => $"Windows ({Environment.UserDomainName}\\{Environment.UserName})",
        _ => c.Auth,
    };
}
