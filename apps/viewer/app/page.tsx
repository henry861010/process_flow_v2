import Link from "next/link";
import { Boxes, GitBranch, Workflow } from "lucide-react";

export default function Home() {
  const entries = [
    {
      href: "/flow-template-editor",
      label: "Flow Template Editor",
      icon: Workflow,
    },
    {
      href: "/cad-viewer",
      label: "CAD Viewer",
      icon: Boxes,
    },
    {
      href: "/flow-instance-editor",
      label: "Flow Instance Editor",
      icon: GitBranch,
    },
  ];

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
    </main>
  );
}
