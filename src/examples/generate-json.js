import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  BoxGeometry,
  Bump,
  Circuit,
  Container,
  Via,
} from "../data/index.js";
import { OpenCascadeConverter } from "../exporters/cad.js";
import { processMolding, processPanel, Status } from "../process/index.js";

const CAD_FORMATS = ["step", "glb", "stl"];
const ALL_FORMATS = ["json", ...CAD_FORMATS, "stp", "gltf", "cad", "all"];

export function createLogicDie(timing = null) {
  const die = timeStep(
    timing,
    "create logic die container",
    () => new Container({ key: "logic-die" }),
  );
  timeStep(timing, "add logic die bumps", () =>
    die.addBump(
      new Bump(
        new BoxGeometry([-700.0, -700.0, 0.0], [700.0, 700.0, 0.0], 40.0),
        0.18,
        "SnAg",
        "-z",
      ),
    ),
  );
  timeStep(timing, "add logic die body", () =>
    die.addBodyBox(
      "Si die",
      [-800.0, -800.0, 40.0],
      [800.0, 800.0, 40.0],
      200.0,
    ),
  );
  timeStep(timing, "add logic die circuit", () =>
    die.addCircuit(
      new Circuit(
        new BoxGeometry(
          [-750.0, -750.0, 240.0],
          [750.0, 750.0, 240.0],
          10.0,
        ),
        0.35,
        "Cu",
      ),
    ),
  );
  return die;
}

export function buildExampleStatus(timing = null) {
  const status = timeStep(timing, "create status", () => new Status());

  timeStep(timing, "process BT substrate panel", () =>
    processPanel(status, "BT substrate", 300.0, 5000.0),
  );
  timeStep(timing, "add substrate vias", () =>
    status.container().addVia(
      new Via(
        new BoxGeometry(
          [-2200.0, -2200.0, 0.0],
          [2200.0, 2200.0, 0.0],
          300.0,
        ),
        0.08,
        "Cu",
        "+z",
      ),
    ),
  );

  timeStep(timing, "fill RDL dielectric", () =>
    status.fill("RDL dielectric", 360.0),
  );
  timeStep(timing, "add RDL circuit", () =>
    status.container().addCircuit(
      new Circuit(
        new BoxGeometry(
          [-2300.0, -2300.0, 300.0],
          [2300.0, 2300.0, 300.0],
          60.0,
        ),
        0.25,
        "Cu",
      ),
    ),
  );

  const logicDie = timeStep(timing, "build logic die", () =>
    createLogicDie(timing),
  );
  timeStep(timing, "place logic die", () => status.addContainers([logicDie]));
  timeStep(timing, "process epoxy mold", () =>
    processMolding(status, "epoxy mold", 340.0),
  );

  return status;
}

export function buildExampleJson(timing = null) {
  const status = timeStep(timing, "build example status", () =>
    buildExampleStatus(timing),
  );
  return timeStep(timing, "serialize container to JSON object", () =>
    status.container().json(),
  );
}

export function parseExampleArgs(argv) {
  const options = {
    format: "json",
    output: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      options.format = normalizeFormat(argv[index]);
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      options.output = argv[index];
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.format = normalizeFormat(arg);
  }

  return options;
}

export async function runExampleCli(argv = process.argv.slice(2)) {
  const timing = createTimingLogger();
  const options = timeStep(timing, "parse CLI args", () =>
    parseExampleArgs(argv),
  );
  if (options.help) {
    console.log(usage());
    timing.total();
    return null;
  }

  const payload = timeStep(timing, "build example JSON payload", () =>
    buildExampleJson(timing),
  );
  if (options.format === "json") {
    const jsonText = timeStep(
      timing,
      "stringify JSON payload",
      () => `${JSON.stringify(payload, null, 2)}\n`,
    );
    if (options.output === null) {
      timeStep(timing, "write JSON to stdout", () =>
        process.stdout.write(jsonText),
      );
      timing.total();
      return { outputPaths: { json: "stdout" } };
    }

    await timeStepAsync(timing, "write JSON file", () =>
      writeFile(options.output, jsonText, "utf8"),
    );
    timeStep(timing, "print output path", () =>
      console.log(JSON.stringify({ json: options.output }, null, 2)),
    );
    timing.total();
    return { outputPaths: { json: options.output } };
  }

  if (options.output === null) {
    throw new Error("CAD export requires --output <base-path>");
  }

  const formats = timeStep(timing, "resolve CAD formats", () =>
    cadFormats(options.format),
  );
  const converter = await timeStepAsync(
    timing,
    "load OpenCascade converter",
    () =>
      OpenCascadeConverter.create({
        formats,
      }),
  );
  const result = await timeStepAsync(timing, "convert and write CAD files", () =>
    converter.export(payload, options.output),
  );
  timeStep(timing, "print output paths", () =>
    console.log(JSON.stringify(result.outputPaths, null, 2)),
  );
  timing.total();
  return result;
}

function createTimingLogger() {
  const startedAt = performance.now();
  const stream = process.stderr;

  return {
    step(label, startedStepAt, endedStepAt = performance.now()) {
      stream.write(
        `[time] ${label}: ${formatMs(endedStepAt - startedStepAt)} ms ` +
          `(total ${formatMs(endedStepAt - startedAt)} ms)\n`,
      );
    },
    total(label = "total runtime") {
      const endedAt = performance.now();
      stream.write(`[time] ${label}: ${formatMs(endedAt - startedAt)} ms\n`);
    },
  };
}

function timeStep(timing, label, action) {
  if (timing === null) return action();
  const startedAt = performance.now();
  try {
    return action();
  } finally {
    timing.step(label, startedAt);
  }
}

async function timeStepAsync(timing, label, action) {
  if (timing === null) return action();
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    timing.step(label, startedAt);
  }
}

function formatMs(value) {
  return value.toFixed(2);
}

function normalizeFormat(format) {
  const normalized = String(format).toLowerCase();
  if (!ALL_FORMATS.includes(normalized)) {
    throw new Error(`Unsupported format: ${format}`);
  }
  if (normalized === "stp") return "step";
  if (normalized === "gltf") return "glb";
  return normalized;
}

function cadFormats(format) {
  if (format === "all" || format === "cad") return CAD_FORMATS;
  return [format];
}

function usage() {
  return [
    "Usage:",
    "  node ./examples/generate-json.js [--format json|step|glb|stl|all] [--output path]",
    "",
    "Examples:",
    "  node ./examples/generate-json.js",
    "  node ./examples/generate-json.js --format json --output /tmp/process-flow-example.json",
    "  node ./examples/generate-json.js --format step --output /tmp/process-flow-example",
    "  node ./examples/generate-json.js --format all --output /tmp/process-flow-example",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExampleCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
