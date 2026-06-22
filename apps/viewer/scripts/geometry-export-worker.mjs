#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [format, inputPath, outputPath, exporterPath] = process.argv.slice(2);

if (!format || !inputPath || !outputPath || !exporterPath) {
  console.error(
    "Usage: geometry-export-worker.mjs <format> <input-json> <output-file> <cad-exporter-js>",
  );
  process.exit(2);
}

try {
  const normalizedFormat = normalizeFormat(format);
  const geometryStructure = JSON.parse(await readFile(inputPath, "utf8"));
  const exporterUrl = pathToFileURL(exporterPath).href;
  const { OpenCascadeConverter } = await import(exporterUrl);
  const converter = await OpenCascadeConverter.create(
    exportOptionsForFormat(normalizedFormat),
  );
  const result = converter.convert(geometryStructure);
  const file = result.files?.[normalizedFormat];

  if (!file) {
    throw new Error(
      `OpenCascade export did not produce a ${normalizedFormat.toUpperCase()} file.`,
    );
  }

  if (normalizedFormat === "step") {
    await writeFile(outputPath, file, "utf8");
  } else {
    await writeFile(outputPath, Buffer.from(file));
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

function normalizeFormat(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "glb" || normalized === "step") {
    return normalized;
  }
  throw new Error(`Unsupported export format: ${value}`);
}

function exportOptionsForFormat(value) {
  if (value === "step") {
    return {
      formats: ["step"],
      includeFeatureBodies: true,
      stepSchema: "AP242",
    };
  }
  return { formats: ["glb"] };
}
