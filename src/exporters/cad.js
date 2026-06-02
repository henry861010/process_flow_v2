import { normalizeGeometryDocument, stableId } from "../data/schema.js";
import { classifyPolygonLoops } from "../utils/polygon.js";

export class CadExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "CadExportError";
  }
}

export class CadExportOptions {
  constructor({
    formats = ["step", "glb"],
    writeManifest = true,
    includeFeaturePlaceholders = true,
    volumeTolerance = 1e-6,
    linearDeflection = 0.1,
    angularDeflection = 0.1,
    opencascade = null,
    suppressOpenCascadeOutput = true,
  } = {}) {
    this.formats = formats;
    this.writeManifest = writeManifest;
    this.includeFeaturePlaceholders = includeFeaturePlaceholders;
    this.volumeTolerance = volumeTolerance;
    this.linearDeflection = linearDeflection;
    this.angularDeflection = angularDeflection;
    this.opencascade = opencascade;
    this.suppressOpenCascadeOutput = suppressOpenCascadeOutput;
  }
}

export class CadBody {
  constructor({
    id,
    sourceIds,
    containerId,
    containerKey,
    material,
    shape,
  }) {
    this.id = id;
    this.sourceIds = sourceIds;
    this.containerId = containerId;
    this.containerKey = containerKey;
    this.material = material;
    this.shape = shape;
  }
}

export class CadExportResult {
  constructor({ outputPaths = {}, files = {}, manifest, bodies = [] }) {
    this.outputPaths = outputPaths;
    this.files = files;
    this.manifest = manifest;
    this.bodies = bodies;
  }
}

export class OpenCascadeConverter {
  static async create(options = {}) {
    const resolvedOptions = options instanceof CadExportOptions
      ? options
      : new CadExportOptions(options);
    const oc = await resolveOpenCascade(
      resolvedOptions.opencascade,
      resolvedOptions,
    );
    return new OpenCascadeConverter(oc, resolvedOptions);
  }

  constructor(opencascade, options = {}) {
    if (!opencascade) {
      throw new CadExportError(
        "OpenCascade.js is required for CAD export. Pass an initialized OpenCascade instance or install opencascade.js.",
      );
    }

    this.oc = opencascade;
    this.options = options instanceof CadExportOptions
      ? options
      : new CadExportOptions(options);
  }

  async export(payload, outputBase) {
    const result = this.convert(payload);
    const outputPaths = {};

    for (const [format, bytes] of Object.entries(result.files)) {
      const path = withSuffix(outputBase, `.${format}`);
      await writeBinaryFile(path, bytes);
      outputPaths[format] = path;
    }

    if (this.options.writeManifest) {
      const manifestPath = withSuffix(outputBase, ".manifest.json");
      await writeTextFile(
        manifestPath,
        `${JSON.stringify(result.manifest, null, 2)}\n`,
      );
      outputPaths.manifest = manifestPath;
    }

    return new CadExportResult({
      outputPaths,
      files: result.files,
      manifest: result.manifest,
      bodies: result.bodies,
    });
  }

  convert(payload) {
    const document = normalizeGeometryDocument(payload);
    const root = document.root;
    const bodies = this._convertContainer(root);
    const visibleBodies = bodies.filter(
      (body) =>
        !this._isEmptyShape(body.shape) &&
        this._shapeVolume(body.shape) > this.options.volumeTolerance,
    );

    const files = {};
    for (const exportFormat of this.options.formats) {
      const normalizedFormat = exportFormat.toLowerCase();
      files[normalizedFormat] = this._exportBodies(
        visibleBodies,
        normalizedFormat,
        document,
      );
    }

    return new CadExportResult({
      files,
      manifest: this._buildManifest(document, bodies),
      bodies,
    });
  }

  _convertContainer(container) {
    let directBodies = container.bodies.map((body) =>
      this._bodyToCad(container, body),
    );
    directBodies = this._resolveSiblingBodies(container, directBodies);

    const descendantBodies = [];
    for (const child of container.children) {
      descendantBodies.push(...this._convertContainer(child));
    }

    const cutTool = this._unionShapes(descendantBodies.map((body) => body.shape));
    if (cutTool !== null) {
      directBodies.forEach((body) => {
        if (this._hasOverlap(body.shape, cutTool)) {
          body.shape = this._cut(body.shape, cutTool);
        }
      });
    }

    return [...directBodies, ...descendantBodies];
  }

  _bodyToCad(container, body) {
    return new CadBody({
      id: body.id,
      sourceIds: [body.id],
      containerId: container.id,
      containerKey: container.key ?? "",
      material: body.material,
      shape: this._geometryToShape(body.geometry),
    });
  }

  _resolveSiblingBodies(container, bodies) {
    if (bodies.length <= 1) return bodies;

    this._raiseOnCrossMaterialOverlap(bodies);
    const components = this._sameMaterialOverlapComponents(bodies);
    const resolved = [];

    components.forEach((component) => {
      if (component.length === 1) {
        resolved.push(component[0]);
        return;
      }

      const material = component[0].material;
      const sourceIds = component.flatMap((body) => body.sourceIds);
      const fusedShape = this._unionShapes(component.map((body) => body.shape));
      resolved.push(
        new CadBody({
          id: stableId("body-union", [container.id, material], {
            sourceIds,
          }),
          sourceIds,
          containerId: container.id,
          containerKey: container.key ?? "",
          material,
          shape: fusedShape,
        }),
      );
    });

    return resolved;
  }

  _raiseOnCrossMaterialOverlap(bodies) {
    bodies.forEach((left, leftIndex) => {
      bodies.slice(leftIndex + 1).forEach((right) => {
        if (left.material === right.material) return;
        if (this._hasOverlap(left.shape, right.shape)) {
          throw new CadExportError(
            `Overlapping sibling bodies with different materials: ${left.id} (${left.material}) and ${right.id} (${right.material})`,
          );
        }
      });
    });
  }

  _sameMaterialOverlapComponents(bodies) {
    const remaining = [...bodies];
    const components = [];

    while (remaining.length > 0) {
      const seed = remaining.shift();
      const component = [seed];
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of [...remaining]) {
          if (candidate.material !== seed.material) continue;
          if (component.some((body) => this._hasOverlap(candidate.shape, body.shape))) {
            remaining.splice(remaining.indexOf(candidate), 1);
            component.push(candidate);
            changed = true;
          }
        }
      }
      components.push(component);
    }

    return components;
  }

  _geometryToShape(geometry) {
    if (geometry === null || typeof geometry !== "object" || Array.isArray(geometry)) {
      throw new CadExportError(
        `Unknown geometry payload: ${JSON.stringify(geometry)}`,
      );
    }

    switch (geometry.type) {
      case "BoxGeometry":
        return this._boxToShape(
          requireGeometryFields(geometry, ["bottom_left", "top_right", "thk"]),
        );
      case "PolygonGeometry":
        return this._polygonsToShape(
          requireGeometryFields(geometry, ["polys", "thk"]),
        );
      case "CylinderGeometry":
        return this._cylinderToShape(
          requireGeometryFields(geometry, ["center", "bottom_radius", "thk"]),
        );
      case "ConeGeometry":
        return this._coneToShape(
          requireGeometryFields(geometry, [
            "center",
            "bottom_radius",
            "top_radius",
            "thk",
          ]),
        );
      default:
        throw new CadExportError(`Unknown geometry type: ${geometry.type}`);
    }
  }

  _boxToShape(geometry) {
    const [x1, y1, z1] = geometry.bottom_left;
    const [x2, y2] = geometry.top_right;
    const p1 = this._point(x1, y1, z1);
    const p2 = this._point(x2, y2, z1 + geometry.thk);
    return new this.oc.BRepPrimAPI_MakeBox_4(p1, p2).Shape();
  }

  _cylinderToShape(geometry) {
    const center = geometry.center;
    return new this.oc.BRepPrimAPI_MakeCylinder_3(
      this._zAxis(center),
      geometry.bottom_radius,
      geometry.thk,
    ).Shape();
  }

  _coneToShape(geometry) {
    const center = geometry.center;
    return new this.oc.BRepPrimAPI_MakeCone_3(
      this._zAxis(center),
      geometry.bottom_radius,
      geometry.top_radius,
      geometry.thk,
    ).Shape();
  }

  _polygonsToShape(geometry) {
    const regions = classifyPolygonLoops(geometry.polys);
    const shapes = regions.map((region) => {
      const faceMaker = new this.oc.BRepBuilderAPI_MakeFace_15(
        this._loopToWire(region.outer),
        true,
      );
      region.holes.forEach((hole) => {
        faceMaker.Add(this._loopToWire(hole));
      });
      faceMaker.Build(new this.oc.Message_ProgressRange_1());
      return this._makeFinitePrism(faceMaker.Face(), geometry.thk);
    });

    return this._unionShapes(shapes);
  }

  _loopToWire(loop) {
    const polygon = new this.oc.BRepBuilderAPI_MakePolygon_1();
    loop.forEach((point) => {
      polygon.Add_1(this._point(point[0], point[1], point[2]));
    });
    polygon.Close();
    polygon.Build(new this.oc.Message_ProgressRange_1());
    return polygon.Wire();
  }

  _makeFinitePrism(shape, height) {
    if (!this.oc.BRepPrimAPI_MakePrism_1) {
      throw new CadExportError(
        "OpenCascade.js build does not expose BRepPrimAPI_MakePrism_1, which is required for finite polygon extrusion.",
      );
    }

    const prism = new this.oc.BRepPrimAPI_MakePrism_1(
      shape,
      this._vec(0, 0, height),
      false,
      true,
    );
    prism.Build(new this.oc.Message_ProgressRange_1());
    return prism.Shape();
  }

  _exportBodies(bodies, exportFormat, document) {
    if (exportFormat === "step" || exportFormat === "stp") {
      return this._exportStep(bodies, document);
    }
    if (exportFormat === "glb" || exportFormat === "gltf") {
      return this._exportGlb(bodies, document);
    }
    if (exportFormat === "stl") {
      return this._exportStl(bodies);
    }
    throw new CadExportError(`Unsupported CAD export format: ${exportFormat}`);
  }

  _exportStep(bodies, document) {
    const filename = this._virtualFileName("export.step");
    const writer = new this.oc.STEPControl_Writer_1();
    this._setStepUnit(document.unitSystem);
    bodies.forEach((body) => {
      writer.Transfer(
        body.shape,
        this._stepAsIs(),
        true,
        new this.oc.Message_ProgressRange_1(),
      );
    });
    const status = writer.Write(filename);
    if (status !== undefined && this.oc.IFSelect_ReturnStatus) {
      const done = this.oc.IFSelect_ReturnStatus.IFSelect_RetDone;
      if (done !== undefined && status !== done) {
        throw new CadExportError(`STEP export failed with status ${status}`);
      }
    }
    return this._readVirtualFile(filename, "utf8");
  }

  _exportStl(bodies) {
    const filename = this._virtualFileName("export.stl");
    const shape = this._compoundFromShapes(bodies.map((body) => body.shape));
    new this.oc.BRepMesh_IncrementalMesh_2(
      shape,
      this.options.linearDeflection,
      false,
      this.options.angularDeflection,
      false,
    );
    const ok = this.oc.StlAPI.Write(shape, filename, false);
    if (ok === false) {
      throw new CadExportError("STL export failed");
    }
    return this._readVirtualFile(filename, "binary");
  }

  _exportGlb(bodies) {
    const filename = this._virtualFileName("export.glb");
    const doc = this._documentFromBodies(bodies);
    const cafWriter = new this.oc.RWGltf_CafWriter(
      new this.oc.TCollection_AsciiString_2(filename),
      true,
    );
    cafWriter.Perform_2(
      new this.oc.Handle_TDocStd_Document_2(doc),
      new this.oc.TColStd_IndexedDataMapOfStringString_1(),
      new this.oc.Message_ProgressRange_1(),
    );
    return this._readVirtualFile(filename, "binary");
  }

  _compoundFromShapes(shapes) {
    const compound = new this.oc.TopoDS_Compound();
    const builder = new this.oc.BRep_Builder();
    builder.MakeCompound(compound);
    shapes
      .filter((shape) => !this._isEmptyShape(shape))
      .forEach((shape) => builder.Add(compound, shape));
    return compound;
  }

  _documentFromBodies(bodies) {
    const doc = new this.oc.TDocStd_Document(
      new this.oc.TCollection_ExtendedString_1(),
    );
    const shapeTool = this.oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();

    bodies.forEach((body) => {
      new this.oc.BRepMesh_IncrementalMesh_2(
        body.shape,
        this.options.linearDeflection,
        false,
        this.options.angularDeflection,
        false,
      );
      const label = shapeTool.NewShape();
      shapeTool.SetShape(label, body.shape);
    });

    return doc;
  }

  _buildManifest(document, bodies) {
    const manifest = {
      schemaVersion: document.schemaVersion,
      unitSystem: document.unitSystem,
      rootId: document.root.id,
      bodies: bodies.map((body) => ({
        id: body.id,
        sourceIds: body.sourceIds,
        containerId: body.containerId,
        containerKey: body.containerKey,
        material: body.material,
      })),
      features: [],
    };

    if (this.options.includeFeaturePlaceholders) {
      this._appendFeaturePlaceholders(document.root, manifest);
    }

    return manifest;
  }

  _appendFeaturePlaceholders(container, manifest) {
    ["vias", "circuits", "bumps"].forEach((featureType) => {
      container[featureType].forEach((feature) => {
        manifest.features.push({
          id: feature.id,
          containerId: container.id,
          containerKey: container.key ?? "",
          featureType: featureType.slice(0, -1),
          material: feature.material,
          density: feature.density,
          conversion: "placeholder",
        });
      });
    });

    container.children.forEach((child) => {
      this._appendFeaturePlaceholders(child, manifest);
    });
  }

  _unionShapes(shapes) {
    const filtered = shapes.filter((shape) => shape !== null && shape !== undefined);
    if (filtered.length === 0) return null;

    let result = filtered[0];
    filtered.slice(1).forEach((shape) => {
      result = this._fuse(result, shape);
    });
    return result;
  }

  _hasOverlap(left, right) {
    if (!this._boundingBoxesOverlap(left, right)) return false;
    const common = this._common(left, right);
    return this._shapeVolume(common) > this.options.volumeTolerance;
  }

  _boundingBoxesOverlap(left, right) {
    const leftBox = this._boundingBox(left);
    const rightBox = this._boundingBox(right);
    return (
      leftBox.xmin <= rightBox.xmax &&
      rightBox.xmin <= leftBox.xmax &&
      leftBox.ymin <= rightBox.ymax &&
      rightBox.ymin <= leftBox.ymax &&
      leftBox.zmin <= rightBox.zmax &&
      rightBox.zmin <= leftBox.zmax
    );
  }

  _boundingBox(shape) {
    const box = new this.oc.Bnd_Box_1();
    this.oc.BRepBndLib.Add(shape, box, false);
    const min = box.CornerMin();
    const max = box.CornerMax();
    return {
      xmin: min.X(),
      ymin: min.Y(),
      zmin: min.Z(),
      xmax: max.X(),
      ymax: max.Y(),
      zmax: max.Z(),
    };
  }

  _shapeVolume(shape) {
    if (this._isEmptyShape(shape)) return 0;
    const props = new this.oc.GProp_GProps_1();
    this.oc.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
    return props.Mass();
  }

  _isEmptyShape(shape) {
    return shape === null || shape === undefined || shape.IsNull?.() === true;
  }

  _fuse(left, right) {
    return this._booleanOperation(
      this.oc.BRepAlgoAPI_Fuse_3,
      left,
      right,
      "fuse",
    );
  }

  _cut(left, right) {
    return this._booleanOperation(
      this.oc.BRepAlgoAPI_Cut_3,
      left,
      right,
      "cut",
    );
  }

  _common(left, right) {
    return this._booleanOperation(
      this.oc.BRepAlgoAPI_Common_3,
      left,
      right,
      "common",
    );
  }

  _booleanOperation(OperationClass, left, right, label) {
    const operation = new OperationClass(
      left,
      right,
      new this.oc.Message_ProgressRange_1(),
    );
    operation.Build(new this.oc.Message_ProgressRange_1());
    if (operation.HasErrors?.()) {
      throw new CadExportError(`OpenCascade boolean ${label} failed`);
    }
    return operation.Shape();
  }

  _point(x, y, z) {
    return new this.oc.gp_Pnt_3(x, y, z);
  }

  _vec(x, y, z) {
    return new this.oc.gp_Vec_4(x, y, z);
  }

  _zAxis(center) {
    const axis = new this.oc.gp_Ax2_1();
    axis.SetLocation(this._point(center[0], center[1], center[2]));
    axis.SetDirection(new this.oc.gp_Dir_4(0, 0, 1));
    return axis;
  }

  _stepAsIs() {
    return (
      this.oc.STEPControl_StepModelType?.STEPControl_AsIs ??
      this.oc.STEPControl_AsIs
    );
  }

  _setStepUnit(unitSystem) {
    if (!this.oc.Interface_Static?.SetCVal) return;
    const stepUnit = this._stepUnit(unitSystem);
    const ok = this.oc.Interface_Static.SetCVal("write.step.unit", stepUnit);
    if (ok === false) {
      throw new CadExportError(`Unsupported STEP unit system: ${unitSystem}`);
    }
  }

  _stepUnit(unitSystem) {
    const units = {
      um: "UM",
      mm: "MM",
      cm: "CM",
      m: "M",
      inch: "INCH",
    };
    return units[String(unitSystem).toLowerCase()] ?? String(unitSystem).toUpperCase();
  }

  _virtualFileName(name) {
    const filename = `/${name}`;
    try {
      this.oc.FS.unlink(filename);
    } catch {
      // The Emscripten FS throws when the file does not exist.
    }
    return filename;
  }

  _readVirtualFile(filename, encoding) {
    const file = this.oc.FS.readFile(filename, { encoding });
    try {
      this.oc.FS.unlink(filename);
    } catch {
      // Best-effort cleanup.
    }
    return file;
  }
}

export async function exportCad(payload, outputBase, options = {}) {
  const converter = await OpenCascadeConverter.create(options);
  return converter.export(payload, outputBase);
}

export async function convertCad(payload, options = {}) {
  const converter = await OpenCascadeConverter.create(options);
  return converter.convert(payload);
}

async function resolveOpenCascade(candidate, options = {}) {
  if (candidate) return candidate;

  let initOpenCascade;
  try {
    ({ default: initOpenCascade } = await import("opencascade.js/dist/node.js"));
  } catch (error) {
    try {
      ({ default: initOpenCascade } = await import("opencascade.js"));
    } catch (fallbackError) {
      throw new CadExportError(
        `Unable to load opencascade.js. Run npm install in src/js first. Original error: ${fallbackError.message || error.message}`,
      );
    }
  }
  const initOptions = options.suppressOpenCascadeOutput
    ? {
        module: {
          print() {},
          printErr() {},
        },
      }
    : {};
  return initOpenCascade(initOptions);
}

function requireGeometryFields(geometry, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(geometry, field)) {
      throw new CadExportError(`Geometry ${geometry.type} missing field ${field}`);
    }
  }
  return geometry;
}

function withSuffix(outputBase, suffix) {
  const base = String(outputBase);
  const lastSlash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const lastDot = base.lastIndexOf(".");
  const withoutSuffix = lastDot > lastSlash ? base.slice(0, lastDot) : base;
  return `${withoutSuffix}${suffix}`;
}

async function writeBinaryFile(path, bytes) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, bytes);
}

async function writeTextFile(path, text) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, text, "utf8");
}
