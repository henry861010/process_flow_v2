"use client";

import * as React from "react";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";

import type {
  BoundsTuple,
  LoadedCadModel,
} from "@/components/viewer/model-loader";
import { DEMO_BOUNDS, formatLength } from "@/components/viewer/model-loader";

export type SectionPlaneMode = "xz" | "yz";
export type CameraViewMode = "iso" | "x" | "y" | "z";

export type MeasurePoint = {
  position: [number, number, number];
  snapped: boolean;
};

export type Measurement = {
  start: MeasurePoint;
  end: MeasurePoint;
  distance: number;
  delta: [number, number, number];
};

type ViewerSceneProps = {
  model: LoadedCadModel | null;
  bounds: BoundsTuple;
  sectionEnabled: boolean;
  sectionPlane: SectionPlaneMode;
  sectionPosition: number;
  sectionFlip: boolean;
  showGrid: boolean;
  showAxes: boolean;
  cameraResetKey: number;
  cameraView: CameraViewMode;
  measureEnabled: boolean;
  pendingMeasurePoint: MeasurePoint | null;
  measurement: Measurement | null;
  onMeasurePoint: (point: MeasurePoint) => void;
};

export function ViewerScene({
  model,
  bounds,
  sectionEnabled,
  sectionPlane,
  sectionPosition,
  sectionFlip,
  showGrid,
  showAxes,
  cameraResetKey,
  cameraView,
  measureEnabled,
  pendingMeasurePoint,
  measurement,
  onMeasurePoint,
}: ViewerSceneProps) {
  const contentRef = React.useRef<THREE.Group>(null);

  return (
    <Canvas
      className="h-full w-full"
      camera={{ fov: 42, position: [7200, -8200, 5200], near: 0.1, far: 100000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      shadows
      onCreated={({ camera, gl }) => {
        camera.up.set(0, 0, 1);
        gl.localClippingEnabled = true;
        gl.setClearColor(0xffffff, 0);
      }}
    >
      <SceneLights bounds={bounds} />
      <CameraRig bounds={bounds} resetKey={cameraResetKey} view={cameraView} />
      <OrbitControls target={bounds.center} />
      <SectionController
        bounds={bounds}
        enabled={sectionEnabled}
        mode={sectionPlane}
        position={sectionPosition}
        flip={sectionFlip}
      />
      {showGrid ? <SceneGrid bounds={bounds} /> : null}
      {showAxes ? <SceneAxes bounds={bounds} /> : null}
      <group
        ref={contentRef}
        onClick={(event) => {
          if (!measureEnabled) return;
          handleMeasureClick(event, {
            bounds,
            sectionEnabled,
            sectionPlane,
            sectionPosition,
            sectionFlip,
            onMeasurePoint,
          });
        }}
      >
        {model ? (
          <primitive object={model.object} key={model.id} />
        ) : (
          <DemoPackage />
        )}
      </group>
      <MeasurementOverlay
        bounds={bounds}
        pendingPoint={pendingMeasurePoint}
        measurement={measurement}
      />
    </Canvas>
  );
}

function SceneLights({ bounds }: { bounds: BoundsTuple }) {
  const [cx, cy, cz] = bounds.center;
  const maxDim = Math.max(...bounds.size, 1);

  return (
    <>
      <hemisphereLight args={["#eff7fb", "#b7b0a2", 2.1]} />
      <directionalLight
        castShadow
        intensity={2.8}
        position={[cx + maxDim * 0.7, cy - maxDim * 0.9, cz + maxDim * 1.2]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight
        intensity={0.85}
        position={[cx - maxDim, cy + maxDim * 0.55, cz + maxDim * 0.6]}
      />
    </>
  );
}

function CameraRig({
  bounds,
  resetKey,
  view,
}: {
  bounds: BoundsTuple;
  resetKey: number;
  view: CameraViewMode;
}) {
  const { camera } = useThree();
  const boundsKey = `${bounds.min.join(",")}:${bounds.max.join(",")}:${resetKey}:${view}`;

  React.useEffect(() => {
    const center = new THREE.Vector3(...bounds.center);
    const size = new THREE.Vector3(...bounds.size);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 42;
    const distance =
      maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const { direction, up } = getCameraViewFrame(view);

    camera.up.copy(up);
    camera.position.copy(center).add(direction.multiplyScalar(distance * 1.55));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = Math.max(maxDim / 10000, 0.001);
      camera.far = Math.max(maxDim * 80, 1000);
    }
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [boundsKey, camera, bounds.center, bounds.size, view]);

  return null;
}

function getCameraViewFrame(view: CameraViewMode) {
  switch (view) {
    case "x":
      return {
        direction: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 0, 1),
      };
    case "y":
      return {
        direction: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(0, 0, 1),
      };
    case "z":
      return {
        direction: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      };
    case "iso":
    default:
      return {
        direction: new THREE.Vector3(0.86, -1.08, 0.66).normalize(),
        up: new THREE.Vector3(0, 0, 1),
      };
  }
}

function OrbitControls({ target }: { target: [number, number, number] }) {
  const { camera, gl } = useThree();
  const controlsRef = React.useRef<OrbitControlsImpl | null>(null);
  const targetKey = target.join(",");

  React.useEffect(() => {
    const controls = new OrbitControlsImpl(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl.domElement]);

  React.useEffect(() => {
    controlsRef.current?.target.set(...target);
    controlsRef.current?.update();
  }, [target, targetKey]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}

function SectionController({
  bounds,
  enabled,
  mode,
  position,
  flip,
}: {
  bounds: BoundsTuple;
  enabled: boolean;
  mode: SectionPlaneMode;
  position: number;
  flip: boolean;
}) {
  const { gl } = useThree();
  const plane = React.useMemo(() => new THREE.Plane(), []);

  React.useEffect(() => {
    if (!enabled) {
      gl.clippingPlanes = [];
      return undefined;
    }

    setSectionPlaneFromState(plane, bounds, mode, position, flip);
    gl.localClippingEnabled = true;
    gl.clippingPlanes = [plane];

    return () => {
      gl.clippingPlanes = [];
    };
  }, [bounds, enabled, flip, gl, mode, plane, position]);

  if (!enabled) return null;

  return (
    <SectionPlaneVisual
      bounds={bounds}
      mode={mode}
      position={position}
      flip={flip}
    />
  );
}

function SectionPlaneVisual({
  bounds,
  mode,
  position,
  flip,
}: {
  bounds: BoundsTuple;
  mode: SectionPlaneMode;
  position: number;
  flip: boolean;
}) {
  const [cx, cy, cz] = bounds.center;
  const [sx, sy, sz] = bounds.size;
  const pad = 1.08;

  const planeArgs: [number, number] =
    mode === "xz" ? [sx * pad, sz * pad] : [sy * pad, sz * pad];
  const planePosition: [number, number, number] =
    mode === "xz" ? [cx, position, cz] : [position, cy, cz];
  const planeRotation: [number, number, number] =
    mode === "xz"
      ? [Math.PI / 2, 0, flip ? Math.PI : 0]
      : [0, Math.PI / 2, flip ? Math.PI : 0];

  return (
    <mesh position={planePosition} rotation={planeRotation} renderOrder={10}>
      <planeGeometry args={planeArgs} />
      <meshBasicMaterial
        color="#1aa7d2"
        transparent
        opacity={0.16}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function getSectionPlaneFrame(
  bounds: BoundsTuple,
  mode: SectionPlaneMode,
  position: number,
  flip: boolean,
) {
  const [cx, cy, cz] = bounds.center;
  const [sx, sy, sz] = bounds.size;
  const pad = 1.08;

  if (mode === "xz") {
    return {
      normal: new THREE.Vector3(0, flip ? -1 : 1, 0),
      position: new THREE.Vector3(cx, position, cz),
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      size: [sx * pad, sz * pad] as [number, number],
    };
  }

  return {
    normal: new THREE.Vector3(flip ? -1 : 1, 0, 0),
    position: new THREE.Vector3(position, cy, cz),
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
    size: [sy * pad, sz * pad] as [number, number],
  };
}

function setSectionPlaneFromState(
  plane: THREE.Plane,
  bounds: BoundsTuple,
  mode: SectionPlaneMode,
  position: number,
  flip: boolean,
) {
  const frame = getSectionPlaneFrame(bounds, mode, position, flip);
  plane.setFromNormalAndCoplanarPoint(frame.normal, frame.position);
}

function disabledRaycast(
  _raycaster: THREE.Raycaster,
  _intersects: THREE.Intersection[],
) {
  return undefined;
}

function handleMeasureClick(
  event: ThreeEvent<MouseEvent>,
  options: {
    bounds: BoundsTuple;
    sectionEnabled: boolean;
    sectionPlane: SectionPlaneMode;
    sectionPosition: number;
    sectionFlip: boolean;
    onMeasurePoint: (point: MeasurePoint) => void;
  },
) {
  event.stopPropagation();

  const clipPlane = new THREE.Plane();
  if (options.sectionEnabled) {
    setSectionPlaneFromState(
      clipPlane,
      options.bounds,
      options.sectionPlane,
      options.sectionPosition,
      options.sectionFlip,
    );
  }

  const tolerance = Math.max(Math.max(...options.bounds.size) * 0.0005, 0.001);
  const intersection = event.intersections.find((candidate) => {
    if (!isRenderableMesh(candidate.object)) return false;
    if (!options.sectionEnabled) return true;
    return clipPlane.distanceToPoint(candidate.point) >= -tolerance;
  });

  if (!intersection || !isRenderableMesh(intersection.object)) return;

  options.onMeasurePoint(
    snapIntersectionToNearbyVertex(
      intersection,
      intersection.object,
      options.bounds,
    ),
  );
}

function snapIntersectionToNearbyVertex(
  intersection: THREE.Intersection,
  mesh: THREE.Mesh,
  bounds: BoundsTuple,
): MeasurePoint {
  const fallback = vectorTuple(intersection.point);
  const geometry = mesh.geometry;
  const positionAttribute = geometry.getAttribute("position");
  const face = intersection.face;

  if (!positionAttribute || !face) {
    return { position: fallback, snapped: false };
  }

  const maxDim = Math.max(...bounds.size, 1);
  const snapDistance = maxDim * 0.006;
  const indices = [face.a, face.b, face.c];
  let nearest: THREE.Vector3 | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  indices.forEach((index) => {
    const vertex = new THREE.Vector3().fromBufferAttribute(
      positionAttribute,
      index,
    );
    mesh.localToWorld(vertex);
    const distance = vertex.distanceTo(intersection.point);
    if (distance < nearestDistance) {
      nearest = vertex;
      nearestDistance = distance;
    }
  });

  if (nearest && nearestDistance <= snapDistance) {
    return { position: vectorTuple(nearest), snapped: true };
  }

  return { position: fallback, snapped: false };
}

function MeasurementOverlay({
  bounds,
  pendingPoint,
  measurement,
}: {
  bounds: BoundsTuple;
  pendingPoint: MeasurePoint | null;
  measurement: Measurement | null;
}) {
  const maxDim = Math.max(...bounds.size, 1);
  const markerRadius = maxDim * 0.012;

  if (!pendingPoint && !measurement) return null;

  return (
    <group renderOrder={60}>
      {pendingPoint ? (
        <MeasureMarker position={pendingPoint.position} radius={markerRadius} />
      ) : null}
      {measurement ? (
        <>
          <MeasureMarker
            position={measurement.start.position}
            radius={markerRadius}
          />
          <MeasureMarker
            position={measurement.end.position}
            radius={markerRadius}
          />
          <MeasureLine measurement={measurement} />
          <MeasureLabel bounds={bounds} measurement={measurement} />
        </>
      ) : null}
    </group>
  );
}

function MeasureMarker({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  return (
    <mesh position={position} renderOrder={62} raycast={disabledRaycast}>
      <sphereGeometry args={[radius, 18, 12]} />
      <meshBasicMaterial
        color="#0f5f78"
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function MeasureLine({ measurement }: { measurement: Measurement }) {
  const geometry = React.useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...measurement.start.position),
      new THREE.Vector3(...measurement.end.position),
    ]);
  }, [measurement]);
  const line = React.useMemo(() => {
    const material = new THREE.LineBasicMaterial({
      color: "#0f5f78",
      depthTest: false,
      depthWrite: false,
    });
    const object = new THREE.Line(geometry, material);
    object.renderOrder = 61;
    object.raycast = disabledRaycast;
    return object;
  }, [geometry]);

  React.useEffect(() => {
    return () => {
      geometry.dispose();
      if (line.material instanceof THREE.Material) {
        line.material.dispose();
      }
    };
  }, [geometry, line]);

  return <primitive object={line} />;
}

function MeasureLabel({
  bounds,
  measurement,
}: {
  bounds: BoundsTuple;
  measurement: Measurement;
}) {
  const texture = React.useMemo(
    () => createMeasureLabelTexture(`${formatLength(measurement.distance)} um`),
    [measurement],
  );

  React.useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  const start = new THREE.Vector3(...measurement.start.position);
  const end = new THREE.Vector3(...measurement.end.position);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const maxDim = Math.max(...bounds.size, 1);

  return (
    <sprite
      position={vectorTuple(midpoint)}
      scale={[maxDim * 0.24, maxDim * 0.07, 1]}
      renderOrder={63}
      raycast={disabledRaycast}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </sprite>
  );
}

function createMeasureLabelTexture(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.strokeStyle = "rgba(15, 95, 120, 0.62)";
  context.lineWidth = 6;
  roundRect(context, 20, 36, canvas.width - 40, canvas.height - 72, 28);
  context.fill();
  context.stroke();

  context.fillStyle = "#12303a";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const fontSize = fitCanvasText(context, label, 58, 32, canvas.width - 120);
  context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function fitCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
) {
  let size = startSize;
  while (size > minSize) {
    context.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function formatSignedLength(value: number) {
  if (Object.is(value, -0)) return "0";
  return value > 0 ? `+${formatLength(value)}` : formatLength(value);
}

function isRenderableMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (
    object instanceof THREE.Mesh &&
    object.visible &&
    object.geometry instanceof THREE.BufferGeometry
  );
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function SceneGrid({ bounds }: { bounds: BoundsTuple }) {
  const gridRef = React.useRef<THREE.GridHelper>(null);
  const [cx, cy] = bounds.center;
  const z = bounds.min[2];
  const size = Math.max(bounds.size[0], bounds.size[1], 1) * 1.2;
  const divisions = 24;

  React.useEffect(() => {
    if (!gridRef.current) return;
    gridRef.current.rotation.x = Math.PI / 2;
  }, []);

  return (
    <gridHelper
      ref={gridRef}
      args={[size, divisions, "#8aa0a6", "#d1dcde"]}
      position={[cx, cy, z - bounds.size[2] * 0.035]}
    />
  );
}

function SceneAxes({ bounds }: { bounds: BoundsTuple }) {
  const size = Math.max(...bounds.size, 1) * 0.16;
  return (
    <axesHelper
      args={[size]}
      position={[
        bounds.min[0] - size * 0.18,
        bounds.min[1] - size * 0.18,
        bounds.min[2],
      ]}
    />
  );
}

function DemoPackage() {
  const packageMaterials = React.useMemo(
    () => ({
      substrate: new THREE.MeshPhysicalMaterial({
        color: "#10775d",
        roughness: 0.58,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
      silicon: new THREE.MeshPhysicalMaterial({
        color: "#858987",
        roughness: 0.5,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
      hbm: new THREE.MeshPhysicalMaterial({
        color: "#aeb5b2",
        roughness: 0.54,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
      rdl: new THREE.MeshPhysicalMaterial({
        color: "#e0c629",
        roughness: 0.38,
        metalness: 0.4,
        side: THREE.DoubleSide,
      }),
      dielectric: new THREE.MeshPhysicalMaterial({
        color: "#20a8cf",
        roughness: 0.5,
        metalness: 0.02,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
      }),
      solder: new THREE.MeshPhysicalMaterial({
        color: "#e3e7e5",
        roughness: 0.34,
        metalness: 0.28,
        side: THREE.DoubleSide,
      }),
      mold: new THREE.MeshPhysicalMaterial({
        color: "#c5cbc8",
        roughness: 0.62,
        metalness: 0.04,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  );

  const bumpXs = [-3300, -2600, -1900, -1200, -500, 200, 900, 1600, 2300, 3000];
  const microBumps = [-3000, -2600, -2200, -1800, -1400, -1000, -600, -200, 200, 600, 1000, 1400, 1800, 2200, 2600, 3000];

  return (
    <group>
      <Box
        material={packageMaterials.substrate}
        position={[0, 0, 0]}
        scale={[7600, 5000, 520]}
      />
      <Box
        material={packageMaterials.dielectric}
        position={[0, 0, 560]}
        scale={[7000, 4600, 180]}
      />
      <Box
        material={packageMaterials.mold}
        position={[0, 0, 1080]}
        scale={[7300, 4800, 900]}
      />
      <Box
        material={packageMaterials.silicon}
        position={[0, 0, 1220]}
        scale={[3200, 3100, 520]}
      />
      <Box
        material={packageMaterials.hbm}
        position={[-2450, 0, 1210]}
        scale={[1200, 3000, 470]}
      />
      <Box
        material={packageMaterials.hbm}
        position={[2450, 0, 1210]}
        scale={[1200, 3000, 470]}
      />
      {microBumps.map((x, index) => (
        <Box
          key={`rdl-${x}`}
          material={packageMaterials.rdl}
          position={[x, index % 2 === 0 ? -950 : 950, 730]}
          scale={[180, 2100, 90]}
        />
      ))}
      {microBumps.map((x) => (
        <Box
          key={`pillar-${x}`}
          material={packageMaterials.rdl}
          position={[x, 0, 840]}
          scale={[120, 120, 310]}
        />
      ))}
      {bumpXs.map((x) => (
        <mesh
          key={`bga-${x}`}
          castShadow
          receiveShadow
          position={[x, -2300, -520]}
          material={packageMaterials.solder}
        >
          <sphereGeometry args={[270, 32, 16]} />
        </mesh>
      ))}
      {bumpXs.map((x) => (
        <mesh
          key={`bga-back-${x}`}
          castShadow
          receiveShadow
          position={[x, 2300, -520]}
          material={packageMaterials.solder}
        >
          <sphereGeometry args={[270, 32, 16]} />
        </mesh>
      ))}
    </group>
  );
}

function Box({
  position,
  scale,
  material,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  material: THREE.Material;
}) {
  return (
    <mesh castShadow receiveShadow position={position} material={material}>
      <boxGeometry args={scale} />
    </mesh>
  );
}
