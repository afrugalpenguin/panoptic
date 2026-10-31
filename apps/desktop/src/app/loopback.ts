/**
 * Whether an endpoint is this machine, in any of the shapes the engines take: a URL (Cosmos), `host,port` or
 * `host\instance` (SQL Server, including `.`, `(local)` and LocalDB), `host:port` (Postgres) and IPv6 literals.
 */
export function isLoopback(endpoint: string): boolean {
  const host = hostOf(endpoint.trim()).toLowerCase();
  return (
    host === "localhost" ||
    host === "." ||
    host === "(local)" ||
    host.startsWith("(localdb)") ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

function hostOf(endpoint: string): string {
  if (endpoint.includes("://")) {
    try {
      return new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return "";
    }
  }
  if (endpoint.startsWith("[")) return endpoint.slice(1, endpoint.indexOf("]"));
  const cut = endpoint.split(/[,\\]/)[0];
  // host:port, but not a bare IPv6 literal such as ::1.
  return (cut.match(/:/g) ?? []).length === 1 ? cut.split(":")[0] : cut;
}
