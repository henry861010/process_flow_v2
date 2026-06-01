"use client";

import * as React from "react";
import Link from "next/link";
import { GitBranch, ListChecks, Workflow } from "lucide-react";

import {
  initializeHomeLocalStorage,
  resetHomeLocalStorage,
} from "@/lib/home-local-storage";

export default function Home() {
  React.useEffect(() => {
    initializeHomeLocalStorage();
  }, []);

  const entries = [
    {
      href: "/flow-template-editor",
      label: "Flow Template Editor",
      icon: Workflow,
    },
    {
      href: "/flow-instance-editor",
      label: "Flow Instance Editor",
      icon: GitBranch,
    },
    {
      href: "/admin/processstepeditor",
      label: "Process Step Editor",
      icon: ListChecks,
    },
  ];

  function handlePocReset() {
    resetHomeLocalStorage();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <nav
        aria-label="Process flow tools"
        className="grid w-full max-w-xl gap-3 sm:grid-cols-3"
      >
        {entries.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex h-24 flex-col items-center justify-center gap-3 rounded-md border bg-white text-center text-sm font-semibold shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <button
        type="button"
        aria-label="Reset POC Data"
        title="Clear localStorage and restore default JSON"
        className="fixed bottom-3 left-3 h-7 rounded border border-foreground/20 bg-background/70 px-2 font-mono text-[11px] text-muted-foreground shadow-none backdrop-blur-sm transition hover:border-foreground/35 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={handlePocReset}
      >
        cmd: reset-poc-data
      </button>
    </main>
  );
}
