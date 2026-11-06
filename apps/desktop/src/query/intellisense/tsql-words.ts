// T-SQL keywords and built-in functions offered where no catalog name fits (docs/query-editor.md). Colouring uses
// Monaco's own sql keyword list; this one is for completion only.

export const TSQL_KEYWORDS = [
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

// T-SQL reserved keywords (learn.microsoft.com, "Reserved keywords (Transact-SQL)"; WITHIN for WITHIN GROUP). A name that
// is one of these or one of TSQL_KEYWORDS is bracketed when inserted (engine.ts quote()). Not offered as completions, which
// stay the short list above. Copied as TsqlKeywords.Reserved in the sidecar; a sidecar test fails if they differ.
export const TSQL_RESERVED = [
  "ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "AUTHORIZATION", "BACKUP", "BEGIN", "BETWEEN", "BREAK", "BROWSE",
  "BULK", "BY", "CASCADE", "CASE", "CHECK", "CHECKPOINT", "CLOSE", "CLUSTERED", "COALESCE", "COLLATE", "COLUMN", "COMMIT",
  "COMPUTE", "CONSTRAINT", "CONTAINS", "CONTAINSTABLE", "CONTINUE", "CONVERT", "CREATE", "CROSS", "CURRENT",
  "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "DATABASE", "DBCC", "DEALLOCATE",
  "DECLARE", "DEFAULT", "DELETE", "DENY", "DESC", "DISK", "DISTINCT", "DISTRIBUTED", "DOUBLE", "DROP", "DUMP", "ELSE",
  "END", "ERRLVL", "ESCAPE", "EXCEPT", "EXEC", "EXECUTE", "EXISTS", "EXIT", "EXTERNAL", "FETCH", "FILE", "FILLFACTOR",
  "FOR", "FOREIGN", "FREETEXT", "FREETEXTTABLE", "FROM", "FULL", "FUNCTION", "GOTO", "GRANT", "GROUP", "HAVING",
  "HOLDLOCK", "IDENTITY", "IDENTITYCOL", "IDENTITY_INSERT", "IF", "IN", "INDEX", "INNER", "INSERT", "INTERSECT", "INTO",
  "IS", "JOIN", "KEY", "KILL", "LEFT", "LIKE", "LINENO", "LOAD", "MERGE", "NATIONAL", "NOCHECK", "NONCLUSTERED", "NOT",
  "NULL", "NULLIF", "OF", "OFF", "OFFSETS", "ON", "OPEN", "OPENDATASOURCE", "OPENQUERY", "OPENROWSET", "OPENXML",
  "OPTION", "OR", "ORDER", "OUTER", "OVER", "PERCENT", "PIVOT", "PLAN", "PRECISION", "PRIMARY", "PRINT", "PROC",
  "PROCEDURE", "PUBLIC", "RAISERROR", "READ", "READTEXT", "RECONFIGURE", "REFERENCES", "REPLICATION", "RESTORE",
  "RESTRICT", "RETURN", "REVERT", "REVOKE", "RIGHT", "ROLLBACK", "ROWCOUNT", "ROWGUIDCOL", "RULE", "SAVE", "SCHEMA",
  "SECURITYAUDIT", "SELECT", "SEMANTICKEYPHRASETABLE", "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE",
  "SESSION_USER", "SET", "SETUSER", "SHUTDOWN", "SOME", "STATISTICS", "SYSTEM_USER", "TABLE", "TABLESAMPLE", "TEXTSIZE",
  "THEN", "TO", "TOP", "TRAN", "TRANSACTION", "TRIGGER", "TRUNCATE", "TRY_CONVERT", "TSEQUAL", "UNION", "UNIQUE",
  "UNPIVOT", "UPDATE", "UPDATETEXT", "USE", "USER", "VALUES", "VARYING", "VIEW", "WAITFOR", "WHEN", "WHERE", "WHILE",
  "WITH", "WITHIN", "WRITETEXT",
];

export const TSQL_FUNCTIONS = [
  "ABS", "AVG", "CAST", "CEILING", "CHARINDEX", "CHECKSUM", "COALESCE", "CONCAT", "CONCAT_WS", "CONVERT", "COUNT", "COUNT_BIG",
  "CUME_DIST", "CURRENT_TIMESTAMP", "DATEADD", "DATEDIFF", "DATEDIFF_BIG", "DATEFROMPARTS", "DATENAME", "DATEPART", "DATETRUNC",
  "DAY", "DENSE_RANK", "EOMONTH", "FIRST_VALUE", "FLOOR", "FORMAT", "GETDATE", "GETUTCDATE", "GREATEST", "HASHBYTES", "IIF",
  "ISDATE", "ISJSON", "ISNULL", "ISNUMERIC", "JSON_QUERY", "JSON_VALUE", "LAG", "LAST_VALUE", "LEAD", "LEAST", "LEFT", "LEN",
  "LOWER", "LTRIM", "MAX", "MIN", "MONTH", "NEWID", "NTILE", "NULLIF", "OBJECT_ID", "OBJECT_NAME", "OPENJSON", "PARSE",
  "PATINDEX", "PERCENT_RANK", "POWER", "QUOTENAME", "RANK", "REPLACE", "REPLICATE", "REVERSE", "RIGHT", "ROUND", "ROW_NUMBER",
  "RTRIM", "SCOPE_IDENTITY", "SIGN", "SPACE", "SQRT", "STDEV", "STRING_AGG", "STRING_SPLIT", "STR", "STUFF", "SUBSTRING", "SUM",
  "SUSER_SNAME", "SYSDATETIME", "SYSDATETIMEOFFSET", "SYSUTCDATETIME", "TRANSLATE", "TRIM", "TRY_CAST", "TRY_CONVERT",
  "TRY_PARSE", "UPPER", "VAR", "YEAR",
];

/** Used when the catalog has not arrived yet, so types still complete after CAST(x AS. */
export const TSQL_TYPES = [
  "bigint", "binary", "bit", "char", "date", "datetime", "datetime2", "datetimeoffset", "decimal", "float", "image", "int",
  "money", "nchar", "ntext", "numeric", "nvarchar", "real", "smalldatetime", "smallint", "smallmoney", "sql_variant", "text",
  "time", "tinyint", "uniqueidentifier", "varbinary", "varchar", "xml",
];
