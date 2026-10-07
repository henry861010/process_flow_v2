import type { Metadata } from "next";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export const metadata: Metadata = {
  title: "Job Dashboard | Process Flow",
  description: "Live export job status across Process Flow.",
};

export default function Dashboard() {
  return <DashboardPage />;
}
