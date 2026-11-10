"use client";

import * as React from "react";
import { previewCowDies, type CowDiePattern } from "./wafer-arrangement-client";

type Selection = { file: File };
type Checked = { selection: Selection; sizeKey: string; json?: unknown; pattern?: CowDiePattern; error?: string };

export function useCowDieImport(size: { x: string; y: string }) {
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [checked, setChecked] = React.useState<Checked | null>(null);
  const sizeKey = JSON.stringify([size.x, size.y]);
  const current = checked?.selection === selection && checked?.sizeKey === sizeKey;
  const pattern = current ? checked?.pattern : undefined;
  const error = current ? checked?.error : undefined;
  const loading = !!selection && !current;

  React.useEffect(() => {
    if (!selection) return;
    const abort = new AbortController();
    const [rawX, rawY] = JSON.parse(sizeKey) as [string, string];
    const x = Number(rawX), y = Number(rawY);
    const cowSize = rawX.trim() && rawY.trim() && Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 ? { x, y } : undefined;
    void (async () => {
      try {
        const text = await selection.file.text();
        if (abort.signal.aborted) return;
        let json: unknown;
        try { json = JSON.parse(text); }
        catch { throw new Error("Choose a valid JSON file. Check its syntax and try again."); }
        const result = await previewCowDies(json, cowSize, abort.signal);
        if (!abort.signal.aborted) setChecked({ selection, sizeKey, json, pattern: result });
      } catch (failure) {
        if (!abort.signal.aborted) setChecked({ selection, sizeKey, error: failure instanceof Error ? failure.message : "Unable to read die JSON. Choose the file again to retry." });
      }
    })();
    return () => abort.abort();
  }, [selection, sizeKey]);

  return {
    fileName: selection?.file.name,
    hasFile: !!selection,
    loading,
    pattern,
    error,
    json: current ? checked?.json : undefined,
    ready: !selection || (!!pattern && !error && pattern.outOfBounds.length === 0),
    choose: (file: File) => setSelection({ file }),
    clear: () => setSelection(null),
  };
}
