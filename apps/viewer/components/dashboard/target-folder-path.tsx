"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TargetFolderPath({ jobId, path }: { jobId: string; path: string }) {
  const [feedback, setFeedback] = React.useState<"idle" | "copied" | "error">("idle");

  React.useEffect(() => {
    if (feedback !== "copied") return;
    const timer = window.setTimeout(() => setFeedback("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setFeedback("copied");
    } catch {
      setFeedback("error");
    }
  }

  return (
    <div className="mt-3 min-w-0 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Target folder</span>
        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0"
          aria-label={`Copy target folder for job ${jobId}`} title="Copy target folder" onClick={copyPath}>
          {feedback === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      <p className="select-text whitespace-pre-wrap break-all font-mono leading-5">{path}</p>
      <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 text-muted-foreground">
        {feedback === "copied" ? "Copied" : feedback === "error" ? "Unable to copy. Select the path and copy it manually." : ""}
      </p>
    </div>
  );
}
