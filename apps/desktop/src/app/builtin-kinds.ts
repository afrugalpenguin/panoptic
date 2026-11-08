import type { KindDescription } from "./api";

/**
 * The four built-in kinds exactly as the sidecar's backends.describe returns them (BackendsDescribeTests pins the
 * same values there). For tests and the preview, which run without a sidecar; the app always asks the sidecar.
 */
export const BUILTIN_KINDS: KindDescription[] = [
  {
    kind: "sql",
    label: "SQL Server / Azure SQL",
    endpointLabel: "Server",
    endpointPlaceholder: "myserver.database.windows.net",
    auths: [
      { id: "entra", label: "Microsoft Entra ID" },
      { id: "sql", label: "SQL login" },
      { id: "windows", label: "Windows" },
    ],
    badge: { letters: "S", color: "#2d5aa0", name: "SQL" },
    fields: { database: true, certificateOptions: true, entraUser: false, trustLocalOnly: false },
  },
  {
    kind: "synapse",
    label: "Azure Synapse SQL",
    endpointLabel: "Server",
    endpointPlaceholder: "myworkspace.sql.azuresynapse.net or ...-ondemand...",
    auths: [
      { id: "entra", label: "Microsoft Entra ID" },
      { id: "sql", label: "SQL login" },
    ],
    badge: { letters: "Sy", color: "#7b4fb5", name: "Synapse" },
    fields: { database: true, certificateOptions: true, entraUser: false, trustLocalOnly: false },
  },
  {
    kind: "cosmos",
    label: "Cosmos DB (NoSQL)",
    endpointLabel: "Account URI",
    endpointPlaceholder: "https://myaccount.documents.azure.com:443/",
    auths: [
      { id: "entra", label: "Microsoft Entra ID" },
      { id: "entraKeys", label: "Entra ID (fetch account keys)" },
      { id: "key", label: "Account key" },
    ],
    badge: { letters: "C", color: "#1f7a74", name: "Cosmos" },
    fields: { database: false, certificateOptions: false, entraUser: false, trustLocalOnly: true },
  },
  {
    kind: "postgres",
    label: "PostgreSQL / Azure Database for PostgreSQL",
    endpointLabel: "Server",
    endpointPlaceholder: "myserver.postgres.database.azure.com or host:5432",
    auths: [
      { id: "entra", label: "Microsoft Entra ID" },
      { id: "password", label: "Username and password" },
      { id: "certificate", label: "Client certificate" },
      { id: "awsIam", label: "AWS IAM (RDS)" },
    ],
    badge: { letters: "PG", color: "#5f7a2e", name: "Postgres" },
    fields: { database: true, certificateOptions: true, entraUser: true, trustLocalOnly: false },
  },
];
