# 0014. Sign release builds before the next daily-use trial

- Status: Proposed (supersedes 0011 once accepted)
- Date: 2026-10-30

## Context

ADR 0011 shipped unsigned installers in M0 to find out what SmartScreen and Intune do. The answer is in docs/benchmarks.md (Install and Defender), and it is worse than a SmartScreen prompt:

- Unmanaged machine, v0.1.0: Defender quarantined `panoptic.exe` as `Trojan:Win32/Bearfoos.A!ml` as the NSIS installer wrote it. Static scans of the exe, the sidecar and the installer were clean, and the same exe copied or run from the repo was not flagged, so the trigger was the install behaviour, not the file on its own.
- Managed machine, v0.2.0: the install itself succeeded with no SmartScreen prompt, but some time later Defender quarantined the installed `panoptic.exe` with the same detection, consistent with a cloud verdict on an unknown unsigned file.
- In both cases a Defender folder exclusion for `%LOCALAPPDATA%\Panoptic` kept the app alive, and on the managed machine the excluded copy auto-updated in place.

Every merge to main is a release (ADR 0010), so every release is a new unknown hash and the reputation never builds up. A folder exclusion is fine on a personal machine but is not something to ask of users on managed machines, so unsigned builds cannot be used there.

## Decision

Sign the installer and every executable we ship with Authenticode before the next daily-use trial on a managed machine, rather than waiting for v1 as 0011 and the plan's decisions table said.

Still to decide: Azure Trusted Signing (now called Azure Artifact Signing; a monthly subscription, identity validation, no hardware token, short-lived certificates) or a purchased code-signing certificate (an annual cost, key held in a cloud HSM or token).

The release workflow change is deferred until that question is answered, because the secrets and the sign command depend on it. The intended shape:

- Off by default. A repository variable (for example `PANOPTIC_SIGN == 'true'`) turns signing on; when it is off the release is byte-for-byte what it is today and no time is added.
- Fail closed. When the variable is on and any required secret or setting is empty, the job fails with a clear message before building, rather than shipping an unsigned build.
- Signing runs inside Tauri's bundling via `bundle.windows.signCommand`, passed at build time (`tauri build --config <file>`) so tauri.conf.json is unchanged and local builds stay unsigned. The bundler then signs the sidecar, `panoptic.exe` and the uninstaller before they are packed and signs the installer after makensis, and the updater `.sig` is computed over the signed installer, so the updater signature matches what users download. Signing the installer after the action would change its bytes and break the `.sig`.
- The portable zip is signed separately. The bundler signs `panoptic.exe` only inside the installer and restores the unsigned copy in `target/release` afterwards, and the zip copies `target/release/panoptic-sidecar.exe`, which is not the file the bundler signs. The zip step signs both exes it ships and checks their signatures before upload.
- The sidecar is signed too. Defender scans it like any other executable, and it is a new unknown hash every release just like `panoptic.exe`, so leaving it unsigned would leave the same exposure.

## Consequences

Signing adds a recurring cost and a dependency on the signing service for every release when it is on. Signed builds start building reputation with SmartScreen and Defender, and a managed machine should be able to run Panoptic without a local exclusion; that needs confirming on a managed machine and recording in docs/benchmarks.md. Until signing lands, the README tells users about the quarantine and how to allow the detection. It no longer recommends the folder exclusion (2026-10-31): `%LOCALAPPDATA%\Panoptic` is writable by anything running as the user, so excluding it would let malware replace the sidecar, which decrypts the credential store, unscanned (issue #172). Updater integrity still rests on the Tauri updater key (ADR 0010); Authenticode is in addition to it, not a replacement.

When this ADR is accepted, 0011's status becomes "Superseded by 0014".
