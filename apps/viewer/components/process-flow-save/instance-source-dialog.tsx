"use client";

import * as React from "react";
import { FileClock, Layers3, Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProcessFlowInstance } from "@/lib/process-flow/types";
import { cn } from "@/lib/utils";
import type { useEditorDrafts } from "./editor-draft-controls";
import { EditorDialog } from "./editor-dialog";

type DraftPicker = Pick<ReturnType<typeof useEditorDrafts>, "pickerContent" | "selectedDraft" | "setPickerOpen" | "load" | "busy" | "loading">;
const BLANK_SOURCE = "__blank__";

export function InstanceSourceDialog({ instances, selectedSourceId, drafts, onUseInstance, onClose }: {
  instances: ProcessFlowInstance[];
  selectedSourceId: string;
  drafts: DraftPicker;
  onUseInstance: (id: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState("instances");
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState(selectedSourceId || BLANK_SOURCE);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setPickerOpen = drafts.setPickerOpen;

  React.useEffect(() => {
    setPickerOpen(tab === "drafts");
    return () => setPickerOpen(false);
  }, [tab, setPickerOpen]);

  const query = search.trim().toLowerCase();
  const visible = instances.filter((instance) =>
    `${instance.name} ${instance.version} ${instance.owner}`.toLowerCase().includes(query));
  const busy = working || drafts.busy;

  async function loadSource() {
    if (busy) return;
    setError(null);
    if (tab === "drafts") {
      if (drafts.selectedDraft && await drafts.load(drafts.selectedDraft)) onClose();
      return;
    }
    setWorking(true);
    try {
      if (await onUseInstance(selectedId === BLANK_SOURCE ? null : selectedId)) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load instance configuration.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <EditorDialog title="Start from…"
      description={tab === "instances"
        ? "Copy configuration from this template's instances, or start again with its defaults."
        : "Resume a draft with its complete metadata and configuration."}
      className="h-[min(620px,calc(100dvh-32px))] max-w-[720px]" busy={busy} onClose={onClose}
      footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (tab === "drafts" ? drafts.loading || !drafts.selectedDraft : !selectedId)} onClick={() => void loadSource()}>
          {busy ? <Loader2 className="animate-spin" /> : tab === "drafts" ? <FileClock /> : <Layers3 />}
          {busy ? "Loading…" : tab === "drafts" ? "Resume draft" : "Use configuration"}
        </Button></>}>
      <Tabs value={tab} onValueChange={(value) => { setTab(value); setError(null); }} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-5 py-3"><TabsList aria-label="Starting source" className="w-full justify-start bg-transparent p-0">
          <TabsTrigger disabled={busy} value="instances" className="gap-2"><Layers3 className="h-4 w-4" />Instances</TabsTrigger>
          <TabsTrigger disabled={busy} value="drafts" className="gap-2"><FileClock className="h-4 w-4" />Drafts</TabsTrigger>
        </TabsList></div>
        <TabsContent value="drafts" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">{drafts.pickerContent}</TabsContent>
        <TabsContent value="instances" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <label className="relative m-5 mb-0 block shrink-0">
            <span className="sr-only">Search instances</span><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input data-autofocus placeholder="Search name, version or owner" value={search} disabled={busy}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
            <ul className="space-y-2">
              {!query ? <li><button type="button" disabled={busy} aria-pressed={selectedId === BLANK_SOURCE} onClick={() => setSelectedId(BLANK_SOURCE)}
                className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", selectedId === BLANK_SOURCE ? "border-primary bg-primary/5" : "border-border") }>
                <Layers3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Start from blank</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Use template defaults and empty geometry bindings.</span></span>
                <Badge variant="outline">Defaults</Badge>
              </button></li> : null}
              {visible.map((instance) => <li key={instance.id}><button type="button" disabled={busy} aria-pressed={selectedId === instance.id} onClick={() => setSelectedId(instance.id)}
                className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", selectedId === instance.id ? "border-primary bg-primary/5" : "border-border") }>
                <Layers3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{instance.name}</span>
                  <span className="mt-1 block break-words text-xs text-muted-foreground">{instance.version} · {instance.owner || "No owner"}</span></span>
              </button></li>)}
            </ul>
            {query && visible.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No instances found.</p> : null}
          </div>
        </TabsContent>
      </Tabs>
    </EditorDialog>
  );
}

