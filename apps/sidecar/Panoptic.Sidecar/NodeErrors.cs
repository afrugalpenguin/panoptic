using System.Net.Sockets;
using System.Security.Authentication;

namespace Panoptic.Sidecar;

/// <summary>Shared pieces of the per-backend error mappers (docs/explorer-errors.md).</summary>
public static class NodeErrors
{
    public const int MaxSummary = 80;

    private const string Unreachable = "Server not found or not reachable. Check the server name and network.";

    /// <summary>
    /// Plain words for failures no backend mapped, found anywhere in the exception chain (#192). The first match wins,
    /// most specific first: a library that failed to load hides behind a TypeInitializationException (#167).
    /// </summary>
    private static readonly (Func<Exception, bool> Matches, string Summary, string Code, bool Retryable)[] Causes =
    [
        (e => e is TypeInitializationException or DllNotFoundException or BadImageFormatException or FileLoadException,
            "Part of the database engine failed to load. Reinstalling Panoptic usually fixes this.", "load", false),
        (e => e is AuthenticationException,
            "A secure connection could not be set up. Check the server's certificate; for a local or dev server, tick Trust server certificate.", "tls", false),
        (e => e is Azure.Identity.AuthenticationFailedException or Azure.Identity.CredentialUnavailableException,
            "Entra ID sign-in failed. Try again, or check the account and tenant.", "sign-in", false),
        (e => e is TimeoutException, "The server took too long to respond. Retry, or check the network.", "timeout", true),
        (e => e is SocketException or HttpRequestException, Unreachable, "network", true),
    ];

    /// <summary>
    /// A failure no backend mapped: a plain summary for the common causes (else the message's first sentence), and as
    /// detail the full message, then each inner exception's type and message ("Caused by:"), then
    /// <paramref name="extra"/>. Driver messages are checked for secrets (#180); nothing else is added.
    /// </summary>
    public static NodeError FromException(Exception ex, string? extra = null)
    {
        var cause = KnownCause(ex);
        var causes = InnerCauses(ex).ToList();
        var detail = causes.Count == 0 ? ex.Message : $"{ex.Message.TrimEnd()}\n\nCaused by:\n{string.Join('\n', causes)}";
        return new NodeError(cause?.Summary ?? FirstSentence(ex.Message), WithExtra(detail, extra), cause?.Code, cause?.Retryable ?? true);
    }

    /// <summary>The same failure on one line, for places that show a single string (a connection test result): the
    /// plain summary (else the message) and the root cause.</summary>
    public static string OneLine(Exception ex)
    {
        var root = ex;
        while (root.InnerException is not null) root = root.InnerException;
        var head = KnownCause(ex)?.Summary ?? ex.Message.Trim();
        return root == ex && KnownCause(ex) is null ? head : $"{head} ({Describe(root)})";
    }

    private static (string Summary, string Code, bool Retryable)? KnownCause(Exception ex)
    {
        var chain = Chain(ex).ToList();
        foreach (var (matches, summary, code, retryable) in Causes)
            if (chain.Any(matches)) return (summary, code, retryable);
        return null;
    }

    private static IEnumerable<Exception> Chain(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException) yield return e;
    }

    /// <summary>"Type: first line of message" for each inner exception, skipping a message the previous one already said.</summary>
    private static IEnumerable<string> InnerCauses(Exception ex)
    {
        var said = ex.Message.Trim();
        for (var e = ex.InnerException; e is not null; e = e.InnerException)
        {
            if (e.Message.Trim() == said) continue;
            said = e.Message.Trim();
            yield return Describe(e);
        }
    }

    private static string Describe(Exception e) => $"{e.GetType().Name}: {e.Message.Trim().Split('\n')[0].TrimEnd('\r')}";

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
