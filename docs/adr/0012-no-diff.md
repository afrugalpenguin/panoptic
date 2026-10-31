# 0012. Cross-environment diff is not core

- Status: Accepted
- Date: 2026-10-29

## Context

The first plan gave "select the same object in two environments and diff it" a headline place and its own milestone. It was never a goal: Panoptic is a platform-agnostic SSMS replacement, and nothing in that needs a comparison tool. It crept in from an early brief, and this record strikes it out.

## Decision

Cross-environment diff is out of v1 and out of the core. If it comes at all, it comes later as a plugin behind the node contract, once SSMS is no longer needed day to day.

## Consequences

The milestones are M0 Measure, M1 Tree, M2 Query and grid, M3 Filters, Seek, actions, M4 Agent, packaging. No diff action in the backend action lists, no canonical text forms in the sidecar, no dbml-diff dependency. Monaco's diff view stays unused (0006 covers the query pane only).
