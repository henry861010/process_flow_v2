"use client";

import * as React from "react";
import { FileClock, Loader2, Search, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditorDialog } from "./editor-dialog";
import type { useEditorDrafts } from "./editor-draft-controls";
import type { ProcessFlowTemplate } from "@/lib/process-flow/types";
import { isTemplateEnabled } from "@/lib/process-flow/template-availability";
import { cn } from "@/lib/utils";

type DraftPicker = Pick<ReturnType<typeof useEditorDrafts>, "pickerContent" | "selectedDraft" | "setPickerOpen" | "load" | "busy" | "loading">;

export function TemplateSourceDialog({ templates, drafts, onUseTemplate, onClose }: {
  templates: ProcessFlowTemplate[]; drafts: DraftPicker;
  onUseTemplate: (id: string) => Promise<boolean>; onClose: () => void;
}) {
  const [tab, setTab] = React.useState("templates");
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setPickerOpen = drafts.setPickerOpen;
  React.useEffect(() => {
    setPickerOpen(tab === "drafts");
    return () => setPickerOpen(false);
  }, [tab, setPickerOpen]);
  const visible = templates.filter((template) =>
    `${template.name} ${template.version} ${template.owner ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const busy = working || drafts.busy;

  async function loadSource() {
    if (busy) return;
    setError(null);
    if (tab === "drafts") {
      if (drafts.selectedDraft && await drafts.load(drafts.selectedDraft)) onClose();
      return;
    }
    if (!selectedId) return;
    setWorking(true);
    try { if (await onUseTemplate(selectedId)) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load template."); }
    finally { setWorking(false); }
  }

  return <EditorDialog title="Start from…" description={tab === "templates"
    ? "Use a template to create a new copy of its process flow."
    : "Resume a draft with its complete configuration and graph layout."}
    className="h-[min(620px,calc(100dvh-32px))] max-w-[720px]" busy={busy} onClose={onClose}
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button disabled={busy || (tab === "drafts" ? drafts.loading || !drafts.selectedDraft : !selectedId)} onClick={() => void loadSource()}>
        {busy ? <Loader2 className="animate-spin" /> : tab === "drafts" ? <FileClock /> : <Workflow />}
        {busy ? "Loading…" : tab === "drafts" ? "Resume draft" : "Use template"}
      </Button></>}>
    <Tabs value={tab} onValueChange={(value) => { setTab(value); setError(null); }} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-5 py-3"><TabsList aria-label="Starting source" className="w-full justify-start bg-transparent p-0">
        <TabsTrigger disabled={busy} value="templates" className="gap-2"><Workflow className="h-4 w-4" />Templates</TabsTrigger>
        <TabsTrigger disabled={busy} value="drafts" className="gap-2"><FileClock className="h-4 w-4" />Drafts</TabsTrigger>
      </TabsList></div>
      <TabsContent value="drafts" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">{drafts.pickerContent}</TabsContent>
      <TabsContent value="templates" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
      <label className="relative m-5 mb-0 block shrink-0">
        <span className="sr-only">Search templates</span><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input data-autofocus placeholder="Search name, version or owner" value={search} disabled={busy}
          onChange={(event) => { setSearch(event.target.value); setSelectedId(null); }}
          className="h-9 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        {visible.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No templates found.</p> :
          <ul className="space-y-2">{visible.map((template) => <li key={template.id}>
            <button type="button" disabled={busy} aria-pressed={selectedId === template.id} onClick={() => setSelectedId(template.id)}
              className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                selectedId === template.id ? "border-primary bg-primary/5" : "border-border")}>
              <Workflow aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{template.name}</span>
                <span className="mt-1 block break-words text-xs text-muted-foreground">{template.version} · {template.owner || "No owner"}</span></span>
              <Badge variant="outline">{isTemplateEnabled(template) ? "Enabled" : "Disabled"}</Badge>
            </button>
          </li>)}</ul>}
      </div>
      </TabsContent>
    </Tabs>
  </EditorDialog>;
}
