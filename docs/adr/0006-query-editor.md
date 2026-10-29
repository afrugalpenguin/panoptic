# 0006. Monaco for the query pane only

- Status: Accepted
- Date: 2026-10-29

## Context

A query editor needs T-SQL highlighting now and Cosmos SQL later, but building a general code editor is a non-goal.

## Decision

Embed Monaco for the query pane and diff view only. Add Cosmos SQL as a custom Monaco language.

## Consequences

Monaco adds bundle weight, so it loads lazily and does not count against the cold-start budget.
