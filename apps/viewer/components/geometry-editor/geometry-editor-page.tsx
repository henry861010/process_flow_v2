"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Braces, CheckCircle2, Copy, Database, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createGeometry, loadBootstrap } from "@/lib/process-flow-api";
import {
  BOX_STRUCTURE_EXAMPLE, EMPTY_METADATA, EMPTY_STRUCTURE, GEOMETRY_ICONS,
  buildGeometryCreateRequest, geometryClassificationSuggestions, geometryCreateRequestErrors,
  parseGeometryStructure, type GeometryEditorErrors, type GeometryEditorMetadata,
} from "./geometry-editor-state";

const inputClass = "w-full min-w-0 rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-muted disabled:text-muted-foreground";
const exampleText = JSON.stringify(BOX_STRUCTURE_EXAMPLE, null, 2);
const fieldLabels: Record<keyof GeometryEditorMetadata | "structure" | "form", string> = {
  name: "Name", entityType: "Entity type", owner: "Owner", category: "Category", dim: "Dim",
  vendor: "Vendor", type1: "Type 1", type2: "Type 2", description: "Description",
  icon: "Icon", iconScale: "Icon scale", structure: "GeometryStructure JSON", form: "Save",
};

export function GeometryEditorPage() {
  const [metadata, setMetadata] = React.useState<GeometryEditorMetadata>({ ...EMPTY_METADATA });
  const [json, setJson] = React.useState(JSON.stringify(EMPTY_STRUCTURE, null, 2));
  const [errors, setErrors] = React.useState<GeometryEditorErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<{ name: string; id: string; fingerprint: string } | null>(null);
  const [suggestions, setSuggestions] = React.useState({ entityTypes: [] as string[], categories: [] as string[] });
  const [suggestionError, setSuggestionError] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const savingRef = React.useRef(false);
  const fingerprint = JSON.stringify([metadata, json]);
  const alreadySaved = saved?.fingerprint === fingerprint;

  React.useEffect(() => {
    let active = true;
    loadBootstrap().then((data) => {
      if (active) setSuggestions(geometryClassificationSuggestions(data.geometries));
    }).catch(() => { if (active) setSuggestionError(true); });
    return () => { active = false; };
  }, []);

  function showErrors(next: GeometryEditorErrors) {
    setErrors(next);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function change(field: keyof GeometryEditorMetadata, value: string) {
    setMetadata((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function formatJson() {
    try {
      setJson(JSON.stringify(parseGeometryStructure(json), null, 2));
      setErrors((current) => ({ ...current, structure: undefined, form: undefined }));
    } catch (error) {
      showErrors({ ...errors, structure: error instanceof Error ? error.message : "Invalid JSON." });
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || alreadySaved) return;
    const result = buildGeometryCreateRequest(metadata, json);
    if (!result.payload) { showErrors(result.errors); return; }
    savingRef.current = true;
    setSaving(true);
    setErrors({});
    try {
      const entity = await createGeometry(result.payload);
      setSaved({ name: entity.name, id: entity.id, fingerprint });
    } catch (error) {
      showErrors(geometryCreateRequestErrors(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function input(field: keyof GeometryEditorMetadata, options: { required?: boolean; list?: string; hint?: string; type?: string } = {}) {
    return (
      <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor={`geometry-${field}`}>
        <span>{fieldLabels[field]} {options.required ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}</span>
        <input
          id={`geometry-${field}`} className={inputClass} value={metadata[field]}
          required={options.required} list={options.list} type={options.type ?? "text"}
          step={options.type === "number" ? "any" : undefined}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={[options.hint ? `geometry-${field}-hint` : "", errors[field] ? `geometry-${field}-error` : ""].filter(Boolean).join(" ") || undefined}
          onChange={(event) => change(field, event.target.value)}
        />
        {options.hint ? <span id={`geometry-${field}-hint`} className="text-xs font-normal text-muted-foreground">{options.hint}</span> : null}
        <FieldError field={field} errors={errors} />
      </label>
    );
  }

  const errorEntries = Object.entries(errors).filter(([, value]) => Boolean(value));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Braces className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />Create Geometry by JSON</h1>
            <p className="mt-1 text-sm text-muted-foreground">Create an immutable catalog geometry from a GeometryStructure and metadata.</p>
          </div>
          <Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft aria-hidden="true" />Return Home</Link></Button>
        </header>

        <form noValidate onSubmit={(event) => void save(event)} aria-busy={saving}>
          {errorEntries.length ? (
            <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="geometry-error-title" className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring">
              <h2 id="geometry-error-title" className="font-semibold">Unable to save geometry</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errorEntries.map(([field, message]) => (
                  <li key={field}>{field === "form" ? message : (
                    <a href={`#geometry-${field}`} className="underline" onClick={(event) => {
                      event.preventDefault();
                      const element = document.getElementById(`geometry-${field}`);
                      element?.closest("details")?.setAttribute("open", "");
                      element?.focus();
                    }}>{fieldLabels[field as keyof typeof fieldLabels]}: {message}</a>
                  )}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {saved ? (
            <div role="status" className="mb-5 flex flex-wrap items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <p>Saved “{saved.name}” to the geometry catalog.</p>
                <p className="mt-1 break-all font-mono text-xs">{saved.id}</p>
                {alreadySaved ? <p className="mt-1 text-xs">Edit the JSON or metadata to create another snapshot.</p> : null}
              </div>
              <Link href="/management" className="underline">Open Management</Link>
            </div>
          ) : null}

          <fieldset disabled={saving} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <legend className="sr-only">Geometry structure and catalog metadata</legend>
            <section className="min-w-0 rounded-md border bg-white p-4 sm:p-5" aria-labelledby="geometry-structure-heading">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 id="geometry-structure-heading" className="text-sm font-semibold"><label htmlFor="geometry-structure">GeometryStructure JSON <span className="text-destructive">*</span></label></h2>
                <Button type="button" variant="outline" size="sm" onClick={formatJson}>Format JSON</Button>
              </div>
              <p id="geometry-structure-hint" className="mb-3 text-xs text-muted-foreground">Paste the structure only, including schemaVersion “1.0.0”, unitSystem “um”, and root. Metadata belongs in the separate fields. Missing IDs and empty collections are filled on save.</p>
              <textarea
                id="geometry-structure" spellCheck={false} required className={`${inputClass} min-h-[420px] resize-y font-mono text-xs leading-5 lg:min-h-[560px]`}
                value={json} aria-invalid={Boolean(errors.structure)} aria-describedby={`geometry-structure-hint${errors.structure ? " geometry-structure-error" : ""}`}
                onChange={(event) => { setJson(event.target.value); setErrors((current) => ({ ...current, structure: undefined, form: undefined })); }}
              />
              <FieldError field="structure" errors={errors} />
              <details className="mt-4 rounded-md border bg-muted/20 p-3">
                <summary className="cursor-pointer text-sm font-medium">BoxGeometry example</summary>
                <p className="mt-2 text-xs text-muted-foreground">A 20 × 20 × 5 um silicon body. Copy this structure into the JSON field to try it.</p>
                <pre className="mt-3 max-h-72 overflow-auto rounded border bg-white p-3 font-mono text-xs">{exampleText}</pre>
                <div className="mt-3 flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={async () => {
                    try { await navigator.clipboard.writeText(exampleText); setCopied(true); }
                    catch { showErrors({ ...errors, form: "Unable to copy the example. Select and copy the example text manually." }); }
                  }}><Copy aria-hidden="true" />Copy example</Button>
                  <span role="status" className="text-xs text-muted-foreground">{copied ? "Copied" : ""}</span>
                </div>
              </details>
            </section>

            <section className="min-w-0 rounded-md border bg-white p-4 sm:p-5" aria-labelledby="geometry-metadata-heading">
              <h2 id="geometry-metadata-heading" className="text-sm font-semibold">Catalog metadata</h2>
              <p className="mb-4 mt-1 text-xs text-muted-foreground">Fields marked * are required. Type a new classification or choose a catalog suggestion.</p>
              {suggestionError ? <p role="status" className="mb-4 text-xs text-muted-foreground">Catalog suggestions are unavailable. You can still enter all values manually.</p> : null}
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                {input("name", { required: true })}
                {input("owner", { required: true })}
                {input("entityType", { required: true, list: "geometry-entity-types" })}
                {input("category", { list: "geometry-categories" })}
                <div className="sm:col-span-2">{input("dim", { hint: "Display label only, for example 20 x 20 x 5 um. Not used for geometry calculations." })}</div>
                {input("vendor")}{input("type1")}{input("type2")}
                <label className="grid gap-1.5 text-sm font-medium sm:col-span-2" htmlFor="geometry-description">
                  <span>Description <span className="font-normal text-muted-foreground">(optional)</span></span>
                  <textarea id="geometry-description" className={`${inputClass} min-h-24 resize-y`} value={metadata.description} onChange={(event) => change("description", event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "geometry-description-error" : undefined} />
                  <FieldError field="description" errors={errors} />
                </label>
              </div>
              <datalist id="geometry-entity-types">{suggestions.entityTypes.map((value) => <option key={value} value={value} />)}</datalist>
              <datalist id="geometry-categories">{suggestions.categories.map((value) => <option key={value} value={value} />)}</datalist>
              <details className="mt-5 rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-1.5 text-sm font-medium" htmlFor="geometry-icon">
                    <span>Icon <span className="font-normal text-muted-foreground">(optional)</span></span>
                    <select id="geometry-icon" className={inputClass} value={metadata.icon} onChange={(event) => change("icon", event.target.value)} aria-invalid={Boolean(errors.icon)} aria-describedby={errors.icon ? "geometry-icon-error" : undefined}>
                      <option value="">Default</option>
                      {GEOMETRY_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                    </select>
                    <FieldError field="icon" errors={errors} />
                  </label>
                  {input("iconScale", { type: "number", hint: "Greater than 0 and at most 1. Leave blank to use the default scale." })}
                </div>
              </details>
            </section>
          </fieldset>

          <footer className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t py-4">
            <Button type="submit" disabled={saving || alreadySaved}>
              {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Database aria-hidden="true" />}
              {saving ? "Saving..." : "Save to DB"}
            </Button>
          </footer>
        </form>
      </div>
    </main>
  );
}

function FieldError({ field, errors }: { field: keyof GeometryEditorErrors; errors: GeometryEditorErrors }) {
  return errors[field] ? <span id={`geometry-${field}-error`} className="mt-1 block text-xs font-normal text-destructive [overflow-wrap:anywhere]">{errors[field]}</span> : null;
}
