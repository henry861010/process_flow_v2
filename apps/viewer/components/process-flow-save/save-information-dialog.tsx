"use client";

import * as React from "react";
import { GitBranch, Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorDialogFocus } from "./editor-dialog";
import { cn } from "@/lib/utils";

const SaveValidationContext = React.createContext(false);

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export type TemplateSaveInformation = {
  name: string;
  version: string;
  owner: string;
  description: string;
};

export type InstanceSaveInformation = {
  name: string;
  version: string;
  owner: string;
  description: string;
};

export type EmbeddedGeometrySaveInformation = {
  localId: string;
  name: string;
  vendor: string;
  type1: string;
  type2: string;
  owner: string;
  description: string;
};

export type SaveInformationMode =
  | "template"
  | "template-and-instance"
  | "instance";

export function SaveInformationDialog({
  mode,
  template,
  instance,
  embeddedGeometries = [],
  error,
  submitting,
  onTemplateChange,
  onInstanceChange,
  onEmbeddedGeometryChange,
  onClose,
  onSubmit,
  onModeChange,
  blockingIssues = [],
  configurationIssues = [],
}: {
  mode: SaveInformationMode;
  template?: TemplateSaveInformation;
  instance?: InstanceSaveInformation;
  embeddedGeometries?: EmbeddedGeometrySaveInformation[];
  error?: string | null;
  submitting: boolean;
  onTemplateChange?: (patch: Partial<TemplateSaveInformation>) => void;
  onInstanceChange?: (patch: Partial<InstanceSaveInformation>) => void;
  onEmbeddedGeometryChange?: (
    localId: string,
    patch: Partial<Omit<EmbeddedGeometrySaveInformation, "localId">>,
  ) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  onModeChange?: (mode: "template" | "template-and-instance") => void;
  blockingIssues?: string[];
  configurationIssues?: string[];
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panel = React.useRef<HTMLFormElement>(null);
  const [attempted, setAttempted] = React.useState(false);
  useEditorDialogFocus(panel, onClose, submitting);
  const errorRef = React.useRef<HTMLParagraphElement | null>(null);
  const issues = [...blockingIssues, ...((mode === "template-and-instance" || mode === "instance") ? configurationIssues : [])];
  const config = dialogConfig(mode);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || issues.length > 0) return;
    setAttempted(true);
    const missing = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[required]"))
      .find((field) => !field.value.trim());
    if (missing) { missing.focus(); return; }
    void onSubmit();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/40"
        onClick={submitting ? undefined : onClose}
      />
      <form
        ref={panel}
        noValidate
        tabIndex={-1}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn("relative z-10 flex max-h-[calc(100dvh-32px)] w-full flex-col overflow-hidden rounded-lg border bg-white shadow-viewport outline-none", onModeChange ? "max-w-[760px]" : "max-w-[680px]")}
        role="dialog"
        onSubmit={submit}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <config.Icon className="h-5 w-5 text-primary" />
              <h2 id={titleId} className="text-lg font-semibold">
                {onModeChange ? "Save flow" : config.title}
              </h2>
            </div>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              {onModeChange ? "Choose what to save, then confirm the information below." : config.description}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Close"
            aria-label="Close save dialog"
            disabled={submitting}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <SaveValidationContext.Provider value={attempted}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {onModeChange ? <fieldset className="space-y-3" disabled={submitting}>
            <legend className="mb-2 text-sm font-semibold">What would you like to save?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { value: "template", label: "Template only", description: "Reusable topology and scalar defaults." },
                { value: "template-and-instance", label: "Template & Instance", description: "Template plus current geometry bindings and complete configuration." },
              ] as const).map((option) => <label key={option.value} className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors hover:bg-muted/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                mode === option.value ? "border-primary bg-primary/5" : "border-border") }>
                <input className="mt-0.5 h-4 w-4 shrink-0 accent-primary" type="radio" name="save-mode" value={option.value}
                  checked={mode === option.value} onChange={() => onModeChange(option.value)} />
                <span><span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
              </label>)}
            </div>
          </fieldset> : null}
          {issues.length > 0 ? <details open className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <summary className="cursor-pointer font-medium">{blockingIssues.length > 0 ? "Flow needs attention" : "Configuration needs attention"} · {issues.length} {issues.length === 1 ? "issue" : "issues"}</summary>
            <ul className="mt-2 space-y-1 pl-5 list-disc">{issues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}</ul>
            {blockingIssues.length === 0 && mode === "template-and-instance" ? <p className="mt-3 text-xs">Complete these settings in the editor, or choose Template only to save the reusable flow.</p> : null}
            {blockingIssues.length === 0 && mode === "instance" ? <p className="mt-3 text-xs">Complete these settings in the editor before saving the instance.</p> : null}
          </details> : onModeChange ? <p className="text-xs text-primary">Ready to save {mode === "template" ? "template" : "template and instance"}.</p> : null}
          {(mode === "template" || mode === "template-and-instance") &&
          template &&
          onTemplateChange ? (
            <section className="space-y-4">
              {mode === "template-and-instance" || onModeChange ? (
                <div>
                  <h3 className="text-sm font-semibold">Template information</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Identify the immutable process flow template.
                  </p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Template name" required>
                  <input
                    data-autofocus
                    className={inputClass}
                    value={template.name}
                    disabled={submitting}
                    onChange={(event) => onTemplateChange({ name: event.target.value })}
                  />
                </FormField>
                <FormField label="Version" required>
                  <input
                    className={inputClass}
                    value={template.version}
                    disabled={submitting}
                    onChange={(event) => onTemplateChange({ version: event.target.value })}
                  />
                </FormField>
                <FormField label="Owner" required>
                  <input
                    className={inputClass}
                    value={template.owner}
                    disabled={submitting}
                    onChange={(event) => onTemplateChange({ owner: event.target.value })}
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <textarea
                  className={textareaClass}
                  value={template.description}
                  disabled={submitting}
                  onChange={(event) =>
                    onTemplateChange({ description: event.target.value })
                  }
                />
              </FormField>
            </section>
          ) : null}

          {(mode === "instance" || mode === "template-and-instance") &&
          instance &&
          onInstanceChange ? (
            <section
              className={
                mode === "template-and-instance" ? "space-y-4 border-t pt-5" : "space-y-4"
              }
            >
              {mode === "template-and-instance" ? (
                <div>
                  <h3 className="text-sm font-semibold">Instance information</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Identify the initial flow tracking instance.
                  </p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Instance name" required>
                  <input
                    data-autofocus={mode === "instance" ? true : undefined}
                    className={inputClass}
                    value={instance.name}
                    disabled={submitting}
                    onChange={(event) => onInstanceChange({ name: event.target.value })}
                  />
                </FormField>
                <FormField label="Version" required>
                  <input
                    className={inputClass}
                    value={instance.version}
                    disabled={submitting}
                    onChange={(event) => onInstanceChange({ version: event.target.value })}
                  />
                </FormField>
                <FormField label="Owner" required>
                  <input
                    className={inputClass}
                    value={instance.owner}
                    disabled={submitting}
                    onChange={(event) => onInstanceChange({ owner: event.target.value })}
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <textarea
                  className={textareaClass}
                  value={instance.description}
                  disabled={submitting}
                  onChange={(event) => onInstanceChange({ description: event.target.value })}
                />
              </FormField>
            </section>
          ) : null}

          {(mode === "instance" || mode === "template-and-instance") &&
          embeddedGeometries.length > 0 &&
          onEmbeddedGeometryChange ? (
            <section className="space-y-4 border-t pt-5">
              <div>
                <h3 className="text-sm font-semibold">Generated geometry information</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Confirm the catalog metadata used when generated draft geometries are materialized.
                </p>
              </div>
              <div className="space-y-4">
                {embeddedGeometries.map((geometry) => (
                  <div key={geometry.localId} className="space-y-4 rounded-md border bg-muted/10 p-4">
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {geometry.localId}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Geometry name" required>
                        <input
                          className={inputClass}
                          value={geometry.name}
                          disabled={submitting}
                          required
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              name: event.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Geometry owner" required>
                        <input
                          className={inputClass}
                          value={geometry.owner}
                          disabled={submitting}
                          required
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              owner: event.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Geometry vendor">
                        <input
                          className={inputClass}
                          value={geometry.vendor}
                          disabled={submitting}
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              vendor: event.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Geometry type 1">
                        <input
                          className={inputClass}
                          value={geometry.type1}
                          disabled={submitting}
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              type1: event.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Geometry type 2">
                        <input
                          className={inputClass}
                          value={geometry.type2}
                          disabled={submitting}
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              type2: event.target.value,
                            })
                          }
                        />
                      </FormField>
                    </div>
                    <FormField label="Geometry description">
                      <textarea
                        className={textareaClass}
                        value={geometry.description}
                        disabled={submitting}
                        onChange={(event) =>
                          onEmbeddedGeometryChange(geometry.localId, {
                            description: event.target.value,
                          })
                        }
                      />
                    </FormField>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <p
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
        </SaveValidationContext.Provider>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || issues.length > 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <config.Icon />}
            {submitting ? "Saving…" : config.submitLabel}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const attempted = React.useContext(SaveValidationContext);
  const child = React.isValidElement<{ value?: string; className?: string }>(children) ? children : null;
  const invalid = Boolean(attempted && required && !child?.props.value?.trim());
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium">
        {label}{required ? <span className="ml-1 text-destructive">*</span> : null}
      </span>
      {child ? React.cloneElement(child as React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>, {
        id, required, "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${id}-error` : undefined,
        className: cn(child.props.className, invalid && "border-destructive"),
      }) : children}
      {invalid ? <span id={`${id}-error`} className="mt-1 block text-xs text-destructive">{label} is required.</span> : null}
    </label>
  );
}

function dialogConfig(mode: SaveInformationMode) {
  switch (mode) {
    case "template":
      return {
        title: "Save template",
        description: "Enter the information used to identify this process flow template.",
        submitLabel: "Save Template",
        Icon: Save,
      };
    case "template-and-instance":
      return {
        title: "Save template and instance",
        description: "Enter the information for the template and its new tracking instance.",
        submitLabel: "Save Template & Create Instance",
        Icon: GitBranch,
      };
    case "instance":
      return {
        title: "Create instance",
        description: "Enter the information used to identify this flow tracking instance.",
        submitLabel: "Create Instance",
        Icon: GitBranch,
      };

  }
}
