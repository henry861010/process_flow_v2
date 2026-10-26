import type { Metadata } from "next";
import { FileExportJobsProvider } from "@/components/geometry-preview/file-export-jobs-provider";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Process Flow",
  description: "Entrypoint for process flow tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><FileExportJobsProvider>{children}</FileExportJobsProvider></body>
    </html>
  );
}
