"use client";

// First-person car interior, parented to the camera. The player's own car body
// (hood, fenders, mirrors) is the same procedural sports car used elsewhere,
// placed so the camera sits at the driver's eye point; the cabin shell is
// back-face culled from inside, so the windows are simply open. On top of it:
// dashboard, instrument binnacle with backlit gauges, infotainment screen,
// steering wheel, A-pillars, roof lining, door cards and a rear-view mirror.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCar } from "./carGeometry";
import { carMaterials, makePaint } from "./carMaterials";

/** Driver eye point in car coordinates (car faces +Z, driver sits on +X). */
const EYE = new THREE.Vector3(0.36, 1.09, -0.6);

/** Rear-view mirror glass size (m) and its render-target resolution. */
const MIRROR_W = 0.22;
const MIRROR_H = 0.052;
const MIRROR_RT_W = 512;
const MIRROR_RT_H = Math.round((MIRROR_RT_W * MIRROR_H) / MIRROR_W);
/** Mirror camera, in camera-local space: on the car's centre line, above the rear seats. */
const MIRROR_CAM_OFFSET = new THREE.Vector3(EYE.x, 0.1, 1.1);
const _mirrorPos = new THREE.Vector3();

function dialTexture(kind: "speed" | "rpm"): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050608";
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  const max = kind === "speed" ? 260 : 8;
  const major = kind === "speed" ? 20 : 1;
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  g.translate(S / 2, S / 2);
  for (let v = 0; v <= max + 1e-6; v += major / (kind === "speed" ? 2 : 4)) {
    const a = a0 + ((a1 - a0) * v) / max;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const red = kind === "rpm" && v >= 6.5;
    g.strokeStyle = red ? "#ff3b2f" : "#f2f4f8";
    g.lineWidth = isMajor ? 4 : 2;
    const r0 = isMajor ? 96 : 104;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * 116, Math.sin(a) * 116);
    g.stroke();
    const label = kind === "speed" ? Math.round(v) % 40 === 0 : true;
    if (isMajor && label) {
      g.fillStyle = red ? "#ff3b2f" : "#e9edf5";
      g.font = "600 20px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(v), Math.cos(a) * 76, Math.sin(a) * 76);
    }
  }
  g.fillStyle = "#9aa3b2";
  g.font = "500 15px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(kind === "speed" ? "km/h" : "x1000 rpm", 0, 46);
  // amber accent ring
  g.strokeStyle = "rgba(255,170,60,0.9)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 122, a0, a1);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Dashboard tell-tale: the blue high-beam symbol (white, tinted by the material). */
function highBeamIcon(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineWidth = 5;
  g.lineCap = "round";
  // lamp body: a "D" facing left
  g.beginPath();
  g.moveTo(34, 14);
  g.bezierCurveTo(62, 14, 62, 50, 34, 50);
  g.closePath();
  g.fill();
  // straight beams (high beam = horizontal)
  for (let i = 0; i < 5; i++) {
    const y = 17 + i * 7.5;
    g.beginPath();
    g.moveTo(6, y);
    g.lineTo(24, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screenTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 300;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#10131c");
  bg.addColorStop(1, "#1b1022");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // album tile
  const tile = g.createLinearGradient(24, 40, 184, 200);
  tile.addColorStop(0, "#ffd400");
  tile.addColorStop(1, "#f97316");
  g.fillStyle = tile;
  g.fillRect(28, 44, 150, 150);
  g.fillStyle = "#111";
  g.font = "900 44px system-ui, sans-serif";
  g.fillText("S", 84, 136);
  g.fillStyle = "#f5f6f8";
  g.font = "700 34px system-ui, sans-serif";
  g.fillText("Saygımdan", 204, 96);
  g.fillStyle = "#a6adbb";
  g.font = "500 24px system-ui, sans-serif";
  g.fillText("Bengü", 204, 134);
  g.fillStyle = "#39404e";
  g.fillRect(204, 170, 270, 6);
  g.fillStyle = "#ffd400";
  g.fillRect(204, 170, 118, 6);
  g.fillStyle = "#a6adbb";
  g.font = "500 18px system-ui, sans-serif";
  g.fillText("1:42", 204, 204);
  g.fillText("3:58", 438, 204);
  // bottom bar
  g.fillStyle = "#0a0c12";
  g.fillRect(0, 240, W, 60);
  g.fillStyle = "#cfd5df";
  g.font = "600 22px system-ui, sans-serif";
  g.fillText("23:14", 24, 280);
  g.fillText("18°C", 420, 280);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A box stretched between two points (for pillars / struts). */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, len, d);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function dashGeometry(): THREE.BufferGeometry {
  // side profile (u, y) extruded across the cabin
  const s = new THREE.Shape();
  s.moveTo(1.05, 0.78);
  s.lineTo(0.62, 0.83);
  s.quadraticCurveTo(0.36, 0.85, 0.33, 0.76);
  s.lineTo(0.36, 0.56);
  s.quadraticCurveTo(0.42, 0.4, 0.6, 0.34);
  s.lineTo(1.05, 0.3);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 1.44,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -0.72);
  // (u, y, across) -> (x = -across, y, z = u)
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, -p.getZ(i), p.getY(i), p.getX(i));
  g.computeVertexNormals();
  return g;
}

function binnacleGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0.52, 0.82);
  s.quadraticCurveTo(0.46, 0.94, 0.27, 0.9);
  s.lineTo(0.26, 0.87);
  s.quadraticCurveTo(0.36, 0.88, 0.42, 0.8);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.44, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, curveSegments: 8 });
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, 0.58 - p.getZ(i), p.getY(i), p.getX(i));
  g.computeVertexNormals();
  return g;
}

export default function Cockpit({
  steerRef,
  speedRef,
  rpmRef,
  color = "#b45309",
  maxSpeedKmh = 260,
  visible = true,
  mirror = true,
  highBeamRef,
}: {
  visible?: boolean;
  /** render the rear-view mirror live (a second, small scene render per frame) */
  mirror?: boolean;
  /** 0..1 high-beam tell-tale brightness */
  highBeamRef?: React.RefObject<number>;
  steerRef: React.RefObject<number>;
  /** km/h */
  speedRef: React.RefObject<number>;
  /** 0..8 (x1000) */
  rpmRef: React.RefObject<number>;
  color?: string;
  maxSpeedKmh?: number;
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const root = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  const needleS = useRef<THREE.Group>(null);
  const needleR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const mirrorFrame = useRef(0);

  // live rear-view mirror: a small camera looking backwards renders the scene
  // (without the cockpit) into a texture shown, mirrored, on the glass
  const mirrorRT = useFBO(MIRROR_RT_W, MIRROR_RT_H, { samples: 2 });
  const mirrorCam = useMemo(() => new THREE.PerspectiveCamera(13, MIRROR_W / MIRROR_H, 0.3, 1600), []);
  const mirrorGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(MIRROR_W, MIRROR_H);
    // flip horizontally, like a real mirror
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    return g;
  }, []);

  useEffect(() => {
    scene.add(camera);
    const g = root.current;
    if (g) camera.add(g);
    return () => {
      if (g) camera.remove(g);
      scene.remove(camera);
    };
  }, [camera, scene]);

  const car = useMemo(() => buildCar("sport", 1), []);
  // exterior shell without the part that would sit inside the cabin (deck /
  // roof above the dashboard): keep hood, fenders, door tops and mirrors
  const shell = useMemo(() => {
    const src = car.body.paint!;
    const pos = src.getAttribute("position") as THREE.BufferAttribute;
    const nor = src.getAttribute("normal") as THREE.BufferAttribute;
    const keepP: number[] = [];
    const keepN: number[] = [];
    for (let t = 0; t < pos.count; t += 3) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += pos.getX(t + k) / 3;
        cy += pos.getY(t + k) / 3;
        cz += pos.getZ(t + k) / 3;
      }
      if (cz > -2.1 && cz < 1.08 && Math.abs(cx) < 0.76 && cy > 0.5) continue;
      for (let k = 0; k < 3; k++) {
        keepP.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
        keepN.push(nor.getX(t + k), nor.getY(t + k), nor.getZ(t + k));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(keepP, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(keepN, 3));
    return g;
  }, [car]);
  const mats = carMaterials();
  const paint = useMemo(() => makePaint(color), [color]);
  const interior = useMemo(
    () => ({
      soft: new THREE.MeshStandardMaterial({ color: "#2a2b30", roughness: 0.8, metalness: 0.05 }),
      leather: new THREE.MeshStandardMaterial({ color: "#1d1d21", roughness: 0.5, metalness: 0.05 }),
      lining: new THREE.MeshStandardMaterial({ color: "#46464b", roughness: 0.95, side: THREE.DoubleSide }),
      alu: new THREE.MeshStandardMaterial({ color: "#5d6269", roughness: 0.42, metalness: 0.9, envMapIntensity: 0.5 }),
      roofGlass: new THREE.MeshStandardMaterial({
        color: "#0a0e16",
        roughness: 0.05,
        metalness: 0.3,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      gloss: new THREE.MeshPhysicalMaterial({ color: "#050506", roughness: 0.08, metalness: 0.2, clearcoat: 1 }),
      speed: new THREE.MeshStandardMaterial({ map: dialTexture("speed"), emissiveMap: dialTexture("speed"), emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.3 }),
      rpm: new THREE.MeshStandardMaterial({ map: dialTexture("rpm"), emissiveMap: dialTexture("rpm"), emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.3 }),
      screen: (() => {
        const t = screenTexture();
        return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: "#ffffff", emissiveIntensity: 0.8, roughness: 0.15 });
      })(),
      needle: new THREE.MeshBasicMaterial({ color: "#ff5a1f", toneMapped: false }),
      highBeam: new THREE.MeshBasicMaterial({ map: highBeamIcon(), color: "#0a1224", transparent: true, depthWrite: false, toneMapped: false }),
    }),
    []
  );

  const geo = useMemo(() => {
    const dash = dashGeometry();
    const binnacle = binnacleGeometry();
    // A-pillars (inside trim) from the dash corners up to the roof
    const pillarL = strut(new THREE.Vector3(0.75, 0.8, 1.02), new THREE.Vector3(0.63, 1.22, 0.02), 0.075, 0.06);
    const pillarR = strut(new THREE.Vector3(-0.75, 0.8, 1.02), new THREE.Vector3(-0.63, 1.22, 0.02), 0.075, 0.06);
    const header = strut(new THREE.Vector3(-0.64, 1.235, 0.14), new THREE.Vector3(0.64, 1.235, 0.14), 0.06, 0.09);
    // headliner frame around a panoramic glass roof
    const liner: THREE.BufferGeometry[] = [];
    const band = (x0: number, x1: number, u0: number, u1: number) => {
      const p = new THREE.PlaneGeometry(x1 - x0, u0 - u1);
      p.rotateX(Math.PI / 2);
      p.translate((x0 + x1) / 2, 1.245, (u0 + u1) / 2);
      liner.push(p);
    };
    band(-0.66, 0.66, 0.12, 0.0);
    band(-0.66, 0.66, -1.1, -1.45);
    band(-0.66, -0.46, 0.0, -1.1);
    band(0.46, 0.66, 0.0, -1.1);
    const roof = mergeGeometries(liner)!;
    const roofGlass = new THREE.PlaneGeometry(0.92, 1.1);
    roofGlass.rotateX(Math.PI / 2);
    roofGlass.translate(0, 1.255, -0.55);
    const doorL = new THREE.BoxGeometry(0.1, 0.44, 2.0);
    doorL.translate(0.74, 0.62, -0.25);
    const doorR = doorL.clone();
    doorR.translate(-1.48, 0, 0);
    const sillL = new THREE.BoxGeometry(0.14, 0.04, 2.0);
    sillL.translate(0.72, 0.86, -0.25);
    const sillR = sillL.clone();
    sillR.translate(-1.44, 0, 0);
    const console_ = new THREE.BoxGeometry(0.26, 0.26, 1.0);
    console_.translate(0.0, 0.46, -0.1);
    return { dash, binnacle, pillarL, pillarR, header, roof, roofGlass, doorL, doorR, sillL, sillR, console_ };
  }, []);

  useFrame(() => {
    if (wheel.current) wheel.current.rotation.z = -(steerRef.current ?? 0) * 1.6;
    const sp = THREE.MathUtils.clamp((speedRef.current ?? 0) / maxSpeedKmh, 0, 1);
    const rpm = THREE.MathUtils.clamp((rpmRef.current ?? 0) / 8, 0, 1);
    // dial sweep: 135° .. 405° (canvas angles, clockwise on screen)
    if (needleS.current) needleS.current.rotation.z = -(Math.PI * 0.75 + sp * Math.PI * 1.5);
    if (needleR.current) needleR.current.rotation.z = -(Math.PI * 0.75 + rpm * Math.PI * 1.5);
    const hb = highBeamRef?.current ?? 0;
    interior.highBeam.color.setRGB(0.035 + hb * 0.3, 0.05 + hb * 0.75, 0.1 + hb * 2.6);
  });

  // mirror pass: after the simulation / fleet updates (priority <= 0), before
  // the post-processing composer (priority 1) draws the main view
  useFrame(({ gl, scene, camera: cam }, dt) => {
    const b = body.current;
    if (!mirror || !visible || !b) return;
    // on a struggling GPU refresh the mirror every other frame
    mirrorFrame.current++;
    if (dt > 1 / 40 && mirrorFrame.current % 2 === 1) return;
    cam.updateMatrixWorld();
    _mirrorPos.copy(MIRROR_CAM_OFFSET).applyMatrix4(cam.matrixWorld);
    mirrorCam.position.copy(_mirrorPos);
    mirrorCam.quaternion.copy(cam.quaternion);
    // turn around, then undo the doubled look-down pitch and aim slightly down
    mirrorCam.rotateY(Math.PI);
    mirrorCam.rotateX(-0.075);
    mirrorCam.updateMatrixWorld();
    const prev = gl.getRenderTarget();
    b.visible = false;
    gl.setRenderTarget(mirrorRT);
    gl.render(scene, mirrorCam);
    gl.setRenderTarget(prev);
    b.visible = true;
  }, 0.5);

  // car group: rotate so car +Z points along camera -Z, eye at the origin
  return (
    <group ref={root} visible={visible}>
      <group rotation={[0, Math.PI, 0]} position={[EYE.x, -EYE.y, EYE.z]}>
        {/* everything but the light, so hiding it for the mirror pass keeps the light count stable */}
        <group ref={body}>
          {/* exterior shell: hood, fenders, mirrors */}
          <mesh geometry={shell} material={paint} />
          {car.body.trim && <mesh geometry={car.body.trim} material={mats.trim} />}
          {car.body.chrome && <mesh geometry={car.body.chrome} material={mats.chrome} />}

          {/* interior */}
          <mesh geometry={geo.dash} material={interior.soft} />
          <mesh geometry={geo.binnacle} material={interior.leather} />
          <mesh geometry={geo.pillarL} material={interior.lining} />
          <mesh geometry={geo.pillarR} material={interior.lining} />
          <mesh geometry={geo.header} material={interior.lining} />
          <mesh geometry={geo.roof} material={interior.lining} />
          <mesh geometry={geo.roofGlass} material={interior.roofGlass} />
          <mesh geometry={geo.doorL} material={interior.soft} />
          <mesh geometry={geo.doorR} material={interior.soft} />
          <mesh geometry={geo.sillL} material={interior.leather} />
          <mesh geometry={geo.sillR} material={interior.leather} />
          <mesh geometry={geo.console_} material={interior.gloss} />

          {/* gauges, facing the driver (towards -u), tilted back */}
          <group position={[0.36, 0.79, 0.285]} rotation={[0.16, Math.PI, 0]}>
            {[
              { x: -0.105, mat: interior.speed, ref: needleS },
              { x: 0.105, mat: interior.rpm, ref: needleR },
            ].map((d, i) => (
              <group key={i} position={[d.x, 0, 0]}>
                <mesh material={d.mat}>
                  <circleGeometry args={[0.084, 40]} />
                </mesh>
                <mesh position={[0, 0, 0.002]} material={interior.alu}>
                  <ringGeometry args={[0.084, 0.091, 40]} />
                </mesh>
                <group ref={d.ref} position={[0, 0, 0.004]}>
                  <mesh position={[0.03, 0, 0]} material={interior.needle}>
                    <boxGeometry args={[0.062, 0.0045, 0.002]} />
                  </mesh>
                </group>
                <mesh position={[0, 0, 0.006]} material={interior.gloss}>
                  <circleGeometry args={[0.012, 16]} />
                </mesh>
              </group>
            ))}
            {/* high-beam tell-tale inside the rev counter face */}
            <mesh position={[0.105, 0.029, 0.003]} material={interior.highBeam}>
              <planeGeometry args={[0.024, 0.024]} />
            </mesh>
          </group>

          {/* infotainment screen */}
          <group position={[-0.02, 0.93, 0.5]} rotation={[0.18, Math.PI, 0]}>
            <mesh material={interior.gloss}>
              <boxGeometry args={[0.3, 0.19, 0.02]} />
            </mesh>
            <mesh position={[0, 0, 0.011]} material={interior.screen}>
              <planeGeometry args={[0.28, 0.165]} />
            </mesh>
          </group>

          {/* steering wheel + column */}
          <group position={[0.36, 0.8, 0.1]} rotation={[0.42, 0, 0]}>
            <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} material={interior.leather}>
              <cylinderGeometry args={[0.035, 0.05, 0.36, 12]} />
            </mesh>
            <group ref={wheel}>
              <mesh material={interior.leather}>
                <torusGeometry args={[0.185, 0.022, 14, 48]} />
              </mesh>
              {[0, Math.PI / 2, -Math.PI / 2].map((a) => (
                <group key={a} rotation={[0, 0, a]}>
                  <mesh position={[0, -0.1, -0.006]} material={interior.leather}>
                    <boxGeometry args={[a === 0 ? 0.05 : 0.032, 0.17, 0.014]} />
                  </mesh>
                </group>
              ))}
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.01]} material={interior.leather}>
                <cylinderGeometry args={[0.05, 0.056, 0.045, 20]} />
              </mesh>
            </group>
          </group>

          {/* rear-view mirror */}
          <group position={[0.02, 1.16, 0.12]}>
            <mesh material={interior.leather}>
              <boxGeometry args={[0.24, 0.068, 0.03]} />
            </mesh>
            <mesh position={[0, 0, -0.016]} rotation={[0, Math.PI, 0]} geometry={mirrorGeo}>
              <meshBasicMaterial map={mirrorRT.texture} color="#c4c8d0" />
            </mesh>
            <mesh position={[0, 0.06, 0.02]} material={interior.leather}>
              <boxGeometry args={[0.02, 0.07, 0.02]} />
            </mesh>
          </group>

        </group>
        {/* soft instrument glow on the driver side */}
        <pointLight position={[0.2, 1.05, -0.2]} color="#dfe6ff" intensity={0.5} distance={1.6} decay={2} />
      </group>
    </group>
  );
}

export { EYE as COCKPIT_EYE };
