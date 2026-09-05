export function blockingDialogOpen(): boolean {
  return document.querySelector('[role="alertdialog"][aria-modal="true"]') !== null;
}
