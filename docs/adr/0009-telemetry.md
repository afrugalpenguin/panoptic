# 0009. No telemetry

- Status: Accepted
- Date: 2026-10-29

## Context

The tool runs against production data on a corporate laptop.

## Decision

Panoptic sends no telemetry. The only outbound call outside configured connections is the update check against GitHub Releases (0010), and Settings can turn it off completely.

## Consequences

Bugs are reported by hand. Anything that phones home is refused.
