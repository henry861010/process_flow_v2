"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleDot,
  FolderOpen,
  GitBranch,
  Loader2,
  Save,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EditorShellHeader({
  editor,
  subtitle,
  busy,
  sourceDisabled,
  saveDisabled,
  draftControl,
  onHome,
  onStartFrom,
  onSave,
}: {
  editor: "flow";
  subtitle: string;
  busy: boolean;
  sourceDisabled: boolean;
  saveDisabled: boolean;
  draftControl: React.ReactNode;
  onHome: () => void;
  onStartFrom: () => void;
  onSave: () => void;
}) {
  const Icon = Workflow;
  const title = "Flow Editor";
  return (
    <header className="shrink-0 border-b bg-white px-4 py-3 sm:px-5">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <Button type="button" variant="ghost"
            className="shrink-0 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={busy} onClick={onHome}>
            <ArrowLeft />Home
          </Button>
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Icon aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
              {title}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</p>
          </div>
          <Button type="button" variant="secondary" className="hidden shrink-0 hover:bg-muted sm:inline-flex"
            disabled={sourceDisabled} onClick={onStartFrom}>
            <FolderOpen />Start from…
          </Button>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <Button type="button" variant="secondary" className="px-3 hover:bg-muted sm:hidden"
            disabled={sourceDisabled} onClick={onStartFrom}>
            Start from…
          </Button>
          <div className="flex items-center gap-2">
            {draftControl}
            <Button type="button" className="px-3 sm:px-4" disabled={saveDisabled} onClick={onSave}>
              <Save className="hidden sm:block" />Save…
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function EditorStatusBar({
  progress,
  saving,
  saved,
  issueCount,
  issueKind,
  expanded,
  onToggle,
}: {
  progress: string;
  saving: boolean;
  saved: boolean;
  issueCount: number;
  issueKind: "Flow" | "Configuration";
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b bg-white/70 px-5 py-1.5 text-xs">
      <span role="status" className="flex items-center gap-2 text-muted-foreground">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 text-primary" /> : <CircleDot className="h-3.5 w-3.5" />}
        {progress}
      </span>
      {issueCount > 0 ? (
        <button type="button" aria-expanded={expanded} aria-controls="flow-save-requirements"
          onClick={onToggle}
          className="flex items-center gap-2 rounded text-amber-800 outline-none hover:text-amber-950 focus-visible:ring-2 focus-visible:ring-ring">
          {issueKind}: {issueCount} {issueCount === 1 ? "issue" : "issues"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : <span className="text-primary">Ready to save</span>}
    </div>
  );
}
