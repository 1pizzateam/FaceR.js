import { CustomMesh } from '@1pizzateam/roostr';
import { Box, Trigo, Utils, Vec2, Vec3 } from '@1pizzateam/spock';
import type { HaircutStyleName, IFacePivots, ISubmeshRange, SubmeshRegionName } from '../interfaces';

export const HAIR_CAP_SEG_U = 20;
export const HAIR_CAP_ROWS_V = 10;
export const HAIR_CAP_VERTEX_COUNT = 2 * (HAIR_CAP_ROWS_V + 1) * (HAIR_CAP_SEG_U + 1);

/** Eye pivot (absolute x, y, z) used for rigs built from an imported .obj. */
const IMPORTED_EYE_PIVOT_ABS = [1.9538, 1.8642, 4.0475] as const;

const CRANIAL_CENTER_X = 0.0;
const CRANIAL_CENTER_Y = 3.0;
const CRANIAL_CENTER_Z = -0.8;

export interface IBaseHeadGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Int32Array;
  submeshes: ISubmeshRange[];
  vertexRegionMap: Uint8Array;
  jawWeights: Float32Array;
  pivots: IFacePivots;
  eyeballPlacement?: {
    offset: Vec3;
    scale: number;
  };
  eyeHolePlacement?: {
    offset: Vec3;
    scale: Vec2;
  };
  teethPlacement?: {
    offset: Vec3;
    scale: number;
    gap: number;
  };
  vertexCount: number;
  triangleCount: number;
}

export type IBaseHeadTopology = IBaseHeadGeometry;

const REGION_ID: Record<SubmeshRegionName, number> = {
  skin: 0,
  eyeLeft: 1,
  eyeRight: 2,
  teethUpper: 3,
  teethLower: 4,
  mouthInner: 5,
  browsHair: 6,
};

const scratchPos = new Vec3();
const scratchNorm = new Vec3();

/**
 * 21-column anatomical hairline azimuth & elevation tables (`iu = 0..20`) around `C = (0, 3.0, -0.8)`:
 * - `iu = 0..3`: Horizontal frontal hairline wrapping to the fronto-temporal recess (`z ≈ +5.40..+3.29, y ≈ +5.92..+6.06`)
 * - `iu = 4`: Vertical fronto-temporal drop to the temporal peak (`z ≈ +3.19, y ≈ +4.54`)
 * - `iu = 5..6`: Concave temple arch sweeping back to the upper sideburn root (`z ≈ +1.96..+1.06, y ≈ +3.63..+2.70`)
 * - `iu = 7..8`: Vertical pre-auricular sideburn tab right in front of the ear tragus (`z ≈ +0.96..+0.30, y ≈ +0.95..+1.00`)
 * - `iu = 9..13`: Tight supra-auricular ear root cutout arch (`z ≈ +0.03..-1.92, y ≈ +2.02..+2.36`)
 * - `iu = 14..16`: Post-auricular mastoid drop immediately behind the ear helix (`z ≈ -2.26..-2.90, y ≈ +1.18..-0.77`)
 * - `iu = 17..20`: Occipital nape hairline (`y ≈ -0.92..-0.65`)
 */
const HAIRLINE_AZ0: readonly number[] = [
  0.00, 0.22, 0.46, 0.71, 0.77,
  1.01, 1.19,
  1.22, 1.35, 1.40,
  1.51, 1.61, 1.71, 1.80,
  1.88, 1.98, 2.12,
  2.34, 2.59, 2.86, Trigo.pi,
];

const HAIRLINE_AZ_SMOOTH: readonly number[] = [
  0.00, 0.22, 0.46, 0.73, 0.90,
  1.08, 1.25,
  1.33, 1.39, 1.46,
  1.54, 1.63, 1.72, 1.81,
  1.91, 2.02, 2.16,
  2.36, 2.60, 2.86, Trigo.pi,
];

const HAIRLINE_PHI0: readonly number[] = [
  0.44, 0.46, 0.49, 0.49, 0.27,
  0.12, -0.06,
  -0.38, -0.38, -0.17,
  -0.14, -0.13, -0.14, -0.20,
  -0.38, -0.60, -0.71,
  -0.74, -0.74, -0.72, -0.70,
];

const HAIRLINE_PHI_SMOOTH: readonly number[] = [
  0.44, 0.46, 0.50, 0.50, 0.36,
  0.22, 0.10,
  -0.02, -0.08, -0.11,
  -0.12, -0.11, -0.12, -0.15,
  -0.28, -0.44, -0.58,
  -0.68, -0.72, -0.71, -0.70,
];

/**
 * Measure the lateral skull wall width (`|x|`) immediately above the ear root on the given `side` (`-1` or `+1`)
 * so outer ear pinna protrusion can be separated from the temporal/mastoid skull wall across narrow and wide heads.
 */
function computeEarWallLimitX(
  skinPositions: ArrayLike<number>,
  skinVertCount: number,
  side: number
): number {
  let maxSkullX = 0.0;
  for (let i = 0; i < skinVertCount; i++) {
    const x = skinPositions[i * 3] * side;
    const y = skinPositions[i * 3 + 1];
    const z = skinPositions[i * 3 + 2];
    if (x > 0.0 && y >= 2.72 && y <= 3.45 && z >= -1.95 && z <= 0.45) {
      if (x > maxSkullX) maxSkullX = x;
    }
  }
  if (maxSkullX < 3.0) maxSkullX = 4.78;
  return maxSkullX + 0.14;
}

/**
 * Raycast outward from `C = (0, 3.0, -0.8)` along unit direction `(dx, dy, dz)` against
 * `skinPositions` / `skinIndices` to find the exact skull surface distance `t`.
 * Clamps any hit on the protruding outer ear helix (`|x| > earWallLimitX` around the ear) back to the
 * inner retroauricular skull wall so the hair cap wraps cleanly around the ear root.
 */
function raycastSkullDistance(
  dx: number,
  dy: number,
  dz: number,
  skinPositions: ArrayLike<number>,
  skinIndices: ArrayLike<number>,
  earWallLimitX: number
): number {
  let bestT = -1.0;
  let minEarT = Infinity;
  const eps = 1e-6;
  const triLen = skinIndices.length;

  for (let i = 0; i < triLen; i += 3) {
    const a = skinIndices[i] * 3;
    const b = skinIndices[i + 1] * 3;
    const c = skinIndices[i + 2] * 3;

    const ax = skinPositions[a];
    const ay = skinPositions[a + 1];
    const az = skinPositions[a + 2];

    const e1x = skinPositions[b] - ax;
    const e1y = skinPositions[b + 1] - ay;
    const e1z = skinPositions[b + 2] - az;

    const e2x = skinPositions[c] - ax;
    const e2y = skinPositions[c + 1] - ay;
    const e2z = skinPositions[c + 2] - az;

    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;

    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < eps) continue;
    const invDet = 1.0 / det;

    const sx = CRANIAL_CENTER_X - ax;
    const sy = CRANIAL_CENTER_Y - ay;
    const sz = CRANIAL_CENTER_Z - az;

    const u = (sx * hx + sy * hy + sz * hz) * invDet;
    if (u < -1e-4 || u > 1.0001) continue;

    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;

    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < -1e-4 || u + v > 1.0002) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t > 2.5) {
      if (t > bestT) bestT = t;
      if (t < minEarT) minEarT = t;
    }
  }

  if (bestT > 2.5) {
    const hitX = CRANIAL_CENTER_X + dx * bestT;
    const hitY = CRANIAL_CENTER_Y + dy * bestT;
    const hitZ = CRANIAL_CENTER_Z + dz * bestT;
    if (Math.abs(hitX) > earWallLimitX && hitY < 2.65 && hitZ > -2.40 && hitZ < 1.15) {
      const innerT = minEarT < bestT ? minEarT : bestT;
      bestT = Math.min(innerT, earWallLimitX / Math.max(0.2, Math.abs(dx)));
    }
    return bestT;
  }
  return 1.0 / Math.hypot(dx / 4.85, dy / 6.35, dz / 6.10);
}

/**
 * Compute the unit cranial ray direction `(dx, dy, dz)` from `C = (0, 3.0, -0.8)` for
 * scalp column `iu in [0, HAIR_CAP_SEG_U]` and row parameter `v in [0, 1]` (`v = 0` at the
 * anatomical ear-wrapping hairline, `v = 1` at the sagittal midline `x = 0`).
 */
function computeScalpRayDirection(
  side: number,
  iu: number,
  v: number,
  outDir: Vec3
): Vec3 {
  const u = iu / HAIR_CAP_SEG_U;
  const azMid = Utils.lerp(HAIRLINE_AZ0[iu], HAIRLINE_AZ_SMOOTH[iu], Utils.smoothstep(0.0, 0.10, v));
  const az = Utils.lerp(azMid, u * Trigo.pi, Utils.smoothstep(0.15, 0.80, v));

  const contourFade = Utils.smoothstep(0.0, 0.14, v);
  const phi0 = Utils.lerp(HAIRLINE_PHI0[iu], HAIRLINE_PHI_SMOOTH[iu], contourFade);

  const dx0 = side * Math.cos(phi0) * Math.sin(az);
  const dy0 = Math.sin(phi0);
  const dz0 = Math.cos(phi0) * Math.cos(az);

  const phiFront = HAIRLINE_PHI0[0];
  const phiBack = HAIRLINE_PHI0[HAIR_CAP_SEG_U];
  const uSag = az / Trigo.pi;
  const thetaSag = Utils.lerp(phiFront, Trigo.pi - phiBack, uSag);
  const dx1 = 0.0;
  const dy1 = Math.sin(thetaSag);
  const dz1 = Math.cos(thetaSag);

  // Use sine easing on v so cross-sections arch spherically over the parietal eminence
  const archV = Math.sin(v * Trigo.pi * 0.5);
  const dx = Utils.lerp(dx0, dx1, v);
  const dy = Utils.lerp(dy0, dy1, archV);
  const dz = Utils.lerp(dz0, dz1, v);
  return outDir.setScalar(dx, dy, dz).normalize();
}

/**
 * Append a bilateral 3D cranial hair cap (`HAIR_CAP_VERTEX_COUNT = 462` vertices, `800` triangles)
 * raycasted directly onto `skinPositions` / `skinIndices` so any haircut style can be shaped
 * in-place without changing vertex/index counts.
 */
function appendHairCapVertices(
  skinPositions: ArrayLike<number>,
  skinIndices: ArrayLike<number>,
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[]
): void {
  const segU = HAIR_CAP_SEG_U;
  const rowsV = HAIR_CAP_ROWS_V;
  const stride = segU + 1;
  const rayDir = new Vec3();
  const skinVertCount = (skinPositions.length / 3) | 0;
  const gridCount = (rowsV + 1) * stride;
  const sideGrids = new Map<number, Float32Array>();
  let maxFrontR = 0.0;
  let maxBackR = 0.0;

  for (const side of [-1, 1]) {
    const earWallLimitX = computeEarWallLimitX(skinPositions, skinVertCount, side);
    const skullDistGrid = new Float32Array(gridCount);
    const rayX = new Float32Array(gridCount);
    const rayY = new Float32Array(gridCount);
    const rayZ = new Float32Array(gridCount);

    for (let row = 0; row <= rowsV; row++) {
      const v = row / rowsV;
      for (let iu = 0; iu <= segU; iu++) {
        const gIdx = row * stride + iu;
        computeScalpRayDirection(side, iu, v, rayDir);
        rayX[gIdx] = rayDir.x;
        rayY[gIdx] = rayDir.y;
        rayZ[gIdx] = rayDir.z;
        skullDistGrid[gIdx] = raycastSkullDistance(
          rayDir.x,
          rayDir.y,
          rayDir.z,
          skinPositions,
          skinIndices,
          earWallLimitX
        );
      }
    }

    // Enforce a strict outer-envelope clearance over all cranial skin vertices, edge midpoints,
    // and triangle centroids so flat hair-cap triangles never dip beneath curved skull triangles.
    const isOuterEarPinna = (x: number, y: number, z: number): boolean =>
      x * side > earWallLimitX && y < 2.65 && z > -2.40 && z < 1.15;

    const sampleDirsAndR: number[] = [];
    const pushSkinSample = (x: number, y: number, z: number): void => {
      if (x * side < -0.01 || y < -1.2 || isOuterEarPinna(x, y, z)) return;
      const rx = x - CRANIAL_CENTER_X;
      const ry = y - CRANIAL_CENTER_Y;
      const rz = z - CRANIAL_CENTER_Z;
      const r = Math.hypot(rx, ry, rz);
      if (r > 1.5 && r < 9.5) {
        sampleDirsAndR.push(rx / r, ry / r, rz / r, r);
      }
    };

    for (let vi = 0; vi < skinVertCount; vi++) {
      const i3 = vi * 3;
      pushSkinSample(skinPositions[i3], skinPositions[i3 + 1], skinPositions[i3 + 2]);
    }
    for (let ti = 0; ti < skinIndices.length; ti += 3) {
      const a = skinIndices[ti] * 3;
      const b = skinIndices[ti + 1] * 3;
      const c = skinIndices[ti + 2] * 3;
      const ax = skinPositions[a], ay = skinPositions[a + 1], az = skinPositions[a + 2];
      const bx = skinPositions[b], by = skinPositions[b + 1], bz = skinPositions[b + 2];
      const cx = skinPositions[c], cy = skinPositions[c + 1], cz = skinPositions[c + 2];
      if (isOuterEarPinna(ax, ay, az) || isOuterEarPinna(bx, by, bz) || isOuterEarPinna(cx, cy, cz)) {
        continue;
      }
      for (const t of [0.25, 0.5, 0.75]) {
        pushSkinSample(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
        pushSkinSample(bx + (cx - bx) * t, by + (cy - by) * t, bz + (cz - bz) * t);
        pushSkinSample(cx + (ax - cx) * t, cy + (ay - cy) * t, cz + (az - cz) * t);
      }
      pushSkinSample((ax + bx + cx) / 3.0, (ay + by + cy) / 3.0, (az + bz + cz) / 3.0);
    }

    const envelopeClearance = 0.042;
    for (let pass = 0; pass < 6; pass++) {
      for (let s = 0; s < sampleDirsAndR.length; s += 4) {
        const dx = sampleDirsAndR[s];
        const dy = sampleDirsAndR[s + 1];
        const dz = sampleDirsAndR[s + 2];
        const rSkin = sampleDirsAndR[s + 3];

        let matched = false;
        for (let row = 0; row < rowsV && !matched; row++) {
          for (let iu = 0; iu < segU; iu++) {
            const a = row * stride + iu;
            if (dx * rayX[a] + dy * rayY[a] + dz * rayZ[a] < 0.82) continue;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;

            for (let triHalf = 0; triHalf < 2; triHalf++) {
              const ia = triHalf === 0 ? a : b;
              const ib = triHalf === 0 ? b : d;
              const ic = c;

              const ax = rayX[ia] * skullDistGrid[ia];
              const ay = rayY[ia] * skullDistGrid[ia];
              const az = rayZ[ia] * skullDistGrid[ia];

              const e1x = rayX[ib] * skullDistGrid[ib] - ax;
              const e1y = rayY[ib] * skullDistGrid[ib] - ay;
              const e1z = rayZ[ib] * skullDistGrid[ib] - az;

              const e2x = rayX[ic] * skullDistGrid[ic] - ax;
              const e2y = rayY[ic] * skullDistGrid[ic] - ay;
              const e2z = rayZ[ic] * skullDistGrid[ic] - az;

              const hx = dy * e2z - dz * e2y;
              const hy = dz * e2x - dx * e2z;
              const hz = dx * e2y - dy * e2x;

              const det = e1x * hx + e1y * hy + e1z * hz;
              if (Math.abs(det) < 1e-6) continue;
              const inv = 1.0 / det;

              const u = (-ax * hx - ay * hy - az * hz) * inv;
              if (u < -1e-4 || u > 1.0001) continue;

              const qx = -ay * e1z + az * e1y;
              const qy = -az * e1x + ax * e1z;
              const qz = -ax * e1y + ay * e1x;

              const v = (dx * qx + dy * qy + dz * qz) * inv;
              if (v < -1e-4 || u + v > 1.0002) continue;

              const tHair = (e2x * qx + e2y * qy + e2z * qz) * inv;
              if (tHair <= 1.5) continue;

              const needed = rSkin + envelopeClearance - tHair;
              if (needed > 0) {
                const wA = Math.max(0.0, 1.0 - u - v);
                const wB = Math.max(0.0, u);
                const wC = Math.max(0.0, v);
                const norm = Math.max(1e-4, wA * wA + wB * wB + wC * wC);
                skullDistGrid[ia] += needed * (wA / norm);
                skullDistGrid[ib] += needed * (wB / norm);
                skullDistGrid[ic] += needed * (wC / norm);
              }
              matched = true;
              break;
            }
            if (matched) break;
          }
        }
      }
    }

    for (let row = 0; row <= rowsV; row++) {
      maxFrontR = Math.max(maxFrontR, skullDistGrid[row * stride]);
      maxBackR = Math.max(maxBackR, skullDistGrid[row * stride + segU]);
    }
    sideGrids.set(side, skullDistGrid);
  }

  // Keep the sagittal midline (row = rowsV) and front/back poles (iu = 0, segU) welded across both hemispheres
  const gridNeg = sideGrids.get(-1)!;
  const gridPos = sideGrids.get(1)!;
  for (let iu = 0; iu <= segU; iu++) {
    const midIdx = rowsV * stride + iu;
    const m = Math.max(gridNeg[midIdx], gridPos[midIdx]);
    gridNeg[midIdx] = m;
    gridPos[midIdx] = m;
  }
  for (let row = 0; row <= rowsV; row++) {
    gridNeg[row * stride] = maxFrontR;
    gridPos[row * stride] = maxFrontR;
    gridNeg[row * stride + segU] = maxBackR;
    gridPos[row * stride + segU] = maxBackR;
  }

  for (const side of [-1, 1]) {
    const skullDistGrid = sideGrids.get(side)!;
    const baseV = (positions.length / 3) | 0;
    for (let row = 0; row <= rowsV; row++) {
      const v = row / rowsV;
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        computeScalpRayDirection(side, iu, v, rayDir);
        const r = skullDistGrid[row * stride + iu];

        const px = iu === 0 || iu === segU || row === rowsV ? 0.0 : CRANIAL_CENTER_X + rayDir.x * r;
        const py = CRANIAL_CENTER_Y + rayDir.y * r;
        const pz = CRANIAL_CENTER_Z + rayDir.z * r;

        positions.push(px, py, pz);
        uvs.push(0.85 + u * 0.13, 0.86 + v * 0.12);
        vertexRegionMap.push(REGION_ID.browsHair);
        jawWeights.push(0);
      }
    }

    for (let row = 0; row < rowsV; row++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = baseV + row * stride + iu;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        if (side > 0) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }
  }
}

/** A hair style asset (see `deserializeHairStyle`): the cap's vertex displacement plus the hair-region atlas shade map. */
export interface IHairStyle {
  id: string;
  /** Per cap vertex (x, y, z) displacement from the unstyled hair cap: `HAIR_CAP_VERTEX_COUNT * 3` floats. */
  capDelta: Float32Array;
  /** Square shade maps over the atlas hair region: `shade` scales the hair colour, `skinMix` blends toward skin (both 0..255). */
  atlas: { size: number; shade: Uint8Array; skinMix: Uint8Array };
}

const _registeredHairStyles = new Map<string, IHairStyle>();

/** Register a hair style (decoded with `deserializeHairStyle`). FaceR ships none: the app loads them at runtime. `'bald'` needs no asset. */
export function registerHairStyle(style: IHairStyle): void {
  _registeredHairStyles.set(style.id, style);
}

export function hasHairStyle(id: string): boolean {
  return id === 'bald' || _registeredHairStyles.has(id);
}

export function getHairStyle(id: string): IHairStyle | undefined {
  return _registeredHairStyles.get(id);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode a `.facerhair.json` asset. */
export function deserializeHairStyle(data: unknown): IHairStyle {
  const o = data as Record<string, any>;
  if (!o || o.format !== 'facer-hair' || typeof o.id !== 'string' || !Array.isArray(o.capDelta) || !o.atlas) {
    throw new Error('deserializeHairStyle: not a facer-hair asset.');
  }
  if (o.capDelta.length !== HAIR_CAP_VERTEX_COUNT * 3) {
    throw new Error(`deserializeHairStyle: expected ${HAIR_CAP_VERTEX_COUNT * 3} cap values, got ${o.capDelta.length}.`);
  }
  const size = o.atlas.size | 0;
  const shade = decodeBase64(String(o.atlas.shade));
  const skinMix = decodeBase64(String(o.atlas.skinMix));
  if (size < 2 || shade.length !== size * size || skinMix.length !== size * size) {
    throw new Error('deserializeHairStyle: inconsistent atlas maps.');
  }
  return { id: o.id, capDelta: new Float32Array(o.capDelta), atlas: { size, shade, skinMix } };
}

/** Fetch `<id>.facerhair.json` from `urlOrBase` (a full asset URL or a folder URL), decode and register it. */
export async function loadHairStyle(id: string, urlOrBase: string): Promise<IHairStyle> {
  const existing = _registeredHairStyles.get(id);
  if (existing) return existing;
  const url = urlOrBase.endsWith('.json') ? urlOrBase : `${urlOrBase.replace(/\/+$/, '')}/${id}.facerhair.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FaceR: could not load hair style "${id}" from ${url} (HTTP ${res.status}).`);
  const style = deserializeHairStyle(await res.json());
  _registeredHairStyles.set(id, style);
  return style;
}

/**
 * Shape the 3D cranial hair cap vertices in-place inside `positions` (starting from their skull-conforming
 * coordinates after `applyMacroProportions`) for the given `hairStyle`: `'bald'` tucks the cap inside the skull, any
 * other style adds its registered `capDelta`.
 */
export function applyHaircutStyleToPositions(
  positions: Float32Array,
  submeshes: ISubmeshRange[],
  hairStyle: HaircutStyleName = 'bald'
): void {
  const smBrows = submeshes.find(sm => sm.name === 'browsHair');
  if (!smBrows || smBrows.vertexCount < HAIR_CAP_VERTEX_COUNT) {
    return;
  }
  const hairStartVertex = smBrows.startVertex + smBrows.vertexCount - HAIR_CAP_VERTEX_COUNT;

  if (hairStyle === 'bald') {
    for (let i = 0; i < HAIR_CAP_VERTEX_COUNT; i++) {
      const idx = (hairStartVertex + i) * 3;
      positions[idx] = CRANIAL_CENTER_X + (positions[idx] - CRANIAL_CENTER_X) * 0.72;
      positions[idx + 1] = CRANIAL_CENTER_Y + (positions[idx + 1] - CRANIAL_CENTER_Y) * 0.72;
      positions[idx + 2] = CRANIAL_CENTER_Z + (positions[idx + 2] - CRANIAL_CENTER_Z) * 0.72;
    }
    return;
  }

  const style = _registeredHairStyles.get(hairStyle);
  if (!style) {
    throw new Error(
      `FaceR: hair style "${hairStyle}" is not registered. Load its .facerhair.json file and call ` +
      `registerHairStyle(deserializeHairStyle(json)) (or loadHairStyle) first.`
    );
  }
  const base = hairStartVertex * 3;
  for (let i = 0; i < HAIR_CAP_VERTEX_COUNT * 3; i++) {
    positions[base + i] += style.capDelta[i];
  }
}

/**
 * Parse a Wavefront `.obj` 3D head mesh text into an `IBaseHeadGeometry`, automatically
 * normalizing its bounding box into `FaceR.js`'s anatomical coordinate frame, generating
 * atlas UVs and jaw weights, and computing smooth vertex normals.
 */
function finiteOr0(token: string): number {
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}

export function parseObjToTopology(objText: string): IBaseHeadGeometry {
  const rawVerts: number[] = [];
  const rawTris: number[] = [];

  let faceCount = 0;
  const lines = objText.split(/\r?\n/);
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l].trim();
    if (!line || line.charCodeAt(0) === 35) continue;
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        rawVerts.push(finiteOr0(parts[1]), finiteOr0(parts[2]), finiteOr0(parts[3]));
      }
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/);
      const vCount = (rawVerts.length / 3) | 0;
      const poly: number[] = [];
      for (let k = 1; k < parts.length; k++) {
        const tok = parts[k].split('/')[0];
        const idx = parseInt(tok, 10);
        if (!isNaN(idx)) {
          poly.push(idx < 0 ? vCount + idx : idx - 1);
        }
      }
      for (let i = 1; i + 1 < poly.length; i++) {
        rawTris.push(poly[0], poly[i], poly[i + 1]);
      }
      faceCount++;
    }
  }

  const vCount = (rawVerts.length / 3) | 0;

  // Drop triangles that reference missing vertices or collapse onto fewer than three distinct vertices.
  const validTris: number[] = [];
  for (let t = 0; t + 2 < rawTris.length; t += 3) {
    const a = rawTris[t], b = rawTris[t + 1], c = rawTris[t + 2];
    if (a < 0 || b < 0 || c < 0 || a >= vCount || b >= vCount || c >= vCount) continue;
    if (a === b || b === c || a === c) continue;
    validTris.push(a, b, c);
  }
  rawTris.length = 0;
  for (let t = 0; t < validTris.length; t++) rawTris.push(validTris[t]);

  if (vCount < 3 || rawTris.length < 3) {
    throw new Error(
      `parseObjToTopology: OBJ has no usable geometry (${vCount} vertices, ${rawTris.length / 3} valid triangles from ${faceCount} faces).`
    );
  }

  const bounds = new Box().setFromPoints(rawVerts, 3);
  const minX = bounds.min.x, maxX = bounds.max.x;
  const minY = bounds.min.y, maxY = bounds.max.y;
  const maxZ = bounds.max.z;

  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);
  const cx = 0.5 * (minX + maxX);
  const aspectYX = spanY / spanX;

  // Distinguish full head+neck meshes (aspectYX >= 1.45) from face-mask / bust meshes
  const scale = aspectYX >= 1.45 ? 20.5 / spanY : 12.2 / spanX;
  const targetMaxY = aspectYX >= 1.45 ? 9.4 : 6.8;
  const targetMaxZ = 7.09;

  const positions: number[] = [];
  const uvs: number[] = [];
  const jawWeights: number[] = [];
  const vertexRegionMap: number[] = [];

  for (let i = 0; i < vCount; i++) {
    const idx = i * 3;
    const x = (rawVerts[idx] - cx) * scale;
    const y = (rawVerts[idx + 1] - maxY) * scale + targetMaxY;
    const z = (rawVerts[idx + 2] - maxZ) * scale + targetMaxZ;

    positions.push(x, y, z);

    const uGrid = Math.atan2(x, z - -0.8) / Trigo.pi;
    const sv = Utils.clamp((y + 11.0) / 21.5, 0.0, 1.0);
    uvs.push(
      Utils.clamp(0.5 + uGrid * 0.48, 0.01, 0.99),
      Utils.clamp(0.74 - sv * 0.72, 0.02, 0.74)
    );

    vertexRegionMap.push(REGION_ID.skin);

    const wTop = Utils.smoothstep(-2.15, -2.55, y);
    const wBot = Utils.smoothstep(-6.2, -4.8, y);
    const wFront = Utils.smoothstep(0.0, 2.5, z);
    jawWeights.push(Utils.clamp(wTop * wBot * wFront, 0.0, 1.0));
  }

  // Split back-of-head UV seam vertices (z < -0.8) where a left-side triangle (cx < 0)
  // touches a midline vertex with u > 0.75 (or vice versa) so UVs never wrap across the face.
  const indices: number[] = [...rawTris];
  const backSeamCloneMap = new Map<string, number>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];
    const zAvg = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
    if (zAvg >= -0.8) continue;
    const xAvg = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
    const targetSide = xAvg < 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      const vi = indices[t + k];
      const uVal = uvs[vi * 2];
      if ((targetSide < 0 && uVal > 0.75) || (targetSide > 0 && uVal < 0.25)) {
        const key = `${vi}:${targetSide}`;
        let clonedIdx = backSeamCloneMap.get(key);
        if (clonedIdx === undefined) {
          clonedIdx = (positions.length / 3) | 0;
          positions.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
          uvs.push(targetSide < 0 ? 0.02 : 0.98, uvs[vi * 2 + 1]);
          vertexRegionMap.push(REGION_ID.skin);
          jawWeights.push(jawWeights[vi]);
          backSeamCloneMap.set(key, clonedIdx);
        }
        indices[t + k] = clonedIdx;
      }
    }
  }
  const skinVertexCount = (positions.length / 3) | 0;
  const skinIndexCount = indices.length;

  // Append cranial 3D hair cap raycasted onto the imported .OBJ skin surface
  const hairStartVertex = (positions.length / 3) | 0;
  const hairStartIndex = indices.length;
  appendHairCapVertices(
    positions,
    rawTris,
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights
  );

  const posArray = new Float32Array(positions);
  const uvArray = new Float32Array(uvs);
  const indArray = new Int32Array(indices);
  const normals = computeSmoothNormals(posArray, indArray);
  unfoldNostrilCavityUVs(posArray, normals, uvArray, skinVertexCount);

  const submeshes: ISubmeshRange[] = [
    { name: 'skin', startIndex: 0, indexCount: skinIndexCount, startVertex: 0, vertexCount: skinVertexCount },
    { name: 'eyeLeft', startIndex: skinIndexCount, indexCount: 0, startVertex: skinVertexCount, vertexCount: 0 },
    { name: 'eyeRight', startIndex: skinIndexCount, indexCount: 0, startVertex: skinVertexCount, vertexCount: 0 },
    { name: 'teethUpper', startIndex: skinIndexCount, indexCount: 0, startVertex: skinVertexCount, vertexCount: 0 },
    { name: 'teethLower', startIndex: skinIndexCount, indexCount: 0, startVertex: skinVertexCount, vertexCount: 0 },
    { name: 'mouthInner', startIndex: skinIndexCount, indexCount: 0, startVertex: skinVertexCount, vertexCount: 0 },
    {
      name: 'browsHair',
      startIndex: hairStartIndex,
      indexCount: indices.length - hairStartIndex,
      startVertex: hairStartVertex,
      vertexCount: (positions.length / 3 - hairStartVertex) | 0,
    },
  ];

  const pivots: IFacePivots = {
    neck: new Vec3(0, -7.8, -0.8),
    jaw: new Vec3(0, -1.25, 1.45),
    eyeLeft: new Vec3(-IMPORTED_EYE_PIVOT_ABS[0], IMPORTED_EYE_PIVOT_ABS[1], IMPORTED_EYE_PIVOT_ABS[2]),
    eyeRight: new Vec3(IMPORTED_EYE_PIVOT_ABS[0], IMPORTED_EYE_PIVOT_ABS[1], IMPORTED_EYE_PIVOT_ABS[2]),
  };

  return {
    positions: posArray,
    normals,
    uvs: uvArray,
    indices: indArray,
    submeshes,
    vertexRegionMap: new Uint8Array(vertexRegionMap),
    jawWeights: new Float32Array(jawWeights),
    pivots,
    vertexCount: (posArray.length / 3) | 0,
    triangleCount: (indArray.length / 3) | 0,
  };
}

/**
 * Unfold recessed, downward-facing 3D nostril cavity vertices (`ny < -0.60`) in UV space
 * so their UV `yHead` maps cleanly to the nostril opening (`yHead = -0.45, absU = 0.032`)
 * without overlapping the outer front tip of the nose (`z > 6.60, yHead >= -0.26`).
 */
function unfoldNostrilCavityUVs(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  skinVertexCount: number
): void {
  for (let i = 0; i < skinVertexCount; i++) {
    const pIdx = i * 3;
    const x = positions[pIdx];
    const absX = Math.abs(x);
    const y = positions[pIdx + 1];
    const z = positions[pIdx + 2];
    const ny = normals[pIdx + 1];

    if (
      absX >= 0.30 &&
      absX <= 1.20 &&
      y >= -0.60 &&
      y <= -0.14 &&
      z >= 5.75 &&
      z <= 6.58 &&
      ny < -0.58
    ) {
      const cavityW = Utils.clamp((-ny - 0.58) / 0.25, 0.0, 1.0);
      const targetYHead = -0.45;
      const targetSv = Utils.clamp((targetYHead + 11.0) / 21.5, 0.0, 1.0);
      const targetV = Utils.clamp(0.74 - targetSv * 0.72, 0.02, 0.74);
      const signX = x < 0 ? -1.0 : 1.0;
      const targetU = 0.5 + signX * 0.032;

      const uIdx = i * 2;
      uvs[uIdx] = Utils.lerp(uvs[uIdx], targetU, cavityW * 0.85);
      uvs[uIdx + 1] = Utils.lerp(uvs[uIdx + 1], targetV, cavityW);
    }
  }
}

/**
 * Compute smooth area-weighted vertex normals using RoostR's CustomMesh.computeVertexNormals()
 * and enforce X=0 symmetry seam normals.
 */
export function computeSmoothNormals(
  positions: Float32Array,
  indices: Int32Array | Uint16Array | Uint32Array
): Float32Array {
  const customMesh = new CustomMesh();
  customMesh.vertices = positions;
  customMesh.indices = indices instanceof Int32Array ? indices : new Int32Array(indices);
  const normArray = customMesh.computeVertexNormals() ?? new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 3) {
    scratchPos.setArray(positions, i);
    if (Math.abs(scratchPos.x) < 1e-3) {
      scratchNorm.setArray(normArray, i);
      scratchNorm.x = 0;
      if (scratchNorm.getMagnitude(true) < 1e-6) {
        scratchNorm.setScalar(
          0,
          scratchPos.y - CRANIAL_CENTER_Y,
          scratchPos.z - CRANIAL_CENTER_Z
        );
      }
      scratchNorm.normalize().toArray(normArray, i);
    }
  }
  return normArray;
}

const _registeredBaseHeads = new Map<string, IBaseHeadGeometry>();

/**
 * Register a base head (decoded with `deserializeBaseHead`) under an id so cartridges and
 * `FaceR.setBaseHead(id)` can use it. FaceR ships no heads: the app loads them at runtime.
 */
export function registerBaseHead(id: string, geometry: IBaseHeadGeometry): void {
  _registeredBaseHeads.set(id, geometry);
}

export function hasBaseHead(id: string): boolean {
  return _registeredBaseHeads.has(id);
}

export function getCanonicalBaseHead(baseHeadId: string): IBaseHeadGeometry {
  const head = _registeredBaseHeads.get(baseHeadId);
  if (!head) {
    throw new Error(
      `FaceR: base head "${baseHeadId}" is not registered. Load its .facerhead.json file and call ` +
      `registerBaseHead(id, deserializeBaseHead(json)) first.`
    );
  }
  return head;
}

/** Decode a `.facerhead.json` asset (see the `heads/` folder) into base head geometry. */
export function deserializeBaseHead(data: unknown): IBaseHeadGeometry {
  const o = data as Record<string, any>;
  if (!o || o.format !== 'facer-head' || !Array.isArray(o.positions) || !Array.isArray(o.indices)) {
    throw new Error('deserializeBaseHead: not a facer-head asset.');
  }
  const v3 = (a: number[]) => new Vec3(a[0], a[1], a[2]);
  const positions = new Float32Array(o.positions);
  const indices = new Int32Array(o.indices);
  const vertexCount = (positions.length / 3) | 0;
  if (o.normals.length !== positions.length || o.jawWeights.length !== vertexCount || o.vertexRegionMap.length !== vertexCount) {
    throw new Error('deserializeBaseHead: inconsistent buffer sizes.');
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] < 0 || indices[i] >= vertexCount) throw new Error('deserializeBaseHead: index out of range.');
  }
  let eyeballPlacement: { offset: Vec3; scale: number } | undefined;
  if (o.eyeballPlacement && typeof o.eyeballPlacement === 'object') {
    const off = o.eyeballPlacement.offset;
    const sc = Number(o.eyeballPlacement.scale);
    eyeballPlacement = {
      offset: Array.isArray(off) && off.length >= 3 ? v3(off) : new Vec3(0, 0, 0),
      scale: Number.isFinite(sc) && sc > 0 ? sc : 1.0,
    };
  }
  let eyeHolePlacement: { offset: Vec3; scale: Vec2 } | undefined;
  if (o.eyeHolePlacement && typeof o.eyeHolePlacement === 'object') {
    const off = o.eyeHolePlacement.offset;
    const sc = o.eyeHolePlacement.scale;
    const sx = Array.isArray(sc) ? Number(sc[0]) : Number(sc?.x ?? sc);
    const sy = Array.isArray(sc) ? Number(sc[1]) : Number(sc?.y ?? sc);
    eyeHolePlacement = {
      offset: Array.isArray(off) && off.length >= 3 ? v3(off) : new Vec3(0, 0, 0),
      scale: new Vec2(
        Number.isFinite(sx) && sx > 0 ? sx : 1.0,
        Number.isFinite(sy) && sy > 0 ? sy : 1.0
      ),
    };
  }
  let teethPlacement: { offset: Vec3; scale: number; gap: number } | undefined;
  if (o.teethPlacement && typeof o.teethPlacement === 'object') {
    const off = o.teethPlacement.offset;
    const sc = Number(o.teethPlacement.scale);
    const gap = Number(o.teethPlacement.gap);
    teethPlacement = {
      offset: Array.isArray(off) && off.length >= 3 ? v3(off) : new Vec3(0, 0, 0),
      scale: Number.isFinite(sc) && sc > 0 ? sc : 1.0,
      gap: Number.isFinite(gap) ? gap : 0.0,
    };
  }
  return {
    positions,
    normals: new Float32Array(o.normals),
    uvs: new Float32Array(o.uvs),
    indices,
    submeshes: o.submeshes.map((s: ISubmeshRange) => ({ ...s })),
    vertexRegionMap: new Uint8Array(o.vertexRegionMap),
    jawWeights: new Float32Array(o.jawWeights),
    pivots: { neck: v3(o.pivots.neck), jaw: v3(o.pivots.jaw), eyeLeft: v3(o.pivots.eyeLeft), eyeRight: v3(o.pivots.eyeRight) },
    ...(eyeballPlacement ? { eyeballPlacement } : {}),
    ...(eyeHolePlacement ? { eyeHolePlacement } : {}),
    ...(teethPlacement ? { teethPlacement } : {}),
    vertexCount,
    triangleCount: (indices.length / 3) | 0,
  };
}

/**
 * Fetch a `.facerhead.json` asset from `url`, decode it and register it as `id` (skipped if already registered).
 * `urlOrBase` is either the full asset URL or a folder URL; for a folder the file name `<id>.facerhead.json` is appended.
 */
export async function loadBaseHead(id: string, urlOrBase: string): Promise<IBaseHeadGeometry> {
  const existing = _registeredBaseHeads.get(id);
  if (existing) return existing;
  const url = urlOrBase.endsWith('.json') ? urlOrBase : `${urlOrBase.replace(/\/+$/, '')}/${id}.facerhead.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FaceR: could not load base head "${id}" from ${url} (HTTP ${res.status}).`);
  const head = deserializeBaseHead(await res.json());
  _registeredBaseHeads.set(id, head);
  return head;
}
