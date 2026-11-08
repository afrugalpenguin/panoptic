# Postgres sign-in with AWS RDS IAM (#121)

A follow-up to docs/plans/2026-10-30-postgres-design.md. Amazon RDS and Aurora PostgreSQL accept a short-lived IAM authentication token as the password. A token is a SigV4-presigned `connect` request for one host, port and database user, signed with the caller's AWS credentials. It is valid for 15 minutes and is only checked when a connection opens.

## Auth kind

- New `AuthKinds.AwsIam = "awsIam"`, listed as "AWS IAM (RDS)", and accepted only by the Postgres backend (`AuthsFor`).
- No secret is stored. The connection holds the database user, as with password auth, plus two new optional fields on `ConnectionConfig`:
  - `AwsProfile`: the named profile in the shared AWS config (`~/.aws/config` and `credentials`). Blank means the SDK's default chain (environment variables, then the `default` profile, then SSO and process credentials from it).
  - `AwsRegion`: blank means it is read from the host name (`<name>.<id>.<region>.rds.amazonaws.com`, which also covers cluster, reader and proxy endpoints). A host that is not an RDS name (a tunnel, `localhost`, a custom DNS name) needs the region set, and the dialog and sidecar both say so.
- A tunnel or custom DNS name also needs the token signed for the real RDS host. The certificate host name field already names the real host for TLS, so when it is set, the token is signed for that host instead of the endpoint. That covers SSH tunnels and port forwards without another field.

## Sidecar

- Packages: `AWSSDK.Core` for credentials and profiles, plus `AWSSDK.SSO` and `AWSSDK.SSOOIDC`, which the SDK loads for IAM Identity Center (SSO) profiles. The token comes from `Amazon.RDS.Util.RDSAuthTokenGenerator` if that can be had without pulling in the whole RDS client. If not, a small SigV4 presigner signs the token with `AWSSDK.Core`'s signer. Pick the smaller option, add the package size to the PR, and update `packages.lock.json` for both projects.
- `Open` gets an `AwsIam` case: the user is required, the region is resolved or it is an invalid-params error, and credentials are resolved once per data source. The data source uses `UsePasswordProvider` with an async provider that generates a fresh token on each physical open. Generation is local signing, and the SDK caches and refreshes the credentials. The data source key includes the profile, region and signing host.
- Sign-in runs under `SignInBudget`, like Entra, so an SSO refresh does not hit the 15 s connect timeout.
- **SSO:** an expired IAM Identity Center session is not refreshed interactively by Panoptic in this version. The error names the profile and says to run `aws sso login --profile <name>`. A missing profile or missing credentials gets its own plain message. These go through the existing NodeError mapping, so the tree shows one line and the Problems tab has the details.
- **TLS:** unchanged. RDS server certificates chain to the Amazon RDS CAs, which are not in the Windows store, so VerifyFull needs the RDS bundle as the certificate file (the existing field). When a VerifyFull open to an `rds.amazonaws.com` host fails on the chain, the error says to download the RDS certificate bundle and choose it as the certificate file.

## UI

- The connection dialog for Postgres lists "AWS IAM (RDS)". With it selected, it shows User (required), AWS profile (placeholder "default"), Region (placeholder: the region read from the server name, or "Required for this server name"), and the existing certificate options. There is no password field.
- Regenerate the TS types (`pnpm types`).
- Docs: a section in `docs/connectors/postgres.md` covering the profile, SSO login, region, the RDS certificate bundle, tunnels, and the IAM policy the user needs (`rds-db:connect` on the db user's ARN). Add a change fragment.

## Tests

- Region from host: instance, cluster, reader, proxy, China (`.amazonaws.com.cn`) and GovCloud names, and non-RDS names returning none.
- Token generation with fixed `BasicAWSCredentials` and a fixed clock: host:port prefix, `Action=connect`, `DBUser`, the `X-Amz-*` query fields, 900 s expiry, signed for the certificate host name when one is set.
- Auth allowlist: Postgres accepts `awsIam`, SQL Server and Cosmos reject it. Saving `awsIam` without a user, or without a region on a non-RDS host, is refused.
- Error mapping: missing profile, expired SSO session, untrusted RDS chain.
- No live AWS test. Integration tests stay on the local Postgres container, which cannot check IAM tokens.

## Not in scope

Interactive SSO login from Panoptic, AWS Secrets Manager passwords, and IAM auth for RDS SQL Server (which does not support it).
