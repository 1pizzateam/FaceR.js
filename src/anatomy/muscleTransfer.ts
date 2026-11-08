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
import { IBaseHeadTopology, HAIR_CAP_VERTEX_COUNT, computeSmoothNormals } from './baseHead';

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
 * Compute the UV-invariant eyelid opening / eyelash weight `[0, 1]` for a `skin` vertex `(u, v)`.
 * Maintains a flat `1.0` plateau across the eyelid opening, upper eyelid tarsal plate, supra-tarsal
 * crease, and painted eyelashes (`yHead <= 2.385`) while staying strictly zero on the nose bridge and eyebrow bed.
 */
function computeUvEyeHoleWeight(u: number, v: number): number {
  if (v >= 0.74) return 0;
  const uGrid = (u - 0.5) / 0.48;
  const absU = Math.abs(uGrid);
  const sv = Utils.clamp((0.74 - v) / 0.72, 0.0, 1.0);
  const yHead = -11.0 + sv * 21.5;

  const wMedial = Utils.smoothstep(0.048, 0.058, absU);
  const wLateral = Utils.smoothstep(0.200, 0.178, absU);
  const wBrow = Utils.smoothstep(2.445, 2.385, yHead);
  const wLower = Utils.smoothstep(1.12, 1.48, yHead);
  const du = (absU - 0.116) / 0.078;
  const dy = (yHead - 1.95) / 0.78;
  const wEllipse = Utils.smoothstep(1.25, 0.82, Math.hypot(du, dy));
  return wMedial * wLateral * wBrow * wLower * wEllipse;
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
  const uvs = baseHead.uvs;
  const regionMap = baseHead.vertexRegionMap;
  const vertexCount = baseHead.vertexCount;

  const basePivots = baseHead.pivots;
  const eyeAbsX = 2.1;
  const eyeY = 1.864;
  const eyeSurfaceZ = 5.25;

  const p = new Vec3();
  const cJaw = new Vec3(4.1, -3.2, 2.2);
  const rJaw = new Vec3(4.0, 3.2, 4.5);
  const cChin = new Vec3(0, -4.25, 6.0);
  const rChin = new Vec3(2.6, 1.9, 3.2);
  const cCheek = new Vec3(3.6, 0.45, 4.8);
  const rCheek = new Vec3(2.6, 2.3, 3.4);
  const cBrow = new Vec3(eyeAbsX, 2.85, 5.6);
  const rBrow = new Vec3(3.0, 1.4, 3.0);
  const cEye = new Vec3(eyeAbsX, eyeY, 5.1);
  const rEye = new Vec3(1.35, 0.65, 2.2);
  const cNose = new Vec3(0, -0.25, 7.0);
  const rNose = new Vec3(1.8, 2.3, 3.2);
  const cMouth = new Vec3(0, -2.25, 6.3);
  const rMouth = new Vec3(2.8, 1.7, 3.0);
  const cEar = new Vec3(5.88, 1.05, -1.5);
  const rEar = new Vec3(1.9, 2.7, 2.4);

  p.setScalar(eyeAbsX, eyeY, eyeSurfaceZ);
  const wEyeCheek = symmetricFalloff(p, cCheek, rCheek);
  const wEyeBrow = symmetricFalloff(p, cBrow, rBrow);
  const eyeDx = proportions.eyeSocketOffset.x + wEyeCheek * proportions.cheekboneOffset.x + wEyeBrow * proportions.browOffset.x;
  const eyeDy = proportions.eyeSocketOffset.y;
  const eyeDz = proportions.eyeSocketOffset.z + wEyeCheek * proportions.cheekboneOffset.z + wEyeBrow * proportions.browOffset.z;

  outPivots.neck.copy(basePivots.neck);
  outPivots.jaw.setScalar(
    basePivots.jaw.x,
    basePivots.jaw.y * proportions.jawScale.y,
    basePivots.jaw.z * proportions.jawScale.z
  );
  outPivots.eyeLeft.setScalar(
    basePivots.eyeLeft.x - eyeDx,
    basePivots.eyeLeft.y + eyeDy,
    basePivots.eyeLeft.z + eyeDz
  );
  outPivots.eyeRight.setScalar(
    basePivots.eyeRight.x + eyeDx,
    basePivots.eyeRight.y + eyeDy,
    basePivots.eyeRight.z + eyeDz
  );

  const smBrows = baseHead.submeshes.find(sm => sm.name === 'browsHair');
  const hairStartVertex =
    smBrows && smBrows.vertexCount >= HAIR_CAP_VERTEX_COUNT
      ? smBrows.startVertex + smBrows.vertexCount - HAIR_CAP_VERTEX_COUNT
      : vertexCount;

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    p.setScalar(srcPos[idx], srcPos[idx + 1], srcPos[idx + 2]);
    const region = regionMap[i];
    const signX = p.x >= 0 ? 1 : -1;

    if (region === FACE_REGION_IDS.eyeLeft) {
      p.x -= eyeDx;
      p.y += eyeDy;
      p.z += eyeDz;
    } else if (region === FACE_REGION_IDS.eyeRight) {
      p.x += eyeDx;
      p.y += eyeDy;
      p.z += eyeDz;
    } else if (region === FACE_REGION_IDS.browsHair && i < hairStartVertex) {
      const upperMask = Utils.smoothstep(2.1, 4.5, p.y);
      p.x *= Utils.lerp(1.0, proportions.craniumScale.x, upperMask);
      if (p.y > 0) {
        p.y *= Utils.lerp(1.0, proportions.craniumScale.y, upperMask);
      }
      p.z *= Utils.lerp(1.0, proportions.craniumScale.z, upperMask);

      const wBrow = Math.max(0.75, symmetricFalloff(p, cBrow, rBrow));
      p.x += signX * proportions.browOffset.x * wBrow;
      p.y += proportions.browOffset.y * wBrow;
      p.z += proportions.browOffset.z * wBrow;
    } else if (region === FACE_REGION_IDS.browsHair && i >= hairStartVertex) {
      const upperMask = Utils.smoothstep(2.1, 4.5, p.y);
      const lowerMask = Utils.smoothstep(1.0, -2.5, p.y) * Utils.smoothstep(-5.8, -4.4, p.y);
      p.x *= Utils.lerp(1.0, proportions.craniumScale.x, upperMask);
      if (p.y > 0) {
        p.y *= Utils.lerp(1.0, proportions.craniumScale.y, upperMask);
      }
      p.z *= Utils.lerp(1.0, proportions.craniumScale.z, upperMask);

      const wJaw = Math.max(lowerMask * 0.65, symmetricFalloff(p, cJaw, rJaw));
      p.x *= Utils.lerp(1.0, proportions.jawScale.x, wJaw);
      if (p.y < 0 && p.y > -5.8) {
        p.y *= Utils.lerp(1.0, proportions.jawScale.y, wJaw * 0.65);
      }
      p.z *= Utils.lerp(1.0, proportions.jawScale.z, wJaw * 0.55);

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

      const wEar = symmetricFalloff(p, cEar, rEar);
      if (wEar > 0) {
        p.y += (p.y - 1.05) * (proportions.earScale.y - 1.0) * wEar;
        p.z += (proportions.earScale.z - 1.0) * 0.9 * wEar;
      }
    } else if (
      region === FACE_REGION_IDS.teethUpper ||
      region === FACE_REGION_IDS.teethLower ||
      region === FACE_REGION_IDS.mouthInner
    ) {
      p.x *= Utils.lerp(1.0, proportions.mouthScale.x, 0.65);
      p.y += (proportions.jawScale.y - 1.0) * -1.4;
      p.z += (proportions.mouthScale.z - 1.0) * 1.1;
    } else {
      const upperMask = Utils.smoothstep(2.1, 4.5, p.y);
      const lowerMask = Utils.smoothstep(1.0, -2.5, p.y) * Utils.smoothstep(-5.8, -4.4, p.y);

      p.x *= Utils.lerp(1.0, proportions.craniumScale.x, upperMask);
      if (p.y > 0) {
        p.y *= Utils.lerp(1.0, proportions.craniumScale.y, upperMask);
      }
      p.z *= Utils.lerp(1.0, proportions.craniumScale.z, upperMask);

      const wJaw = Math.max(lowerMask * 0.65, symmetricFalloff(p, cJaw, rJaw));
      p.x *= Utils.lerp(1.0, proportions.jawScale.x, wJaw);
      if (p.y < 0 && p.y > -5.8) {
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

      const absX = Math.abs(p.x);
      const wEye3d =
        symmetricFalloff(p, cEye, rEye) *
        Utils.smoothstep(0.92, 1.32, absX) *
        Utils.smoothstep(2.44, 2.28, p.y) *
        Utils.smoothstep(1.12, 1.48, p.y);
      const wEyeUv = uvs ? computeUvEyeHoleWeight(uvs[i * 2], uvs[i * 2 + 1]) : 0;
      const wEye = Math.max(wEye3d, wEyeUv);
      if (wEye > 0) {
        p.x += signX * proportions.eyeSocketOffset.x * wEye;
        p.y += proportions.eyeSocketOffset.y * wEye;
        p.z += proportions.eyeSocketOffset.z * wEye;
      }

      const wNose = regionFalloff(p, cNose, rNose);
      if (wNose > 0) {
        p.x *= Utils.lerp(1.0, proportions.noseScale.x, wNose);
        p.y += (proportions.noseScale.y - 1.0) * -0.95 * wNose;
        p.z += (proportions.noseScale.z - 1.0) * 1.75 * wNose;
      }

      const wMouth = regionFalloff(p, cMouth, rMouth);
      if (wMouth > 0) {
        p.x *= Utils.lerp(1.0, proportions.mouthScale.x, wMouth);
        p.y += (p.y + 2.25) * (proportions.mouthScale.y - 1.0) * wMouth;
        p.z += (proportions.mouthScale.z - 1.0) * 1.35 * wMouth;
      }

      const wEar = symmetricFalloff(p, cEar, rEar);
      if (wEar > 0) {
        p.x += signX * (proportions.earScale.x - 1.0) * 1.2 * wEar;
        p.y += (p.y - 1.05) * (proportions.earScale.y - 1.0) * wEar;
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
  jawW: number,
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
    if (region === FACE_REGION_IDS.mouthInner && jawW < 0.4) {
      return;
    }
    switch (muscleName) {
      case 'jawOpen':
        outDelta.setScalar(0, -1.45, -0.35);
        return;
      case 'jawForward':
        outDelta.setScalar(0, 0, 0.85);
        return;
      case 'jawLeft':
        outDelta.setScalar(-0.85, 0, 0);
        return;
      case 'jawRight':
        outDelta.setScalar(0.85, 0, 0);
        return;
      default:
        return;
    }
  }

  const eyeL = pivots.eyeLeft;
  const eyeR = pivots.eyeRight;
  const upperLipMask = Utils.clamp(1.0 - jawW * 1.25, 0.0, 1.0);
  const lowerLipMask = Utils.clamp(jawW * 1.25, 0.0, 1.0);

  switch (muscleName) {
    case 'browInnerUp': {
      const wL = regionFalloff(pos, new Vec3(eyeL.x * 0.45, eyeL.y + 1.05, eyeL.z + 1.75), new Vec3(1.55, 1.15, 2.3));
      const wR = regionFalloff(pos, new Vec3(eyeR.x * 0.45, eyeR.y + 1.05, eyeR.z + 1.75), new Vec3(1.55, 1.15, 2.3));
      const w = Math.min(1.1, wL + wR);
      if (w > 0.002) {
        outDelta.setScalar(0, 0.78 * w, 0.14 * w);
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
      const w = regionFalloff(pos, new Vec3(ex * 0.85, ey + 0.98, ez + 1.65), new Vec3(1.95, 1.05, 2.3));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.38 * w, -0.72 * w, 0.20 * w);
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
      const w = regionFalloff(pos, new Vec3(ex * 1.32, ey + 0.95, ez + 1.15), new Vec3(1.65, 1.08, 2.3));
      if (w > 0.002) {
        outDelta.setScalar(latSign * 0.14 * w, 0.82 * w, 0.10 * w);
      }
      break;
    }

    case 'eyeBlinkL':
    case 'eyeBlinkR': {
      if (region === FACE_REGION_IDS.browsHair) break;
      const isLeft = muscleName === 'eyeBlinkL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeR.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const upperGate = Utils.smoothstep(ey - 0.04, ey + 0.10, pos.y);
      const lowerGate = Utils.smoothstep(ey + 0.04, ey - 0.10, pos.y);
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.28, ez + 1.25), new Vec3(1.25, 0.42, 1.6)) * upperGate;
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.28, ez + 1.20), new Vec3(1.22, 0.38, 1.6)) * lowerGate;
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, -0.52 * wUpper + 0.18 * wLower, 0.14 * wUpper + 0.08 * wLower);
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
      const w = regionFalloff(pos, new Vec3(ex * 1.05, ey - 0.32, ez + 1.15), new Vec3(1.55, 0.72, 2.0));
      if (w > 0.002) {
        outDelta.setScalar(medialSign * 0.16 * w, 0.44 * w, 0.16 * w);
      }
      break;
    }

    case 'eyeWideL':
    case 'eyeWideR': {
      if (region === FACE_REGION_IDS.browsHair) break;
      const isLeft = muscleName === 'eyeWideL';
      const ex = isLeft ? eyeL.x : eyeR.x;
      const ey = isLeft ? eyeL.y : eyeR.y;
      const ez = isLeft ? eyeL.z : eyeR.z;
      const upperGate = Utils.smoothstep(ey - 0.04, ey + 0.10, pos.y);
      const lowerGate = Utils.smoothstep(ey + 0.04, ey - 0.10, pos.y);
      const wUpper = regionFalloff(pos, new Vec3(ex, ey + 0.28, ez + 1.25), new Vec3(1.25, 0.45, 1.6)) * upperGate;
      const wLower = regionFalloff(pos, new Vec3(ex, ey - 0.28, ez + 1.20), new Vec3(1.22, 0.38, 1.6)) * lowerGate;
      if (wUpper > 0.002 || wLower > 0.002) {
        outDelta.setScalar(0, 0.38 * wUpper - 0.14 * wLower, -0.08 * wUpper);
      }
      break;
    }

    case 'cheekSquintL':
    case 'cheekSquintR': {
      const isLeft = muscleName === 'cheekSquintL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 2.85, 0.45, 5.0), new Vec3(1.95, 1.45, 2.5));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.18 * w, 0.54 * w, 0.34 * w);
      }
      break;
    }

    case 'noseSneerL':
    case 'noseSneerR': {
      const isLeft = muscleName === 'noseSneerL';
      const signX = isLeft ? -1 : 1;
      const wWing = regionFalloff(pos, new Vec3(signX * 1.12, -0.78, 6.25), new Vec3(1.05, 0.95, 2.0));
      const wLip = regionFalloff(pos, new Vec3(signX * 1.05, -1.78, 6.50), new Vec3(1.15, 0.85, 2.0)) * upperLipMask;
      const w = Math.max(wWing, wLip * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.22 * wWing, 0.62 * w, 0.18 * w);
      }
      break;
    }

    case 'jawOpen': {
      const wLowerLip = regionFalloff(pos, new Vec3(0, -2.65, 6.3), new Vec3(2.4, 1.25, 2.8)) * lowerLipMask;
      const wChin = regionFalloff(pos, new Vec3(0, -4.35, 5.2), new Vec3(3.5, 2.0, 4.0)) * lowerLipMask;
      const wCorners = symmetricFalloff(pos, new Vec3(1.68, -2.33, 5.86), new Vec3(0.95, 0.85, 1.8)) * 0.45;
      const w = Math.min(1.0, Math.max(wLowerLip, wChin * 0.95, wCorners));
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.04 * w, -1.45 * w, -0.36 * w);
      }
      break;
    }

    case 'jawForward': {
      const w = regionFalloff(pos, new Vec3(0, -3.95, 5.0), new Vec3(3.8, 2.2, 4.0)) * lowerLipMask;
      if (w > 0.002) {
        outDelta.setScalar(0, 0.08 * w, 0.85 * w);
      }
      break;
    }

    case 'jawLeft':
    case 'jawRight': {
      const dir = muscleName === 'jawLeft' ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(0, -3.95, 5.0), new Vec3(3.8, 2.2, 4.0)) * lowerLipMask;
      if (w > 0.002) {
        outDelta.setScalar(dir * 0.85 * w, 0, 0);
      }
      break;
    }

    case 'mouthSmileL':
    case 'mouthSmileR': {
      const isLeft = muscleName === 'mouthSmileL';
      const signX = isLeft ? -1 : 1;
      const wCorner = regionFalloff(pos, new Vec3(signX * 1.68, -2.28, 5.86), new Vec3(1.38, 1.10, 2.2));
      const wCheek = regionFalloff(pos, new Vec3(signX * 2.75, -0.75, 5.10), new Vec3(1.75, 1.35, 2.4));
      if (wCorner > 0.002 || wCheek > 0.002) {
        outDelta.setScalar(
          signX * (0.68 * wCorner + 0.24 * wCheek),
          0.78 * wCorner + 0.38 * wCheek,
          -0.18 * wCorner + 0.26 * wCheek
        );
      }
      break;
    }

    case 'mouthFrownL':
    case 'mouthFrownR': {
      const isLeft = muscleName === 'mouthFrownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 1.72, -2.38, 5.86), new Vec3(1.38, 1.15, 2.2));
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.18 * w, -0.76 * w, -0.10 * w);
      }
      break;
    }

    case 'mouthPucker': {
      const w = regionFalloff(pos, new Vec3(0, -2.25, 6.25), new Vec3(2.3, 1.32, 2.4));
      if (w > 0.002) {
        outDelta.setScalar(-pos.x * 0.36 * w, 0, 0.72 * w);
      }
      break;
    }

    case 'mouthFunnel': {
      const w = regionFalloff(pos, new Vec3(0, -2.25, 6.25), new Vec3(2.2, 1.32, 2.4));
      if (w > 0.002) {
        const vertPart = upperLipMask > 0.5 ? 0.36 * upperLipMask : -0.44 * lowerLipMask;
        outDelta.setScalar(-pos.x * 0.22 * w, vertPart * w, 0.65 * w);
      }
      break;
    }

    case 'mouthUpperUpL':
    case 'mouthUpperUpR': {
      const isLeft = muscleName === 'mouthUpperUpL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 0.92, -1.85, 6.50), new Vec3(1.12, 0.82, 2.1)) * upperLipMask;
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.12 * w, 0.68 * w, 0.16 * w);
      }
      break;
    }

    case 'mouthLowerDownL':
    case 'mouthLowerDownR': {
      const isLeft = muscleName === 'mouthLowerDownL';
      const signX = isLeft ? -1 : 1;
      const w = regionFalloff(pos, new Vec3(signX * 0.92, -2.65, 6.35), new Vec3(1.18, 0.85, 2.1)) * lowerLipMask;
      if (w > 0.002) {
        outDelta.setScalar(signX * 0.15 * w, -0.68 * w, 0.18 * w);
      }
      break;
    }

    case 'mouthShrugUpper': {
      const wLip = regionFalloff(pos, new Vec3(0, -2.25, 6.35), new Vec3(1.9, 1.15, 2.2));
      const wChin = regionFalloff(pos, new Vec3(0, -4.25, 6.0), new Vec3(1.9, 1.35, 2.2));
      const w = Math.max(wLip, wChin * 0.85);
      if (w > 0.002) {
        outDelta.setScalar(0, 0.54 * w, 0.22 * wLip - 0.10 * wChin);
      }
      break;
    }

    case 'mouthPress': {
      const w = regionFalloff(pos, new Vec3(0, -2.25, 6.35), new Vec3(2.0, 1.05, 2.2));
      if (w > 0.002) {
        const dy = pos.y - -2.25;
        outDelta.setScalar(0, -dy * 0.42 * w, -0.28 * w);
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
  pivots: IFacePivots,
  jawWeights?: Float32Array
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

    const nonHairLimit = Math.max(0, vertexCount - HAIR_CAP_VERTEX_COUNT);
    for (let i = 0; i < nonHairLimit; i++) {
      const idx = i * 3;
      posVec.setScalar(positions[idx], positions[idx + 1], positions[idx + 2]);
      const jw = jawWeights ? jawWeights[i] : Utils.smoothstep(-2.15, -2.55, posVec.y);
      evaluateSingleMuscleDisplacement(muscleName, posVec, vertexRegionMap[i], jw, pivots, deltaVec);

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
