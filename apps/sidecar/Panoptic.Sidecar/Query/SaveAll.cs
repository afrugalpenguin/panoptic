using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Whether a query may run a second time to save all its rows (#287). The first run's reader is gone by the time its
/// summary arrives, so saving past the row limit means running the text again: only a lone SELECT may, since
/// anything else could change data twice. Conservative on purpose: words are matched anywhere outside comments,
/// strings and quoted names, so a SELECT that merely mentions UPDATE (FOR UPDATE, say) is refused too.
/// </summary>
public static partial class SingleReadQuery
{
    /// <summary>Words that write, or run code that might.</summary>
    private static readonly HashSet<string> Writes =
        ["INTO", "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "EXECUTE", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "CALL", "COPY"];

    /// <summary>Null when <paramref name="text"/> may run again; otherwise why not, for the user.</summary>
    public static string? Refusal(string language, string text)
    {
        var tokens = ReadOnlyScript.Tokenize(text).Select(t => t.Text).ToList();
        if (tokens.Count == 0 || tokens.All(t => t == ";")) return "There is nothing to run.";
        var end = tokens.Count;
        while (end > 0 && tokens[end - 1] == ";") end--;
        if (tokens.Take(end).Any(t => t == ";") || (language != "cosmos" && tokens.Contains("GO")))
            return "Save all runs the query again, so the script must be one statement.";
        var first = tokens[0];
        if (!(first == "SELECT" || (first == "WITH" && language != "cosmos")))
            return "Save all runs the query again, so only a single SELECT can be saved this way.";
        var writing = tokens.Take(end).FirstOrDefault(Writes.Contains);
        return writing is null
            ? null
            : $"Save all runs the query again, so only a single SELECT can be saved this way, and this one contains {writing}{(writing == "INTO" ? " (SELECT INTO creates a table)" : "")}.";
    }
}

/// <summary>
/// Streams a query's first result set to a CSV or JSON file, every row, with no row limit (#287). Values go through
/// <see cref="SqlValues"/>, as for the grid, and the formats match the grid's Export CSV and Export JSON
/// (apps/desktop/src/query/export.ts), so a saved file reads the same as an exported one.
/// </summary>
public sealed partial class FileSink : IQuerySink, IDisposable
{
    private readonly StreamWriter _out;
    private readonly bool _csv;
    private readonly ArrayBufferWriter<byte> _cell = new();
    private Utf8JsonWriter? _json;
    private string[]? _keys;
    private int _sets;
    private int _rows;

    public FileSink(string path, string format)
    {
        _csv = format == "csv";
        _out = new StreamWriter(path, false, new UTF8Encoding(false));
        if (!_csv)
        {
            _json = new Utf8JsonWriter(_out.BaseStream, new JsonWriterOptions { Indented = true });
            _json.WriteStartArray();
        }
    }

    public string? Error { get; private set; }

    /// <summary>Set when CSV rows grew columns after the header was written (Cosmos properties first seen late).</summary>
    public string? Note { get; private set; }

    public int RowsWritten => _rows;
    public int BatchSize => QueryService.BatchSize;
    public int MaxRows => int.MaxValue;
    public int SetCount => _sets;
    public int BeginSet() => _sets++;
    public int RowCount(int set) => set == 0 ? _rows : 0;
    public void Truncated(int set) { }
    public void Message(string kind, string text) { }
    public void RolledBack() { }
    public void Committed() { }
    public void AddCharge(double charge) { }

    public void Fail(string error, IReadOnlyList<QueryError>? errors = null) => Error ??= error;

    public void Rows(int set, ResultColumn[]? columns, IReadOnlyList<object?[]> rows)
    {
        if (set != 0) return;
        if (columns is not null)
        {
            var keys = _csv ? columns.Select(c => c.Name).ToArray() : UniqueKeys(columns);
            if (_keys is null && _csv) _out.Write(string.Join(",", keys.Select(Field)) + "\r\n");
            else if (_keys is not null && _csv && keys.Length > _keys.Length)
                Note = "Some columns first appeared after the first rows: their values are in the file, but its header does not name them. Save as JSON to keep their names.";
            _keys = keys;
        }
        if (_keys is null) return;
        foreach (var row in rows)
        {
            if (_csv) _out.Write(string.Join(",", _keys.Select((_, i) => Field(CellText(i < row.Length ? row[i] : null)))) + "\r\n");
            else
            {
                _json!.WriteStartObject();
                for (var i = 0; i < _keys.Length; i++)
                {
                    _json.WritePropertyName(_keys[i]);
                    SqlValues.Write(_json, i < row.Length ? row[i] : null);
                }
                _json.WriteEndObject();
            }
            _rows++;
        }
    }

    public void Dispose()
    {
        if (_json is not null)
        {
            _json.WriteEndArray();
            _json.Flush();
            _json.Dispose();
        }
        _out.Dispose();
    }

    /// <summary>As export.ts toJson: duplicate names get _2, _3...; empty ones columnN.</summary>
    private static string[] UniqueKeys(ResultColumn[] columns)
    {
        var seen = new Dictionary<string, int>();
        return columns.Select((c, i) =>
        {
            var name = string.IsNullOrEmpty(c.Name) ? $"column{i + 1}" : c.Name;
            seen[name] = seen.GetValueOrDefault(name) + 1;
            return seen[name] == 1 ? name : $"{name}_{seen[name]}";
        }).ToArray();
    }

    /// <summary>
    /// A value as the grid holds it (via <see cref="SqlValues"/>, so the two cannot drift): null, text the grid shows as
    /// a string (with whether it was one), or the literal of a number or boolean.
    /// </summary>
    private (string? Text, bool IsString) CellText(object? value)
    {
        _cell.ResetWrittenCount();
        using (var w = new Utf8JsonWriter(_cell)) SqlValues.Write(w, value);
        var reader = new Utf8JsonReader(_cell.WrittenSpan);
        reader.Read();
        return reader.TokenType switch
        {
            JsonTokenType.Null => (null, false),
            JsonTokenType.String => (reader.GetString(), true),
            _ => (Encoding.UTF8.GetString(reader.ValueSpan), false),
        };
    }

    /// <summary>As export.ts toCsv: RFC 4180, NULL empty, and text that starts like a formula gets a leading '.</summary>
    private static string Field((string? Text, bool IsString) cell)
    {
        if (cell.Text is null) return "";
        var s = cell.Text;
        if (cell.IsString && FormulaStart().IsMatch(s) && !Numeric().IsMatch(s)) s = "'" + s;
        return s.AsSpan().IndexOfAny("\",\r\n") >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }

    private static string Field(string name) => Field((name, true));

    [GeneratedRegex(@"^[=+\-@\t\r]")]
    private static partial Regex FormulaStart();

    [GeneratedRegex(@"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")]
    private static partial Regex Numeric();
}
