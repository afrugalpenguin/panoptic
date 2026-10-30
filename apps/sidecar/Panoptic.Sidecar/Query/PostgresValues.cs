using System.Globalization;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Postgres values for the grid. Results are read in text format, so every type (arrays, ranges, enums, intervals,
/// json, extension types) arrives as the server's own text, as psql shows it. Integers, floats and booleans become
/// JSON numbers and booleans (<see cref="SqlValues"/> then keeps large integers exact); bytea becomes 0x hex like
/// SQL Server's binary. Everything else stays text.
/// </summary>
public static class PostgresValues
{
    private const uint Bool = 16, Bytea = 17, Int8 = 20, Int2 = 21, Int4 = 23, Oid = 26, Float4 = 700, Float8 = 701;
    private const int MaxBinaryBytes = 32;

    public static object? FromText(uint typeOid, string? text)
    {
        if (text is null) return null;
        switch (typeOid)
        {
            case Bool:
                return text == "t";
            case Int2 or Int4 or Int8 or Oid when long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l):
                return l;
            case Float4 or Float8 when double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d):
                return d;
            case Bytea when text.StartsWith(@"\x", StringComparison.Ordinal):
                var hex = text[2..].ToUpperInvariant();
                var bytes = hex.Length / 2;
                return bytes > MaxBinaryBytes ? $"0x{hex[..(MaxBinaryBytes * 2)]}... ({bytes} bytes)" : $"0x{hex}";
            default:
                return text;
        }
    }
}
