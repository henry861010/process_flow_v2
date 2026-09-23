"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CircleAlert,
  Database,
  Download,
  FileJson,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  createFileExportJob,
  getFileExportClientId,
  type FileExportJob,
  type FileExportKind,
  type SymmetryMode,
} from "@/components/geometry-preview/file-export-client";
import {
  buildMeshControlConfiguration,
  collectKeyedGeometryReferences,
  filterKeyedGeometryReferences,
  MESH_CONTROL_METHODS,
  newMeshControlDraft,
  validateMeshControlDraft,
  type MeshControlDraft,
  type MeshControlMethod,
  type KeyedGeometryReference,
  type ZLocationDraft,
} from "@/components/geometry-preview/file-export-mesh-control";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const compactInputClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-white px-2 py-1 text-xs shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

const SYMMETRY_OPTIONS: ReadonlyArray<{
  value: SymmetryMode;
  label: string;
}> = [
  {
    value: "full",
    label: "Full",
  },
  {
    value: "upper_half",
    label: "Upper Half",
  },
  {
    value: "right_half",
    label: "Right Half",
  },
  {
    value: "upper_right_quarter",
    label: "Upper-right Quarter",
  },
];

export function FileExportDialog({
  kind,
  geometryStructure,
  geometryEntityJson,
  sourceLabel,
  onClose,
  onJobCreated,
}: {
  kind: FileExportKind;
  geometryStructure: unknown;
  geometryEntityJson: unknown;
  sourceLabel: string;
  onClose: () => void;
  onJobCreated: (job: FileExportJob) => void;
}) {
  const [portalReady, setPortalReady] = React.useState(false);
  const [globalElementSize, setGlobalElementSize] = React.useState("500");
  const [symmetry, setSymmetryMode] = React.useState<SymmetryMode>("full");
  const [controls, setControls] = React.useState<MeshControlDraft[]>([]);
  const [outputPath, setOutputPath] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const config = exportKindConfig(kind);
  const keyedGeometryReferences = React.useMemo(
    () => collectKeyedGeometryReferences(geometryStructure),
    [geometryStructure],
  );

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedOutputPath = outputPath.trim();
    const meshControlError =
      kind === "cdb"
        ? validateMeshControlDraft(globalElementSize, controls)
        : null;
    const validationError = validateExportForm(kind, meshControlError, trimmedOutputPath);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const meshControl =
        kind === "cdb"
          ? buildMeshControlConfiguration(globalElementSize, symmetry, controls)
          : undefined;
      const job = await createFileExportJob({
        clientId: getFileExportClientId(),
        kind,
        geometryStructure: kind === "json" ? undefined : geometryStructure,
        geometryEntityJson: kind === "json" ? geometryEntityJson : undefined,
        meshControl,
        outputPath: trimmedOutputPath,
        sourceLabel,
      });
      onJobCreated(job);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Unable to create ${config.label} export job.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!portalReady) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/35"
        onClick={submitting ? undefined : onClose}
      />
      <form
        className="relative z-10 flex max-h-[min(92vh,900px)] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onSubmit={submit}
      >
        <header className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:h-4 [&_svg]:w-4">
              <ExportKindIcon kind={kind} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">
                Export {config.label}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {sourceLabel}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Close"
            disabled={submitting}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {kind === "cdb" ? (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-foreground">
                  Mesher
                </span>
                <input
                  className={inputClass}
                  value="process_flow_2_5d"
                  disabled
                  readOnly
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-foreground">
                  Global element size
                </span>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={globalElementSize}
                  disabled={submitting}
                  onChange={(event) => setGlobalElementSize(event.target.value)}
                />
              </label>

              <fieldset className="space-y-1.5" disabled={submitting}>
                <legend className="text-sm font-semibold text-foreground">
                  Symmetry
                </legend>
                <div className="space-y-1">
                  {SYMMETRY_OPTIONS.map((option) => {
                    const selected = symmetry === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex items-center gap-2 py-1 text-sm ${
                          submitting
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer"
                        }`}
                      >
                        <input
                          className="h-4 w-4 shrink-0 accent-primary"
                          type="radio"
                          name="symmetry"
                          value={option.value}
                          checked={selected}
                          onChange={() => setSymmetryMode(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <section className="space-y-3 border-t pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    Mesh controls
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Add global Z-plane controls relative to geometry references.
                  </p>
                </div>

                {controls.length > 0 ? (
                  <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Controls are sent to the mesher but are not applied by this version.
                    The CDB uses global element size and symmetry only.
                  </p>
                ) : null}

                {controls.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    No local mesh controls.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {controls.map((control, index) => (
                      <MeshControlEditor
                        key={control.clientId}
                        index={index}
                        control={control}
                        keyedGeometryReferences={keyedGeometryReferences}
                        disabled={submitting}
                        onChange={(next) =>
                          setControls((items) =>
                            items.map((item, itemIndex) =>
                              itemIndex === index ? next : item,
                            ),
                          )
                        }
                        onRemove={() =>
                          setControls((items) =>
                            items.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    onClick={() =>
                      setControls((items) => [...items, newMeshControlDraft()])
                    }
                  >
                    <Plus />
                    Add control
                  </Button>
                </div>
              </section>
            </>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-foreground">
              Output path
            </span>
            <input
              className={inputClass}
              value={outputPath}
              disabled={submitting}
              placeholder={config.placeholder}
              onChange={(event) => setOutputPath(event.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-white px-4 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <ExportKindIcon kind={kind} />
            )}
            Export
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function MeshControlEditor({
  index,
  control,
  keyedGeometryReferences,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  control: MeshControlDraft;
  keyedGeometryReferences: KeyedGeometryReference[];
  disabled: boolean;
  onChange: (control: MeshControlDraft) => void;
  onRemove: () => void;
}) {
  const isPoint = control.method === "Z_POINT";
  const [referenceGuideOpen, setReferenceGuideOpen] = React.useState(false);
  const [referenceSearch, setReferenceSearch] = React.useState("");
  const referenceGuideId = React.useId();
  const referenceGuideRef = React.useRef<HTMLDivElement>(null);
  const filteredGeometryReferences = React.useMemo(
    () =>
      filterKeyedGeometryReferences(keyedGeometryReferences, referenceSearch),
    [keyedGeometryReferences, referenceSearch],
  );

  React.useEffect(() => {
    if (!referenceGuideOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !referenceGuideRef.current?.contains(event.target)
      ) {
        setReferenceGuideOpen(false);
        setReferenceSearch("");
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setReferenceGuideOpen(false);
      setReferenceSearch("");
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [referenceGuideOpen]);

  return (
    <article className="rounded-md border bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 rounded-t-md border-b bg-muted/40 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground">
            {index + 1}
          </span>
          <div className="min-w-0">
            <h5 className="text-xs font-semibold text-foreground">
              Mesh control
            </h5>
            <p className="truncate text-[11px] text-muted-foreground">
              {isPoint ? "Point constraint" : "Section constraint"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={`Remove control ${index + 1}`}
          aria-label={`Remove control ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </header>

      <div className="space-y-4 p-3">
        <div
          className={
            isPoint
              ? "min-w-0"
              : "grid min-w-0 grid-cols-[minmax(0,1fr)_110px] gap-2 sm:grid-cols-[220px_140px]"
          }
        >
          <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-foreground">Method</span>
            <select
              className={compactInputClass}
              value={control.method}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...control,
                  method: event.target.value as MeshControlMethod,
                })
              }
            >
              {MESH_CONTROL_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>

          {!isPoint ? (
            <label className="block min-w-0 space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                Element size
              </span>
              <input
                className={compactInputClass}
                inputMode="decimal"
                value={control.elementSize}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...control, elementSize: event.target.value })
                }
              />
            </label>
          ) : null}
        </div>

        <section className="min-w-0 space-y-2">
          <div
            ref={referenceGuideRef}
            className="relative flex items-center gap-1.5"
          >
            <h6 className="text-xs font-medium text-foreground">
              Geometry reference
            </h6>
            <button
              type="button"
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                referenceGuideOpen
                  ? "bg-amber-100 text-amber-700"
                  : "text-muted-foreground hover:bg-amber-50 hover:text-amber-700"
              }`}
              title="Show available reference keys"
              aria-label={`Show available reference keys for control ${index + 1}`}
              aria-expanded={referenceGuideOpen}
              aria-controls={referenceGuideId}
              disabled={disabled}
              onClick={() => {
                setReferenceGuideOpen((open) => !open);
                if (referenceGuideOpen) setReferenceSearch("");
              }}
            >
              <CircleAlert className="h-3.5 w-3.5" />
            </button>
            {referenceGuideOpen ? (
              <div
                id={referenceGuideId}
                className="absolute left-0 top-7 z-30 w-[min(380px,calc(100vw-64px))] rounded-md border bg-white p-3 shadow-viewport"
                role="dialog"
                aria-label="Available geometry reference keys"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-foreground">
                    Available references
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {filteredGeometryReferences.length} / {keyedGeometryReferences.length}
                  </span>
                </div>

                <label className="relative mb-2 block">
                  <span className="sr-only">Search reference kind or key</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className={`${compactInputClass} pl-8`}
                    autoFocus
                    type="search"
                    placeholder="Search kind or key"
                    value={referenceSearch}
                    onChange={(event) => setReferenceSearch(event.target.value)}
                  />
                </label>

                {filteredGeometryReferences.length > 0 ? (
                  <ul className="max-h-40 divide-y overflow-y-auto overscroll-contain rounded-md border">
                    {filteredGeometryReferences.map((reference) => (
                      <li
                        key={`${reference.kind}:${reference.key}`}
                        className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-2 bg-white px-2.5 py-2"
                      >
                        <span className="truncate font-mono text-[10px] font-medium text-muted-foreground">
                          {reference.kind}
                        </span>
                        <span
                          className="min-w-0 truncate font-mono text-[11px] text-foreground"
                          title={reference.key}
                        >
                          {reference.key}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
                    {keyedGeometryReferences.length > 0
                      ? "No references match your search."
                      : "No keyed references are available in this preview."}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">Kind</span>
              <input
                className={compactInputClass}
                aria-label={`Control ${index + 1} filter kind`}
                value={control.referenceKind}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...control, referenceKind: event.target.value })
                }
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">Key</span>
              <input
                className={compactInputClass}
                aria-label={`Control ${index + 1} filter key`}
                value={control.referenceKey}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...control, referenceKey: event.target.value })
                }
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">ID</span>
              <input
                className={compactInputClass}
                aria-label={`Control ${index + 1} filter id`}
                value={control.referenceId}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...control, referenceId: event.target.value })
                }
              />
            </label>
          </div>
        </section>

        {isPoint ? (
          <section className="space-y-2 border-t pt-3">
            <h6 className="text-xs font-medium text-foreground">Z location</h6>
            <ZLocationEditor
              label="Z"
              hideLabel
              value={control.z}
              disabled={disabled}
              onChange={(z) => onChange({ ...control, z })}
            />
          </section>
        ) : (
          <section className="space-y-3 border-t pt-3">
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs font-medium text-foreground">
                Z range
              </legend>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] sm:items-center">
                <div className="rounded-md border bg-muted/15 p-2.5">
                  <ZLocationEditor
                    label="Start"
                    value={control.startZ}
                    disabled={disabled}
                    onChange={(startZ) => onChange({ ...control, startZ })}
                  />
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block"
                />
                <div className="rounded-md border bg-muted/15 p-2.5">
                  <ZLocationEditor
                    label="End"
                    value={control.endZ}
                    disabled={disabled}
                    onChange={(endZ) => onChange({ ...control, endZ })}
                  />
                </div>
              </div>
            </fieldset>
          </section>
        )}
      </div>
    </article>
  );
}

function ZLocationEditor({
  label,
  hideLabel = false,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: ZLocationDraft;
  disabled: boolean;
  onChange: (value: ZLocationDraft) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend
        className={
          hideLabel
            ? "sr-only"
            : "text-[11px] font-medium leading-none text-muted-foreground"
        }
      >
        {label}
      </legend>
      <div className="grid min-w-0 gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        <label className="block min-w-0 space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Mode
          </span>
          <select
            className={compactInputClass}
            aria-label={`${label} mode`}
            value={value.mode}
            onChange={(event) =>
              onChange({
                ...value,
                mode: event.target.value as ZLocationDraft["mode"],
              })
            }
          >
            <option value="relative">relative</option>
            <option value="absolute">absolute</option>
          </select>
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Anchor
          </span>
          <select
            className={compactInputClass}
            aria-label={`${label} anchor`}
            value={value.mode === "relative" ? value.anchor : ""}
            disabled={disabled || value.mode === "absolute"}
            onChange={(event) =>
              onChange({
                ...value,
                anchor: event.target.value as ZLocationDraft["anchor"],
              })
            }
          >
            {value.mode === "absolute" ? <option value="">—</option> : null}
            <option value="z_min">z_min</option>
            <option value="z_max">z_max</option>
          </select>
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {value.mode === "relative" ? "Offset" : "Global Z"}
          </span>
          <input
            className={compactInputClass}
            inputMode="decimal"
            aria-label={
              value.mode === "relative"
                ? `${label} offset`
                : `${label} absolute value`
            }
            placeholder={value.mode === "relative" ? "Offset" : "Global Z"}
            value={value.value}
            onChange={(event) =>
              onChange({ ...value, value: event.target.value })
            }
          />
        </label>
      </div>
    </fieldset>
  );
}

function ExportKindIcon({ kind }: { kind: FileExportKind }) {
  if (kind === "json") return <FileJson />;
  if (kind === "cdb") return <Database />;
  return <Download />;
}

function exportKindConfig(kind: FileExportKind) {
  if (kind === "json") {
    return {
      label: "JSON",
      extension: ".json",
      placeholder: "/Users/henry/Desktop/geometry-preview.json",
    };
  }
  if (kind === "step") {
    return {
      label: "STEP",
      extension: ".step",
      placeholder: "/Users/henry/Desktop/geometry-preview.step",
    };
  }
  return {
    label: "CDB",
    extension: ".cdb",
    placeholder: "/Users/henry/Desktop/model.cdb",
  };
}

function validateExportForm(
  kind: FileExportKind,
  meshControlError: string | null,
  outputPath: string,
) {
  const config = exportKindConfig(kind);
  if (kind === "cdb" && meshControlError) {
    return meshControlError;
  }
  if (!outputPath) {
    return "Output path is required.";
  }
  if (!outputPath.startsWith("/")) {
    return "Output path must be absolute.";
  }
  if (!new RegExp(`${escapeRegExp(config.extension)}$`, "i").test(outputPath)) {
    return `Output path must use a ${config.extension} file extension.`;
  }
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
