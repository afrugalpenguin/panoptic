using System.Text;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Splits a T-SQL script into batches on lines containing only GO, as SSMS does. GO inside a string,
/// a comment or another word does not split. Empty batches are dropped.
/// </summary>
public static class BatchSplitter
{
    public static List<string> Split(string script)
    {
        var batches = new List<string>();
        var current = new StringBuilder();
        var inBlockComment = false;
        var inString = false;

        foreach (var rawLine in script.Replace("\r\n", "\n").Split('\n'))
        {
            if (!inBlockComment && !inString && IsGo(rawLine))
            {
                Flush();
                continue;
            }
            current.Append(rawLine).Append('\n');
            Scan(rawLine);
        }
        Flush();
        return batches;

        void Flush()
        {
            var batch = current.ToString().Trim();
            if (batch.Length > 0) batches.Add(batch);
            current.Clear();
        }

        // Tracks whether the next line starts inside a /* comment */ or a 'string', so GO there doesn't split.
        void Scan(string line)
        {
            for (var i = 0; i < line.Length; i++)
            {
                if (inBlockComment)
                {
                    if (line[i] == '*' && i + 1 < line.Length && line[i + 1] == '/') { inBlockComment = false; i++; }
                }
                else if (inString)
                {
                    if (line[i] == '\'') inString = false; // '' re-enters on the next char
                }
                else if (line[i] == '-' && i + 1 < line.Length && line[i + 1] == '-') break;
                else if (line[i] == '/' && i + 1 < line.Length && line[i + 1] == '*') { inBlockComment = true; i++; }
                else if (line[i] == '\'') inString = true;
            }
        }
    }

    private static bool IsGo(string line)
    {
        var t = line.Trim();
        var comment = t.IndexOf("--", StringComparison.Ordinal);
        if (comment >= 0) t = t[..comment].TrimEnd();
        if (!t.StartsWith("GO", StringComparison.OrdinalIgnoreCase)) return false;
        var rest = t[2..].Trim();
        return rest.Length == 0 || rest.All(char.IsDigit);
    }
}
