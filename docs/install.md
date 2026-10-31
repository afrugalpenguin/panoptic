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

Until builds are signed, add a Defender folder exclusion for `%LOCALAPPDATA%\Panoptic` (Windows
Security, Virus and threat protection, Manage settings, Exclusions, Add an exclusion, Folder) and
reinstall. With the exclusion in place, installed copies update in place as normal. On a managed
machine the exclusion may need your IT team.
