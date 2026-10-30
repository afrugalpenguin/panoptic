# Changelog and What's new spec

Decided 29 Oct 2026. Pairs with ADR 0013 (write it first, same decision in ADR form). Visual spec v2 for the tab added 30 Oct 2026 at the end.

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

A required check that is skipped (a job whose `if:` is false) reports success and does not block the merge. So a job may only carry an `if:` that is false when skipping it is safe: fragment.yml's job has none, and the fragment check lives in its own workflow so a retitle never touches ci.yml. ci.yml's four build jobs are skipped on purpose for docs-only pull requests (every changed file under `docs/` or a `.md` file), decided by its `changes` job; that `if:` fails closed, so the jobs run unless `changes` positively reports docs only. A path filter on the workflow itself would not work: a workflow that never starts leaves its required checks pending, which blocks the merge. A cancelled run (fragment.yml cancels superseded runs) does not count as passing; the newer run decides.

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
- The tab lives in the existing workspace. Generalise the workspace tab list to a discriminated union: `QueryTab` stays as is with `kind: "query"`, new `WhatsNewTab` has `kind: "whats-new"`, `id: "whats-new"` (singleton; opening again focuses it), `title: "What's new"` and `sections`. Workspace.svelte renders `QueryView` for query tabs and `WhatsNewView` for the other. The tab strip's env colour band is transparent for it. Middle-click and the x close it like any tab. Query store logic (routing of rows and messages) only ever touches query tabs; filter by kind, do not add optional fields to `QueryTab`.
- `WhatsNewView.svelte`: see "Visual spec v2" below. Rendering uses a hand-written markdown subset: `**bold**`, `` `code` ``, `[text](https://...)` opened with the Tauri opener plugin. Nothing else is interpreted; everything else is text. No markdown library.
- Settings dialog: a "What's new" button next to "Check now". It opens the tab with every section (not sliced), so the full history is always reachable. Disabled with a tooltip when the changelog is empty.
- No modal, no toast, no sound. Closing the tab is the only interaction. If the workspace already has query tabs open, the What's new tab is appended and made active once; the user's query tabs are untouched.

## Docs

- ADR 0013 `docs/adr/0013-changelog.md`: Status Accepted, Date 2026-10-29. Context: releases on every merge, version from run number, no commit-back. Decision: fragments in `changes/`, generated at build time, bundled as a resource, shown as a workspace tab on first launch after a version change, CI requires a fragment for feat and fix PRs. Consequences: the changelog is not a file in the repo; the GitHub release page and the app always agree because both come from the same generator run; a PR that forgets a fragment is blocked, not shipped silently. Add the row to docs/adr/README.md.
- README.md: the Release section still describes the old tag-driven flow and set-version.ps1's final message says to tag after merge. Both are stale against release.yml. Replace with: every merge to main releases; bump the minor with set-version.ps1 on a branch to start a new series; add a `changes/*.md` fragment to any feat or fix PR. Fix the set-version.ps1 message to match.
- `docs/plan.md`: nothing to change unless it lists release steps.

## Out of scope

Fetching notes from GitHub at runtime (would be a second outbound call, ADR 0009 and 0010), a `CHANGELOG.md` committed to the repo, editing fragments after merge, categories beyond the four above, a "don't show again" setting (there is nothing to dismiss; the tab opens once per version).

## What's new tab: visual spec v2 (30 Oct 2026)

Replaces the earlier `WhatsNewView.svelte` description. Mockup: board "D. Combined (chosen)" on the "What's new header mockups" canvas. Everything in existing theme tokens; the only new colours are the two from the logo, cyan `#26c6da` and amber `#ffc107`, introduced as `--brand-cyan` and `--brand-amber` in app.css (same values in both themes).

Known bug fixed here: the logo never rendered in the installed build. `128x128.png` is 1.6 KB, under Vite's 4 KB `assetsInlineLimit`, so the production build inlined it as a `data:` URI, and the CSP (`default-src 'self'`, no `img-src`) blocks `data:` images. It worked in `tauri dev`. Fix: `build.assetsInlineLimit: 0` in vite.config.ts, with a comment saying why. Do not loosen the CSP.

### Masthead

Full width, background `--bg-pane`, bottom border `--border`, padding about 30px 40px 26px. A two-stripe left edge, 4px cyan then 4px amber, full height of the masthead. Contents, left to right: the logo at 64px (the existing `128x128@2x.png` or `icon.png`, whichever is sharp at 64px on a 2x display); a title block with `Panoptic 0.2.44` at 26px/600, the version in amber; under it a muted 13px line: `Updated today. N releases since you last opened it.` (N = unseen count; when opened from Settings: `Every release.`); a spacer; a secondary button `Releases on GitHub` opening `https://github.com/afrugalpenguin/panoptic/releases` through the opener. The tab strip title becomes `What's new` with the 14px logo as the tab icon, env band transparent.

### Timeline

Below the masthead, padding 8px 40px 24px. One row per release, flex: a 120px right-aligned gutter holding the version (14px/600), the date (11px muted, `30 Oct` form) and, on the current version only, a small pill `current` (`--bg-selected` background); the gutter's right edge is a 2px vertical rule, `--accent` for the current version and `--border` for the others. Body column padding 14px 0 14px 22px, line-height 1.6, items 10px apart. Each item is a flex row: a 64px category tag (11px/600, 4px radius, tinted background, text in the category colour: Added green `--ok`, Changed amber, Fixed cyan, Removed red `--bad`, each tint `color-mix(in srgb, <colour> 15%, var(--bg-pane))`) then the note text. The generator already emits `Added:` style prefixes grouped in order; the parser splits the prefix off into the tag. Earlier versions' text is a step lighter than `--text` (not `--text-muted`); the current version's is `--text`.

The newest release is separated from the rest by a 1px horizontal rule (`--border`, margin 14px 0) across the full content width. The rule is not drawn when there is only one release in the tab.

### What is shown

On launch: every release newer than `lastSeenVersion`, however many. From Settings: every release in the bundled file. There is no cap on either; a "last N" cap was considered and dropped (the cadence is one release per merge, so a count means nothing, and truncating is the only way to hide something unseen).
