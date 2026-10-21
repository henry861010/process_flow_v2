"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { HomeWorkspace, type HomeData } from "@/components/home/home-workspace";
import { loadBootstrap } from "@/lib/process-flow-api";

export default function Home() {
  const router = useRouter();
  const [homeData, setHomeData] = React.useState<HomeData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadHomeData = React.useCallback(async () => {
    setLoading(true);
    try {
      const { processFlowTemplates, processFlowInstances, processStepTemplates, geometryGenerators } = await loadBootstrap();
      setHomeData({ processFlowTemplates, processFlowInstances, processStepTemplates, geometryGenerators });
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load API data.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHomeData();
  }, [loadHomeData]);

  return (
    <HomeWorkspace
      data={homeData}
      loading={loading}
      loadError={loadError}
      onRetry={() => void loadHomeData()}
      onCreated={(instance, editAfterCreate) => {
        setHomeData((current) => current ? {
          ...current,
          processFlowInstances: [...current.processFlowInstances, instance],
        } : current);
        if (editAfterCreate) router.push(`/flow-instance-editor?instanceId=${encodeURIComponent(instance.id)}`);
      }}
    />
  );
}
