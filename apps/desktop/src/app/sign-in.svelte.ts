// A connection's sign-in settings while they are edited: authentication, user, certificate and AWS options, the secret,
// tenant and client id, and certificate trust. Shared by the New connection dialog and the connection pane's
// Authentication popover (docs/connection-pane.md), so both apply the same rules and the same secret binding.
import type { AuthKind, ConnectionConfig, KindDescription } from "./api";
import { isLoopback } from "./loopback";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sign-in part of a ConnectionConfig: everything SignInDraft edits. */
export type SignInConfig = Pick<
  ConnectionConfig,
  | "auth"
  | "user"
  | "tenantId"
  | "clientId"
  | "trustServerCertificate"
  | "certificateHostName"
  | "certificateFile"
  | "clientCertificateFile"
  | "clientKeyFile"
  | "awsProfile"
  | "awsRegion"
>;

/** Optional text that compares blank-or-missing as equal, ignoring case and surrounding space. */
const same = (a?: string | null, b?: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * A saved secret can be kept only while the edit still points where it was saved for: same type, server, sign-in,
 * user and certificate trust (the sidecar enforces the same rule). Otherwise it has to be entered again.
 */
export function keepsSecret(saved: ConnectionConfig, edited: ConnectionConfig): boolean {
  return (
    edited.kind === saved.kind &&
    edited.endpoint.toLowerCase() === saved.endpoint.toLowerCase() &&
    edited.auth === saved.auth &&
    (edited.user ?? null) === (saved.user ?? null) &&
    edited.trustServerCertificate === saved.trustServerCertificate &&
    same(edited.certificateHostName, saved.certificateHostName) &&
    same(edited.certificateFile, saved.certificateFile) &&
    same(edited.clientCertificateFile, saved.clientCertificateFile) &&
    same(edited.clientKeyFile, saved.clientKeyFile)
  );
}

/** Sign-ins that store a secret Panoptic must keep (a password or an account key); the others store none. */
export const storesSecret = (auth: AuthKind) => auth === "sql" || auth === "password" || auth === "key";

export class SignInDraft {
  auth = $state<AuthKind>("entra");
  user = $state("");
  tenantId = $state("");
  clientId = $state("");
  trust = $state(false);
  certHost = $state("");
  certFile = $state("");
  clientCert = $state("");
  clientKey = $state("");
  awsProfile = $state("");
  awsRegion = $state("");
  secret = $state("");

  /** The kind being edited and its endpoint, which the rules read; the caller owns both. */
  readonly described: () => KindDescription;
  readonly endpoint: () => string;

  constructor(described: () => KindDescription, endpoint: () => string, initial?: ConnectionConfig) {
    this.described = described;
    this.endpoint = endpoint;
    this.auth = initial?.auth ?? "entra";
    this.user = initial?.user ?? "";
    this.tenantId = initial?.tenantId ?? "";
    this.clientId = initial?.clientId ?? "";
    this.trust = initial?.trustServerCertificate ?? false;
    this.certHost = initial?.certificateHostName ?? "";
    this.certFile = initial?.certificateFile ?? "";
    this.clientCert = initial?.clientCertificateFile ?? "";
    this.clientKey = initial?.clientKeyFile ?? "";
    this.awsProfile = initial?.awsProfile ?? "";
    this.awsRegion = initial?.awsRegion ?? "";
  }

  readonly fields = $derived.by(() => this.described().fields);
  readonly authOptions = $derived.by(() => this.described().auths);
  /** Client certificate sign-in (Postgres, #120): a certificate and key, and the key's passphrase as an optional secret. */
  readonly certAuth = $derived(this.auth === "certificate");
  /** AWS IAM sign-in (Postgres on Amazon RDS, #121): a token from the AWS profile's credentials, so no secret. */
  readonly awsAuth = $derived(this.auth === "awsIam");
  /** A user is required: a login's name, the role a client certificate maps to, or the IAM database user. */
  readonly login = $derived(this.auth === "sql" || this.auth === "password" || this.certAuth || this.awsAuth);
  readonly needsSecret = $derived(storesSecret(this.auth));
  readonly showSecret = $derived(this.needsSecret || this.certAuth);
  /** A .pfx or .p12 holds the key as well, so needs no key file. */
  readonly bundle = $derived(/\.(pfx|p12)$/i.test(this.clientCert.trim()));
  /** Signs in with Entra: directly, or to fetch a Cosmos account's keys (#65). Either way the tenant and client id apply. */
  readonly entra = $derived(this.auth === "entra" || this.auth === "entraKeys");
  /** Postgres signs Entra users in under their Entra name; blank means the name from the sign-in. */
  readonly entraUser = $derived.by(() => this.fields.entraUser && this.auth === "entra");
  /** The region in an RDS server name (the certificate host name's, for a tunnel), as the sidecar reads it. */
  readonly rdsRegion = $derived.by(
    () =>
      /^[^:]+\.[^.:]+\.([a-z]{2}(?:-[a-z]+)+-\d+)\.rds\.amazonaws\.com(?:\.cn)?\.?(?::\d+)?$/i.exec(this.certHost.trim() || this.endpoint().trim())?.[1]?.toLowerCase() ?? "",
  );
  readonly secretName = $derived(this.auth === "key" ? "account key" : "password");
  /** Some kinds (Cosmos) allow skipping the check for a localhost emulator only (the sidecar refuses otherwise). */
  readonly trustWarning = $derived.by(() => {
    const endpoint = this.endpoint().trim();
    if (!this.trust || this.fields.trustLocalOnly || !endpoint || isLoopback(endpoint)) return "";
    const what = this.entra
      ? "your Microsoft Entra sign-in token, which could then be used against other Azure databases for up to an hour"
      : this.auth === "windows"
        ? "your queries and their results"
        : this.awsAuth
          ? "an IAM sign-in token, which could then be used against this database for up to 15 minutes"
          : "the password";
    return `The certificate of ${endpoint} won't be checked, so anyone able to intercept the connection could pose as it and capture ${what}. Only trust certificates for servers you control. Where you can, use a certificate host name or file instead.`;
  });

  /** The sign-in settings as saved: blanks and options the sign-in does not use are left out (null). */
  config(): SignInConfig {
    const fields = this.fields;
    return {
      auth: this.auth,
      user: this.login || (this.entraUser && this.user.trim()) ? this.user.trim() : null,
      tenantId: this.entra && this.tenantId.trim() ? this.tenantId.trim() : null,
      clientId: this.entra && this.clientId.trim() ? this.clientId.trim() : null,
      trustServerCertificate: this.trust,
      certificateHostName: fields.certificateOptions && this.certHost.trim() ? this.certHost.trim() : null,
      certificateFile: fields.certificateOptions && this.certFile.trim() ? this.certFile.trim() : null,
      clientCertificateFile: this.certAuth && this.clientCert.trim() ? this.clientCert.trim() : null,
      clientKeyFile: this.certAuth && this.clientKey.trim() ? this.clientKey.trim() : null,
      awsProfile: this.awsAuth && this.awsProfile.trim() ? this.awsProfile.trim() : null,
      awsRegion: this.awsAuth && this.awsRegion.trim() ? this.awsRegion.trim() : null,
    };
  }

  /** What to send as the secret: blank keeps the stored one while keepsSaved allows, "" clears it. */
  secretArg(keepsSaved: boolean): string | undefined {
    return this.showSecret ? this.secret || (keepsSaved ? undefined : "") : "";
  }

  /** The first sign-in problem, or "". editing words a missing secret as "enter it again". */
  validate(keepsSaved: boolean, editing: boolean): string {
    const fields = this.fields;
    if (this.login && !this.user.trim()) return "User is required";
    if (this.entra && this.clientId.trim() && !GUID.test(this.clientId.trim()))
      return "Client id must be an app's Application (client) ID, a GUID such as 11111111-2222-3333-4444-555555555555";
    if (this.certAuth && !this.clientCert.trim()) return "Choose the client certificate file.";
    if (this.certAuth && !this.clientKey.trim() && !this.bundle) return "Choose the certificate's private key file, or use a .pfx file, which holds both.";
    if (this.awsAuth && !this.awsRegion.trim() && !this.rdsRegion) return "Enter the AWS region: it can't be read from this server name.";
    if (fields.certificateOptions && this.trust && (this.certHost.trim() || this.certFile.trim()))
      return "Turn off Trust server certificate to use a certificate host name or file: trusting skips the checks they set up.";
    if (this.needsSecret && !this.secret && !keepsSaved)
      return editing
        ? `Enter the ${this.secretName} again: the server, user, sign-in or certificate setting changed, so the saved one is not sent.`
        : this.auth === "key" ? "Account key is required" : "Password is required";
    return "";
  }

  /** Every field, for an effect that drops a stale test result when any of them changes. */
  touch(): unknown[] {
    return [this.auth, this.user, this.tenantId, this.clientId, this.trust, this.certHost, this.certFile, this.awsProfile, this.awsRegion, this.secret];
  }
}
