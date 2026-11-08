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
