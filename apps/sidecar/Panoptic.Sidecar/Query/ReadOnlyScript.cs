namespace Panoptic.Sidecar.Query;

/// <summary>
/// The read-only guard's static check for SQL Server. A read-only run is one transaction that is rolled back at the end;
/// these statements end it or escape it, so a read-only run refuses any script that contains them:
/// COMMIT and ROLLBACK (the next statements would run outside the guard and stay), SET IMPLICIT_TRANSACTIONS (the guard
/// relies on it) and dynamic SQL (EXEC(...), sp_executesql), whose text could hold either. Words inside comments, strings
/// and quoted identifiers never count. Procedures are allowed: their own COMMITs are contained on the server instead.
/// </summary>
public static class ReadOnlyScript
{
    public static ForbiddenStatement? FindForbidden(string script)
    {
        var tokens = Tokenize(script);
        for (var i = 0; i < tokens.Count; i++)
        {
            var (text, line) = tokens[i];
            var next = i + 1 < tokens.Count ? tokens[i + 1].Text : "";
            switch (text)
            {
                case "COMMIT":
                case "ROLLBACK":
                    return new ForbiddenStatement(text, line);
                case "SP_EXECUTESQL":
                    return new ForbiddenStatement("sp_executesql", line);
                case "SET" when next == "IMPLICIT_TRANSACTIONS":
                    return new ForbiddenStatement("SET IMPLICIT_TRANSACTIONS", line);
                case "EXEC" or "EXECUTE" when next == "(":
                    return new ForbiddenStatement("EXEC(...)", line);
            }
        }
        return null;
    }

    /// <summary>Upper-cased words and single punctuation characters, with their 1-based lines.</summary>
    private static List<(string Text, int Line)> Tokenize(string s)
    {
        var tokens = new List<(string, int)>();
        var line = 1;
        var i = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (c == '\n') { line++; i++; }
            else if (char.IsWhiteSpace(c)) i++;
            else if (c == '-' && At(i + 1, '-')) { while (i < s.Length && s[i] != '\n') i++; }
            else if (c == '/' && At(i + 1, '*')) SkipBlockComment();
            else if (c == '\'') SkipQuoted('\'', '\'');
            else if (c == '"') SkipQuoted('"', '"');
            else if (c == '[') SkipQuoted('[', ']');
            else if (IsWordStart(c))
            {
                var start = i;
                while (i < s.Length && IsWordPart(s[i])) i++;
                tokens.Add((s[start..i].ToUpperInvariant(), line));
            }
            else { tokens.Add((c.ToString(), line)); i++; }
        }
        return tokens;

        bool At(int j, char ch) => j < s.Length && s[j] == ch;

        // T-SQL block comments nest.
        void SkipBlockComment()
        {
            var depth = 0;
            while (i < s.Length)
            {
                if (s[i] == '/' && At(i + 1, '*')) { depth++; i += 2; }
                else if (s[i] == '*' && At(i + 1, '/')) { depth--; i += 2; if (depth == 0) return; }
                else { if (s[i] == '\n') line++; i++; }
            }
        }

        // 'it''s', "a""b" and [a]]b]: the closing character doubled is an escape, not the end.
        void SkipQuoted(char open, char close)
        {
            i++;
            while (i < s.Length)
            {
                if (s[i] == close)
                {
                    if (At(i + 1, close)) { i += 2; continue; }
                    i++;
                    return;
                }
                if (s[i] == '\n') line++;
                i++;
            }
        }
    }

    private static bool IsWordStart(char c) => char.IsLetter(c) || c is '_' or '@' or '#';
    private static bool IsWordPart(char c) => char.IsLetterOrDigit(c) || c is '_' or '@' or '#' or '$';
}

/// <summary>A statement a read-only run refuses, as the user would write it, and the 1-based script line it is on.</summary>
public sealed record ForbiddenStatement(string Statement, int Line);
