# Design tokens

Every colour, size and spacing value in the UI comes from the CSS custom properties in `apps/desktop/src/app/app.css`, defined once for the light theme and overridden for dark under `prefers-color-scheme: dark`. Components use the tokens, never literal values. `theme-contrast.browser.test.ts` checks the text and indicator tokens against WCAG AA in both themes.

## Colour

- **Surfaces and text:** `--bg`, `--bg-pane`, `--bg-hover`, `--bg-selected`, `--bg-selected-blur`, `--border`, `--text`, `--text-muted`.
- **State:** `--accent` (links, focus, selection), `--accent-fill` with `--on-accent` (filled buttons), `--ok`, `--bad`, `--warn`, `--focus-ring`.
- **Brand:** `--brand-primary` (cyan) and `--brand-secondary` (amber) are the logo's colours, for the logo and decoration only. On the light theme they are too pale for text or indicators, which use `--text-brand-primary` and `--text-brand-secondary`.
- **Object kinds:** `--glyph-database`, `--glyph-table`, `--glyph-view`, `--glyph-proc`, `--glyph-function`, `--glyph-key`, `--glyph-policy` and `--glyph-neutral`, the letter-on-tint icons in the tree and detail pane (`Icon.svelte`).
- **Badges:** `--on-badge` is the text on a filled badge. Connection kind badge colours come from the sidecar (`backends.describe`); `--kind-unknown` is for a kind it did not describe.
- **Elevation:** `--shadow-popover` (context menu), `--shadow-dialog` (dialogs, the Seek overlay) and `--backdrop` behind a modal.
- **Screen tokens:** `--landing-*`, `--tree-*`, `--explorer-*`, `--kbd-*`, `--engine-toggle-on` and `--scrollbar-thumb` belong to one part of the UI. They are named for where they apply because their values are tuned for it.

**Environment colours** are not tokens: they are saved in config as hex. The one palette is `apps/desktop/src/app/env-palette.ts`: `ENV_PICKER` is the Environment dialog's swatches and `ENV_EXTRA` the colours Import assigns to environments it does not recognise.

**The query editor** (Monaco) cannot read CSS, so `query/editor-theme.ts` builds its theme from the tokens at runtime: background, text, line numbers, line highlight, selection and cursor, on top of Monaco's stock syntax colours. It is rebuilt when the colour scheme changes. Only plain hex tokens can be passed; others keep Monaco's colour. Its font comes from `--font-mono`.

## Type

`--font-ui` and `--font-mono` are the families. Sizes use the scale:

| Token | Size | Typical use |
| --- | --- | --- |
| `--fs-2xs` | 10px | pills, tiny labels |
| `--fs-xs` | 11px | muted secondary text, shortcut chips |
| `--fs-sm` | 12px | status bar, toolbars, grid |
| `--fs-md` | 13px | body text, the default |
| `--fs-lg` | 14px | emphasis |
| `--fs-xl` | 16px | pane titles |
| `--fs-2xl` | 20px | section titles |
| `--fs-3xl` | 26px | the What's new title |

Some sizes are still between steps (9, 10.5, 11.5, 12.5 and 15px). Move them onto the scale when the component is next changed and the result is checked on screen; do not add new ones. The landing's 300px wordmark is decoration and stays as it is.

## Spacing

`--space-1` to `--space-9`: 2, 4, 6, 8, 10, 12, 16, 20 and 24px, for padding, margins and gaps. New and moved code uses them; existing px values migrate as components are changed.

## Shared pieces

- `button.ghost` (`app.css`) is the borderless, backgroundless button reset; components add only their own layout.
- `button.link` is a button that reads as a link.
- `Spinner.svelte`, `Kbd.svelte`, `KindBadge.svelte` and `ReadOnlyPill.svelte` are the shared spinner, shortcut chip, engine badge and READ ONLY pill.
- `glyphs.ts` holds the SVG paths for icons drawn in more than one place.
- The logo is `src-tauri/icons/icon.svg` everywhere in the UI.
