// Generated from the sidecar's JSON records by GeneratedTypesTests (apps/sidecar/Panoptic.Sidecar.Tests).
// Do not edit: change the C# record, then regenerate with
//   $env:PANOPTIC_UPDATE_TYPES = '1'; dotnet test apps/sidecar --filter GeneratedTypes

export interface AppConfig {
  environments: EnvironmentConfig[];
  connections: ConnectionConfig[];
}

export interface AppSettings {
  updateCheck: string;
  lastSeenVersion?: string | null;
  explorer: ExplorerSettings;
  editor: EditorSettings;
}

export interface AuthOption {
  id: string;
  label: string;
}

export interface BackupExportResult {
  environments: number;
  connections: number;
}

export interface BackupImportParams {
  path: string;
  connections: number[];
}

export interface BackupImportResult {
  environmentsCreated: number;
  connectionsAdded: number;
  skipped: number;
}

export interface BackupPathParams {
  path: string;
}

export interface BackupPreview {
  environments: BackupPreviewEnvironment[];
  connections: BackupPreviewConnection[];
}

export interface BackupPreviewConnection {
  index: number;
  name: string;
  kind: string;
  endpoint: string;
  auth: string;
  user?: string | null;
  database?: string | null;
  environment?: string | null;
  skip?: string | null;
}

export interface BackupPreviewEnvironment {
  name: string;
  color: string;
  readOnly: boolean;
  exists: boolean;
}

export interface CatalogNotice {
  key: string;
  state: string;
  catalog?: DatabaseCatalog | null;
  message?: string | null;
}

export interface CatalogObject {
  name: string;
  schema: string;
  kind: string;
  columns?: ColumnRef[] | null;
  params?: ParamRef[] | null;
}

export interface CatalogParams {
  nodeId: string;
  database?: string | null;
}

export interface CatalogResult {
  key: string;
  state: string;
  catalog?: DatabaseCatalog | null;
}

export interface ColumnRef {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  kind: string;
  endpoint: string;
  auth: string;
  user?: string | null;
  database?: string | null;
  tenantId?: string | null;
  trustServerCertificate: boolean;
  clientId?: string | null;
  certificateHostName?: string | null;
  certificateFile?: string | null;
  clientCertificateFile?: string | null;
  clientKeyFile?: string | null;
}

export interface ConnectionFields {
  database: boolean;
  certificateOptions: boolean;
  entraUser: boolean;
  trustLocalOnly: boolean;
}

export interface ContainerRef {
  name: string;
  partitionKey: string;
  paths: PathRef[];
}

export interface DatabaseCatalog {
  stamp: string;
  schemas: string[];
  objects: CatalogObject[];
  types: string[];
  containers?: ContainerRef[] | null;
}

export interface DeviceCodePrompt {
  message: string;
  userCode: string;
  verificationUri: string;
}

export interface EditorSettings {
  intellisense: boolean;
  keywordCase?: string | null;
  catalogSampleDocs: number;
  autoRefreshOnDdl: boolean;
  warnUnknownNames: boolean;
  maxRows: number;
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  color: string;
  readOnly: boolean;
  connections: ConnectionConfig[];
}

export interface ExplorerSettings {
  showKindBadge: boolean;
  rowFont: string;
  envOrder: string[];
}

export interface IdParams {
  id: string;
}

export interface ImportCandidate {
  name: string;
  kind: string;
  endpoint: string;
  auth: string;
  user?: string | null;
  database?: string | null;
  trustServerCertificate: boolean;
  note?: string | null;
  alreadyAdded: boolean;
}

export interface ImportFileParams {
  path: string;
}

export interface ImportGroup {
  name: string;
  connections: ImportCandidate[];
}

export interface ImportSource {
  source: string;
  label: string;
  path: string;
  groups: ImportGroup[];
  error?: string | null;
}

export interface KindBadge {
  letters: string;
  color: string;
  name: string;
}

export interface KindDescription {
  kind: string;
  label: string;
  endpointLabel: string;
  endpointPlaceholder: string;
  auths: AuthOption[];
  badge: KindBadge;
  fields: ConnectionFields;
}

export interface NodeError {
  summary: string;
  detail: string;
  code?: string | null;
  retryable: boolean;
}

export interface NodeInvokeParams {
  nodeId: string;
  actionId: string;
}

export interface NodeInvokeResult {
  text?: string | null;
}

export interface NodeScopeParams {
  nodeId: string;
}

export interface ParamRef {
  name: string;
  type: string;
  output: boolean;
}

export interface PathRef {
  path: string;
  types: string[];
}

export interface PurgeSecretsParams {
  connectionIds?: string[] | null;
}

export interface QueryCancelParams {
  queryId: string;
}

export interface QueryCapabilities {
  databasePicker: boolean;
  unknownNameWarnings: boolean;
  ddlRefresh: boolean;
}

export interface QueryRequest {
  queryId: string;
  nodeId: string;
  text: string;
  database?: string | null;
}

export interface QuerySaveRequest {
  queryId: string;
  nodeId: string;
  text: string;
  path: string;
  format: string;
  database?: string | null;
}

export interface QuerySaveResult {
  rows: number;
  cancelled: boolean;
  error?: string | null;
  note?: string | null;
}

export interface QueryScope {
  connection: string;
  database?: string | null;
  container?: string | null;
  label: string;
  connectionLabel: string;
}

export interface QuerySummary {
  queryId: string;
  resultSets: ResultSetSummary[];
  elapsedMs: number;
  rolledBack: boolean;
  committed: boolean;
  cancelled: boolean;
  error?: string | null;
  requestCharge?: number | null;
}

export interface QueryTemplateParams {
  nodeId: string;
  action: string;
}

export interface QueryTemplateResult {
  text?: string | null;
  language: string;
  scope: QueryScope;
  capabilities: QueryCapabilities;
}

export interface ResultSetSummary {
  rowCount: number;
  truncated: boolean;
}

export interface SaveConnectionParams {
  environmentId?: string | null;
  connection: ConnectionConfig;
  secret?: string | null;
}

export interface TestConnectionParams {
  connection: ConnectionConfig;
  secret?: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  elapsedMs: number;
  error?: string | null;
}

export interface TreeChildrenParams {
  nodeId: string;
}

export interface TreeNode {
  id: string;
  kind: string;
  label: string;
  icon: string;
  hasChildren: boolean;
  actions: string[];
  meta?: Record<string, string> | null;
}
