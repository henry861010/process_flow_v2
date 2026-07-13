"use client";

import * as React from "react";
import { Database, Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[82px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export type GeneratorSaveMetadata = {
  name: string;
  version: string;
  owner: string;
  description: string;
};

export function GeometryGeneratorSaveDialog({
  generatorLabel,
  entityType,
  category,
  icon,
  metadata,
  error,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  generatorLabel: string;
  entityType: string;
  category: string;
  icon: string;
  metadata: GeneratorSaveMetadata;
  error: string | null;
  saving: boolean;
  onChange: (patch: Partial<GeneratorSaveMetadata>) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const savingRef = React.useRef(saving);
  const valid = generatorSaveMetadataIsValid(metadata);

  React.useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previousFocus.current?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/45"
        onClick={saving ? undefined : onClose}
      />
      <form
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !saving) void onSubmit();
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Save className="h-5 w-5 text-primary" />
              <h2 id={titleId} className="text-lg font-semibold">
                Save {generatorLabel} Geometry
              </h2>
            </div>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              Add catalog metadata before saving this immutable geometry snapshot.
            </p>
          </div>
          <Button
            aria-label="Close save dialog"
            disabled={saving}
            size="icon"
            title="Close"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <MetadataInput
              autoFocus
              label="Name"
              value={metadata.name}
              disabled={saving}
              onChange={(value) => onChange({ name: value })}
            />
            <MetadataInput
              label="Version"
              value={metadata.version}
              disabled={saving}
              onChange={(value) => onChange({ version: value })}
            />
            <div className="sm:col-span-2">
              <MetadataInput
                label="Owner"
                value={metadata.owner}
                disabled={saving}
                onChange={(value) => onChange({ owner: value })}
              />
            </div>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Description</span>
            <textarea
              className={textareaClass}
              disabled={saving}
              value={metadata.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>

          <div className="grid gap-2 rounded-md border bg-muted/20 px-3 py-3 text-xs sm:grid-cols-3">
            <MetadataConstant label="Entity type" value={entityType} />
            <MetadataConstant label="Category" value={category} />
            <MetadataConstant label="Icon" value={icon} />
          </div>

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
          <Button disabled={saving} type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} type="submit">
            {saving ? <Loader2 className="animate-spin" /> : <Database />}
            Save to DB
          </Button>
        </footer>
      </form>
    </div>
  );
}

export function generatorSaveMetadataIsValid(metadata: GeneratorSaveMetadata) {
  return Boolean(
    metadata.name.trim() && metadata.version.trim() && metadata.owner.trim(),
  );
}

function MetadataInput({
  label,
  value,
  disabled,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <input
        autoFocus={autoFocus}
        className={inputClass}
        disabled={disabled}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MetadataConstant({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-foreground">{value}</div>
    </div>
  );
}
