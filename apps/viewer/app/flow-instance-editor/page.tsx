import Link from "next/link";
import { ArrowLeft, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function FlowInstanceEditorPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b bg-white px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GitBranch className="h-5 w-5" />
          </div>
          <h1 className="text-sm font-semibold md:text-base">
            Process Flow Instance Editor
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft />
            Home
          </Link>
        </Button>
      </header>

      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-md border bg-white p-6 text-center shadow-sm">
          <h2 className="text-base font-semibold">UI spec is ready</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This route is reserved for the from-template flow instance editor.
          </p>
        </div>
      </section>
    </main>
  );
}
