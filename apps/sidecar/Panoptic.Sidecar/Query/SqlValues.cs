using System.Globalization;
using System.Text.Json;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Writes database values as JSON for the grid. Anything a JavaScript number can't hold exactly
/// (decimals, integers beyond 2^53) is sent as a string, so no precision is lost on the way.
/// </summary>
public static class SqlValues
{
    private const long MaxSafeInteger = 9007199254740991;
    private const int MaxBinaryBytes = 32;

    public static void Write(Utf8JsonWriter w, object? value)
    {
        switch (value)
        {
            case null or DBNull:
                w.WriteNullValue();
                break;
            case string s:
                w.WriteStringValue(s);
                break;
            case bool b:
                w.WriteBooleanValue(b);
                break;
            case byte or sbyte or short or ushort or int or uint:
                w.WriteNumberValue(Convert.ToInt64(value, CultureInfo.InvariantCulture));
                break;
            case long l:
                if (l is >= -MaxSafeInteger and <= MaxSafeInteger) w.WriteNumberValue(l);
                else w.WriteStringValue(l.ToString(CultureInfo.InvariantCulture));
                break;
            case ulong ul:
                w.WriteStringValue(ul.ToString(CultureInfo.InvariantCulture));
                break;
            case float f when float.IsFinite(f):
                w.WriteNumberValue(f);
                break;
            case double d when double.IsFinite(d):
                w.WriteNumberValue(d);
                break;
            case decimal m:
                w.WriteStringValue(m.ToString(CultureInfo.InvariantCulture));
                break;
            case DateTime dt:
                w.WriteStringValue(dt.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture));
                break;
            case DateTimeOffset dto:
                w.WriteStringValue(dto.ToString("yyyy-MM-dd HH:mm:ss.fff zzz", CultureInfo.InvariantCulture));
                break;
            case DateOnly date:
                w.WriteStringValue(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                break;
            case TimeSpan ts:
                w.WriteStringValue(ts.ToString("c", CultureInfo.InvariantCulture));
                break;
            case Guid g:
                w.WriteStringValue(g.ToString());
                break;
            case byte[] bytes:
                var hex = "0x" + Convert.ToHexString(bytes, 0, Math.Min(bytes.Length, MaxBinaryBytes));
                w.WriteStringValue(bytes.Length > MaxBinaryBytes ? $"{hex}... ({bytes.Length} bytes)" : hex);
                break;
            case JsonElement e:
                WriteJson(w, e);
                break;
            default:
                w.WriteStringValue(Convert.ToString(value, CultureInfo.InvariantCulture));
                break;
        }
    }

    /// <summary>Cosmos values: primitives as themselves, objects and arrays as their JSON text.</summary>
    private static void WriteJson(Utf8JsonWriter w, JsonElement e)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object or JsonValueKind.Array:
                w.WriteStringValue(e.GetRawText());
                break;
            case JsonValueKind.Number when e.TryGetInt64(out var l) && l is > MaxSafeInteger or < -MaxSafeInteger:
                w.WriteStringValue(e.GetRawText());
                break;
            case JsonValueKind.Undefined:
                w.WriteNullValue();
                break;
            default:
                e.WriteTo(w);
                break;
        }
    }
}
