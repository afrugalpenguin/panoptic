# Changelog and What's new spec

Decided 29 Oct 2026. Pairs with ADR 0013 (write it first, same decision in ADR form).

## Why this shape

Every merge to main ships a release and the patch number is the workflow run number (release.yml). There is no release moment where anyone writes notes, and the workflow must not commit back to main. So the changelog is derived from git at build time, never maintained as a versioned file by hand.

## Source: change fragments

- Folder `changes/` at the repo root. One markdown file per PR that changes behaviour, named after the change in kebab-case: `changes/explorer-env-groups.md`.
- Content is user-facing prose, one line or a short paragraph. First word is a category prefix, one of `Added:`, `Changed:`, `Fixed:`, `Removed:`. Markdown subset only (see the `WhatsNewView.svelte` bullet under "UI: the What's new tab"). No PR numbers, no commit hashes, no code paths unless the user would type them.
- Fragments are never edited, renamed, moved or deleted after merge. Git history is what assigns them to a release.
- `changes/README.md` explains the rule in five lines and is itself ignored by the generator.
- CI check (its own workflow, fragment.yml, so a retitle re-runs only this check; runs on pull_request only): if the PR title starts with `feat` or `fix` (conventional commit type, with or without scope and `!`), the diff against the base branch must add at least one file matching `changes/*.md` other than README.md. Otherwise fail with a message that says what to add. `chore`, `ci`, `docs`, `refactor`, `test`, `perf`, `build`, `style` are exempt. The check reads `github.event.pull_request.title`, not the commit messages.
- The same check, on every PR whatever its title, also fails if the PR modifies, renames or deletes an existing file under `changes/` (`git diff --diff-filter=MDR`; editing `changes/README.md` is allowed, it is documentation), or if an added fragment is not directly under `changes/`, is empty, or does not start with `Added:`, `Changed:`, `Fixed:` or `Removed:` followed by text. The diff base is the first parent of the PR's test merge commit, not the event's `base.sha`, which goes stale when main moves and would count fragments other PRs merged since.

## Enforcement: the ruleset on main

The fragment check only blocks a merge if it is a required status check. The repository ruleset `main` (Settings > Rules > Rulesets, created 2026-10-29) is the source of truth; this is what it holds, and what to set if it is ever recreated:

- Target: the default branch. Enforcement: Active. Bypass list: empty.
- Restrict deletions; block force pushes.
- Require a pull request before merging, 0 approvals (single maintainer).
- Require status checks to pass, source GitHub Actions, checks `ui`, `sidecar`, `shell` (ci.yml) and `fragment` (fragment.yml). These are job names, not workflow names. "Require branches to be up to date" off: every merge releases, and the checks already run on the test merge commit.

A required check that is skipped (a job whose `if:` is false) reports success and does not block the merge. So none of these jobs may carry an `if:` that can be false on a pull_request event: that is why the fragment check lives in its own workflow (ci.yml's build jobs would otherwise be skipped on a retitle) and why fragment.yml's job has no `if:`. A cancelled run (fragment.yml cancels superseded runs) does not count as passing; the newer run decides.

The check reads the PR title, but a squash merge of a one-commit PR takes the commit subject by default, so the PR title and the commit on main can disagree. Set Settings > General > Pull Requests > Allow squash merging > default message to "Default to pull request title" so the commit on main always carries the title the check saw.

## Generator: scripts/changelog.ps1

- PowerShell, like every other script in `scripts/`. Needs full history and tags (`fetch-depth: 0` in the workflow).
- Walks tags matching `v*` in version order (parse the three numbers, do not sort as strings). For each tag, the fragments are the files added under `changes/` between the previous tag and this one: `git diff --name-only --diff-filter=A <prev>..<tag> -- changes/`, README excluded. Content is read at that tag (`git show <tag>:<path>`), not from the working tree, so later edits cannot rewrite history. For the first tag, the range is from the root commit.
- `-Head <version>` adds a section for the version being built now, covering fragments added since the latest tag. The release workflow passes the version it just computed; the tag does not exist yet at that point.
- Output, newest first:

```
# Panoptic changelog

## v0.2.13 (2026-10-29)

- Added: ...
- Fixed: ...
```

Within a section fragments are grouped by category in the order Added, Changed, Fixed, Removed, prefix stripped, each fragment one bullet (multi-line fragments become one bullet with continuation lines). The date is the tag's commit date in UTC. A release with no fragments gets a section with the single line `No user-facing changes.` so the app can still slice by version.

- `-Latest` prints only the newest section's body (no `##` heading), for the GitHub release body.
- `-Out <path>` writes the full file; default is stdout. Written as UTF-8 without BOM, LF line endings, like set-version.ps1.
- Pester or a plain script test is not required; the generator is exercised by running it in CI (see below) and a unit test on the parsing side lives in the UI.

## Release workflow changes (release.yml)

- `actions/checkout@v5` with `fetch-depth: 0`.
- After "Set version": run `scripts/changelog.ps1 -Head $version -Out apps/desktop/src-tauri/CHANGELOG.md` and `scripts/changelog.ps1 -Head $version -Latest` into a file, then read that file into a multi-line env var or step output for the release body.
- `releaseBody` becomes the generated latest section followed by a blank line and the existing one-paragraph "Two ways to run it" text, so the GitHub release page shows real notes and `latest.json` carries them too (tauri-action puts the release body in the updater manifest's `notes`).
- Bundle the file: `bundle.resources: ["CHANGELOG.md"]` in tauri.conf.json so the installer puts it next to the exe. Add `CHANGELOG.md` to the "Attach portable zip" copy list.
- Add `src-tauri/CHANGELOG.md` to .gitignore; it is a build artifact. `pnpm dev` and `pnpm build` must also produce it: add a `changelog` script to apps/desktop/package.json that runs the generator with `-Head` set to the package.json version, and call it from `beforeDevCommand` and `beforeBuildCommand`. If git is unavailable or has no tags (a fresh clone, a tarball), the generator writes a file with only the heading and the current version section reading `No release history available.` and exits 0; the app must never fail to start over a missing or empty changelog.
- The ci.yml ui job runs the generator once (`-Head 0.0.0`) so a broken script fails CI, not a release.

## Shell: one new command

- Rust command `changelog_markdown() -> Result<String, String>` reads `CHANGELOG.md` from `app.path().resource_dir()`. No new fs plugin scope; reading one known file from the resource dir in Rust keeps capabilities/default.json unchanged. Missing file returns Ok with an empty string.

## Sidecar: one new setting

- `AppSettings` gains `string? LastSeenVersion = null`. Null means never recorded (fresh install, or a store written before this change). Validated in ConfigStore as either null or matching `^\d+\.\d+\.\d+$`. Round-trip covered by the existing StoreAndTreeTests pattern.
- Mirrored in the UI `AppSettings` type as `lastSeenVersion?: string`.

## UI: the What's new tab

- New module `apps/desktop/src/whats-new.ts`:
  - `parseChangelog(markdown): { version, date, body }[]` splits the generated file on `## v` headings. Pure, unit-tested (vitest) against a fixture string, including the empty and the single-section cases.
  - `compareVersions(a, b)` numeric three-part compare, unit-tested.
  - `sectionsSince(sections, lastSeen)` returns every section with version greater than lastSeen, newest first. `lastSeen` null returns `[]`: a first install shows nothing.
- Startup, in App.svelte after settings load and before update checks are scheduled: `const current = await currentVersion()`; if `settings.lastSeenVersion !== current`: when `lastSeenVersion` is not null, call `changelog_markdown`, take `sectionsSince`, and if non-empty open the What's new tab; in every case save `lastSeenVersion = current` through `settings.save`. Save happens even when the tab is not opened, so the version is recorded on first install. Opening the tab must not delay first paint: do it after the tree has loaded, same place `scheduleUpdateChecks` is wired.
- The tab lives in the existing workspace. Generalise the workspace tab list to a discriminated union: `QueryTab` stays as is with `kind: "query"`, new `WhatsNewTab` has `kind: "whats-new"`, `id: "whats-new"` (singleton; opening again focuses it), `title: "What's new in v0.2.13"` (newest version shown) and `sections`. Workspace.svelte renders `QueryView` for query tabs and `WhatsNewView` for the other. The tab strip's env colour band is transparent for it. Middle-click and the x close it like any tab. Query store logic (routing of rows and messages) only ever touches query tabs; filter by kind, do not add optional fields to `QueryTab`.
- `WhatsNewView.svelte`: scrollable, max width around 72ch, UI font. Each section is an `h2` with the version and date muted beside it, then a `ul`. Rendering uses a hand-written markdown subset: `**bold**`, `` `code` ``, `[text](https://...)` opened with the Tauri opener plugin (or `shell.open` if that is what the repo already uses for external links; add `opener:allow-open-url` to capabilities only if the opener plugin is introduced, scoped to `https://*`: without a scope it denies every url). Nothing else is interpreted; everything else is text. No markdown library.
- Settings dialog: a "What's new" button next to "Check now". It opens the tab with every section (not sliced), so the full history is always reachable. Disabled with a tooltip when the changelog is empty.
- No modal, no toast, no sound. Closing the tab is the only interaction. If the workspace already has query tabs open, the What's new tab is appended and made active once; the user's query tabs are untouched.

## Docs

- ADR 0013 `docs/adr/0013-changelog.md`: Status Accepted, Date 2026-10-29. Context: releases on every merge, version from run number, no commit-back. Decision: fragments in `changes/`, generated at build time, bundled as a resource, shown as a workspace tab on first launch after a version change, CI requires a fragment for feat and fix PRs. Consequences: the changelog is not a file in the repo; the GitHub release page and the app always agree because both come from the same generator run; a PR that forgets a fragment is blocked, not shipped silently. Add the row to docs/adr/README.md.
- README.md: the Release section still describes the old tag-driven flow and set-version.ps1's final message says to tag after merge. Both are stale against release.yml. Replace with: every merge to main releases; bump the minor with set-version.ps1 on a branch to start a new series; add a `changes/*.md` fragment to any feat or fix PR. Fix the set-version.ps1 message to match.
- `docs/plan.md`: nothing to change unless it lists release steps.

## Out of scope

Fetching notes from GitHub at runtime (would be a second outbound call, ADR 0009 and 0010), a `CHANGELOG.md` committed to the repo, editing fragments after merge, categories beyond the four above, a "don't show again" setting (there is nothing to dismiss; the tab opens once per version).
