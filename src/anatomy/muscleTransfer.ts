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
  const cJaw = new Vec3(4.6, -4.1, 1.5);
  const rJaw = new Vec3(4.2, 3.6, 4.8);
  const cChin = new Vec3(0, -5.65, 6.2);
  const rChin = new Vec3(2.8, 2.1, 3.5);
  const cCheek = new Vec3(4.15, 0.55, 5.0);
  const rCheek = new Vec3(2.8, 2.5, 3.6);
  const cBrow = new Vec3(2.35, 3.15, 6.5);
  const rBrow = new Vec3(3.2, 1.5, 3.2);
  const cEye = new Vec3(2.35, 1.85, 5.6);
  const rEye = new Vec3(2.1, 1.6, 3.2);
  const cNose = new Vec3(0, 0.15, 7.0);
  const rNose = new Vec3(1.9, 2.4, 3.4);
  const cMouth = new Vec3(0, -3.10, 6.6);
  const rMouth = new Vec3(3.2, 1.9, 3.2);
  const cEar = new Vec3(6.15, 0.45, -0.65);
  const rEar = new Vec3(1.8, 2.6, 2.2);

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
      p.y += (proportions.jawScale.y - 1.0) * -1.8;
      p.z += (proportions.mouthScale.z - 1.0) * 1.2;
    } else {
      const upperMask = Utils.smoothstep(-0.8, 3.0, p.y);
      const lowerMask = Utils.smoothstep(1.2, -3.2, p.y) * Utils.smoothstep(-6.8, -5.4, p.y);

      p.x *= Utils.lerp(1.0, proportions.craniumScale.x, upperMask);
      if (p.y > 0) {
        p.y *= Utils.lerp(1.0, proportions.craniumScale.y, upperMask);
      }
      p.z *= Utils.lerp(1.0, proportions.craniumScale.z, upperMask);

      const wJaw = Math.max(lowerMask * 0.65, symmetricFalloff(p, cJaw, rJaw));
      p.x *= Utils.lerp(1.0, proportions.jawScale.x, wJaw);
      if (p.y < 0 && p.y > -6.8) {
        p.y *= Utils.lerp(1.0, proportions.jawScale.y, wJaw * 0.65);
      }
      p.z *= Utils.lerp(1.0, proportions.jawScale.z, wJaw * 0.55);

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
        p.y += (proportions.noseScale.y - 1.0) * -1.1 * wNose;
        p.z += (proportions.noseScale.z - 1.0) * 1.9 * wNose;
      }

      const wMouth = regionFalloff(p, cMouth, rMouth);
      if (wMouth > 0) {
        p.x *= Utils.lerp(1.0, proportions.mouthScale.x, wMouth);
        p.y += (p.y + 3.1) * (proportions.mouthScale.y - 1.0) * wMouth;
        p.z += (proportions.mouthScale.z - 1.0) * 1.5 * wMouth;
      }

      const wEar = symmetricFalloff(p, cEar, rEar);
      if (wEar > 0) {
        p.x += signX * (proportions.earScale.x - 1.0) * 1.2 * wEar;
        p.y += (p.y - 0.45) * (proportions.earScale.y - 1.0) * wEar;
        p.z += (proportions.earScale.z - 1.0) * 0.9 * wEar;
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
    if (region === FACE_REGION_IDS.mouthInner && pos.y > -3.05) {
      return;
    }
    switch (muscleName) {
      case 'jawOpen':
        outDelta.setScalar(0, -1.95, -0.45);
        return;
      case 'jawForward':
        outDelta.setScalar(0, 0, 0.95);
        return;
      case 'jawLeft':
        outDelta.setScalar(-0.95, 0, 0);
        return;
      case 'jawRight':
        outDelta.setScalar(0.95, 0, 0);
        return;
      default:
        return;
    }
  }

  const eyeL = pivots.eyeLeft;
  const eyeR = pivots.eyeRight;

  switch (muscleName) {
    case 'browInnerUp': {
      const wL = regionFalloff(pos, new Vec3(eyeL.x * 0.45, eyeL.y + 1.35, eyeL.z + 1.8), new Vec3(1.65, 1.35, 2.5));
      const wR = regionFalloff(pos, new Vec3(eyeR.x * 0.45, eyeR.y + 1.35, eyeR.z + 1.8), new Vec3(1.65, 1.35, 2.5));
      const w = Math.min(1.1, wL + wR);
      if (w > 0.002) {
        outDelta.setScalar(0, 0.95 * w, 0.18 * w);
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
      const w = regionFalloff(pos, new Vec3(ex * 0.85, ey + 1.30, ez + 1.8), new Vec3(2.1, 1.25, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.48 * w, -0.88 * w, 0.25 * w);
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
      const w = regionFalloff(pos, new Vec3(ex * 1.32, ey + 1.35, ez + 1.4), new Vec3(1.85, 1.25, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(latSign * 0.18 * w, 0.98 * w, 0.12 * w);
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
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.42, ez + 1.35), new Vec3(1.45, 0.55, 2.0));
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.42, ez + 1.30), new Vec3(1.42, 0.48, 2.0));
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, -0.85 * wUpper + 0.28 * wLower, 0.28 * (wUpper + wLower));
      }
      break;
    }

    case 'eyeSquintL':
    case 'eyeSquintR': {
      const isLeft = muscleName === 'eyeSquintL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeR.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const medialSign = isLeft ? 1 : -1;
      const w = regionFalloff(pos, new Vec3(ex * 1.05, ey - 0.45, ez + 1.2), new Vec3(1.85, 0.88, 2.2));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.20 * w, 0.58 * w, 0.22 * w);
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
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.42, ez + 1.35), new Vec3(1.45, 0.58, 2.0));
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.42, ez + 1.30), new Vec3(1.42, 0.48, 2.0));
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, 0.52 * wUpper - 0.18 * wLower, -0.12 * wUpper);
      }
      break;
    }

    case 'cheekSquintL':
    case 'cheekSquintR': {
      const isLeft = muscleName === 'cheekSquintL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 3.25, 0.35, 5.2), new Vec3(2.2, 1.65, 2.8));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.22 * w, 0.65 * w, 0.42 * w);
      }
      break;
    }

    case 'noseSneerL':
    case 'noseSneerR': {
      const isLeft = muscleName === 'noseSneerL';
      const signX = isLeft ? -1 : 1;
      const wWing = regionFalloff(pos, new Vec3(signX * 1.12, -0.95, 6.6), new Vec3(1.15, 1.05, 2.2));
      const wLip = regionFalloff(pos, new Vec3(signX * 1.18, -2.25, 6.8), new Vec3(1.25, 0.95, 2.2));
      const w = Math.max(wWing, wLip * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.28 * wWing, 0.78 * w, 0.22 * w);
      }
      break;
    }

    case 'jawOpen': {
      const wLowerLip = regionFalloff(pos, new Vec3(0, -3.75, 6.6), new Vec3(2.8, 1.35, 3.0));
      const wChin = regionFalloff(pos, new Vec3(0, -5.65, 5.2), new Vec3(3.8, 2.2, 4.2));
      const wCorners = symmetricFalloff(pos, new Vec3(1.98, -3.12, 6.2), new Vec3(1.05, 0.95, 2.0));
      const w = Math.min(1.0, Math.max(wLowerLip, wChin * 0.92) + wCorners * 0.35);
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.04 * w, -1.95 * w, -0.48 * w);
      }
      break;
    }

    case 'jawForward': {
      const w = regionFalloff(pos, new Vec3(0, -5.1, 5.2), new Vec3(4.2, 2.5, 4.2));
      if (w > 0.002) {
        outDelta.setScalar(0, 0.10 * w, 0.95 * w);
      }
      break;
    }

    case 'jawLeft':
    case 'jawRight': {
      const dir = muscleName === 'jawLeft' ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(0, -5.1, 5.2), new Vec3(4.2, 2.5, 4.2));
      if (w > 0.002) {
        outDelta.setScalar(dir * 0.95 * w, 0, 0);
      }
      break;
    }

    case 'mouthSmileL':
    case 'mouthSmileR': {
      const isLeft = muscleName === 'mouthSmileL';
      const signX = isLeft ? -1 : 1;
      const wCorner = regionFalloff(pos, new Vec3(signX * 1.92, -3.08, 6.3), new Vec3(1.55, 1.25, 2.4));
      const wCheek = regionFalloff(pos, new Vec3(signX * 3.15, -1.15, 5.3), new Vec3(1.95, 1.55, 2.6));
      if (wCorner > 0.002 || wCheek > 0.002) {
        outDelta.setScalar(
          signX * (0.78 * wCorner + 0.28 * wCheek),
          0.95 * wCorner + 0.45 * wCheek,
          -0.22 * wCorner + 0.32 * wCheek
        );
      }
      break;
    }

    case 'mouthFrownL':
    case 'mouthFrownR': {
      const isLeft = muscleName === 'mouthFrownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.98, -3.22, 6.2), new Vec3(1.55, 1.32, 2.4));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.22 * w, -0.92 * w, -0.12 * w);
      }
      break;
    }

    case 'mouthPucker': {
      const w = regionFalloff(pos, new Vec3(0, -3.10, 6.6), new Vec3(2.6, 1.48, 2.6));
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.38 * w, 0, 0.88 * w);
      }
      break;
    }

    case 'mouthFunnel': {
      const w = regionFalloff(pos, new Vec3(0, -3.10, 6.6), new Vec3(2.5, 1.48, 2.6));
      if (w > 0.002) {
        const dy = pos.y - -3.10;
        const vertPart = dy >= 0 ? 0.45 : -0.55;
        outDelta.setScalar(-pos.x * 0.24 * w, vertPart * w, 0.78 * w);
      }
      break;
    }

    case 'mouthUpperUpL':
    case 'mouthUpperUpR': {
      const isLeft = muscleName === 'mouthUpperUpL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.05, -2.55, 6.8), new Vec3(1.25, 0.92, 2.3));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.14 * w, 0.82 * w, 0.20 * w);
      }
      break;
    }

    case 'mouthLowerDownL':
    case 'mouthLowerDownR': {
      const isLeft = muscleName === 'mouthLowerDownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.05, -3.65, 6.6), new Vec3(1.32, 0.95, 2.3));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.18 * w, -0.80 * w, 0.22 * w);
      }
      break;
    }

    case 'mouthShrugUpper': {
      const wLip = regionFalloff(pos, new Vec3(0, -3.15, 6.8), new Vec3(2.1, 1.25, 2.4));
      const wChin = regionFalloff(pos, new Vec3(0, -5.5, 6.2), new Vec3(2.1, 1.5, 2.4));
      const w = Math.max(wLip, wChin * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(0, 0.65 * w, 0.28 * wLip - 0.12 * wChin);
      }
      break;
    }

    case 'mouthPress': {
      const w = regionFalloff(pos, new Vec3(0, -3.10, 6.8), new Vec3(2.3, 1.15, 2.4));
      if (w > 0.002) {
        const dy = pos.y - -3.10;
        outDelta.setScalar(0, -dy * 0.45 * w, -0.35 * w);
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
