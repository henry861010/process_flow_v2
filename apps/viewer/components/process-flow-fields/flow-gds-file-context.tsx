"use client";

import * as React from "react";

type FlowGdsFileContextValue = {
  file: File | null;
  rememberFile: (file: File) => void;
  clearFile: () => void;
};

const FlowGdsFileContext = React.createContext<FlowGdsFileContextValue | null>(null);

export function FlowGdsFileProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [generation, setGeneration] = React.useState(0);
  const generationRef = React.useRef(0);
  const clearFile = React.useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
    setFile(null);
  }, []);
  const rememberFile = React.useCallback((next: File) => {
    // A completion from a replaced flow must not restore its old file.
    if (generationRef.current === generation) setFile(next);
  }, [generation]);
  const value = React.useMemo(
    () => ({ file, rememberFile, clearFile }),
    [file, rememberFile, clearFile],
  );

  return <FlowGdsFileContext.Provider value={value}>{children}</FlowGdsFileContext.Provider>;
}

export function useFlowGdsFile() {
  return React.useContext(FlowGdsFileContext);
}
