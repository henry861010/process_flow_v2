"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dialogs: HTMLElement[] = [];
const focusableSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex='0']";

/** The topmost dialog owns focus, including when a confirmation overlays a picker. */
export function useEditorDialogFocus(
  panel: React.RefObject<HTMLElement>, onClose: () => void, busy: boolean, returnFocus?: React.RefObject<HTMLElement>, enabled = true,
) {
  const latest = React.useRef({ onClose, busy });
  latest.current = { onClose, busy };
  React.useEffect(() => {
    const element = panel.current;
    if (!enabled || !element) return;
    const previous = returnFocus?.current ?? document.activeElement as HTMLElement | null;
    dialogs.push(element);
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((control) => control.getClientRects().length > 0);
    (element.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onClose();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); element.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault(); first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (dialogs.at(-1) === element && !element.contains(event.target as Node)) {
        (controls()[0] ?? element).focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      dialogs.splice(dialogs.indexOf(element), 1);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      // Wait for the underlying picker to re-enable its controls after a confirmation.
      requestAnimationFrame(() => {
        if (dialogs.includes(element)) return; // React StrictMode has re-mounted this effect.
        if (previous?.isConnected && !previous.matches(":disabled")) previous.focus();
        else dialogs.at(-1)?.querySelector<HTMLElement>(focusableSelector)?.focus();
      });
    };
  }, [panel, returnFocus, enabled]);
}

export function EditorDialog({ title, description, busy = false, onClose, children, footer, className, returnFocus }: {
  title: string; description?: string; busy?: boolean; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; className?: string;
  returnFocus?: React.RefObject<HTMLElement>;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  useEditorDialogFocus(panel, onClose, busy, returnFocus);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/40 p-4"
      onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined} tabIndex={-1}
        className={cn("flex max-h-[calc(100dvh-32px)] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-white shadow-xl outline-none", className)}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p> : null}</div>
          <Button type="button" variant="ghost" size="icon" title="Close dialog" aria-label="Close dialog" disabled={busy} onClick={onClose}><X /></Button>
        </header>
        {children}
        {footer ? <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
