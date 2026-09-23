// Procedural car geometry.
//
// Every body is built from side profiles (u = along the car, +u = nose,
// y = up) that are extruded across the width with a rounded bevel and then
// deformed (plan-view taper at the ends, tumblehome on the greenhouse, hood /
// roof crown). Windows, lights, grilles and door seams are thin "decals"
// generated in the same pre-deform space and pushed through the same
// deformation, so they sit exactly on the curved surfaces.
//
// Output is a set of geometries keyed by material slot, so a car can be drawn
// as a handful of meshes (hero car) or as instanced meshes (traffic).
//
// Conventions: car faces +Z, x = right, ground at y = 0.

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CarType = "sport" | "sedan" | "hatch" | "suv" | "van" | "bus" | "truck";
export const TRAFFIC_TYPES: CarType[] = ["sedan", "hatch", "suv", "van", "bus", "truck"];

export type Slot = "paint" | "glass" | "trim" | "chrome" | "rubber" | "rim" | "head" | "tail" | "amber" | "panel";
export const SLOTS: Slot[] = ["paint", "panel", "glass", "trim", "chrome", "rubber", "rim", "head", "tail", "amber"];

/** rounded polyline point: [u, y, cornerRadius] */
type RP = [number, number, number];

interface Part {
  slot: Slot;
  outline: RP[];
  /** true: `outline` goes rear-bottom → over the top → front-bottom and the
   *  bottom edge (with wheel arches) is generated. false: closed polygon. */
  arches?: boolean;
  width: number;
  bevel: number;
  taper: number;
  tumble: number;
  crown: number;
  /** tumble / crown ramp between these heights */
  y0: number;
  y1: number;
  /** vertical offset of the whole part */
}

interface Strip {
  part: number;
  slot: Slot;
  edge: "top" | "front" | "rear";
  a: number;
  b: number;
  /** across range in pre-deform x; mirrored to both sides when `pair` */
  x0: number;
  x1: number;
  pair?: boolean;
  off?: number;
}

interface SideDecal {
  part: number;
  slot: Slot;
  /** explicit polygon (u, y) or auto daylight opening of the part */
  poly: [number, number][] | "dlo";
  off?: number;
}

export interface CarSpec {
  type: CarType;
  L: number;
  W: number;
  R: number;
  tireW: number;
  axles: number[];
  track: number;
  ground: number;
  archR: number;
  parts: Part[];
  strips: Strip[];
  sides: SideDecal[];
  /** auto DLO settings */
  belt: number;
  pillar: number;
  bPillar: number[];
  /** mirrors: [u, y] on the cabin, or null */
  mirror: [number, number] | null;
  /** chassis box inside the body: [yBottom, yTop] */
  chassis: [number, number];
  /** extra boxes: [slot, x, y, z, w, h, d] (mirrored in x when x != 0) */
  boxes?: [Slot, number, number, number, number, number, number][];
  exhaust?: [number, number][];
}

/* ------------------------------------------------------------------ specs */

const SPECS: Record<CarType, CarSpec> = {
  sport: {
    type: "sport",
    L: 4.5,
    W: 1.94,
    R: 0.345,
    tireW: 0.27,
    axles: [1.36, -1.3],
    track: 0.82,
    ground: 0.13,
    archR: 0.415,
    belt: 0.84,
    pillar: 0.075,
    bPillar: [],
    mirror: [0.72, 0.9],
    chassis: [0.1, 0.62],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-2.14, 0.13, 0],
          [-2.24, 0.34, 0.08],
          [-2.26, 0.7, 0.1],
          [-2.22, 0.93, 0.08],
          [-2.02, 0.99, 0.2],
          [-1.2, 0.93, 0.5],
          [0.2, 0.87, 0.6],
          [1.5, 0.76, 0.5],
          [2.1, 0.63, 0.18],
          [2.25, 0.5, 0.1],
          [2.26, 0.28, 0.08],
          [2.18, 0.13, 0],
        ],
        width: 1.94,
        bevel: 0.2,
        taper: 0.13,
        tumble: 0.05,
        crown: 0.04,
        y0: 0.45,
        y1: 0.95,
      },
      {
        slot: "paint",
        outline: [
          [1.12, 0.74, 0],
          [0.0, 1.25, 0.32],
          [-0.62, 1.275, 0.5],
          [-1.98, 0.9, 0.2],
          [-2.0, 0.74, 0],
        ],
        width: 1.58,
        bevel: 0.16,
        taper: 0.1,
        tumble: 0.17,
        crown: 0.035,
        y0: 0.84,
        y1: 1.28,
      },
    ],
    strips: [
      { part: 1, slot: "glass", edge: "top", a: 0.08, b: 1.02, x0: -0.62, x1: 0.62 },
      { part: 1, slot: "glass", edge: "top", a: -1.9, b: -0.95, x0: -0.54, x1: 0.54 },
      { part: 0, slot: "head", edge: "top", a: 1.98, b: 2.13, x0: 0.44, x1: 0.8, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.2, b: 0.42, x0: -0.62, x1: 0.62, off: 0.008 },
      { part: 0, slot: "trim", edge: "front", a: 0.2, b: 0.36, x0: 0.68, x1: 0.84, pair: true, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.8, b: 0.87, x0: -0.8, x1: 0.8, off: 0.012 },
      { part: 0, slot: "tail", edge: "rear", a: 0.7, b: 0.88, x0: 0.58, x1: 0.82, pair: true, off: 0.016 },
      { part: 0, slot: "trim", edge: "rear", a: 0.16, b: 0.38, x0: -0.7, x1: 0.7, off: 0.008 },
      { part: 0, slot: "panel", edge: "rear", a: 0.47, b: 0.6, x0: -0.26, x1: 0.26, off: 0.012 },
    ],
    sides: [
      { part: 1, slot: "glass", poly: "dlo" },
      { part: 0, slot: "trim", poly: [[0.62, 0.24], [0.63, 0.24], [0.63, 0.83], [0.62, 0.83]] },
      { part: 0, slot: "trim", poly: [[-0.78, 0.3], [-0.77, 0.3], [-0.77, 0.86], [-0.78, 0.86]] },
      { part: 0, slot: "trim", poly: [[-0.52, 0.76], [-0.34, 0.76], [-0.34, 0.785], [-0.52, 0.785]] },
      { part: 0, slot: "trim", poly: [[-0.9, 0.2], [0.9, 0.2], [0.9, 0.24], [-0.9, 0.24]] },
    ],
    exhaust: [[-0.62, 0.3], [-0.46, 0.3]],
  },
  sedan: {
    type: "sedan",
    L: 4.72,
    W: 1.84,
    R: 0.325,
    tireW: 0.22,
    axles: [1.44, -1.4],
    track: 0.79,
    ground: 0.17,
    archR: 0.39,
    belt: 0.95,
    pillar: 0.07,
    bPillar: [-0.25],
    mirror: [0.95, 1.0],
    chassis: [0.14, 0.7],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-2.3, 0.17, 0],
          [-2.36, 0.4, 0.08],
          [-2.37, 0.78, 0.08],
          [-2.3, 1.0, 0.1],
          [-1.9, 1.04, 0.25],
          [-1.3, 1.0, 0.3],
          [0.5, 0.96, 0.5],
          [1.45, 0.9, 0.4],
          [2.22, 0.78, 0.18],
          [2.35, 0.6, 0.1],
          [2.36, 0.35, 0.08],
          [2.3, 0.17, 0],
        ],
        width: 1.84,
        bevel: 0.16,
        taper: 0.1,
        tumble: 0.04,
        crown: 0.03,
        y0: 0.5,
        y1: 1.0,
      },
      {
        slot: "paint",
        outline: [
          [1.18, 0.86, 0],
          [0.22, 1.42, 0.3],
          [-0.85, 1.44, 0.45],
          [-1.72, 1.04, 0.2],
          [-1.76, 0.86, 0],
        ],
        width: 1.6,
        bevel: 0.13,
        taper: 0.08,
        tumble: 0.15,
        crown: 0.03,
        y0: 0.95,
        y1: 1.44,
      },
    ],
    strips: [
      { part: 1, slot: "glass", edge: "top", a: 0.3, b: 1.08, x0: -0.62, x1: 0.62 },
      { part: 1, slot: "glass", edge: "top", a: -1.64, b: -1.0, x0: -0.56, x1: 0.56 },
      { part: 0, slot: "head", edge: "front", a: 0.66, b: 0.76, x0: 0.44, x1: 0.78, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.42, b: 0.66, x0: -0.4, x1: 0.4, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.82, b: 0.95, x0: 0.5, x1: 0.82, pair: true, off: 0.012 },
      { part: 0, slot: "panel", edge: "rear", a: 0.55, b: 0.68, x0: -0.26, x1: 0.26, off: 0.012 },
      { part: 0, slot: "trim", edge: "rear", a: 0.2, b: 0.34, x0: -0.8, x1: 0.8, off: 0.008 },
    ],
    sides: [
      { part: 1, slot: "glass", poly: "dlo" },
      { part: 0, slot: "trim", poly: [[0.85, 0.3], [0.86, 0.3], [0.86, 0.94], [0.85, 0.94]] },
      { part: 0, slot: "trim", poly: [[-0.26, 0.3], [-0.25, 0.3], [-0.25, 0.95], [-0.26, 0.95]] },
      { part: 0, slot: "trim", poly: [[-1.28, 0.36], [-1.27, 0.36], [-1.27, 0.95], [-1.28, 0.95]] },
    ],
  },
  hatch: {
    type: "hatch",
    L: 4.1,
    W: 1.78,
    R: 0.31,
    tireW: 0.2,
    axles: [1.3, -1.25],
    track: 0.77,
    ground: 0.16,
    archR: 0.37,
    belt: 0.93,
    pillar: 0.07,
    bPillar: [-0.3],
    mirror: [0.9, 0.98],
    chassis: [0.14, 0.7],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-1.98, 0.16, 0],
          [-2.04, 0.4, 0.08],
          [-2.05, 0.85, 0.08],
          [-2.0, 1.0, 0.06],
          [-1.2, 1.0, 0.3],
          [0.6, 0.95, 0.4],
          [1.4, 0.88, 0.3],
          [1.98, 0.74, 0.16],
          [2.04, 0.55, 0.1],
          [2.05, 0.33, 0.08],
          [1.98, 0.16, 0],
        ],
        width: 1.78,
        bevel: 0.16,
        taper: 0.1,
        tumble: 0.04,
        crown: 0.03,
        y0: 0.5,
        y1: 1.0,
      },
      {
        slot: "paint",
        outline: [
          [1.12, 0.86, 0],
          [0.18, 1.48, 0.3],
          [-1.72, 1.47, 0.3],
          [-1.98, 1.02, 0.1],
          [-1.98, 0.86, 0],
        ],
        width: 1.58,
        bevel: 0.13,
        taper: 0.07,
        tumble: 0.13,
        crown: 0.03,
        y0: 0.93,
        y1: 1.48,
      },
    ],
    strips: [
      { part: 1, slot: "glass", edge: "top", a: 0.26, b: 1.02, x0: -0.6, x1: 0.6 },
      { part: 1, slot: "glass", edge: "rear", a: 1.08, b: 1.38, x0: -0.54, x1: 0.54 },
      { part: 0, slot: "head", edge: "front", a: 0.6, b: 0.72, x0: 0.42, x1: 0.74, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.3, b: 0.56, x0: -0.5, x1: 0.5, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.72, b: 0.97, x0: 0.62, x1: 0.8, pair: true, off: 0.012 },
      { part: 0, slot: "panel", edge: "rear", a: 0.55, b: 0.68, x0: -0.26, x1: 0.26, off: 0.012 },
      { part: 0, slot: "trim", edge: "rear", a: 0.2, b: 0.34, x0: -0.78, x1: 0.78, off: 0.008 },
    ],
    sides: [
      { part: 1, slot: "glass", poly: "dlo" },
      { part: 0, slot: "trim", poly: [[0.8, 0.3], [0.81, 0.3], [0.81, 0.92], [0.8, 0.92]] },
      { part: 0, slot: "trim", poly: [[-0.31, 0.3], [-0.3, 0.3], [-0.3, 0.93], [-0.31, 0.93]] },
    ],
  },
  suv: {
    type: "suv",
    L: 4.75,
    W: 1.92,
    R: 0.38,
    tireW: 0.25,
    axles: [1.45, -1.4],
    track: 0.82,
    ground: 0.26,
    archR: 0.46,
    belt: 1.1,
    pillar: 0.08,
    bPillar: [-0.2, -1.3],
    mirror: [1.05, 1.15],
    chassis: [0.2, 0.9],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-2.3, 0.26, 0],
          [-2.37, 0.5, 0.08],
          [-2.38, 1.0, 0.1],
          [-2.32, 1.14, 0.08],
          [-1.0, 1.13, 0.3],
          [0.8, 1.1, 0.4],
          [1.6, 1.06, 0.3],
          [2.28, 0.94, 0.16],
          [2.37, 0.7, 0.1],
          [2.37, 0.42, 0.08],
          [2.3, 0.26, 0],
        ],
        width: 1.92,
        bevel: 0.16,
        taper: 0.08,
        tumble: 0.03,
        crown: 0.03,
        y0: 0.6,
        y1: 1.12,
      },
      {
        slot: "paint",
        outline: [
          [1.32, 1.02, 0],
          [0.42, 1.72, 0.3],
          [-2.18, 1.76, 0.25],
          [-2.34, 1.18, 0.08],
          [-2.34, 1.02, 0],
        ],
        width: 1.74,
        bevel: 0.13,
        taper: 0.06,
        tumble: 0.09,
        crown: 0.03,
        y0: 1.1,
        y1: 1.76,
      },
    ],
    strips: [
      { part: 1, slot: "glass", edge: "top", a: 0.5, b: 1.22, x0: -0.66, x1: 0.66 },
      { part: 1, slot: "glass", edge: "rear", a: 1.24, b: 1.64, x0: -0.6, x1: 0.6 },
      { part: 0, slot: "head", edge: "front", a: 0.82, b: 0.93, x0: 0.44, x1: 0.8, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.46, b: 0.8, x0: -0.46, x1: 0.46, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.92, b: 1.1, x0: 0.62, x1: 0.84, pair: true, off: 0.012 },
      { part: 0, slot: "panel", edge: "rear", a: 0.62, b: 0.75, x0: -0.26, x1: 0.26, off: 0.012 },
      { part: 0, slot: "trim", edge: "rear", a: 0.28, b: 0.5, x0: -0.86, x1: 0.86, off: 0.008 },
    ],
    sides: [
      { part: 1, slot: "glass", poly: "dlo" },
      { part: 0, slot: "trim", poly: [[-1.8, 0.28], [1.9, 0.28], [1.9, 0.42], [-1.8, 0.42]] },
      { part: 0, slot: "trim", poly: [[0.95, 0.44], [0.96, 0.44], [0.96, 1.1], [0.95, 1.1]] },
      { part: 0, slot: "trim", poly: [[-0.21, 0.44], [-0.2, 0.44], [-0.2, 1.1], [-0.21, 1.1]] },
    ],
  },
  van: {
    type: "van",
    L: 5.3,
    W: 2.0,
    R: 0.36,
    tireW: 0.23,
    axles: [1.8, -1.65],
    track: 0.86,
    ground: 0.22,
    archR: 0.44,
    belt: 1.2,
    pillar: 0.08,
    bPillar: [],
    mirror: null,
    chassis: [0.2, 0.9],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-2.6, 0.22, 0],
          [-2.65, 0.5, 0.08],
          [-2.65, 2.25, 0.14],
          [-2.5, 2.38, 0.14],
          [0.9, 2.38, 0.4],
          [1.8, 1.45, 0.45],
          [2.55, 1.08, 0.2],
          [2.65, 0.72, 0.1],
          [2.65, 0.42, 0.08],
          [2.6, 0.22, 0],
        ],
        width: 2.0,
        bevel: 0.16,
        taper: 0.07,
        tumble: 0.05,
        crown: 0.04,
        y0: 0.9,
        y1: 2.38,
      },
    ],
    strips: [
      { part: 0, slot: "glass", edge: "top", a: 0.98, b: 1.72, x0: -0.76, x1: 0.76 },
      { part: 0, slot: "glass", edge: "rear", a: 1.35, b: 2.05, x0: -0.8, x1: -0.06 },
      { part: 0, slot: "glass", edge: "rear", a: 1.35, b: 2.05, x0: 0.06, x1: 0.8 },
      { part: 0, slot: "head", edge: "front", a: 0.84, b: 0.98, x0: 0.5, x1: 0.84, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.3, b: 0.8, x0: -0.45, x1: 0.45, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.7, b: 1.2, x0: 0.78, x1: 0.9, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "rear", a: 0.26, b: 0.45, x0: -0.9, x1: 0.9, off: 0.008 },
    ],
    sides: [
      { part: 0, slot: "glass", poly: [[0.95, 1.25], [1.62, 1.25], [1.0, 2.1], [0.95, 2.1]] },
      { part: 0, slot: "glass", poly: [[-0.4, 1.3], [0.75, 1.3], [0.75, 2.05], [-0.4, 2.05]] },
      { part: 0, slot: "glass", poly: [[-2.35, 1.3], [-0.6, 1.3], [-0.6, 2.05], [-2.35, 2.05]] },
      { part: 0, slot: "trim", poly: [[0.86, 0.35], [0.87, 0.35], [0.87, 2.2], [0.86, 2.2]] },
      { part: 0, slot: "trim", poly: [[-2.0, 0.45], [0.8, 0.45], [0.8, 0.6], [-2.0, 0.6]] },
    ],
  },
  bus: {
    type: "bus",
    L: 12,
    W: 2.55,
    R: 0.5,
    tireW: 0.3,
    axles: [3.4, -2.7],
    track: 1.0,
    ground: 0.32,
    archR: 0.6,
    belt: 1.4,
    pillar: 0.1,
    bPillar: [],
    mirror: null,
    chassis: [0.3, 1.2],
    parts: [
      {
        slot: "paint",
        arches: true,
        outline: [
          [-5.96, 0.32, 0],
          [-6.02, 0.6, 0.1],
          [-6.02, 3.0, 0.15],
          [-5.8, 3.16, 0.2],
          [5.6, 3.16, 0.3],
          [6.0, 2.9, 0.25],
          [6.03, 0.6, 0.1],
          [5.98, 0.32, 0],
        ],
        width: 2.55,
        bevel: 0.18,
        taper: 0.02,
        tumble: 0.02,
        crown: 0.05,
        y0: 1.0,
        y1: 3.16,
      },
    ],
    strips: [
      { part: 0, slot: "glass", edge: "front", a: 1.15, b: 2.72, x0: -1.08, x1: 1.08, off: 0.01 },
      { part: 0, slot: "amber", edge: "front", a: 2.8, b: 3.0, x0: -0.8, x1: 0.8, off: 0.012 },
      { part: 0, slot: "glass", edge: "rear", a: 2.0, b: 2.85, x0: -0.9, x1: 0.9, off: 0.01 },
      { part: 0, slot: "head", edge: "front", a: 0.58, b: 0.74, x0: 0.62, x1: 1.02, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.35, b: 0.55, x0: -1.1, x1: 1.1, off: 0.008 },
      { part: 0, slot: "tail", edge: "rear", a: 0.6, b: 1.2, x0: 0.9, x1: 1.1, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "rear", a: 0.35, b: 0.55, x0: -1.1, x1: 1.1, off: 0.008 },
    ],
    sides: [
      { part: 0, slot: "glass", poly: [[-5.7, 1.45], [5.6, 1.45], [5.6, 2.8], [-5.7, 2.8]] },
      { part: 0, slot: "trim", poly: [[-5.7, 0.5], [5.6, 0.5], [5.6, 0.62], [-5.7, 0.62]] },
    ],
  },
  truck: {
    type: "truck",
    L: 8.6,
    W: 2.5,
    R: 0.5,
    tireW: 0.3,
    axles: [2.9, -2.4],
    track: 0.98,
    ground: 0.36,
    archR: 0.6,
    belt: 1.5,
    pillar: 0.1,
    bPillar: [],
    mirror: null,
    chassis: [0.35, 1.2],
    parts: [
      {
        // cab
        slot: "paint",
        arches: true,
        outline: [
          [1.95, 0.36, 0],
          [1.95, 2.95, 0],
          [2.2, 3.05, 0.1],
          [3.9, 3.05, 0.3],
          [4.25, 2.6, 0.2],
          [4.3, 0.7, 0.1],
          [4.25, 0.36, 0],
        ],
        width: 2.45,
        bevel: 0.16,
        taper: 0.05,
        tumble: 0.03,
        crown: 0.04,
        y0: 1.2,
        y1: 3.05,
      },
      {
        // cargo box
        slot: "panel",
        outline: [
          [-4.3, 1.1, 0],
          [1.85, 1.1, 0],
          [1.85, 3.85, 0.06],
          [-4.3, 3.85, 0.06],
        ],
        width: 2.5,
        bevel: 0.06,
        taper: 0,
        tumble: 0,
        crown: 0.0,
        y0: 1,
        y1: 4,
      },
    ],
    strips: [
      { part: 0, slot: "glass", edge: "front", a: 1.7, b: 2.6, x0: -1.02, x1: 1.02, off: 0.01 },
      { part: 0, slot: "head", edge: "front", a: 0.75, b: 0.92, x0: 0.62, x1: 1.0, pair: true, off: 0.012 },
      { part: 0, slot: "trim", edge: "front", a: 0.95, b: 1.55, x0: -0.8, x1: 0.8, off: 0.008 },
      { part: 0, slot: "trim", edge: "front", a: 0.38, b: 0.66, x0: -1.1, x1: 1.1, off: 0.008 },
      { part: 1, slot: "tail", edge: "rear", a: 1.15, b: 1.45, x0: 0.85, x1: 1.12, pair: true, off: 0.012 },
      { part: 1, slot: "amber", edge: "rear", a: 3.72, b: 3.8, x0: 0.9, x1: 1.12, pair: true, off: 0.012 },
      { part: 1, slot: "trim", edge: "rear", a: 1.5, b: 3.7, x0: -0.02, x1: 0.02, off: 0.008 },
    ],
    sides: [
      { part: 0, slot: "glass", poly: [[3.0, 1.75], [3.95, 1.75], [3.95, 2.62], [3.0, 2.62]] },
      { part: 1, slot: "trim", poly: [[-4.2, 1.14], [1.75, 1.14], [1.75, 1.22], [-4.2, 1.22]] },
    ],
    boxes: [["trim", 0, 0.75, -1.2, 1.9, 0.6, 6.2]],
  },
};

export function getSpec(type: CarType): CarSpec {
  return SPECS[type];
}

/* ------------------------------------------------------------------ 2D helpers */

type V2 = THREE.Vector2;

function roundedTo(path: THREE.Path, pts: RP[], from: number) {
  for (let i = from; i < pts.length; i++) {
    const [u, y, r] = pts[i];
    const prev = pts[i - 1];
    const next = pts[i + 1];
    if (!prev || !next || r <= 0) {
      path.lineTo(u, y);
      continue;
    }
    const p1 = new THREE.Vector2(u, y);
    const d0 = new THREE.Vector2(prev[0], prev[1]).sub(p1);
    const d2 = new THREE.Vector2(next[0], next[1]).sub(p1);
    const r0 = Math.min(r, d0.length() * 0.48);
    const r2 = Math.min(r, d2.length() * 0.48);
    const a = p1.clone().addScaledVector(d0.normalize(), r0);
    const b = p1.clone().addScaledVector(d2.normalize(), r2);
    path.lineTo(a.x, a.y);
    path.quadraticCurveTo(p1.x, p1.y, b.x, b.y);
  }
}

function buildShape(spec: CarSpec, part: Part): THREE.Shape {
  const s = new THREE.Shape();
  const o = part.outline;
  s.moveTo(o[0][0], o[0][1]);
  roundedTo(s, o, 1);
  if (part.arches) {
    const g = spec.ground;
    const R = spec.R;
    const ar = spec.archR;
    const h = R - g;
    const alpha = Math.asin(Math.min(0.99, h / ar));
    const dx = Math.sqrt(Math.max(0, ar * ar - h * h));
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of o) {
      lo = Math.min(lo, q[0]);
      hi = Math.max(hi, q[0]);
    }
    const axles = spec.axles.filter((a) => a - dx > lo && a + dx < hi).sort((a, b) => b - a);
    for (const a of axles) {
      s.lineTo(a + dx, g);
      s.absarc(a, R, ar, -alpha, Math.PI + alpha, false);
    }
  }
  s.closePath();
  return s;
}

function polyOf(shape: THREE.Shape, div = 16): V2[] {
  const pts = shape.extractPoints(div).shape.slice();
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  return pts;
}

/** Max y of the polygon boundary at u (upper envelope). */
function topAt(poly: V2[], u: number): number {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const lo = Math.min(p.x, q.x);
    const hi = Math.max(p.x, q.x);
    if (u < lo || u > hi || hi - lo < 1e-9) continue;
    const t = (u - p.x) / (q.x - p.x);
    best = Math.max(best, p.y + (q.y - p.y) * t);
  }
  return best;
}

/** Max (front) or min (rear) u of the polygon boundary at height y. */
function sideAt(poly: V2[], y: number, front: boolean): number {
  let best = front ? -Infinity : Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const lo = Math.min(p.y, q.y);
    const hi = Math.max(p.y, q.y);
    if (y < lo || y > hi || hi - lo < 1e-9) continue;
    const t = (y - p.y) / (q.y - p.y);
    const u = p.x + (q.x - p.x) * t;
    best = front ? Math.max(best, u) : Math.min(best, u);
  }
  return best;
}

function clipPoly(poly: V2[], inside: (p: V2) => number): V2[] {
  // Sutherland–Hodgman against a single half-plane f(p) >= 0 (f linear)
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = inside(a);
    const fb = inside(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return out;
}

function insetPoly(poly: V2[], d: number): V2[] {
  const ccw = !THREE.ShapeUtils.isClockWise(poly);
  const n = poly.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const e0 = p1.clone().sub(p0).normalize();
    const e1 = p2.clone().sub(p1).normalize();
    // inward normal of CCW polygon = left normal (-y, x)
    const n0 = new THREE.Vector2(-e0.y, e0.x);
    const n1 = new THREE.Vector2(-e1.y, e1.x);
    const nm = n0.add(n1);
    if (nm.lengthSq() < 1e-8) nm.set(-e1.y, e1.x);
    nm.normalize();
    const cos = Math.max(0.35, nm.dot(new THREE.Vector2(-e1.y, e1.x)));
    out.push(p1.clone().addScaledVector(nm, ((ccw ? 1 : -1) * d) / cos));
  }
  return out;
}

/* ------------------------------------------------------------------ deformation */

interface PartCtx {
  part: Part;
  shape: THREE.Shape;
  poly: V2[];
  uMin: number;
  uMax: number;
  yMin: number;
  yMax: number;
}

function deformVertex(ctx: PartCtx, v: THREE.Vector3) {
  const p = ctx.part;
  const hw = p.width / 2;
  const uc = (ctx.uMin + ctx.uMax) / 2;
  const hl = (ctx.uMax - ctx.uMin) / 2;
  const xn = Math.min(1, Math.abs(v.x) / hw);
  const zt = Math.abs(v.z - uc) / hl;
  const t = THREE.MathUtils.clamp((zt - 0.68) / 0.32, 0, 1);
  let sx = 1 - p.taper * t * t;
  const ty = THREE.MathUtils.clamp((v.y - p.y0) / (p.y1 - p.y0), 0, 1);
  sx *= 1 - p.tumble * ty;
  v.y += p.crown * (1 - xn * xn) * ty;
  v.x *= sx;
}

/** Analytic normal of the (deformed) flat side of a part at (y, z). */
function capNormal(ctx: PartCtx, side: number, y: number, z: number, out: THREE.Vector3) {
  const p = ctx.part;
  const hw = p.width / 2;
  const uc = (ctx.uMin + ctx.uMax) / 2;
  const hl = (ctx.uMax - ctx.uMin) / 2;
  const zt = Math.abs(z - uc) / hl;
  const t = THREE.MathUtils.clamp((zt - 0.68) / 0.32, 0, 1);
  const sxp = 1 - p.taper * t * t;
  const ty = THREE.MathUtils.clamp((y - p.y0) / (p.y1 - p.y0), 0, 1);
  const inY = y > p.y0 && y < p.y1 ? 1 : 0;
  const fy = hw * sxp * (-p.tumble / (p.y1 - p.y0)) * inY;
  const dt = t > 0 && t < 1 ? 1 / 0.32 / hl : 0;
  const fz = hw * (1 - p.tumble * ty) * (-p.taper * 2 * t * dt) * Math.sign(z - uc);
  out.set(side, -fy, -fz).normalize();
}

function deformGeometry(ctx: PartCtx, g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    deformVertex(ctx, v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
}

/** Ensure faces point along `dir` on average; flips winding otherwise. */
function orient(g: THREE.BufferGeometry, dir: THREE.Vector3) {
  g.computeVertexNormals();
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  let s = 0;
  for (let i = 0; i < n.count; i++) s += n.getX(i) * dir.x + n.getY(i) * dir.y + n.getZ(i) * dir.z;
  if (s < 0) {
    flipWinding(g);
    g.computeVertexNormals();
  }
}

function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const idx = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      const s = a.itemSize;
      for (let i = 0; i < a.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k];
          arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
          arr[(i + 2) * s + k] = t;
        }
      }
      a.needsUpdate = true;
    }
  }
}

/** Mirror a geometry in x (keeps faces front-facing). */
export function mirrorX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.scale(-1, 1, 1);
  flipWinding(g);
  return g;
}

/** Strip only position / normal / uv so everything merges. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") out.deleteAttribute(name);
  }
  if (!out.getAttribute("uv")) {
    out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.getAttribute("position").count * 2), 2));
  }
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  return out;
}

/* ------------------------------------------------------------------ builders */

function extrudePart(ctx: PartCtx, detail: number): THREE.BufferGeometry {
  const p = ctx.part;
  const bt = p.bevel;
  const bs = Math.min(0.05, bt * 0.35);
  const depth = Math.max(0.01, p.width - bt * 2);
  const g = new THREE.ExtrudeGeometry(ctx.shape, {
    depth,
    bevelEnabled: bt > 0,
    bevelThickness: bt,
    bevelSize: bs,
    bevelSegments: detail > 0.5 ? 5 : 3,
    curveSegments: detail > 0.5 ? 12 : 6,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  // (u, y, across) -> (x = -across, y, z = u)
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const y = pos.getY(i);
    const w = pos.getZ(i);
    pos.setXYZ(i, -w, y, u);
  }
  g.deleteAttribute("normal");
  deformGeometry(ctx, g);
  const out = toCreasedNormals(g, 0.62);
  // the flat sides are a few huge triangles: give them analytic normals so
  // the tumblehome / plan taper shade smoothly instead of showing facets
  const caps = out.groups.find((gr) => gr.materialIndex === 0);
  if (caps) {
    const pos = out.getAttribute("position") as THREE.BufferAttribute;
    const nor = out.getAttribute("normal") as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = caps.start; i < caps.start + caps.count; i++) {
      capNormal(ctx, Math.sign(pos.getX(i)) || 1, pos.getY(i), pos.getZ(i), n);
      nor.setXYZ(i, n.x, n.y, n.z);
    }
  }
  return out;
}

function stripGeometry(ctx: PartCtx, s: Strip, xSign: number, detail: number): THREE.BufferGeometry {
  const bs = Math.min(0.05, ctx.part.bevel * 0.35);
  const off = bs + (s.off ?? 0.008);
  const NA = detail > 0.5 ? 10 : 4;
  const NX = detail > 0.5 ? 8 : 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const eps = 0.01;
  const sample = (t: number) => {
    // returns [u, y, nu, ny]
    if (s.edge === "top") {
      const u = THREE.MathUtils.clamp(t, ctx.uMin + 0.003, ctx.uMax - 0.003);
      const y = topAt(ctx.poly, u);
      const ua = Math.max(ctx.uMin + 0.001, u - eps);
      const ub = Math.min(ctx.uMax - 0.001, u + eps);
      let dy = (topAt(ctx.poly, ub) - topAt(ctx.poly, ua)) / (ub - ua);
      if (!Number.isFinite(dy)) dy = 0;
      const n = new THREE.Vector2(-dy, 1).normalize();
      return [u, y, n.x, n.y];
    }
    const front = s.edge === "front";
    const y = THREE.MathUtils.clamp(t, ctx.yMin + 0.003, ctx.yMax - 0.003);
    const u = sideAt(ctx.poly, y, front);
    const ya = Math.max(ctx.yMin + 0.001, y - eps);
    const yb = Math.min(ctx.yMax - 0.001, y + eps);
    let du = (sideAt(ctx.poly, yb, front) - sideAt(ctx.poly, ya, front)) / (yb - ya);
    if (!Number.isFinite(du)) du = 0;
    const n = front ? new THREE.Vector2(1, -du).normalize() : new THREE.Vector2(-1, du).normalize();
    return [u, y, n.x, n.y];
  };
  const x0 = xSign > 0 ? s.x0 : -s.x1;
  const x1 = xSign > 0 ? s.x1 : -s.x0;
  for (let i = 0; i <= NA; i++) {
    const t = s.a + ((s.b - s.a) * i) / NA;
    const [u, y, nu, ny] = sample(t);
    for (let j = 0; j <= NX; j++) {
      const x = x0 + ((x1 - x0) * j) / NX;
      pos.push(x, y + ny * off, u + nu * off);
      uv.push(j / NX, i / NA);
    }
  }
  for (let i = 0; i < NA; i++)
    for (let j = 0; j < NX; j++) {
      const a = i * (NX + 1) + j;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  deformGeometry(ctx, g);
  const mid = sample((s.a + s.b) / 2);
  orient(g, new THREE.Vector3(0, mid[3], mid[2]));
  return g;
}

function sideDecalGeometries(spec: CarSpec, ctx: PartCtx, d: SideDecal): THREE.BufferGeometry[] {
  let polys: V2[][];
  if (d.poly === "dlo") {
    let p = insetPoly(ctx.poly, spec.pillar);
    const belt = spec.belt + 0.03;
    p = clipPoly(p, (q) => q.y - belt);
    polys = [p];
    for (const bu of spec.bPillar) {
      const next: V2[][] = [];
      for (const pp of polys) {
        const f = clipPoly(pp, (q) => q.x - (bu + spec.pillar * 0.8));
        const r = clipPoly(pp, (q) => bu - spec.pillar * 0.8 - q.x);
        if (f.length > 2) next.push(f);
        if (r.length > 2) next.push(r);
      }
      polys = next;
    }
  } else {
    polys = [d.poly.map(([u, y]) => new THREE.Vector2(u, y))];
  }
  const out: THREE.BufferGeometry[] = [];
  const hw = ctx.part.width / 2 + (d.off ?? 0.006);
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const shape = new THREE.Shape(poly);
    for (const side of [1, -1]) {
      const g = new THREE.ShapeGeometry(shape, 4);
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        const y = pos.getY(i);
        pos.setXYZ(i, side * hw, y, u);
      }
      deformGeometry(ctx, g);
      orient(g, new THREE.Vector3(side, 0, 0));
      const nor = g.getAttribute("normal") as THREE.BufferAttribute;
      const n = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        capNormal(ctx, side, pos.getY(i), pos.getZ(i), n);
        nor.setXYZ(i, n.x, n.y, n.z);
      }
      out.push(g);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ wheels */

export interface WheelGeoms {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  barrel: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
}

const wheelCache = new Map<string, WheelGeoms>();

/** Wheel geometries, axis = X, outer face towards +x, centered at origin. */
export function wheelGeometries(R: number, w: number, detail: number, spokes = 10): WheelGeoms {
  const key = `${R}-${w}-${detail}-${spokes}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  const seg = detail > 0.5 ? 40 : 12;
  const ri = R * 0.69;
  const hw = w / 2;
  // tire profile (radius, axial) around the Y axis
  const prof = [
    [ri - 0.005, -hw + 0.03],
    [ri + 0.01, -hw + 0.002],
    [R - 0.1, -hw - 0.006],
    [R - 0.045, -hw + 0.004],
    [R - 0.012, -hw + 0.025],
    [R, -hw + 0.06],
    [R + 0.002, 0],
    [R, hw - 0.06],
    [R - 0.012, hw - 0.025],
    [R - 0.045, hw - 0.004],
    [R - 0.1, hw + 0.006],
    [ri + 0.01, hw - 0.002],
    [ri - 0.005, hw - 0.03],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const tire = new THREE.LatheGeometry(prof, seg);
  tire.rotateZ(-Math.PI / 2);
  // lathe winds inward for this profile direction; make it face outwards
  tire.computeVertexNormals();
  {
    const p = tire.getAttribute("position") as THREE.BufferAttribute;
    const n = tire.getAttribute("normal") as THREE.BufferAttribute;
    // check a tread vertex: normal should point away from axis
    const i = 6;
    const ry = p.getY(i);
    const rz = p.getZ(i);
    if (n.getY(i) * ry + n.getZ(i) * rz < 0) {
      flipWinding(tire);
      tire.computeVertexNormals();
    }
  }

  // rim face: disc with spoke windows, extruded, dished towards the hub
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, ri, 0, Math.PI * 2, false);
  const rOut = ri - 0.028;
  const rIn = R * 0.25;
  const half = 0.019;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2;
    const a1 = ((k + 1) / spokes) * Math.PI * 2;
    const dO = half / rOut;
    const dI = half / rIn;
    if (a1 - a0 - 2 * dI < 0.02) continue;
    const h = new THREE.Path();
    const n = detail > 0.5 ? 6 : 2;
    for (let i = 0; i <= n; i++) {
      const a = a0 + dO + ((a1 - a0 - 2 * dO) * i) / n;
      const x = Math.cos(a) * rOut;
      const y = Math.sin(a) * rOut;
      if (i === 0) h.moveTo(x, y);
      else h.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + dI + ((a1 - a0 - 2 * dI) * i) / n;
      h.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    h.closePath();
    rimShape.holes.push(h);
  }
  if (detail <= 0.5) {
    // distant / traffic cars: plain dished wheel cover, no spoke windows
    const cover = new THREE.CylinderGeometry(ri, ri * 0.97, 0.03, seg);
    cover.rotateZ(-Math.PI / 2);
    cover.translate(hw - 0.05, 0, 0);
    const hub0 = new THREE.CylinderGeometry(R * 0.12, R * 0.14, 0.03, 8);
    hub0.rotateZ(-Math.PI / 2);
    hub0.translate(hw - 0.03, 0, 0);
    rimShape.holes.length = 0;
    const barrel0 = new THREE.CylinderGeometry(ri - 0.004, ri - 0.004, w * 0.86, seg, 1, true);
    barrel0.rotateZ(-Math.PI / 2);
    const disc0 = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.028, seg);
    disc0.rotateZ(-Math.PI / 2);
    disc0.translate(hw - 0.14, 0, 0);
    const cal0 = new THREE.BoxGeometry(0.06, R * 0.28, R * 0.42);
    const out0 = { tire, rim: mergeGeometries([clean(cover), clean(hub0)])!, barrel: barrel0, disc: disc0, caliper: cal0 };
    wheelCache.set(key, out0);
    return out0;
  }
  let rim: THREE.BufferGeometry = new THREE.ExtrudeGeometry(rimShape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: detail > 0.5 ? 28 : 12,
  });
  rim.rotateY(Math.PI / 2); // face +x
  {
    const p = rim.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getY(i), p.getZ(i));
      p.setX(i, p.getX(i) + hw - 0.07 - (1 - r / ri) * 0.045);
    }
    rim.computeVertexNormals();
  }
  const hub = new THREE.CylinderGeometry(R * 0.12, R * 0.14, 0.03, seg / 2);
  hub.rotateZ(-Math.PI / 2);
  hub.translate(hw - 0.105, 0, 0);
  rim = mergeGeometries([clean(rim), clean(hub)])!;

  const barrel = new THREE.CylinderGeometry(ri - 0.004, ri - 0.004, w * 0.86, seg, 1, true);
  barrel.rotateZ(-Math.PI / 2);
  const disc = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.028, seg);
  disc.rotateZ(-Math.PI / 2);
  disc.translate(hw - 0.14, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, R * 0.28, R * 0.42);
  caliper.translate(hw - 0.14 + 0.03, R * 0.5, -R * 0.1);
  caliper.rotateX(0.5);

  const out = { tire, rim, barrel, disc, caliper };
  wheelCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ assembly */

export interface CarGeometry {
  spec: CarSpec;
  /** body parts per slot (wheels excluded) */
  body: Partial<Record<Slot, THREE.BufferGeometry>>;
  /** same + wheels merged (for instanced / static cars) */
  full: Partial<Record<Slot, THREE.BufferGeometry>>;
  wheels: { x: number; y: number; z: number; front: boolean }[];
  headLights: THREE.Vector3[];
  tailLights: THREE.Vector3[];
  /** half extents for collision */
  half: { x: number; z: number };
  height: number;
}

const carCache = new Map<string, CarGeometry>();

export function buildCar(type: CarType, detail = 1): CarGeometry {
  const key = `${type}-${detail}`;
  const hit = carCache.get(key);
  if (hit) return hit;
  const spec = SPECS[type];
  const buckets: Partial<Record<Slot, THREE.BufferGeometry[]>> = {};
  const add = (slot: Slot, g: THREE.BufferGeometry) => {
    (buckets[slot] ??= []).push(clean(g));
  };

  const ctxs: PartCtx[] = spec.parts.map((part) => {
    const shape = buildShape(spec, part);
    const poly = polyOf(shape, 24);
    let uMin = Infinity;
    let uMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of poly) {
      uMin = Math.min(uMin, p.x);
      uMax = Math.max(uMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
    return { part, shape, poly, uMin, uMax, yMin, yMax };
  });
  let height = 0;
  for (const c of ctxs) {
    add(c.part.slot, extrudePart(c, detail));
    for (const p of c.poly) height = Math.max(height, p.y);
  }

  const headLights: THREE.Vector3[] = [];
  const tailLights: THREE.Vector3[] = [];
  for (const s of spec.strips) {
    const sides = s.pair ? [1, -1] : [1];
    for (const sx of sides) {
      const g = stripGeometry(ctxs[s.part], s, sx, detail);
      add(s.slot, g);
      if (s.slot === "head" || s.slot === "tail") {
        g.computeBoundingBox();
        const c = g.boundingBox!.getCenter(new THREE.Vector3());
        if (!s.pair && Math.abs(s.x1 - s.x0) > 1) {
          // full-width bar: two flare points at its ends
          const b = g.boundingBox!;
          (s.slot === "head" ? headLights : tailLights).push(
            new THREE.Vector3(b.min.x + 0.12, c.y, c.z),
            new THREE.Vector3(b.max.x - 0.12, c.y, c.z)
          );
        } else (s.slot === "head" ? headLights : tailLights).push(c);
      }
    }
  }
  for (const d of spec.sides) {
    for (const g of sideDecalGeometries(spec, ctxs[d.part], d)) add(d.slot, g);
  }

  // chassis / floor pan and wheel wells
  const innerX = spec.track - spec.tireW / 2 - 0.04;
  const chL = spec.L - 0.5;
  const chassis = new THREE.BoxGeometry(innerX * 2, spec.chassis[1] - spec.chassis[0], chL);
  chassis.translate(0, (spec.chassis[0] + spec.chassis[1]) / 2, 0);
  add("trim", chassis);
  for (const a of spec.axles) {
    for (const sx of [1, -1]) {
      const wl = spec.W / 2 - 0.03 - innerX;
      const well = new THREE.CylinderGeometry(spec.archR - 0.01, spec.archR - 0.01, wl, 16, 1, true, 0, Math.PI);
      // upper half cylinder (the well above the tyre), axis along x
      well.rotateZ(Math.PI / 2);
      const g = well;
      g.translate(sx * (innerX + wl / 2), spec.R, a);
      add("trim", g);
    }
  }
  if (spec.boxes) {
    for (const [slot, x, y, z, w, h, d] of spec.boxes) {
      for (const sx of x !== 0 ? [1, -1] : [1]) {
        const b = new THREE.BoxGeometry(w, h, d);
        b.translate(sx * x, y, z);
        add(slot, b);
      }
    }
  }
  // exhausts
  if (spec.exhaust) {
    const rearU = sideAt(ctxs[0].poly, 0.3, false);
    for (const [x, y] of spec.exhaust) {
      for (const sx of [1, -1]) {
        const e = new THREE.CylinderGeometry(0.055, 0.05, 0.22, 14, 1, true);
        e.rotateX(Math.PI / 2);
        e.translate(sx * -x, y, rearU + 0.02);
        add("chrome", e);
        const inner = new THREE.CircleGeometry(0.05, 14);
        inner.rotateY(Math.PI);
        inner.translate(sx * -x, y, rearU + 0.08);
        add("trim", inner);
      }
    }
  }
  // mirrors
  if (spec.mirror) {
    const [mu, my] = spec.mirror;
    const cab = ctxs[1] ?? ctxs[0];
    const v = new THREE.Vector3(cab.part.width / 2, my, mu);
    deformVertex(cab, v);
    for (const sx of [1, -1]) {
      const housing = new THREE.SphereGeometry(1, detail > 0.5 ? 16 : 8, detail > 0.5 ? 10 : 6);
      housing.scale(0.13, 0.075, 0.07);
      housing.translate(sx * (v.x + 0.17), v.y + 0.04, v.z - 0.05);
      add("paint", housing);
      const glassM = new THREE.CircleGeometry(1, 12);
      glassM.scale(0.11, 0.06, 1);
      glassM.rotateY(Math.PI);
      glassM.translate(sx * (v.x + 0.17), v.y + 0.04, v.z - 0.121);
      add("chrome", glassM);
      const stalk = new THREE.BoxGeometry(0.14, 0.03, 0.05);
      stalk.translate(sx * (v.x + 0.06), v.y + 0.0, v.z - 0.04);
      add("trim", stalk);
    }
  }

  const body: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  for (const slot of SLOTS) {
    const list = buckets[slot];
    if (list && list.length) body[slot] = mergeGeometries(list)!;
  }

  // wheels merged for the "full" variant
  const wg = wheelGeometries(spec.R, spec.tireW, detail, type === "sport" ? 10 : type === "bus" || type === "truck" ? 8 : 6);
  const wheels: CarGeometry["wheels"] = [];
  const fullBuckets: Partial<Record<Slot, THREE.BufferGeometry[]>> = {};
  for (const slot of SLOTS) if (body[slot]) fullBuckets[slot] = [body[slot]!];
  const push = (slot: Slot, g: THREE.BufferGeometry) => (fullBuckets[slot] ??= []).push(clean(g));
  spec.axles.forEach((a, ai) => {
    for (const sx of [1, -1]) {
      wheels.push({ x: sx * spec.track, y: spec.R, z: a, front: ai === 0 });
      const place = (g: THREE.BufferGeometry) => {
        const m = sx > 0 ? g.clone() : mirrorX(g);
        m.translate(sx * spec.track, spec.R, a);
        return m;
      };
      push("rubber", place(wg.tire));
      push("rim", place(wg.rim));
      push("trim", place(wg.barrel));
      push("trim", place(wg.disc));
    }
  });
  const full: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  for (const slot of SLOTS) {
    const list = fullBuckets[slot];
    if (list && list.length) full[slot] = list.length === 1 ? list[0] : mergeGeometries(list)!;
  }

  const out: CarGeometry = {
    spec,
    body,
    full,
    wheels,
    headLights,
    tailLights,
    half: { x: spec.W / 2, z: spec.L / 2 },
    height,
  };
  carCache.set(key, out);
  return out;
}
