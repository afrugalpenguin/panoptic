# Installing Panoptic

Download `Panoptic_<version>_x64-setup.exe` from the
[latest release](https://github.com/afrugalpenguin/panoptic/releases/latest) and run it. It
installs per-user into `%LOCALAPPDATA%\Panoptic` with no elevation. To run without installing,
unzip `Panoptic_<version>_x64-portable.zip` anywhere and run `panoptic.exe`.

## Updates

Installed copies check for updates on launch and offer "Restart to update". Settings can switch
that to hourly or turn automatic checks off; Check now stays available. The portable build tells
you when a new version exists. The update check is the only outbound call Panoptic makes.

## SmartScreen and Microsoft Defender

Builds are not code-signed yet; signing is planned, see [ADR 0014](adr/0014-code-signing.md).

- **SmartScreen** may warn on first install. Choose More info, then Run anyway.
- **Microsoft Defender** may quarantine `panoptic.exe` as `Trojan:Win32/Bearfoos.A!ml`, either as
  the installer writes it or some time later. This is a false positive on an unknown unsigned file:
  static scans of the exe, the database engine and the installer are clean, and the trigger is the
  unsigned installer dropping an unsigned exe (see the 2026-10-29 rows in
  [benchmarks.md](benchmarks.md)). Every release is a new file Defender has not seen, so it can
  happen again after an update.

Until builds are signed, the safest way to keep it is to allow that one detection: Windows
Security, Virus and threat protection, Protection history, open the `Bearfoos` entry, then
Actions, **Allow on device**, and reinstall. This allows that exact file only, so it may be
needed again after an update.

If that is too frequent, a **file** exclusion for `%LOCALAPPDATA%\Panoptic\panoptic.exe` only
(Manage settings, Exclusions, Add an exclusion, File) is the narrower fallback. It has not been
confirmed to stop this quarantine, and it means anything that replaces that one file is not
scanned.

**Do not exclude the whole `%LOCALAPPDATA%\Panoptic` folder.** Any program running as you can
write there, so a folder exclusion lets it drop or replace files unscanned, including the
database engine (`panoptic-sidecar.exe`), which decrypts your saved credentials. On a managed
machine, ask your IT team rather than adding exclusions yourself.
