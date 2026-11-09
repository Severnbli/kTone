import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/context';
import { CloseIcon } from './icons';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * Placement on wide screens (phones always get a bottom sheet): `side` is a
   * panel docked to the right edge, `center` a compact dialog in the middle.
   */
  placement?: 'side' | 'center';
  children: ReactNode;
  testId?: string;
}

/**
 * Modal sheet rendered into `document.body`. Traps focus, closes on Esc and on
 * a tap outside, and gives the focus back to the element that opened it. The
 * backdrop is light, so the live readout stays visible behind it. The first
 * element with `data-autofocus` (else the first focusable one) gets the focus.
 */
export function Sheet({
  open,
  onClose,
  title,
  placement = 'center',
  children,
  testId,
}: SheetProps) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    first?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    // Only the checked radio of a group is a tab stop.
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked),
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`sheet-layer sheet-${placement}`} onKeyDown={onKeyDown}>
      <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
