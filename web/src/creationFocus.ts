/** Focus only the newly created selection, after its form and any closing dialog commit. */
export function focusCreated(id: string, label: string) {
  const focus = (expanded = false) =>
    requestAnimationFrame(() => {
      const pane = document.querySelector(`[data-edit-subject="${CSS.escape(id)}"]`);
      if (pane?.hasAttribute('hidden') && !expanded) {
        document.querySelector<HTMLButtonElement>('button[aria-label="Expand inspector"]')?.click();
        focus(true);
        return;
      }
      const field = [...(pane?.querySelectorAll('label') ?? [])].find(
        (field) => field.textContent?.trim() === label,
      );
      const input = field?.control;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
      for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement)
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      input.focus();
      input.select();
    });
  focus();
}
