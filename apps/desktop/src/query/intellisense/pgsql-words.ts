// Postgres keywords and built-in functions: colouring for the pgsql language (monaco.ts), and the words the pgsql
// dialect will complete (#118).

export const PGSQL_KEYWORDS = [
  "ABORT", "ADD", "ALL", "ALTER", "ANALYZE", "AND", "ANY", "ARRAY", "AS", "ASC", "ATOMIC", "BEGIN", "BETWEEN", "BIGSERIAL",
  "BOTH", "BY", "CALL", "CASCADE", "CASE", "CAST", "CHECK", "CLUSTER", "COLLATE", "COLUMN", "COMMENT", "COMMIT", "CONCURRENTLY",
  "CONFLICT", "CONSTRAINT", "COPY", "CREATE", "CROSS", "CURRENT", "CURSOR", "DATABASE", "DECLARE", "DEFAULT", "DEFERRABLE",
  "DELETE", "DESC", "DISTINCT", "DO", "DOMAIN", "DROP", "ELSE", "END", "ENUM", "EXCEPT", "EXCLUDE", "EXECUTE", "EXISTS",
  "EXPLAIN", "EXTENSION", "FALSE", "FETCH", "FILTER", "FIRST", "FOLLOWING", "FOR", "FOREIGN", "FROM", "FULL", "FUNCTION",
  "GENERATED", "GRANT", "GROUP", "GROUPS", "HAVING", "IDENTITY", "IF", "ILIKE", "IMMUTABLE", "IN", "INCLUDE", "INDEX",
  "INHERITS", "INNER", "INSERT", "INTERSECT", "INTO", "IS", "ISNULL", "JOIN", "KEY", "LANGUAGE", "LAST", "LATERAL", "LEADING",
  "LEFT", "LIKE", "LIMIT", "LISTEN", "LOCK", "MATERIALIZED", "MERGE", "NATURAL", "NO", "NOT", "NOTHING", "NOTIFY", "NOTNULL",
  "NULL", "NULLS", "OF", "OFFSET", "ON", "ONLY", "OR", "ORDER", "ORDINALITY", "OUT", "OUTER", "OVER", "OWNER", "PARTITION",
  "PLPGSQL", "POLICY", "PRECEDING", "PREPARE", "PRIMARY", "PROCEDURE", "RANGE", "RAISE", "READ", "RECURSIVE", "REFERENCES",
  "REFRESH", "REINDEX", "RELEASE", "RENAME", "REPLACE", "RESTRICT", "RETURN", "RETURNING", "RETURNS", "REVOKE", "RIGHT", "ROLE",
  "ROLLBACK", "ROW", "ROWS", "SAVEPOINT", "SCHEMA", "SECURITY", "SELECT", "SEQUENCE", "SERIAL", "SESSION", "SET", "SETOF",
  "SHOW", "SIMILAR", "SOME", "STABLE", "STRICT", "TABLE", "TABLESAMPLE", "TEMP", "TEMPORARY", "THEN", "TIES", "TO", "TRAILING",
  "TRANSACTION", "TRIGGER", "TRUE", "TRUNCATE", "TYPE", "UNBOUNDED", "UNION", "UNIQUE", "UNLOGGED", "UPDATE", "USING",
  "VACUUM", "VALUES", "VARIADIC", "VERBOSE", "VIEW", "VOLATILE", "WHEN", "WHERE", "WINDOW", "WITH", "WITHIN", "WITHOUT", "WORK",
  "WRITE",
];

export const PGSQL_TYPES = [
  "bigint", "boolean", "bytea", "char", "character", "cidr", "date", "decimal", "double", "inet", "int", "int2", "int4",
  "int8", "integer", "interval", "json", "jsonb", "money", "numeric", "precision", "real", "smallint", "text", "time",
  "timestamp", "timestamptz", "tsvector", "uuid", "varchar", "varying", "xml", "zone",
];

export const PGSQL_FUNCTIONS = [
  "abs", "age", "array_agg", "array_length", "array_position", "array_to_string", "avg", "bool_and", "bool_or", "btrim",
  "cardinality", "ceil", "char_length", "clock_timestamp", "coalesce", "concat", "concat_ws", "count", "current_date",
  "current_schema", "current_setting", "current_time", "current_timestamp", "current_user", "date_bin", "date_part",
  "date_trunc", "decode", "dense_rank", "encode", "every", "extract", "first_value", "floor", "format", "format_type",
  "gen_random_uuid", "generate_series", "greatest", "initcap", "json_agg", "json_build_object", "jsonb_agg",
  "jsonb_array_elements", "jsonb_build_object", "jsonb_each", "jsonb_object_agg", "jsonb_path_query", "jsonb_set",
  "jsonb_typeof", "lag", "last_value", "lead", "least", "left", "length", "localtimestamp", "lower", "lpad", "ltrim",
  "make_date", "make_interval", "make_timestamp", "max", "md5", "min", "mod", "now", "ntile", "nullif", "overlay",
  "percent_rank", "percentile_cont", "percentile_disc", "pg_backend_pid", "pg_cancel_backend", "pg_relation_size",
  "pg_size_pretty", "pg_sleep", "pg_terminate_backend", "pg_total_relation_size", "position", "power", "quote_ident",
  "quote_literal", "random", "rank", "regexp_match", "regexp_matches", "regexp_replace", "regexp_split_to_array", "repeat",
  "replace", "reverse", "right", "round", "row_number", "rpad", "rtrim", "split_part", "sqrt", "starts_with",
  "statement_timestamp", "string_agg", "string_to_array", "strpos", "substr", "substring", "sum", "to_char", "to_date",
  "to_json", "to_jsonb", "to_number", "to_timestamp", "transaction_timestamp", "translate", "trim", "trunc", "unnest", "upper",
];
