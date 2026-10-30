# Explorer errors spec

Decided 30 Oct 2026. Pairs with docs/explorer-ux.md; the same principles apply. Branch `fix/explorer-errors`.

## Problem

Errors on a tree node render as one full-width inline row containing the raw exception string. The row widens the panel, still truncates, and the text is mostly noise (ActivityId, "Response status code does not indicate success", a dangling `Reason: {`).

## Sidecar

- Node errors become a structured object, not a string:

```
{ summary: string, detail: string, code?: string, retryable: bool }
```

- `summary` is one short human sentence, under 80 chars, no identifiers.
- `detail` is the full original message plus anything useful: status, substatus, ActivityId, endpoint, identity used.
- `code` is the provider status where there is one (`403`, `403/5300`, SQL error number).
- A small mapper per backend turns known failures into good summaries. Cosmos 403 substatus 5300 becomes `summary: "No data-plane access. Identity needs a Cosmos DB role such as Built-in Data Reader."`, `code: "403/5300"`, `retryable: false`. Cosmos 401, 404, 429 and SQL 4060, 18456, 40615, 2 and -2 (timeout) get mappings too. Anything unmapped falls back to the exception's first sentence as the summary and the full text as detail.
- The mapper is a table, unit-tested in the sidecar xunit project: one test per mapped code and one for the fallback.

## Tree

- An error on a node renders as a single child row at leaf height: warning icon, `summary` in 11px muted red, truncated with ellipsis to the panel width. It never wraps and never widens the panel.
- The parent node gets a small warning glyph after its label so the error is visible when the child row is collapsed.
- Hover on the row shows `summary` plus `code` in a tooltip. Click opens the Problems tab scrolled to this entry.
- Right-click: Copy error, Retry (only if `retryable`), Open Problems.

## Problems tab

- New workspace tab `kind: "problems"`, singleton like What's new, title `Problems (n)`.
- One entry per node error: env, connection, node path, summary, code, time, and the full `detail` in a monospace block with a Copy button.
- Reachable from the status bar (error count badge, click to open) and the command palette.
- Entries clear when the node is refreshed successfully or the connection is removed.

## Settings

None new.

## Change fragment

`changes/explorer-errors.md`:

```
Changed: explorer errors are now a short one-line summary on the node, with full details in a new Problems tab. Common Cosmos and SQL Server failures get plain-English explanations.
```

## Verification

Test against a Cosmos account where the identity lacks a data-plane role (the 403/5300 case) and a SQL connection with a wrong password. Show the tree, the tooltip and the Problems tab. `pnpm test` with output. Conventional commit, no AI attribution, PR against main.

## Out of scope

Toasts or modals for errors, retry on a timer, surfacing query execution errors in the Problems tab (they stay in the query tab's messages pane).
