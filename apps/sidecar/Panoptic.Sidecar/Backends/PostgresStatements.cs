namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Splits a Postgres script into statements on top-level semicolons, as psql does: not inside '...' or E'...' strings,
/// "..." names, $tag$...$tag$ bodies, -- or nested /* */ comments, or the BEGIN ATOMIC ... END body of a CREATE
/// FUNCTION or PROCEDURE. Each statement is sent on its own, so a server error position is an offset into one
/// statement, which <see cref="Locate"/> turns back into a script line and column.
/// </summary>
public static class PostgresStatements
{
    /// <param name="Start">Offset of the statement's first character (comments included) in the script.</param>
    /// <param name="Text">The statement without its semicolon.</param>
    /// <param name="FirstWord">Its first keyword, lower case: what <see cref="EndsTransaction"/> checks.</param>
    /// <param name="Atomic">It has semicolons of its own, in a BEGIN ATOMIC body.</param>
    public sealed record Statement(int Start, string Text, string FirstWord, bool Atomic = false);

    public static List<Statement> Split(string script)
    {
        var statements = new List<Statement>();
        var start = -1; // first non-blank character of the current statement
        var words = new List<string>(4); // its first words, lower case
        var atomicDepth = 0;
        var atomic = false;
        var i = 0;

        void End(int end)
        {
            // A statement that is only comments has no first word and is not sent.
            if (start >= 0 && words.Count > 0) statements.Add(new Statement(start, script[start..end].TrimEnd(), words[0], atomic));
            start = -1;
            words.Clear();
            atomicDepth = 0;
            atomic = false;
        }

        while (i < script.Length)
        {
            var c = script[i];
            var next = i + 1 < script.Length ? script[i + 1] : '\0';
            if (char.IsWhiteSpace(c))
            {
                i++;
                continue;
            }
            if (start < 0 && c != ';') start = i;

            if (c == '-' && next == '-')
            {
                while (i < script.Length && script[i] != '\n') i++;
            }
            else if (c == '/' && next == '*')
            {
                var depth = 0;
                while (i < script.Length)
                {
                    if (script[i] == '/' && i + 1 < script.Length && script[i + 1] == '*') { depth++; i += 2; }
                    else if (script[i] == '*' && i + 1 < script.Length && script[i + 1] == '/') { i += 2; if (--depth == 0) break; }
                    else i++;
                }
            }
            else if (c == '\'')
            {
                i = SkipQuoted(script, i, '\'', backslashes: false);
            }
            else if (c == '"')
            {
                i = SkipQuoted(script, i, '"', backslashes: false);
            }
            else if (c == '$' && DollarTag(script, i) is { } tag)
            {
                var close = script.IndexOf(tag, i + tag.Length, StringComparison.Ordinal);
                i = close < 0 ? script.Length : close + tag.Length;
            }
            else if (IsWordStart(c))
            {
                var wordStart = i;
                while (i < script.Length && IsWordPart(script[i])) i++;
                var word = script[wordStart..i];
                // E'...' (and e'...') is an escape string: a backslash escapes the next character, quotes included.
                if (word is "E" or "e" && i < script.Length && script[i] == '\'')
                {
                    i = SkipQuoted(script, i, '\'', backslashes: true);
                    continue;
                }
                var lower = word.ToLowerInvariant();
                if (words.Count < 4) words.Add(lower);
                if (IsRoutine(words))
                {
                    if (lower == "begin" || (lower == "case" && atomicDepth > 0)) atomicDepth++;
                    else if (lower == "end" && atomicDepth > 0) atomicDepth--;
                }
            }
            else if (c == ';')
            {
                if (atomicDepth == 0) End(i);
                else atomic = true;
                i++;
            }
            else i++;
        }
        End(script.Length);
        return statements;
    }

    /// <summary>Statements after which the read-only guard's transaction may have ended (COMMIT, END, ROLLBACK, ABORT,
    /// PREPARE TRANSACTION). Inside a transaction block a procedure or DO block cannot end it.</summary>
    public static bool EndsTransaction(Statement statement) => statement.FirstWord is "commit" or "end" or "rollback" or "abort" or "prepare";

    /// <summary>
    /// The script line and column (both 1-based, the column in UTF-16 code units as the editor counts) of a server
    /// error position: a 1-based count of characters (code points) into <paramref name="statement"/>'s text.
    /// </summary>
    public static (int Line, int Column) Locate(string script, Statement statement, int position)
    {
        var index = statement.Start;
        for (var n = 1; n < position && index < statement.Start + statement.Text.Length; n++)
            index += char.IsHighSurrogate(script[index]) && index + 1 < script.Length ? 2 : 1;
        return LineAndColumn(script, index);
    }

    public static (int Line, int Column) LineAndColumn(string script, int index)
    {
        var line = 1;
        var lineStart = 0;
        for (var i = 0; i < index && i < script.Length; i++)
            if (script[i] == '\n') { line++; lineStart = i + 1; }
        return (line, index - lineStart + 1);
    }

    private static bool IsRoutine(List<string> words) =>
        words.Count >= 2 && words[0] == "create"
        && (words[1] is "function" or "procedure" || (words.Count >= 4 && words[1] == "or" && words[2] == "replace" && words[3] is "function" or "procedure"));

    /// <summary>The index after a quoted string or name that starts at <paramref name="open"/>. A doubled quote is part
    /// of it; with <paramref name="backslashes"/>, so is any backslash-escaped character. Unclosed runs to the end.</summary>
    private static int SkipQuoted(string s, int open, char quote, bool backslashes)
    {
        var i = open + 1;
        while (i < s.Length)
        {
            if (backslashes && s[i] == '\\') i += 2;
            else if (s[i] == quote)
            {
                if (i + 1 < s.Length && s[i + 1] == quote) i += 2;
                else return i + 1;
            }
            else i++;
        }
        return s.Length;
    }

    /// <summary>The dollar-quote tag at <paramref name="i"/> ($$ or $name$), or null when the $ starts none ($1 is a
    /// parameter). A $ inside a word is part of the word and never gets here.</summary>
    private static string? DollarTag(string s, int i)
    {
        var j = i + 1;
        if (j < s.Length && IsWordStart(s[j]))
            while (j < s.Length && IsWordPart(s[j]) && s[j] != '$') j++;
        return j < s.Length && s[j] == '$' ? s[i..(j + 1)] : null;
    }

    private static bool IsWordStart(char c) => char.IsLetter(c) || c == '_' || c > 0x7f;

    private static bool IsWordPart(char c) => char.IsLetterOrDigit(c) || c is '_' or '$' || c > 0x7f;
}
