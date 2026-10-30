namespace Panoptic.Sidecar.Backends;

/// <summary>
/// The T-SQL keywords that make a name need brackets when it is dragged into the editor. A copy of TSQL_KEYWORDS in
/// apps/desktop/src/query/intellisense/tsql-words.ts (the UI's completion list); a sidecar test fails if they differ.
/// </summary>
public static class TsqlKeywords
{
    public static readonly string[] All =
    [
        "ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "BEGIN", "BETWEEN", "BREAK", "BY", "CASCADE", "CASE", "CATCH", "CHECK",
        "CLOSE", "COLUMN", "COMMIT", "CONSTRAINT", "CONTINUE", "CREATE", "CROSS", "CURSOR", "DATABASE", "DEALLOCATE", "DECLARE",
        "DEFAULT", "DELETE", "DESC", "DISTINCT", "DROP", "ELSE", "END", "EXCEPT", "EXEC", "EXECUTE", "EXISTS", "FETCH", "FOR",
        "FOREIGN", "FROM", "FULL", "FUNCTION", "GO", "GOTO", "GROUP", "HAVING", "IDENTITY", "IF", "IN", "INDEX", "INNER", "INSERT",
        "INTERSECT", "INTO", "IS", "JOIN", "KEY", "LEFT", "LIKE", "MERGE", "NEXT", "NOCOUNT", "NOLOCK", "NOT", "NULL", "OFF",
        "OFFSET", "ON", "OPEN", "OPTION", "OR", "ORDER", "OUTER", "OUTPUT", "OVER", "PARTITION", "PERCENT", "PIVOT", "PRIMARY",
        "PRINT", "PROCEDURE", "RAISERROR", "REFERENCES", "RETURN", "RETURNS", "RIGHT", "ROLLBACK", "ROWS", "SCHEMA", "SELECT", "SET",
        "TABLE", "THEN", "THROW", "TIES", "TOP", "TRAN", "TRANSACTION", "TRUNCATE", "TRY", "UNION", "UNIQUE", "UNPIVOT", "UPDATE",
        "USE", "USING", "VALUES", "VIEW", "WHEN", "WHERE", "WHILE", "WITH",
    ];
}
