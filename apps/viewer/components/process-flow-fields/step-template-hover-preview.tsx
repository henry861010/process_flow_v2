"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import type { ProcessStepTemplate } from "@/lib/process-flow/types";
import { StepTemplateDetails } from "./step-template-details";

const PreviewContext = React.createContext<{
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
} | null>(null);

export function StepTemplatePreviewProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ activeId, setActiveId }), [activeId]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** Keep the preview outside the palette's clipping container and inside the viewport. */
export function stepPreviewPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top">,
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const margin = 12;
  const gap = 8;
  const width = Math.min(360, Math.max(0, viewport.width - margin * 2));
  const maxHeight = Math.min(420, Math.max(0, viewport.height - margin * 2));
  const height = Math.min(contentHeight, maxHeight);
  const preferredLeft = anchor.left - gap - width;
  const left = preferredLeft >= margin ? preferredLeft : anchor.right + gap;
  return {
    width,
    maxHeight,
    left: Math.max(margin, Math.min(left, viewport.width - margin - width)),
    top: Math.max(margin, Math.min(anchor.top, viewport.height - margin - height)),
  };
}

type PreviewTriggerProps = {
  "aria-controls": string | undefined;
  "aria-describedby": string | undefined;
  "aria-expanded": boolean;
};

export function StepTemplateHoverPreview({
  template,
  disabled,
  children,
}: {
  template: Pick<ProcessStepTemplate, "name" | "description">;
  disabled: boolean;
  children: (props: { triggerProps: PreviewTriggerProps; closePreview: () => void }) => React.ReactNode;
}) {
  const context = React.useContext(PreviewContext);
  if (!context) throw new Error("Step previews require StepTemplatePreviewProvider");
  const { activeId, setActiveId } = context;
  const id = React.useId();
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInside = React.useRef(false);
  const focusAnchorPosition = React.useRef<DOMRect | null>(null);
  const [position, setPosition] = React.useState<ReturnType<typeof stepPreviewPosition> | null>(null);
  const open = activeId === id;

  const clearTimers = React.useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const closePreview = React.useCallback(() => {
    clearTimers();
    focusAnchorPosition.current = null;
    if (panelRef.current?.contains(document.activeElement)) {
      const trigger = anchorRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? anchorRef.current;
      trigger?.focus({ preventScroll: true });
    }
    setActiveId((current) => current === id ? null : current);
  }, [clearTimers, id, setActiveId]);

  const contains = (target: EventTarget | null) => target instanceof Node &&
    (anchorRef.current?.contains(target) || panelRef.current?.contains(target));

  const showPreview = (fromFocus = false) => {
    clearTimers();
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    focusAnchorPosition.current = fromFocus ? rect : null;
    setPosition(stepPreviewPosition(rect, { width: window.innerWidth, height: window.innerHeight }, 420));
    setActiveId(id);
  };

  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      // A keyboard user may still be reading or scrolling the focused preview.
      if (!pointerInside.current && !contains(document.activeElement)) closePreview();
    }, 150);
  };

  const onPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointerInside.current = true;
    clearTimers();
    if (!open) openTimer.current = setTimeout(showPreview, 300);
  };

  const onPointerLeave = (event: React.PointerEvent) => {
    if (contains(event.relatedTarget)) return;
    pointerInside.current = false;
    scheduleClose();
  };

  const onBlur = (event: React.FocusEvent) => {
    if (contains(event.relatedTarget)) return;
    if (!pointerInside.current) closePreview();
  };

  React.useLayoutEffect(() => {
    if (!open || !panelRef.current || !anchorRef.current) return;
    setPosition(stepPreviewPosition(
      anchorRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      panelRef.current.getBoundingClientRect().height,
    ));
  }, [open, template]);

  React.useEffect(() => {
    const onScroll = (event: Event) => {
      // Scrolling the details is allowed; scrolling the library invalidates the anchor.
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      // Focus scrolls an offscreen card into view synchronously, but its scroll event
      // arrives after onFocus. Keep that preview if its measured anchor has not moved.
      const focusedPosition = focusAnchorPosition.current;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (focusedPosition && rect && anchorRef.current?.contains(document.activeElement) &&
          rect.top === focusedPosition.top && rect.left === focusedPosition.left) return;
      closePreview();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!open && openTimer.current === null)) return;
      event.preventDefault();
      event.stopPropagation();
      closePreview();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closePreview);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closePreview);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, closePreview]);

  React.useEffect(() => closePreview(), [disabled, closePreview]);
  React.useEffect(() => () => closePreview(), [closePreview]);

  const triggerProps: PreviewTriggerProps = {
    "aria-controls": open ? id : undefined,
    "aria-describedby": open ? id : undefined,
    "aria-expanded": open,
  };

  return (
    <div
      ref={anchorRef}
      tabIndex={disabled ? 0 : undefined}
      role={disabled ? "group" : undefined}
      aria-label={disabled ? `${template.name} (unavailable to add)` : undefined}
      {...(disabled ? triggerProps : {})}
      className={`min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring${disabled ? " cursor-not-allowed" : ""}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={(event) => {
        if (!contains(event.relatedTarget)) {
          anchorRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
          showPreview(true);
        }
      }}
      onBlur={onBlur}
    >
      {children({ triggerProps: disabled ? { "aria-controls": undefined, "aria-describedby": undefined, "aria-expanded": false } : triggerProps, closePreview })}
      {open && position ? createPortal(
        <div
          id={id}
          ref={panelRef}
          role="region"
          aria-label={`${template.name} step details`}
          tabIndex={0}
          className="fixed z-40 overflow-y-auto overscroll-contain rounded-md border bg-background p-3 text-sm shadow-viewport outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
          style={position}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            pointerInside.current = true;
            clearTimers();
          }}
          onPointerLeave={onPointerLeave}
          onFocus={clearTimers}
          onBlur={onBlur}
        >
          <StepTemplateDetails template={template} />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
