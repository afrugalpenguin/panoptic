# Change fragments

Every feat or fix pull request adds one file here, e.g. `changes/explorer-env-groups.md` (CI checks).
Write one user-facing line or short paragraph starting with `Added:`, `Changed:`, `Fixed:` or `Removed:`.
No PR numbers, commit hashes or code paths; markdown is limited to **bold**, `code` and [links](https://example.com).
Never edit, rename, move or delete a fragment after merge: git history assigns it to its release.
`scripts/changelog.ps1` builds the changelog from these at build time; this README is ignored. See docs/changelog.md.
