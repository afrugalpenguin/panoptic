/**
 * Closing a dialog or menu hands focus back to what opened it (#216). Only when focus is still in the closing
 * element or has fallen to the page: if something else took it (a click elsewhere, a field the caller focused), it
 * stays there.
 */
export function restoreFocus(opener: HTMLElement | undefined, closing: HTMLElement | undefined): void {
  const active = document.activeElement;
  const lost = !active || active === document.body || (closing?.contains(active) ?? false);
  if (lost && opener?.isConnected) opener.focus();
}

/** Keys that move focus around: pressing one switches the focus ring back on. */
const NAVIGATION_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * Marks the root with how focus last moved, `data-input="pointer"` or `"keyboard"`, so app.css can leave out the ring
 * Chromium draws on a clicked button when focus comes back to it: a dialog closed with Esc or Enter hands focus back
 * to its opener, and Chromium counts that as keyboard focus (#366). Typing, Esc and Enter do not switch to keyboard;
 * Tab and the other navigation keys do. Returns a stop.
 */
export function trackInputModality(root: HTMLElement = document.documentElement): () => void {
  const pointer = () => (root.dataset.input = "pointer");
  const keyboard = (e: KeyboardEvent) => {
    if (NAVIGATION_KEYS.has(e.key)) root.dataset.input = "keyboard";
  };
  window.addEventListener("pointerdown", pointer, true);
  window.addEventListener("keydown", keyboard, true);
  return () => {
    window.removeEventListener("pointerdown", pointer, true);
    window.removeEventListener("keydown", keyboard, true);
    delete root.dataset.input;
  };
}
