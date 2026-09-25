import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { makeSuitMaterial } from "./suitMaterial";

/**
 * Skinned hero: Quaternius "Superhero_Male" (CC0) with clips from the
 * Universal Animation Library 1+2 (CC0), baked into /models/spiderman.glb
 * (meshopt-compressed, ~0.5 MB). The suit is procedural (suitMaterial.ts).
 *
 * Hierarchy:
 *   root   — placed at the centre of mass, carries the world orientation
 *    └ flip — flip / somersault pivot (rotates about the body's side axis)
 *       └ model — glTF scene, offset so the feet are PELVIS_HEIGHT below root
 * The model faces +Z, character's left = +X, ~1.81 m tall.
 */

export const HERO_URL = "/models/spiderman.glb";
/** centre of mass above the feet (rotation pivot) */
export const PELVIS_HEIGHT = 1.0;

export const BONES = [
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "Head",
  "clavicle_l",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "middle_01_l",
  "clavicle_r",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "middle_01_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "ball_l",
  "thigh_r",
  "calf_r",
  "foot_r",
  "ball_r",
] as const;
export type BoneName = (typeof BONES)[number];

export interface HeroRig {
  root: THREE.Group;
  flip: THREE.Group;
  model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  clips: THREE.AnimationClip[];
  dispose: () => void;
}

let loader: GLTFLoader | null = null;
function getLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

/** Bind-pose position of every vertex in model space → `aRest` (drives the suit pattern). */
function bakeRestPositions(mesh: THREE.SkinnedMesh, modelRoot: THREE.Object3D) {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const out = new Float32Array(pos.count * 3);
  // NB: bones are still at their glTF rest TRS here. Don't use skeleton.pose():
  // the quantised mesh has its dequantisation baked into the inverse bind
  // matrices, and pose() would bake it into the bones.
  modelRoot.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert().multiply(mesh.matrixWorld);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(toModel);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  g.setAttribute("aRest", new THREE.BufferAttribute(out, 3));
}

export async function loadHero(url = HERO_URL): Promise<HeroRig> {
  const gltf = await getLoader().loadAsync(url);
  const model = gltf.scene;
  let mesh: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error("hero: no skinned mesh");
  const sk = mesh as THREE.SkinnedMesh;

  bakeRestPositions(sk, model);
  const oldMat = sk.material as THREE.MeshStandardMaterial;
  const normalMap = oldMat.normalMap ?? null;
  if (normalMap) normalMap.anisotropy = 4;
  const mat = makeSuitMaterial(normalMap);
  oldMat.dispose();
  sk.material = mat;
  sk.castShadow = true;
  sk.receiveShadow = true;
  // flips / swings move the mesh far from its bind-pose bounds; it's one mesh, just draw it
  sk.frustumCulled = false;

  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const b = model.getObjectByName(n) as THREE.Bone | undefined;
    if (!b) throw new Error(`hero: missing bone ${n}`);
    bones[n] = b;
  }

  const root = new THREE.Group();
  root.name = "hero";
  const flip = new THREE.Group();
  root.add(flip);
  model.position.y = -PELVIS_HEIGHT;
  flip.add(model);

  const dispose = () => {
    sk.geometry.dispose();
    mat.dispose();
    normalMap?.dispose();
    sk.skeleton.dispose();
  };

  return { root, flip, model, mesh: sk, bones, clips: gltf.animations, dispose };
}
