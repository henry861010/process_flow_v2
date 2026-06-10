#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [inputPath, outputGlbPath, outputStepPath, exporterPath] =
  process.argv.slice(2);

if (!inputPath || !outputGlbPath || !outputStepPath || !exporterPath) {
  console.error(
    "Usage: geometry-to-glb-worker.mjs <input-json> <output-glb> <output-step> <cad-exporter-js>",
  );
  process.exit(2);
}

try {
  const geometryStructure = JSON.parse(await readFile(inputPath, "utf8"));
  const exporterUrl = pathToFileURL(exporterPath).href;
  const { OpenCascadeConverter } = await import(exporterUrl);
  const glbConverter = await OpenCascadeConverter.create({ formats: ["glb"] });
  const glbResult = glbConverter.convert(geometryStructure);
  const glb = glbResult.files?.glb;

  if (!glb) {
    throw new Error("OpenCascade export did not produce a GLB file.");
  }

  const stepConverter = new OpenCascadeConverter(glbConverter.oc, {
    formats: ["step"],
    includeFeatureBodies: true,
    stepSchema: "AP242",
  });
  const stepResult = stepConverter.convert(geometryStructure);
  const step = stepResult.files?.step;

  if (!step) {
    throw new Error("OpenCascade export did not produce a STEP file.");
  }

  await Promise.all([
    writeFile(outputGlbPath, Buffer.from(glb)),
    writeFile(outputStepPath, step, "utf8"),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
