"use client";

import * as React from "react";
import { GitBranch, Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export type TemplateSaveInformation = {
  id: string;
  name: string;
  version: string;
  owner: string;
  description: string;
};

export type InstanceSaveInformation = {
  id: string;
  name: string;
};

export type EmbeddedGeometrySaveInformation = {
  localId: string;
  name: string;
  version: string;
  owner: string;
  description: string;
};

export type SaveInformationMode =
  | "template"
  | "template-and-instance"
  | "instance"
  | "workspace";

export function SaveInformationDialog({
  mode,
  template,
  instance,
  workspaceName,
  embeddedGeometries = [],
  error,
  submitting,
  onTemplateChange,
  onInstanceChange,
  onWorkspaceNameChange,
  onEmbeddedGeometryChange,
  onClose,
  onSubmit,
}: {
  mode: SaveInformationMode;
  template?: TemplateSaveInformation;
  instance?: InstanceSaveInformation;
  workspaceName?: string;
  embeddedGeometries?: EmbeddedGeometrySaveInformation[];
  error?: string | null;
  submitting: boolean;
  onTemplateChange?: (patch: Partial<TemplateSaveInformation>) => void;
  onInstanceChange?: (patch: Partial<InstanceSaveInformation>) => void;
  onWorkspaceNameChange?: (name: string) => void;
  onEmbeddedGeometryChange?: (
    localId: string,
    patch: Partial<Omit<EmbeddedGeometrySaveInformation, "localId">>,
  ) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const submittingRef = React.useRef(submitting);
  const config = dialogConfig(mode);

  React.useEffect(() => {
    onCloseRef.current = onClose;
    submittingRef.current = submitting;
  }, [onClose, submitting]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previousFocus.current?.focus();
    };
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitting) void onSubmit();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/40"
        onClick={submitting ? undefined : onClose}
      />
      <form
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        role="dialog"
        onSubmit={submit}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <config.Icon className="h-5 w-5 text-primary" />
              <h2 id={titleId} className="text-lg font-semibold">
                {config.title}
              </h2>
            </div>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              {config.description}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Close"
            disabled={submitting}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {mode === "workspace" && onWorkspaceNameChange ? (
            <FormField label="Workspace name" required>
              <input
                autoFocus
                className={inputClass}
                value={workspaceName ?? ""}
                disabled={submitting}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
            </FormField>
          ) : null}

          {(mode === "template" || mode === "template-and-instance") &&
          template &&
          onTemplateChange ? (
            <section className="space-y-4">
              {mode === "template-and-instance" ? (
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
                    autoFocus
                    className={inputClass}
                    value={template.name}
                    disabled={submitting}
                    onChange={(event) => onTemplateChange({ name: event.target.value })}
                  />
                </FormField>
                <FormField label="Template id" required>
                  <input
                    className={inputClass}
                    value={template.id}
                    disabled={submitting}
                    onChange={(event) => onTemplateChange({ id: event.target.value })}
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
                    Identify the initial immutable process flow instance.
                  </p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Instance name" required>
                  <input
                    autoFocus={mode === "instance"}
                    className={inputClass}
                    value={instance.name}
                    disabled={submitting}
                    onChange={(event) => onInstanceChange({ name: event.target.value })}
                  />
                </FormField>
                <FormField label="Instance id" required>
                  <input
                    className={inputClass}
                    value={instance.id}
                    disabled={submitting}
                    onChange={(event) => onInstanceChange({ id: event.target.value })}
                  />
                </FormField>
              </div>
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
                      <FormField label="Geometry version" required>
                        <input
                          className={inputClass}
                          value={geometry.version}
                          disabled={submitting}
                          required
                          onChange={(event) =>
                            onEmbeddedGeometryChange(geometry.localId, {
                              version: event.target.value,
                            })
                          }
                        />
                      </FormField>
                      <div className="sm:col-span-2">
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
                      </div>
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
              aria-live="polite"
              className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-white px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <config.Icon />}
            {config.submitLabel}
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
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </span>
      {children}
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
        description: "Enter the information for both immutable records before saving.",
        submitLabel: "Save Template & Instance",
        Icon: GitBranch,
      };
    case "instance":
      return {
        title: "Save instance",
        description: "Enter the information used to identify this immutable instance.",
        submitLabel: "Save Instance",
        Icon: GitBranch,
      };
    case "workspace":
      return {
        title: "Save draft",
        description: "Name this workspace before saving its first revision.",
        submitLabel: "Save Draft",
        Icon: Save,
      };
  }
}
