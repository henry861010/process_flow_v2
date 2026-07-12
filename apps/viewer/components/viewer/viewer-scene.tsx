"use client";

import * as React from "react";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";

import type {
  BoundsTuple,
  LoadedCadModel,
} from "@/components/viewer/model-loader";
import { DEMO_BOUNDS } from "@/components/viewer/model-loader";
import { sectionDisplayEpsilon } from "@/components/viewer/section-display";

export type SectionPlaneMode = "xz" | "yz";
export type CameraViewMode = "iso" | "x" | "y" | "z";

type ViewerSceneProps = {
  model: LoadedCadModel | null;
  bounds: BoundsTuple;
  sectionBounds?: BoundsTuple;
  sectionEnabled: boolean;
  sectionPlane: SectionPlaneMode;
  sectionPosition: number;
  sectionFlip: boolean;
  showGrid: boolean;
  showAxes: boolean;
  cameraResetKey: number;
  cameraView: CameraViewMode;
  showDemoWhenEmpty?: boolean;
  children?: React.ReactNode;
};

export function ViewerScene({
  model,
  bounds,
  sectionBounds,
  sectionEnabled,
  sectionPlane,
  sectionPosition,
  sectionFlip,
  showGrid,
  showAxes,
  cameraResetKey,
  cameraView,
  showDemoWhenEmpty = true,
  children,
}: ViewerSceneProps) {
  const contentRef = React.useRef<THREE.Group>(null);

  return (
    <Canvas
      className="h-full w-full"
      camera={{ fov: 42, position: [7200, -8200, 5200], near: 0.1, far: 100000 }}
      dpr={1}
      frameloop="demand"
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      fallback={
        <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
          3D acceleration is unavailable. Use the exact engineering section in the
          settings panel.
        </div>
      }
      onCreated={({ camera, gl }) => {
        camera.up.set(0, 0, 1);
        gl.localClippingEnabled = true;
        gl.setClearColor(0xffffff, 0);
      }}
    >
      <SceneLights bounds={bounds} />
      <CameraRig bounds={bounds} resetKey={cameraResetKey} view={cameraView} />
      <CameraClipRange bounds={bounds} />
      <OrbitControls target={bounds.center} />
      <SectionController
        bounds={sectionBounds ?? bounds}
        enabled={sectionEnabled}
        mode={sectionPlane}
        position={sectionPosition}
        flip={sectionFlip}
      />
      {showGrid ? <SceneGrid bounds={bounds} /> : null}
      {showAxes ? <SceneAxes bounds={bounds} /> : null}
      <group ref={contentRef}>
        {model ? (
          <primitive object={model.object} key={model.id} />
        ) : showDemoWhenEmpty ? (
          <DemoPackage />
        ) : null}
        {children}
      </group>
    </Canvas>
  );
}

function SceneLights({ bounds }: { bounds: BoundsTuple }) {
  const [cx, cy, cz] = bounds.center;
  const maxDim = Math.max(...bounds.size, 1);

  return (
    <>
      <hemisphereLight args={["#eff7fb", "#b7b0a2", 1.35]} />
      <directionalLight
        intensity={1.65}
        position={[cx + maxDim * 0.7, cy - maxDim * 0.9, cz + maxDim * 1.2]}
      />
      <directionalLight
        intensity={0.45}
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
  const { camera, invalidate } = useThree();
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
    camera.lookAt(center);
    setCameraClipRange(camera, bounds);
    camera.updateProjectionMatrix();
    invalidate();
  }, [bounds, boundsKey, camera, bounds.center, bounds.size, invalidate, view]);

  return null;
}

function CameraClipRange({ bounds }: { bounds: BoundsTuple }) {
  const { camera } = useThree();

  const updateClipRange = React.useCallback(() => {
    setCameraClipRange(camera, bounds);
  }, [bounds, camera]);

  React.useEffect(updateClipRange, [updateClipRange]);
  useFrame(updateClipRange);
  return null;
}

function setCameraClipRange(camera: THREE.Camera, bounds: BoundsTuple) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;

  const center = new THREE.Vector3(...bounds.center);
  const radius = Math.max(
    new THREE.Vector3(...bounds.size).length() / 2,
    0.001,
  );
  const distance = camera.position.distanceTo(center);
  const padding = radius * 1.35;
  const near = Math.max(radius / 10000, distance - padding, 0.001);
  const far = Math.max(distance + padding, near + radius * 0.01, near + 1);

  if (
    Math.abs(camera.near - near) <= near * 1e-4 &&
    Math.abs(camera.far - far) <= far * 1e-4
  ) {
    return;
  }

  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
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
  const { camera, gl, invalidate } = useThree();
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
    const handleChange = () => invalidate();
    controls.addEventListener("change", handleChange);
    controlsRef.current = controls;

    return () => {
      controls.removeEventListener("change", handleChange);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl.domElement, invalidate]);

  React.useEffect(() => {
    controlsRef.current?.target.set(...target);
    controlsRef.current?.update();
    invalidate();
  }, [invalidate, target, targetKey]);

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
  const frame = getSectionPlaneFrame(bounds, mode, position, flip);
  const planeArgs = frame.size;
  // Keep the translucent guide with the cap, beyond the inset clipping plane.
  const planePosition = frame.position
    .clone()
    .addScaledVector(frame.normal, sectionDisplayEpsilon(bounds))
    .toArray() as [number, number, number];

  return (
    <mesh position={planePosition} rotation={frame.rotation} renderOrder={10}>
      <planeGeometry args={planeArgs} />
      <meshBasicMaterial
        color="#1aa7d2"
        transparent
        opacity={0.05}
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
  // Move the display clipping plane a fraction into the retained half-space.
  // OpenCascade can return an exact cap on a plane that is also an existing
  // tessellated cavity wall. Without this inset, Three.js retains the wall at
  // distance zero and it can depth-occlude the authoritative material cap.
  const insetPosition = frame.position
    .clone()
    .addScaledVector(frame.normal, sectionDisplayEpsilon(bounds) * 0.5);
  plane.setFromNormalAndCoplanarPoint(frame.normal, insetPosition);
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
      substrate: new THREE.MeshStandardMaterial({
        color: "#10775d",
        roughness: 0.58,
        metalness: 0.02,
        side: THREE.FrontSide,
      }),
      silicon: new THREE.MeshStandardMaterial({
        color: "#858987",
        roughness: 0.5,
        metalness: 0.08,
        side: THREE.FrontSide,
      }),
      hbm: new THREE.MeshStandardMaterial({
        color: "#aeb5b2",
        roughness: 0.54,
        metalness: 0.04,
        side: THREE.FrontSide,
      }),
      rdl: new THREE.MeshStandardMaterial({
        color: "#e0c629",
        roughness: 0.38,
        metalness: 0.4,
        side: THREE.FrontSide,
      }),
      dielectric: new THREE.MeshStandardMaterial({
        color: "#20a8cf",
        roughness: 0.5,
        metalness: 0.02,
        side: THREE.FrontSide,
      }),
      solder: new THREE.MeshStandardMaterial({
        color: "#e3e7e5",
        roughness: 0.34,
        metalness: 0.28,
        side: THREE.FrontSide,
      }),
      mold: new THREE.MeshStandardMaterial({
        color: "#c5cbc8",
        roughness: 0.62,
        metalness: 0.04,
        side: THREE.FrontSide,
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
          position={[x, -2300, -520]}
          material={packageMaterials.solder}
        >
          <sphereGeometry args={[270, 16, 10]} />
        </mesh>
      ))}
      {bumpXs.map((x) => (
        <mesh
          key={`bga-back-${x}`}
          position={[x, 2300, -520]}
          material={packageMaterials.solder}
        >
          <sphereGeometry args={[270, 16, 10]} />
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
    <mesh position={position} material={material}>
      <boxGeometry args={scale} />
    </mesh>
  );
}
