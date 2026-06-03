#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [inputPath, outputPath, exporterPath] = process.argv.slice(2);

if (!inputPath || !outputPath || !exporterPath) {
  console.error(
    "Usage: geometry-to-glb-worker.mjs <input-json> <output-glb> <cad-exporter-js>",
  );
  process.exit(2);
}

try {
  const geometryStructure = JSON.parse(await readFile(inputPath, "utf8"));
  const exporterUrl = pathToFileURL(exporterPath).href;
  const { convertCad } = await import(exporterUrl);
  const result = await convertCad(geometryStructure, { formats: ["glb"] });
  const glb = result.files?.glb;

  if (!glb) {
    throw new Error("OpenCascade export did not produce a GLB file.");
  }

  await writeFile(outputPath, Buffer.from(glb));
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
