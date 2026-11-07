# Contributing to Panoptic

Thanks for helping. A few rules keep the history clean and the code safe to share.

## Licence

The core of Panoptic is MIT, and contributions to this repository are accepted under the MIT licence. Planned paid Pro add-ons live elsewhere; see [ADR 0016](docs/adr/0016-open-core.md).

## Sign off every commit

Every commit needs a Developer Certificate of Origin sign-off. Commit with `git commit -s`, which adds a `Signed-off-by:` line with your name and email. The DCO is a short statement that you wrote the change, or otherwise have the right to submit it under the project's licence: read it at [developercertificate.org](https://developercertificate.org/). A check on every pull request fails if any commit lacks the line. To fix a branch, `git rebase --signoff main` adds it to each commit.

## Commit messages

Use conventional commits: `type(scope): description`, for example `fix(explorer): keep the filter box usable`. The scope is required. Types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf` and `style`. Keep the subject line to 72 characters or less.

## Branches and pull requests

Work on a feature branch and open a pull request. Nothing is committed to `main` directly. Every merge to `main` releases, so the pull request checks are the only gate.

## Change fragments

A pull request that changes what users see adds one file to `changes/`, one line starting with `Added:`, `Changed:`, `Fixed:` or `Removed:`. `feat` and `fix` pull requests must have one. [docs/changelog.md](docs/changelog.md) has the details.

## No real connection details

Never commit real server names, tenants, credentials or connection details, in code, tests, docs or screenshots. Test data is synthetic: use names under `.example.test`.

## Decisions

Architecture decisions are recorded in [docs/adr/README.md](docs/adr/README.md). Read the relevant ADR before changing something it covers.
