import { Vec3, Utils } from '@1pizzateam/spock';
import { CustomMesh } from '@1pizzateam/roostr';
import {
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
  FACE_REGION_IDS,
  IMacroProportions,
  IFacePivots,
  ISparseMuscleDelta
} from '../interfaces';
import { IBaseHeadTopology, computeSmoothNormals } from './baseHead';

/**
 * Evaluate a 3D anisotropic Gaussian weight around `center` with `radii`.
 */
function regionFalloff(pos: Vec3, center: Vec3, radii: Vec3): number {
  const dx = (pos.x - center.x) / radii.x;
  const dy = (pos.y - center.y) / radii.y;
  const dz = (pos.z - center.z) / radii.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 9.0) return 0;
  return Math.exp(-d2);
}

/**
 * Evaluate a bilaterally symmetric 3D Gaussian weight (`center.x` mirrored).
 */
function symmetricFalloff(pos: Vec3, center: Vec3, radii: Vec3): number {
  const dx = (Math.abs(pos.x) - center.x) / radii.x;
  const dy = (pos.y - center.y) / radii.y;
  const dz = (pos.z - center.z) / radii.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 9.0) return 0;
  return Math.exp(-d2);
}

/**
 * Apply macro anatomical proportions (`IMacroProportions`, all `Vec3`) plus
 * optional freeform sculpt offsets (`Float32Array`) to the canonical base head
 * topology, writing deformed positions into `outPositions` and updated pivot
 * centers into `outPivots`.
 */
export function applyMacroProportions(
  baseHead: IBaseHeadTopology,
  proportions: IMacroProportions,
  sculptOffsets: Float32Array | null,
  outPositions: Float32Array,
  outPivots: IFacePivots
): void {
  const srcPos = baseHead.positions;
  const regionMap = baseHead.vertexRegionMap;
  const vertexCount = baseHead.vertexCount;

  const basePivots = baseHead.pivots;
  outPivots.neck.copy(basePivots.neck);
  outPivots.jaw.setScalar(
    basePivots.jaw.x,
    basePivots.jaw.y * proportions.jawScale.y,
    basePivots.jaw.z * proportions.jawScale.z
  );
  outPivots.eyeLeft.setScalar(
    basePivots.eyeLeft.x - proportions.eyeSocketOffset.x,
    basePivots.eyeLeft.y + proportions.eyeSocketOffset.y,
    basePivots.eyeLeft.z + proportions.eyeSocketOffset.z
  );
  outPivots.eyeRight.setScalar(
    basePivots.eyeRight.x + proportions.eyeSocketOffset.x,
    basePivots.eyeRight.y + proportions.eyeSocketOffset.y,
    basePivots.eyeRight.z + proportions.eyeSocketOffset.z
  );

  const p = new Vec3();
  const cJaw = new Vec3(5.2, -4.6, 1.5);
  const rJaw = new Vec3(4.5, 4.2, 5.0);
  const cChin = new Vec3(0, -7.0, 6.0);
  const rChin = new Vec3(3.2, 2.5, 3.8);
  const cCheek = new Vec3(4.6, 0.2, 4.8);
  const rCheek = new Vec3(3.2, 3.0, 4.0);
  const cBrow = new Vec3(2.8, 4.1, 6.8);
  const rBrow = new Vec3(3.6, 1.8, 3.5);
  const cEye = new Vec3(2.85, 2.35, 6.2);
  const rEye = new Vec3(2.5, 2.0, 3.5);
  const cNose = new Vec3(0, 0.8, 7.2);
  const rNose = new Vec3(2.2, 2.8, 3.6);
  const cMouth = new Vec3(0, -3.2, 6.8);
  const rMouth = new Vec3(3.8, 2.2, 3.6);
  const cEar = new Vec3(7.6, 0.6, -1.2);
  const rEar = new Vec3(2.0, 3.0, 2.5);

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    p.setScalar(srcPos[idx], srcPos[idx + 1], srcPos[idx + 2]);
    const region = regionMap[i];
    const signX = p.x >= 0 ? 1 : -1;

    if (region === FACE_REGION_IDS.eyeLeft) {
      p.x -= proportions.eyeSocketOffset.x;
      p.y += proportions.eyeSocketOffset.y;
      p.z += proportions.eyeSocketOffset.z;
    } else if (region === FACE_REGION_IDS.eyeRight) {
      p.x += proportions.eyeSocketOffset.x;
      p.y += proportions.eyeSocketOffset.y;
      p.z += proportions.eyeSocketOffset.z;
    } else if (region === FACE_REGION_IDS.browsHair) {
      p.x += signX * (proportions.browOffset.x + proportions.eyeSocketOffset.x * 0.65);
      p.y += proportions.browOffset.y + proportions.eyeSocketOffset.y * 0.65;
      p.z += proportions.browOffset.z + proportions.eyeSocketOffset.z * 0.65;
    } else if (
      region === FACE_REGION_IDS.teethUpper ||
      region === FACE_REGION_IDS.teethLower ||
      region === FACE_REGION_IDS.mouthInner
    ) {
      p.x *= Utils.lerp(1.0, proportions.mouthScale.x, 0.65);
      p.y += (proportions.jawScale.y - 1.0) * -2.2;
      p.z += (proportions.mouthScale.z - 1.0) * 1.4;
    } else {
      const upperMask = Utils.smoothstep(-1.0, 3.5, p.y);
      const lowerMask = Utils.smoothstep(1.5, -3.5, p.y) * Utils.smoothstep(-10.0, -7.8, p.y);

      p.x *= Utils.lerp(1.0, proportions.craniumScale.x, upperMask);
      if (p.y > 0) {
        p.y *= Utils.lerp(1.0, proportions.craniumScale.y, upperMask);
      }
      p.z *= Utils.lerp(1.0, proportions.craniumScale.z, upperMask);

      const wJaw = Math.max(lowerMask * 0.7, symmetricFalloff(p, cJaw, rJaw));
      p.x *= Utils.lerp(1.0, proportions.jawScale.x, wJaw);
      if (p.y < 0) {
        p.y *= Utils.lerp(1.0, proportions.jawScale.y, wJaw);
      }
      p.z *= Utils.lerp(1.0, proportions.jawScale.z, wJaw * 0.6);

      const wChin = regionFalloff(p, cChin, rChin);
      if (wChin > 0) {
        p.x *= 1.0 + proportions.chinOffset.x * 0.12 * wChin;
        p.y += proportions.chinOffset.y * wChin;
        p.z += proportions.chinOffset.z * wChin;
      }

      const wCheek = symmetricFalloff(p, cCheek, rCheek);
      if (wCheek > 0) {
        p.x += signX * proportions.cheekboneOffset.x * wCheek;
        p.y += proportions.cheekboneOffset.y * wCheek;
        p.z += proportions.cheekboneOffset.z * wCheek;
      }

      const wBrow = symmetricFalloff(p, cBrow, rBrow);
      if (wBrow > 0) {
        p.x += signX * proportions.browOffset.x * wBrow;
        p.y += proportions.browOffset.y * wBrow;
        p.z += proportions.browOffset.z * wBrow;
      }

      const wEye = symmetricFalloff(p, cEye, rEye);
      if (wEye > 0) {
        p.x += signX * proportions.eyeSocketOffset.x * wEye;
        p.y += proportions.eyeSocketOffset.y * wEye;
        p.z += proportions.eyeSocketOffset.z * wEye;
      }

      const wNose = regionFalloff(p, cNose, rNose);
      if (wNose > 0) {
        p.x *= Utils.lerp(1.0, proportions.noseScale.x, wNose);
        p.y += (proportions.noseScale.y - 1.0) * -1.4 * wNose;
        p.z += (proportions.noseScale.z - 1.0) * 2.4 * wNose;
      }

      const wMouth = regionFalloff(p, cMouth, rMouth);
      if (wMouth > 0) {
        p.x *= Utils.lerp(1.0, proportions.mouthScale.x, wMouth);
        p.y += (p.y + 3.2) * (proportions.mouthScale.y - 1.0) * wMouth;
        p.z += (proportions.mouthScale.z - 1.0) * 1.8 * wMouth;
      }

      const wEar = symmetricFalloff(p, cEar, rEar);
      if (wEar > 0) {
        p.x += signX * (proportions.earScale.x - 1.0) * 1.4 * wEar;
        p.y += (p.y - 0.6) * (proportions.earScale.y - 1.0) * wEar;
        p.z += (proportions.earScale.z - 1.0) * 1.1 * wEar;
      }
    }

    if (sculptOffsets && sculptOffsets.length >= idx + 3) {
      p.x += sculptOffsets[idx];
      p.y += sculptOffsets[idx + 1];
      p.z += sculptOffsets[idx + 2];
    }

    outPositions[idx] = p.x;
    outPositions[idx + 1] = p.y;
    outPositions[idx + 2] = p.z;
  }
}

/**
 * Evaluate the 3D displacement vector `outDelta` (`Vec3`) for a single vertex
 * `pos` under FACS muscle `muscleName` at 100% activation (`weight = 1.0`).
 */
function evaluateSingleMuscleDisplacement(
  muscleName: FacsMuscleName,
  pos: Vec3,
  region: number,
  pivots: IFacePivots,
  outDelta: Vec3
): void {
  outDelta.origin();

  if (
    region === FACE_REGION_IDS.eyeLeft ||
    region === FACE_REGION_IDS.eyeRight ||
    region === FACE_REGION_IDS.teethUpper
  ) {
    return;
  }

  if (region === FACE_REGION_IDS.teethLower || region === FACE_REGION_IDS.mouthInner) {
    if (region === FACE_REGION_IDS.mouthInner && pos.y > -3.15) {
      return;
    }
    switch (muscleName) {
      case 'jawOpen':
        outDelta.setScalar(0, -2.15, -0.55);
        return;
      case 'jawForward':
        outDelta.setScalar(0, 0, 1.15);
        return;
      case 'jawLeft':
        outDelta.setScalar(-1.1, 0, 0);
        return;
      case 'jawRight':
        outDelta.setScalar(1.1, 0, 0);
        return;
      default:
        return;
    }
  }

  const eyeL = pivots.eyeLeft;
  const eyeR = pivots.eyeRight;

  switch (muscleName) {
    case 'browInnerUp': {
      const wL = regionFalloff(pos, new Vec3(eyeL.x * 0.45, eyeL.y + 1.85, eyeL.z + 1.2), new Vec3(1.9, 1.6, 2.8));
      const wR = regionFalloff(pos, new Vec3(eyeR.x * 0.45, eyeR.y + 1.85, eyeR.z + 1.2), new Vec3(1.9, 1.6, 2.8));
      const w = Math.min(1.1, wL + wR);
      if (w > 0.002) {
        outDelta.setScalar(0, 1.15 * w, 0.22 * w);
      }
      break;
    }

    case 'browDownL':
    case 'browDownR': {
      const isLeft = muscleName === 'browDownL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeR.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const medialSign = isLeft ? 1 : -1;
      const w = regionFalloff(pos, new Vec3(ex * 0.85, ey + 1.75, ez + 1.2), new Vec3(2.4, 1.45, 2.8));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.58 * w, -1.05 * w, 0.32 * w);
      }
      break;
    }

    case 'browOuterUpL':
    case 'browOuterUpR': {
      const isLeft = muscleName === 'browOuterUpL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeR.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const latSign = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(ex * 1.32, ey + 1.82, ez + 0.8), new Vec3(2.1, 1.45, 2.8));
      if (w > 0.002) {
        outDelta.setScalar(latSign * 0.22 * w, 1.18 * w, 0.15 * w);
      }
      break;
    }

    case 'eyeBlinkL':
    case 'eyeBlinkR': {
      if (region === FACE_REGION_IDS.browsHair) break;
      const isLeft = muscleName === 'eyeBlinkL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeL.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.62, ez + 1.25), new Vec3(1.75, 0.72, 2.2));
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.58, ez + 1.20), new Vec3(1.70, 0.62, 2.2));
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, -1.12 * wUpper + 0.38 * wLower, 0.42 * (wUpper + wLower));
      }
      break;
    }

    case 'eyeSquintL':
    case 'eyeSquintR': {
      const isLeft = muscleName === 'eyeSquintL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeL.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const medialSign = isLeft ? 1 : -1;
      const w = regionFalloff(pos, new Vec3(ex * 1.05, ey - 0.55, ez + 1.0), new Vec3(2.1, 1.05, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.24 * w, 0.72 * w, 0.28 * w);
      }
      break;
    }

    case 'eyeWideL':
    case 'eyeWideR': {
      if (region === FACE_REGION_IDS.browsHair) break;
      const isLeft = muscleName === 'eyeWideL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeL.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.58, ez + 1.25), new Vec3(1.75, 0.75, 2.2));
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.55, ez + 1.20), new Vec3(1.70, 0.58, 2.2));
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, 0.68 * wUpper - 0.22 * wLower, -0.15 * wUpper);
      }
      break;
    }

    case 'cheekSquintL':
    case 'cheekSquintR': {
      const isLeft = muscleName === 'cheekSquintL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 3.6, 0.35, 5.5), new Vec3(2.5, 1.85, 3.0));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.28 * w, 0.78 * w, 0.52 * w);
      }
      break;
    }

    case 'noseSneerL':
    case 'noseSneerR': {
      const isLeft = muscleName === 'noseSneerL';
      const signX = isLeft ? -1 : 1;
      const wWing = regionFalloff(pos, new Vec3(signX * 1.35, -0.45, 7.0), new Vec3(1.35, 1.25, 2.4));
      const wLip = regionFalloff(pos, new Vec3(signX * 1.45, -2.15, 7.2), new Vec3(1.45, 1.15, 2.4));
      const w = Math.max(wWing, wLip * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.35 * wWing, 0.92 * w, 0.28 * w);
      }
      break;
    }

    case 'jawOpen': {
      const wLowerLip = regionFalloff(pos, new Vec3(0, -4.1, 6.8), new Vec3(3.2, 1.6, 3.2));
      const wChin = regionFalloff(pos, new Vec3(0, -6.8, 5.2), new Vec3(4.5, 2.8, 4.5));
      const wCorners = symmetricFalloff(pos, new Vec3(2.35, -3.2, 6.4), new Vec3(1.2, 1.1, 2.2));
      const w = Math.min(1.0, Math.max(wLowerLip, wChin * 0.92) + wCorners * 0.35);
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.05 * w, -2.25 * w, -0.58 * w);
      }
      break;
    }

    case 'jawForward': {
      const w = regionFalloff(pos, new Vec3(0, -5.8, 5.5), new Vec3(4.8, 3.0, 4.5));
      if (w > 0.002) {
        outDelta.setScalar(0, 0.12 * w, 1.15 * w);
      }
      break;
    }

    case 'jawLeft':
    case 'jawRight': {
      const dir = muscleName === 'jawLeft' ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(0, -5.8, 5.5), new Vec3(4.8, 3.0, 4.5));
      if (w > 0.002) {
        outDelta.setScalar(dir * 1.15 * w, 0, 0);
      }
      break;
    }

    case 'mouthSmileL':
    case 'mouthSmileR': {
      const isLeft = muscleName === 'mouthSmileL';
      const signX = isLeft ? -1 : 1;
      const wCorner = regionFalloff(pos, new Vec3(signX * 2.15, -3.15, 6.6), new Vec3(1.85, 1.45, 2.6));
      const wCheek = regionFalloff(pos, new Vec3(signX * 3.6, -1.2, 5.6), new Vec3(2.2, 1.8, 2.8));
      if (wCorner > 0.002 || wCheek > 0.002) {
        outDelta.setScalar(
          signX * (0.95 * wCorner + 0.35 * wCheek),
          1.15 * wCorner + 0.55 * wCheek,
          -0.28 * wCorner + 0.38 * wCheek
        );
      }
      break;
    }

    case 'mouthFrownL':
    case 'mouthFrownR': {
      const isLeft = muscleName === 'mouthFrownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 2.25, -3.35, 6.5), new Vec3(1.85, 1.55, 2.6));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.28 * w, -1.12 * w, -0.15 * w);
      }
      break;
    }

    case 'mouthPucker': {
      const w = regionFalloff(pos, new Vec3(0, -3.2, 6.9), new Vec3(3.1, 1.75, 2.8));
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.42 * w, 0, 1.05 * w);
      }
      break;
    }

    case 'mouthFunnel': {
      const w = regionFalloff(pos, new Vec3(0, -3.2, 6.9), new Vec3(3.0, 1.75, 2.8));
      if (w > 0.002) {
        const dy = pos.y - -3.2;
        const vertPart = dy >= 0 ? 0.55 : -0.65;
        outDelta.setScalar(-pos.x * 0.28 * w, vertPart * w, 0.92 * w);
      }
      break;
    }

    case 'mouthUpperUpL':
    case 'mouthUpperUpR': {
      const isLeft = muscleName === 'mouthUpperUpL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.25, -2.55, 7.2), new Vec3(1.45, 1.05, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.18 * w, 0.98 * w, 0.25 * w);
      }
      break;
    }

    case 'mouthLowerDownL':
    case 'mouthLowerDownR': {
      const isLeft = muscleName === 'mouthLowerDownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.25, -3.85, 7.0), new Vec3(1.55, 1.10, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.22 * w, -0.95 * w, 0.28 * w);
      }
      break;
    }

    case 'mouthShrugUpper': {
      const wLip = regionFalloff(pos, new Vec3(0, -3.3, 7.1), new Vec3(2.5, 1.45, 2.6));
      const wChin = regionFalloff(pos, new Vec3(0, -6.4, 6.4), new Vec3(2.4, 1.8, 2.6));
      const w = Math.max(wLip, wChin * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(0, 0.78 * w, 0.35 * wLip - 0.15 * wChin);
      }
      break;
    }

    case 'mouthPress': {
      const w = regionFalloff(pos, new Vec3(0, -3.2, 7.1), new Vec3(2.8, 1.35, 2.6));
      if (w > 0.002) {
        const dy = pos.y - -3.2;
        outDelta.setScalar(0, -dy * 0.48 * w, -0.42 * w);
      }
      break;
    }
  }
}

/**
 * Automatically compute all sparse FACS muscle morph targets (`ISparseMuscleDelta`)
 * directly from the sculpted vertex positions, triangle indices, region map, and pivots.
 * Uses `CustomMesh.prototype.computeVertexNormals()` from `@1pizzateam/roostr` to
 * calculate exact normal deltas (`dNorm`) for every active vertex.
 */
export function computeFacsMuscles(
  positions: Float32Array,
  indices: Int32Array | Uint16Array | Uint32Array,
  vertexRegionMap: Uint8Array,
  pivots: IFacePivots
): Record<FacsMuscleName, ISparseMuscleDelta> {
  const vertexCount = (positions.length / 3) | 0;
  const baseNormals = computeSmoothNormals(positions, indices);

  const deformedPos = new Float32Array(positions.length);
  const posVec = new Vec3();
  const deltaVec = new Vec3();
  const activeIndices: number[] = [];
  const activeDPos: number[] = [];

  const result = {} as Record<FacsMuscleName, ISparseMuscleDelta>;

  const tempCustomMesh = new CustomMesh();
  tempCustomMesh.vertices = deformedPos;
  tempCustomMesh.indices = indices instanceof Int32Array ? indices : new Int32Array(indices);

  for (let m = 0; m < FACS_MUSCLE_NAMES.length; m++) {
    const muscleName = FACS_MUSCLE_NAMES[m];
    deformedPos.set(positions);
    activeIndices.length = 0;
    activeDPos.length = 0;

    for (let i = 0; i < vertexCount; i++) {
      const idx = i * 3;
      posVec.setScalar(positions[idx], positions[idx + 1], positions[idx + 2]);
      evaluateSingleMuscleDisplacement(muscleName, posVec, vertexRegionMap[i], pivots, deltaVec);

      const magSq = deltaVec.getMagnitude(true);
      if (magSq > 1e-6) {
        activeIndices.push(i);
        activeDPos.push(deltaVec.x, deltaVec.y, deltaVec.z);
        deformedPos[idx] += deltaVec.x;
        deformedPos[idx + 1] += deltaVec.y;
        deformedPos[idx + 2] += deltaVec.z;
      }
    }

    const defNormals = tempCustomMesh.computeVertexNormals() ?? baseNormals;

    const count = activeIndices.length;
    const dNorm = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const vIdx = activeIndices[k] * 3;
      const outIdx = k * 3;
      dNorm[outIdx] = defNormals[vIdx] - baseNormals[vIdx];
      dNorm[outIdx + 1] = defNormals[vIdx + 1] - baseNormals[vIdx + 1];
      dNorm[outIdx + 2] = defNormals[vIdx + 2] - baseNormals[vIdx + 2];
    }

    result[muscleName] = {
      indices: new Uint16Array(activeIndices),
      dPos: new Float32Array(activeDPos),
      dNorm
    };
  }

  return result;
}
