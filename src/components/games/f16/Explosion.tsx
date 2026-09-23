"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import Particles, { type ParticleHandle } from "../shared/Particles";
import { glowTexture } from "./textures";

export interface ExplosionHandle {
  trigger: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
}

const DEBRIS = 26;
const _o = new THREE.Object3D();
// HDR colours (> 1) so the fireball blooms against a bright sky
const FIRE_HOT = new THREE.Color(5, 3, 1.1);
const FIRE_MID = new THREE.Color(4, 1.5, 0.3);
const FIRE_RED = new THREE.Color(2.4, 0.55, 0.08);
const SMOKE_A = new THREE.Color("#2b2826");
const SMOKE_B = new THREE.Color("#4a443e");
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Fireball + smoke column + flash + shock ring + tumbling debris.
 * Everything is pre-allocated; trigger() just resets state.
 */
const Explosion = forwardRef<ExplosionHandle>(function Explosion(_, ref) {
  const fire = useRef<ParticleHandle>(null);
  const smoke = useRef<ParticleHandle>(null);
  const flash = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const debris = useRef<THREE.InstancedMesh>(null);
  const st = useMemo(
    () => ({
      t: 99,
      origin: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      emitAcc: 0,
      dPos: new Float32Array(DEBRIS * 3),
      dVel: new Float32Array(DEBRIS * 3),
      dRot: new Float32Array(DEBRIS * 3),
      dSpin: new Float32Array(DEBRIS * 3),
      dScale: new Float32Array(DEBRIS),
    }),
    []
  );
  const flashMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color("#ffd9a0").multiplyScalar(4),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
      }),
    []
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#fff1dc",
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    []
  );

  useImperativeHandle(ref, () => ({
    trigger(pos, vel) {
      st.t = 0;
      st.origin.copy(pos);
      st.vel.copy(vel).multiplyScalar(0.35);
      st.emitAcc = 0;
      for (let i = 0; i < DEBRIS; i++) {
        st.dPos[i * 3] = pos.x;
        st.dPos[i * 3 + 1] = pos.y;
        st.dPos[i * 3 + 2] = pos.z;
        _v.set(Math.random() - 0.5, Math.random() * 0.8 - 0.1, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(20 + Math.random() * 45)
          .addScaledVector(vel, 0.25);
        st.dVel[i * 3] = _v.x;
        st.dVel[i * 3 + 1] = _v.y;
        st.dVel[i * 3 + 2] = _v.z;
        for (let k = 0; k < 3; k++) {
          st.dRot[i * 3 + k] = Math.random() * 6;
          st.dSpin[i * 3 + k] = (Math.random() - 0.5) * 14;
        }
        st.dScale[i] = 0.3 + Math.random() * 1.1;
      }
      // initial burst
      for (let i = 0; i < 70; i++) {
        _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(8 + Math.random() * 26)
          .addScaledVector(st.vel, 1);
        const hot = Math.random();
        fire.current?.emit(pos, _v, {
          life: 0.5 + Math.random() * 0.9,
          size: 6 + Math.random() * 10,
          color: hot < 0.3 ? FIRE_HOT : hot < 0.7 ? FIRE_MID : FIRE_RED,
          grow: 2.2,
        });
      }
    },
  }));

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    st.t += dt;
    const t = st.t;
    const active = t < 6;
    if (flash.current) {
      const f = Math.max(0, 1 - t / 0.35);
      flash.current.visible = f > 0;
      flash.current.position.copy(st.origin);
      flash.current.scale.setScalar(20 + t * 240);
      flashMat.opacity = f;
    }
    if (ring.current) {
      const f = Math.max(0, 1 - t / 0.7);
      ring.current.visible = f > 0;
      ring.current.position.copy(st.origin);
      ring.current.quaternion.copy(camera.quaternion);
      ring.current.scale.setScalar(2 + t * 160);
      ringMat.opacity = f * f * 0.5;
    }
    if (!active) {
      if (debris.current) debris.current.visible = false;
      return;
    }
    // lingering fire then rising smoke
    st.emitAcc += dt * (t < 1.2 ? 60 : t < 4 ? 18 : 0);
    while (st.emitAcc >= 1) {
      st.emitAcc -= 1;
      _p.copy(st.origin).add(_v.set((Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8));
      if (t < 1.0 && Math.random() < 0.6) {
        _v.set((Math.random() - 0.5) * 10, 4 + Math.random() * 8, (Math.random() - 0.5) * 10);
        fire.current?.emit(_p, _v, { life: 0.6 + Math.random() * 0.6, size: 5 + Math.random() * 6, color: Math.random() < 0.5 ? FIRE_MID : FIRE_RED, grow: 1.6 });
      } else {
        _v.set((Math.random() - 0.5) * 6, 6 + Math.random() * 10, (Math.random() - 0.5) * 6);
        smoke.current?.emit(_p, _v, {
          life: 2.5 + Math.random() * 2,
          size: 8 + Math.random() * 8,
          color: Math.random() < 0.5 ? SMOKE_A : SMOKE_B,
          grow: 3,
        });
      }
    }
    // debris
    const im = debris.current;
    if (im) {
      im.visible = true;
      for (let i = 0; i < DEBRIS; i++) {
        st.dVel[i * 3 + 1] -= 9.8 * dt;
        const drag = Math.exp(-0.4 * dt);
        st.dVel[i * 3] *= drag;
        st.dVel[i * 3 + 2] *= drag;
        st.dPos[i * 3] += st.dVel[i * 3] * dt;
        st.dPos[i * 3 + 1] += st.dVel[i * 3 + 1] * dt;
        st.dPos[i * 3 + 2] += st.dVel[i * 3 + 2] * dt;
        if (st.dPos[i * 3 + 1] < 0.2) {
          st.dPos[i * 3 + 1] = 0.2;
          st.dVel[i * 3] *= 0.5;
          st.dVel[i * 3 + 1] *= -0.25;
          st.dVel[i * 3 + 2] *= 0.5;
        }
        for (let k = 0; k < 3; k++) st.dRot[i * 3 + k] += st.dSpin[i * 3 + k] * dt;
        _o.position.set(st.dPos[i * 3], st.dPos[i * 3 + 1], st.dPos[i * 3 + 2]);
        _o.rotation.set(st.dRot[i * 3], st.dRot[i * 3 + 1], st.dRot[i * 3 + 2]);
        _o.scale.setScalar(st.dScale[i]);
        _o.updateMatrix();
        im.setMatrixAt(i, _o.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <Particles ref={fire} count={500} gravity={3} drag={2.2} blending={THREE.AdditiveBlending} life={1} />
      <Particles ref={smoke} count={400} gravity={1.5} drag={0.8} life={3} opacity={0.75} />
      <sprite ref={flash} material={flashMat} visible={false} renderOrder={10} />
      <mesh ref={ring} material={ringMat} visible={false}>
        <ringGeometry args={[0.8, 1, 48]} />
      </mesh>
      <instancedMesh ref={debris} args={[undefined, undefined, DEBRIS]} castShadow visible={false} frustumCulled={false}>
        <boxGeometry args={[1.2, 0.18, 0.7]} />
        <meshStandardMaterial color="#3a3c40" roughness={0.7} metalness={0.4} />
      </instancedMesh>
    </>
  );
});

export default Explosion;
