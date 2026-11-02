import { CustomMesh } from '@1pizzateam/roostr';
import { Trigo, Utils, Vec2, Vec3 } from '@1pizzateam/spock';
import type { BaseHeadId, HaircutStyleName, IFacePivots, ISubmeshRange, SubmeshRegionName } from '../interfaces';
import { BASE_HEAD_ARCHETYPES } from './baseHeadArchetypes';
import {
  SCULPTED_EYE_PIVOT_ABS,
  SCULPTED_SKIN_UVS,
  SCULPTED_SKIN_JAW_WEIGHTS,
  SCULPTED_SKIN_INDICES,
  SCULPTED_EYE_LEFT_POSITIONS,
  SCULPTED_EYE_LEFT_UVS,
  SCULPTED_EYE_LEFT_INDICES,
  SCULPTED_EYE_RIGHT_POSITIONS,
  SCULPTED_EYE_RIGHT_UVS,
  SCULPTED_EYE_RIGHT_INDICES,
} from './sculptedHeadData';

export { BASE_HEAD_ARCHETYPES };

export const HAIR_CAP_SEG_U = 20;
export const HAIR_CAP_ROWS_V = 10;
export const HAIR_CAP_VERTEX_COUNT = 2 * (HAIR_CAP_ROWS_V + 1) * (HAIR_CAP_SEG_U + 1);

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
 * Project a 2D point `(x, y)` onto the front-most (+Z) triangle of `skinPositions` / `skinIndices`
 * using barycentric coordinates so 3D eyebrows conform with zero gap to the ZBrush forehead mesh.
 */
function projectOntoFrontSkinZ(
  x: number,
  y: number,
  skinPositions: ArrayLike<number>,
  skinIndices: ArrayLike<number>,
  fallbackZ: number
): number {
  let bestZ = -999;
  for (let i = 0; i < skinIndices.length; i += 3) {
    const a = skinIndices[i] * 3;
    const b = skinIndices[i + 1] * 3;
    const c = skinIndices[i + 2] * 3;
    const az = skinPositions[a + 2];
    const bz = skinPositions[b + 2];
    const cz = skinPositions[c + 2];
    if (az < 2.0 && bz < 2.0 && cz < 2.0) continue;

    const ax = skinPositions[a];
    const ay = skinPositions[a + 1];
    const bx = skinPositions[b];
    const by = skinPositions[b + 1];
    const cx = skinPositions[c];
    const cy = skinPositions[c + 1];

    const v0x = cx - ax;
    const v0y = cy - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = x - ax;
    const v2y = y - ay;

    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;

    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-8) continue;
    const inv = 1.0 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    if (u >= -1e-4 && v >= -1e-4 && u + v <= 1.0002) {
      const z = az + u * (cz - az) + v * (bz - az);
      if (z > bestZ) {
        bestZ = z;
      }
    }
  }
  return bestZ > -900 ? bestZ : fallbackZ;
}

/**
 * Append a pre-sculpted eyeball submesh (`eyeLeft` or `eyeRight`).
 */
function appendSculptedEyeball(
  srcPositions: ArrayLike<number>,
  srcUvs: ArrayLike<number>,
  srcIndices: ArrayLike<number>,
  regionName: SubmeshRegionName,
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  const startVertex = (positions.length / 3) | 0;
  const startIndex = indices.length;
  const vCount = (srcPositions.length / 3) | 0;

  for (let i = 0; i < srcPositions.length; i++) {
    positions.push(srcPositions[i]);
  }
  for (let i = 0; i < srcUvs.length; i++) {
    uvs.push(srcUvs[i]);
  }
  for (let i = 0; i < vCount; i++) {
    vertexRegionMap.push(REGION_ID[regionName]);
    jawWeights.push(0);
  }
  for (let i = 0; i < srcIndices.length; i++) {
    indices.push(startVertex + srcIndices[i]);
  }

  submeshes.push({
    name: regionName,
    startIndex,
    indexCount: indices.length - startIndex,
    startVertex,
    vertexCount: vCount,
  });
}

/**
 * Append a curved dental arch submesh (Upper or Lower Teeth) positioned inside the sculpted oral cavity.
 */
function appendDentalArch(
  yBase: number,
  yHeight: number,
  jawWeight: number,
  uvBoxMin: Vec2,
  uvBoxMax: Vec2,
  regionName: SubmeshRegionName,
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  const segU = 14;
  const startVertex = (positions.length / 3) | 0;
  const startIndex = indices.length;
  const archWidth = 1.42;
  const archDepth = 1.15;
  const zFront = 5.65;

  for (let row = 0; row <= 2; row++) {
    const v = row / 2;
    const y = yBase + (row === 1 ? yHeight : 0);
    const zInset = row === 2 ? -0.24 : 0;

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const angle = (u - 0.5) * Trigo.pi * 0.82;
      const x = Trigo.sinePrecise(angle) * archWidth;
      const z = zFront - (1 - Trigo.cosinePrecise(angle)) * archDepth + zInset;

      positions.push(x, y, z);
      uvs.push(
        Utils.lerp(uvBoxMin.x, uvBoxMax.x, u),
        Utils.lerp(uvBoxMin.y, uvBoxMax.y, v)
      );
      vertexRegionMap.push(REGION_ID[regionName]);
      jawWeights.push(jawWeight);
    }
  }

  const stride = segU + 1;
  for (let row = 0; row < 2; row++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = startVertex + row * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (yHeight < 0) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  submeshes.push({
    name: regionName,
    startIndex,
    indexCount: indices.length - startIndex,
    startVertex,
    vertexCount: (positions.length / 3 - startVertex) | 0,
  });
}

/**
 * Append inner oral cavity backwall and surface-conforming 3D eyebrows projected onto `skinPositions`.
 */
function appendMouthInnerAndBrows(
  skinPositions: ArrayLike<number>,
  skinIndices: ArrayLike<number>,
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  // 1. Inner mouth cavity backplate (behind dental arches)
  const startVertexMouth = (positions.length / 3) | 0;
  const startIndexMouth = indices.length;
  const mw = 1.55;
  const myTop = -1.65;
  const myBot = -3.15;
  const mz = 4.65;

  const mouthPts = [
    new Vec3(-mw, myTop, mz),
    new Vec3(mw, myTop, mz),
    new Vec3(mw, myBot, mz),
    new Vec3(-mw, myBot, mz),
  ];
  const mouthJaws = [0.0, 0.0, 0.85, 0.85];
  for (let i = 0; i < 4; i++) {
    positions.push(mouthPts[i].x, mouthPts[i].y, mouthPts[i].z);
    uvs.push(0.55 + (i & 1) * 0.20, 0.95 + (i >> 1) * 0.04);
    vertexRegionMap.push(REGION_ID.mouthInner);
    jawWeights.push(mouthJaws[i]);
  }
  indices.push(
    startVertexMouth, startVertexMouth + 2, startVertexMouth + 1,
    startVertexMouth, startVertexMouth + 3, startVertexMouth + 2
  );
  submeshes.push({
    name: 'mouthInner',
    startIndex: startIndexMouth,
    indexCount: 6,
    startVertex: startVertexMouth,
    vertexCount: 4,
  });

  // 2. Surface-conforming 3D Eyebrow strips projected onto the ZBrush supraorbital ridge
  const startVertexBrows = (positions.length / 3) | 0;
  const startIndexBrows = indices.length;
  const segBrow = 12;
  const rowsBrow = 2;

  for (const side of [-1, 1]) {
    const baseV = (positions.length / 3) | 0;
    for (let row = 0; row <= rowsBrow; row++) {
      const rowNorm = row / rowsBrow;
      const rowOffsetY = (rowNorm - 0.5) * 0.26;
      const crestLift = row === 1 ? 0.075 : 0.012;

      for (let i = 0; i <= segBrow; i++) {
        const t = i / segBrow;
        const bx = side * Utils.lerp(0.62, 3.02, t);
        const archY = Math.sin(Math.pow(t, 0.85) * Trigo.pi) * 0.18 - 0.10 * t;
        const by = 2.76 + archY + rowOffsetY * (1.0 - t * 0.35);

        const surfaceZ = projectOntoFrontSkinZ(-Math.abs(bx), by, skinPositions, skinIndices, 5.5);
        const endTaper = Math.sin(t * Trigo.pi);
        const lift = crestLift * (0.35 + 0.65 * endTaper);

        positions.push(
          bx + side * lift * 0.20,
          by,
          surfaceZ + lift
        );
        uvs.push(0.85 + t * 0.13, 0.76 + rowNorm * 0.08);
        vertexRegionMap.push(REGION_ID.browsHair);
        jawWeights.push(0);
      }
    }
    const stride = segBrow + 1;
    for (let row = 0; row < rowsBrow; row++) {
      for (let i = 0; i < segBrow; i++) {
        const a = baseV + row * stride + i;
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

  // 3. Surface-conforming 3D Cranial Hair Cap (462 vertices, 800 triangles) raycasted onto the skull
  appendHairCapVertices(
    skinPositions,
    skinIndices,
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights
  );

  submeshes.push({
    name: 'browsHair',
    startIndex: startIndexBrows,
    indexCount: indices.length - startIndexBrows,
    startVertex: startVertexBrows,
    vertexCount: (positions.length / 3 - startVertexBrows) | 0,
  });
}

/**
 * 21-column anatomical hairline azimuth & elevation tables (`iu = 0..20`) around `C = (0, 3.0, -0.8)`:
 * - `iu = 0..4`: Forehead & fronto-temporal peak
 * - `iu = 5..6`: Temple sweep down toward sideburn
 * - `iu = 7..9`: Pre-auricular sideburn tab right in front of the ear tragus (`z ≈ +1.37..+0.38, y ≈ 0.33..0.78`)
 * - `iu = 10..13`: Tight supra-auricular ear root cutout arch (`z ≈ +0.03..-1.81, y ≈ 2.16..2.37, x ≈ 4.78`)
 * - `iu = 14..16`: Post-auricular mastoid drop immediately behind the ear helix (`z ≈ -2.18..-2.90, y ≈ +1.07..-0.92`)
 * - `iu = 17..20`: Occipital nape hairline (`y ≈ -0.96..-0.65`)
 */
const HAIRLINE_AZ0: readonly number[] = [
  0.00, 0.16, 0.32, 0.48, 0.65,
  0.83, 1.00,
  1.14, 1.24, 1.33,
  1.40, 1.52, 1.66, 1.81,
  1.91, 2.00, 2.12,
  2.34, 2.59, 2.86, Trigo.pi,
];

const HAIRLINE_PHI0: readonly number[] = [
  0.46, 0.47, 0.50, 0.52, 0.38,
  0.18, -0.02,
  -0.41, -0.49, -0.42,
  -0.16, -0.13, -0.13, -0.16,
  -0.36, -0.66, -0.74,
  -0.75, -0.74, -0.72, -0.70,
];

const HAIRLINE_PHI_SMOOTH: readonly number[] = [
  0.46, 0.47, 0.50, 0.52, 0.38,
  0.22, 0.06,
  -0.06, -0.10, -0.12,
  -0.12, -0.11, -0.12, -0.15,
  -0.28, -0.44, -0.58,
  -0.68, -0.72, -0.71, -0.70,
];

/**
 * Raycast outward from `C = (0, 3.0, -0.8)` along unit direction `(dx, dy, dz)` against
 * `skinPositions` / `skinIndices` to find the exact skull surface distance `t`.
 * Clamps any hit on the protruding outer ear helix (`|x| > 4.80` around the ear) back to the
 * temporal/mastoid skull wall (`|x| = 4.78`) so the hair cap wraps tightly around the ear root.
 */
function raycastSkullDistance(
  dx: number,
  dy: number,
  dz: number,
  skinPositions: ArrayLike<number>,
  skinIndices: ArrayLike<number>
): number {
  let bestT = -1.0;
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
    if (t > 1.5 && t > bestT) {
      bestT = t;
    }
  }

  if (bestT > 1.5) {
    const hitX = CRANIAL_CENTER_X + dx * bestT;
    const hitY = CRANIAL_CENTER_Y + dy * bestT;
    const hitZ = CRANIAL_CENTER_Z + dz * bestT;
    if (Math.abs(hitX) > 4.80 && hitY < 2.55 && hitZ > -2.35 && hitZ < 0.35) {
      bestT = Math.min(bestT, 4.78 / Math.max(0.2, Math.abs(dx)));
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
  const azBlend = Utils.smoothstep(0.0, 0.45, v);
  const az = Utils.lerp(HAIRLINE_AZ0[iu], u * Trigo.pi, azBlend);

  const contourFade = Utils.smoothstep(0.0, 0.35, v);
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

  // Precompute symmetric skull distances on the right hemisphere (+X) so left & right match 100%
  const gridCount = (rowsV + 1) * stride;
  const skullDistGrid = new Float32Array(gridCount);
  const rayX = new Float32Array(gridCount);
  const rayY = new Float32Array(gridCount);
  const rayZ = new Float32Array(gridCount);

  for (let row = 0; row <= rowsV; row++) {
    const v = row / rowsV;
    for (let iu = 0; iu <= segU; iu++) {
      const gIdx = row * stride + iu;
      computeScalpRayDirection(1, iu, v, rayDir);
      rayX[gIdx] = rayDir.x;
      rayY[gIdx] = rayDir.y;
      rayZ[gIdx] = rayDir.z;
      skullDistGrid[gIdx] = raycastSkullDistance(
        rayDir.x,
        rayDir.y,
        rayDir.z,
        skinPositions,
        skinIndices
      );
    }
  }

  // Enforce a strict outer-envelope clearance over all cranial skin vertices, edge midpoints,
  // and triangle centroids so flat hair-cap triangles never dip beneath curved skull triangles.
  const isOuterEarPinna = (x: number, y: number, z: number): boolean =>
    Math.abs(x) > 4.82 && y < 2.45 && z > -2.35 && z < 0.35;

  const sampleDirsAndR: number[] = [];
  const pushSkinSample = (x: number, y: number, z: number): void => {
    if (x < -0.01 || y < -1.2 || isOuterEarPinna(x, y, z)) return;
    const rx = x - CRANIAL_CENTER_X;
    const ry = y - CRANIAL_CENTER_Y;
    const rz = z - CRANIAL_CENTER_Z;
    const r = Math.hypot(rx, ry, rz);
    if (r > 1.5 && r < 9.5) {
      sampleDirsAndR.push(rx / r, ry / r, rz / r, r);
    }
  };

  const skinVertCount = (skinPositions.length / 3) | 0;
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
    pushSkinSample((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    pushSkinSample((bx + cx) * 0.5, (by + cy) * 0.5, (bz + cz) * 0.5);
    pushSkinSample((cx + ax) * 0.5, (cy + ay) * 0.5, (cz + az) * 0.5);
    pushSkinSample((ax + bx + cx) / 3.0, (ay + by + cy) / 3.0, (az + bz + cz) / 3.0);
  }

  const envelopeClearance = 0.032;
  for (let pass = 0; pass < 5; pass++) {
    for (let s = 0; s < sampleDirsAndR.length; s += 4) {
      const dx = sampleDirsAndR[s];
      const dy = sampleDirsAndR[s + 1];
      const dz = sampleDirsAndR[s + 2];
      const rSkin = sampleDirsAndR[s + 3];

      let matched = false;
      for (let row = 0; row < rowsV && !matched; row++) {
        for (let iu = 0; iu < segU; iu++) {
          const a = row * stride + iu;
          if (dx * rayX[a] + dy * rayY[a] + dz * rayZ[a] < 0.84) continue;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;

          for (let triHalf = 0; triHalf < 2; triHalf++) {
            const ia = a;
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

  // Keep the front (iu = 0) and back (iu = segU) sagittal poles welded across all rows
  let maxFrontR = 0.0;
  let maxBackR = 0.0;
  for (let row = 0; row <= rowsV; row++) {
    maxFrontR = Math.max(maxFrontR, skullDistGrid[row * stride]);
    maxBackR = Math.max(maxBackR, skullDistGrid[row * stride + segU]);
  }
  for (let row = 0; row <= rowsV; row++) {
    skullDistGrid[row * stride] = maxFrontR;
    skullDistGrid[row * stride + segU] = maxBackR;
  }

  for (const side of [-1, 1]) {
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

/**
 * Shape the 3D cranial hair cap vertices in-place inside `positions` (starting from their
 * skull-conforming coordinates after `applyMacroProportions`) for the given `hairStyle`.
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
  const segU = HAIR_CAP_SEG_U;
  const rowsV = HAIR_CAP_ROWS_V;
  const stride = segU + 1;
  const sideVertCount = (rowsV + 1) * stride;

  if (hairStyle === 'bald') {
    for (let i = 0; i < HAIR_CAP_VERTEX_COUNT; i++) {
      const idx = (hairStartVertex + i) * 3;
      const sx = positions[idx];
      const sy = positions[idx + 1];
      const sz = positions[idx + 2];
      positions[idx] = CRANIAL_CENTER_X + (sx - CRANIAL_CENTER_X) * 0.72;
      positions[idx + 1] = CRANIAL_CENTER_Y + (sy - CRANIAL_CENTER_Y) * 0.72;
      positions[idx + 2] = CRANIAL_CENTER_Z + (sz - CRANIAL_CENTER_Z) * 0.72;
    }
    return;
  }

  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    const baseV = hairStartVertex + s * sideVertCount;

    for (let row = 0; row <= rowsV; row++) {
      const v = row / rowsV;
      for (let iu = 0; iu <= segU; iu++) {
        const vIdx = (baseV + row * stride + iu) * 3;

        const sx = positions[vIdx];
        const sy = positions[vIdx + 1];
        const sz = positions[vIdx + 2];

        const rx = sx - CRANIAL_CENTER_X;
        const ry = sy - CRANIAL_CENTER_Y;
        const rz = sz - CRANIAL_CENTER_Z;
        const rLen = Math.max(1e-4, Math.hypot(rx, ry, rz));
        const nx = rx / rLen;
        const ny = ry / rLen;
        const nz = rz / rLen;

        // True anatomical azimuth around the cranial center
        const az = Math.atan2(Math.abs(rx), rz);

        // Smooth edge taper across v in [0, 0.22] and around the ear arch while keeping positive clearance
        const edgeBlend = Utils.smoothstep(0.0, 0.22, v);
        const earTaper = 1.0 - 0.55 * Math.exp(-Math.pow((az - 1.58) / 0.42, 2)) * Utils.smoothstep(0.35, 0.0, v);
        const baseContact = 0.012 * (1.0 - edgeBlend);

        let px = sx;
        let py = sy;
        let pz = sz;

        if (hairStyle === 'buzz_fade') {
          // High-and-tight military buzz fade: clean skin-tight fade on lower sides, crisp mat on top deck
          const topZone = Utils.smoothstep(0.24, 0.58, v) + 0.35 * Utils.smoothstep(0.55, 0.0, az);
          const dr = baseContact + edgeBlend * earTaper * (0.068 + 0.22 * Utils.clamp(topZone, 0.0, 1.0));
          px = sx + nx * dr;
          py = sy + ny * dr;
          pz = sz + nz * dr;
        } else if (hairStyle === 'flattop') {
          // Iconic Doom Marine / Guile squared high-top flat-top deck with tapered ear/sideburn/nape fade
          const upperDome = Utils.smoothstep(0.24, 0.60, ny);
          const topDeckW = Utils.smoothstep(0.32, 0.58, v) * upperDome;
          const cornerFlare = Math.sin(v * Trigo.pi) * Math.sin(az) * upperDome;
          const radialFade = baseContact + edgeBlend * earTaper * (0.10 + 0.36 * upperDome + 0.42 * cornerFlare);
          const deckTargetY = (sy + ny * radialFade) * (1.0 - topDeckW) + 10.35 * topDeckW;
          const frontVisor = Utils.smoothstep(0.75, 0.0, az) * edgeBlend * upperDome * 0.32;

          px = sx + nx * radialFade + side * topDeckW * (1.0 - v) * 0.65 * Math.sin(az);
          py = deckTargetY;
          pz = sz + nz * radialFade + frontVisor;
        } else if (hairStyle === 'afro_short') {
          // Volumetric sculpted textured afro halo with tailored temple/ear taper
          const coils = 0.065 * Math.sin(az * 18.0) * Math.cos(v * 16.0);
          const crownLoft = 0.48 + 0.52 * Utils.smoothstep(0.0, 0.50, v);
          const dr = baseContact + edgeBlend * earTaper * (0.76 * crownLoft + coils);
          px = sx + nx * dr;
          py = sy + ny * dr + edgeBlend * 0.28 * v;
          pz = sz + nz * dr;
        } else if (hairStyle === 'mohawk') {
          // Close-buzzed skull sides with a tall central spiked sagittal crest from forehead to nape
          const sideBuzz = 0.034 + 0.022 * edgeBlend * earTaper;
          const crestMask = Utils.smoothstep(0.58, 0.78, v);
          if (crestMask <= 0.001) {
            px = sx + nx * sideBuzz;
            py = sy + ny * sideBuzz;
            pz = sz + nz * sideBuzz;
          } else {
            const centerProfile = Utils.smoothstep(0.58, 0.96, v);
            const spikes = 0.86 + 0.22 * Math.sin(az * 18.0);
            const frontToBackHeight = 1.0 - 0.25 * Utils.smoothstep(2.1, 3.1, az);
            const spikeLift = 1.85 * centerProfile * spikes * frontToBackHeight;
            px = (sx + nx * sideBuzz) * (1.0 - 0.46 * centerProfile);
            py = sy + ny * (sideBuzz + spikeLift) + 0.45 * spikeLift;
            pz = sz + nz * (sideBuzz + spikeLift * 0.72) + (az < 0.45 ? 0.35 * centerProfile : 0);
          }
        } else if (hairStyle === 'slick_back') {
          // Swept-back pompadour with elevated front wave and clean tapered wings around the ears
          const pompFront = Utils.smoothstep(1.15, 0.0, az) * Utils.smoothstep(0.0, 0.55, v);
          const sideWing = Math.sin(az) * Math.sin(v * Trigo.pi);
          const dr = baseContact + edgeBlend * earTaper * (0.24 + 0.44 * v + 0.20 * sideWing);
          const ridgeWave = 0.042 * Math.sin(v * 24.0 + az * 8.0) * edgeBlend * earTaper;
          const backSweepZ = Utils.smoothstep(0.15, 0.50, v) * 0.20 * Math.sin(az * 0.85);
          px = sx + nx * (dr + ridgeWave);
          py = sy + ny * dr + pompFront * 0.65;
          pz = sz + nz * dr + pompFront * 0.42 - backSweepZ;
        } else if (hairStyle === 'dreadlocks') {
          // Thick 3D braided dreadlock cords radiating from crown with hanging back locks behind the ear
          const cordGroove = Math.pow(0.5 + 0.5 * Math.cos(az * 14.0), 0.55);
          const ropeBead = 0.05 * Math.sin(v * 28.0);
          const dr = baseContact + edgeBlend * earTaper * (0.22 + (0.56 * cordGroove + ropeBead) * Utils.smoothstep(0.0, 0.25, v));
          const hangBack = Utils.smoothstep(1.80, 2.65, az) * (1.0 - v) * edgeBlend;
          px = sx + nx * (dr + 0.22 * hangBack * cordGroove);
          py = sy + ny * dr - 0.58 * hangBack * (0.4 + 0.6 * cordGroove);
          pz = sz + nz * (dr + 0.18 * hangBack);
        } else if (hairStyle === 'combat_helmet') {
          // Tactical Space Marine armored dome with brow visor rim, contoured ear cutout, and sagittal ridge
          const visorRim = Utils.smoothstep(0.28, 0.0, v) * Utils.smoothstep(1.05, 0.35, az);
          const earRim = Utils.smoothstep(0.32, 0.0, v) * Math.exp(-Math.pow((az - 1.58) / 0.38, 2));
          const crownRidge = Utils.smoothstep(0.76, 0.92, v) * 0.28;
          const shellThickness = (0.48 + 0.28 * Utils.smoothstep(0.0, 0.22, v)) * (1.0 - 0.28 * earRim) + crownRidge + visorRim * 0.24;
          px = sx + nx * shellThickness;
          py = sy + ny * shellThickness - visorRim * 0.36;
          pz = sz + nz * shellThickness + visorRim * 0.32;
        }

        if (iu === 0 || iu === segU || row === rowsV) {
          px = 0.0;
        }

        positions[vIdx] = px;
        positions[vIdx + 1] = py;
        positions[vIdx + 2] = pz;
      }
    }
  }
}

/**
 * Build the canonical symmetrical anatomical base head mesh from Vidar Rapp's ZBrush human head
 * sculpt (`african_head.obj` + `african_head_eye_inner.obj`), dental arches, and surface-conforming
 * 3D eyebrows, computing smooth normals with RoostR's `CustomMesh.computeVertexNormals()`.
 */
export function buildAnatomicalBaseHead(
  _segU: number = 64,
  _segV: number = 48,
  baseHeadId: BaseHeadId = 'african_sculpt'
): IBaseHeadGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexRegionMap: number[] = [];
  const jawWeights: number[] = [];
  const submeshes: ISubmeshRange[] = [];

  const archetype = BASE_HEAD_ARCHETYPES[baseHeadId] ?? BASE_HEAD_ARCHETYPES.african_sculpt;
  const skinSource = archetype.skinPositions;

  // 1. ZBrush / Scan Fitted Human Head Skin Mesh (100% bilaterally symmetrized)
  const skinVertexCount = (skinSource.length / 3) | 0;
  for (let i = 0; i < skinSource.length; i++) {
    positions.push(skinSource[i]);
  }
  for (let i = 0; i < SCULPTED_SKIN_UVS.length; i++) {
    uvs.push(SCULPTED_SKIN_UVS[i]);
  }
  for (let i = 0; i < skinVertexCount; i++) {
    vertexRegionMap.push(REGION_ID.skin);
    jawWeights.push(SCULPTED_SKIN_JAW_WEIGHTS[i]);
  }
  for (let i = 0; i < SCULPTED_SKIN_INDICES.length; i++) {
    indices.push(SCULPTED_SKIN_INDICES[i]);
  }

  submeshes.push({
    name: 'skin',
    startIndex: 0,
    indexCount: SCULPTED_SKIN_INDICES.length,
    startVertex: 0,
    vertexCount: skinVertexCount,
  });

  // 2. Define the 4 Anatomical Pivots (Vec3)
  const pivots: IFacePivots = {
    neck: new Vec3(0, -7.8, -0.8),
    jaw: new Vec3(0, -1.25, 1.45),
    eyeLeft: new Vec3(-SCULPTED_EYE_PIVOT_ABS[0], SCULPTED_EYE_PIVOT_ABS[1], SCULPTED_EYE_PIVOT_ABS[2]),
    eyeRight: new Vec3(SCULPTED_EYE_PIVOT_ABS[0], SCULPTED_EYE_PIVOT_ABS[1], SCULPTED_EYE_PIVOT_ABS[2]),
  };

  // 3. Left & Right Sculpted Eyeballs (`african_head_eye_inner.obj`)
  appendSculptedEyeball(
    SCULPTED_EYE_LEFT_POSITIONS,
    SCULPTED_EYE_LEFT_UVS,
    SCULPTED_EYE_LEFT_INDICES,
    'eyeLeft',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  appendSculptedEyeball(
    SCULPTED_EYE_RIGHT_POSITIONS,
    SCULPTED_EYE_RIGHT_UVS,
    SCULPTED_EYE_RIGHT_INDICES,
    'eyeRight',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  // 4. Upper & Lower Dental Arches (Teeth) inside the oral cavity
  appendDentalArch(
    -1.85,
    -0.38,
    0.0,
    new Vec2(0.52, 0.78),
    new Vec2(0.82, 0.85),
    'teethUpper',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  appendDentalArch(
    -2.72,
    0.38,
    1.0,
    new Vec2(0.52, 0.86),
    new Vec2(0.82, 0.93),
    'teethLower',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  // 5. Inner Oral Cavity Backwall & Surface-Conforming 3D Eyebrows + Cranial Hair Cap
  appendMouthInnerAndBrows(
    skinSource,
    SCULPTED_SKIN_INDICES,
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  const posArray = new Float32Array(positions);
  const uvArray = new Float32Array(uvs);
  const indArray = new Int32Array(indices);
  const normArray = computeSmoothNormals(posArray, indArray);
  unfoldNostrilCavityUVs(posArray, normArray, uvArray, skinVertexCount);

  return {
    positions: posArray,
    normals: normArray,
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
 * Parse a Wavefront `.obj` 3D head mesh text into an `IBaseHeadGeometry`, automatically
 * normalizing its bounding box into `FaceR.js`'s anatomical coordinate frame, generating
 * atlas UVs and jaw weights, and computing smooth vertex normals.
 */
export function parseObjToTopology(objText: string): IBaseHeadGeometry {
  const rawVerts: number[] = [];
  const rawTris: number[] = [];

  const lines = objText.split(/\r?\n/);
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l].trim();
    if (!line || line.charCodeAt(0) === 35) continue;
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        rawVerts.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0);
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
    }
  }

  const vCount = (rawVerts.length / 3) | 0;
  if (vCount < 3 || rawTris.length < 3) {
    return buildAnatomicalBaseHead();
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < rawVerts.length; i += 3) {
    const x = rawVerts[i];
    const y = rawVerts[i + 1];
    const z = rawVerts[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

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
    eyeLeft: new Vec3(-SCULPTED_EYE_PIVOT_ABS[0], SCULPTED_EYE_PIVOT_ABS[1], SCULPTED_EYE_PIVOT_ABS[2]),
    eyeRight: new Vec3(SCULPTED_EYE_PIVOT_ABS[0], SCULPTED_EYE_PIVOT_ABS[1], SCULPTED_EYE_PIVOT_ABS[2]),
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

export const createBaseHeadTopology = buildAnatomicalBaseHead;

const _cachedBaseHeads = new Map<BaseHeadId, IBaseHeadGeometry>();

export function getCanonicalBaseHead(baseHeadId: BaseHeadId = 'african_sculpt'): IBaseHeadGeometry {
  let cached = _cachedBaseHeads.get(baseHeadId);
  if (!cached) {
    cached = buildAnatomicalBaseHead(64, 48, baseHeadId);
    _cachedBaseHeads.set(baseHeadId, cached);
  }
  return cached;
}
