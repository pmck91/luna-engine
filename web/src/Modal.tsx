import { useEffect, useRef, type ReactNode } from 'react';
export function restoreFocus(previous: Element | null) {
  if (previous instanceof HTMLElement && previous.isConnected)
    previous.focus({ preventScroll: true });
  else
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        document
          .querySelector<HTMLElement>(
            '.inspector:not([hidden]) input, .inspector:not([hidden]) textarea, .inspector:not([hidden]) select, .inspector:not([hidden]) button',
          )
          ?.focus({ preventScroll: true });
    });
}
export default function Modal({
  title,
  close,
  children,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    (
      dialog.querySelector<HTMLElement>('input, select, textarea') ??
      dialog.querySelector<HTMLElement>('button')
    )?.focus();
    return () => {
      dialog.close();
      restoreFocus(previous);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal native-modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}
