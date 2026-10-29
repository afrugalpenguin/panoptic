# 0012. Cross-environment diff is not core

- Status: Accepted
- Date: 2026-10-29

## Context

Early drafts of the plan listed "select the same object in two environments and diff it" as the headline feature and gave it its own milestone. That was an inference from the design, not a decision: Panoptic is a platform-agnostic SSMS replacement, and nothing in that goal needs a comparison tool.

## Decision

Cross-environment diff is out of v1 and out of the core. If it comes at all, it comes later as a plugin behind the node contract, once SSMS is no longer needed day to day.

## Consequences

The milestones are M0 Measure, M1 Tree, M2 Query and grid, M3 Filters, Seek, actions, M4 Agent, packaging. No diff action in the backend action lists, no canonical text forms in the sidecar, no dbml-diff dependency. Monaco's diff view stays unused (0006 covers the query pane only).
