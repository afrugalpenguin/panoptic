# 0016. Open core with a paid Pro tier

- Status: Accepted
- Date: 2026-11-07
- Amends: 0003, 0012

## Context

Panoptic needs a way to pay for itself if it finds users beyond its author. The candidates were a non-commercial source-available licence (PolyForm Noncommercial or Small Business), a delayed open-source licence (BSL or FSL), sponsorship, and open core with a paid tier.

A non-commercial licence is a poor fit for a developer tool: almost everyone who would use Panoptic uses it at work, so "free for non-commercial use" blocks exactly the people most likely to adopt it, and it would never be enforced. BSL and FSL protect against a company forking and reselling the tool, which is not the risk here. Sponsorship rarely funds a desktop tool. The nearest comparable products split along the open-core line: DBeaver has an Apache community edition and paid Pro and Team editions, and TablePlus has a limited free tier with a one-off per-seat licence.

The free tools that already exist (SSMS, the VS Code mssql and Cosmos DB extensions) set the baseline: nobody will pay for a tree and a query editor. Panoptic's adoption hook is the SQL Server family, Cosmos DB and Postgres under one multi-environment tree, so that must stay free. What people pay for in this market is what only matters at work, in a team, against production.

## Decision

Panoptic is open core.

**Core stays MIT** in afrugalpenguin/panoptic (0003 stands). Core is the whole single-user workflow and every engine:

- Explorer, Seek, environments and loose connections, the landing, What's new
- All engines: SQL Server family, Cosmos DB, PostgreSQL, and any engine added later
- Query editor with catalog IntelliSense, results grid and row cap
- Read-only guard, encrypted connection store, auth
- Engine warm-up, changelog pipeline, all hardening work
- The node contract, backend contract and a reference plugin, so third parties can build engines

**Pro is closed source, per seat**, built as separate signed plugin packages behind the same node and backend contracts, in a private repository. The first and main Pro product is one **Teams bundle**: the things that only matter once a second person has the same tree open and one of the environments is production.

- Shared environment definitions: a team-owned config (git repository or blob) that everyone imports, with secrets staying local. Core's export and import file (issue #28) is the format; the sync and governance on top is Pro.
- Production write policies. The promise is not that nobody can write to prod; it is that nobody writes to prod by accident and every deliberate write is on the record. Three levels per environment: *read-only* (core's guard, writes refused before they leave the editor), *guarded* (writes allowed after the parsed statement and affected rows are shown, confirmed, and a reason or ticket reference is recorded), and *break-glass* (a read-only environment elevated to guarded for a set window, with a reason, logged, auto-reverting). The database login stays the real protection; policies guard against mistakes and are not a security boundary.
- Audit log of who ran what, where, with the recorded reasons, exportable
- Query history sync and shared snippets across machines
- Cross-environment diff and compare (the plugin that 0012 allowed "later at most" is a Pro plugin, if it is built at all; it is still not core)

Engine-specific Pro packs (for example Cosmos DB request-unit cost before a query runs, cross-partition analysis, index policy diff, bulk operations with rollback) are a possible second product, only where the vendor's free tooling is poor and the feature only matters at work against a bill. The engines themselves never move to Pro: a solo developer must be able to browse and query every engine for free, and the Cosmos DB backend in particular has already shipped under MIT and cannot be withdrawn.

**Gate.** The free app has a licence-key field. A valid key downloads and enables the Pro packages. Without a key the Pro features are absent, not greyed out with an upsell. Keys are signed and validated offline with a grace period, because Pro users will run Panoptic on locked-down work machines with no outbound access.

**Pricing, as a starting point.** Individual Pro: one-off, around GBP 59 to 79, twelve months of updates, then it keeps working at the last version (the TablePlus model). Team: the same per seat with a discount at five or more. Free Pro for open-source maintainers and students on request. Floating licences, an org admin console and SSO for the licence itself are deferred until someone asks.

**Contributions.** Core adopts the Developer Certificate of Origin (`Signed-off-by` on every commit). MIT does not strictly need it, but it costs nothing and keeps the option of moving code between core and Pro open.

## Consequences

Nothing changes in the repository until the stabilise-and-harden phase is done. After that, the order is: one Pro feature end to end (shared environment definitions, the smallest and the one wanted most), then the licence-key plumbing, then the rest of the Teams bundle only as demand appears. Pro ideas are not public issues: an open issue reads as a promise to free users, so they live in the Pro repository. The plumbing is not built first; it is worthless with nothing behind it.

The node and backend contracts become a product boundary as well as a plugin boundary, so breaking changes to them affect paid packages and need a deprecation path.

"Open source" is still an honest description of Panoptic, because core is MIT; Pro is described as paid add-ons, never as part of the open-source project.

The whole plan only pays if the free version finds users at SQL Server and Cosmos DB shops. Shipping core and watching is how that is found out, and every Pro item above is deferrable until that signal exists.

The author's employment contract must be checked for IP clauses before the first paid download, and Pro development stays on personal hardware and accounts. 0003's rule that nothing employer-specific enters the repository applies to the Pro repository too.
