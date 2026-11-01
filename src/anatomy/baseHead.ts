import { CustomMesh } from '@1pizzateam/roostr';
import { Trigo, Utils, Vec2, Vec3 } from '@1pizzateam/spock';
import type { IFacePivots, ISubmeshRange, SubmeshRegionName } from '../interfaces';

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
const scratchUv = new Vec2();
const scratchCenter = new Vec3();

/**
 * Evaluate a smooth 3D radial Gaussian lobe on the head surface using Vec3 distance.
 */
function gaussianLobe(pos: Vec3, center: Vec3, radii: Vec3): number {
  const dx = (pos.x - center.x) / radii.x;
  const dy = (pos.y - center.y) / radii.y;
  const dz = (pos.z - center.z) / radii.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 9.0) return 0;
  return Math.exp(-d2);
}

/**
 * Symmetric Gaussian lobe across +/- center.x.
 */
function symmetricLobe(pos: Vec3, absCenter: Vec3, radii: Vec3): number {
  scratchCenter.setScalar(-absCenter.x, absCenter.y, absCenter.z);
  const left = gaussianLobe(pos, scratchCenter, radii);
  scratchCenter.setScalar(absCenter.x, absCenter.y, absCenter.z);
  const right = gaussianLobe(pos, scratchCenter, radii);
  return left + right;
}

/**
 * Deform a spherical/cylindrical grid point into an anatomical human head surface.
 */
function shapeAnatomicalHeadPoint(u: number, v: number, target: Vec3): number {
  // u in [-1, 1] wraps azimuth around Y (0 = front +Z, +/-1 = back -Z)
  // v in [0, 1] goes from base of neck (0) to crown of cranium (1)
  const azimuth = u * Trigo.pi;
  const sinAz = Trigo.sinePrecise(azimuth);
  const cosAz = Trigo.cosinePrecise(azimuth);

  // Height y in [-11.5, +13.5]
  const y = Utils.lerp(-11.5, 13.5, v);

  // Base cranial/neck profile radii (width X, depth Z)
  let rx = 7.6;
  let rz = 8.8;
  let zCenter = -0.6;

  if (v < 0.18) {
    // Neck cylinder flaring into trapezius/jaw base
    const t = Utils.normalize(v, 0, 0.18);
    const s = Utils.smoothstep(0, 1, t);
    rx = Utils.lerp(4.4, 6.4, s);
    rz = Utils.lerp(4.6, 6.6, s);
    zCenter = Utils.lerp(-1.8, -0.8, s);
  } else if (v < 0.52) {
    // Lower face: jaw, chin, mouth, cheeks
    const t = Utils.normalize(v, 0.18, 0.52);
    const s = Utils.smoothstep(0, 1, t);
    rx = Utils.lerp(6.0, 7.65, s);
    rz = Utils.lerp(6.8, 8.6, s);
    zCenter = Utils.lerp(-0.5, -0.3, s);
  } else if (v < 0.78) {
    // Mid-to-upper face: orbits, temples, forehead
    const t = Utils.normalize(v, 0.52, 0.78);
    rx = Utils.lerp(7.65, 7.45, t);
    rz = Utils.lerp(8.6, 8.95, t);
    zCenter = Utils.lerp(-0.3, -0.75, t);
  } else {
    // Cranial dome closing cleanly at the crown
    const t = Utils.normalize(v, 0.78, 1.0);
    const dome = Trigo.cosinePrecise(t * Trigo.halfpi);
    const softDome = Math.pow(Math.max(0, dome), 0.72);
    rx = 7.45 * softDome;
    rz = 8.95 * softDome;
    zCenter = Utils.lerp(-0.75, -1.1, t);
  }

  target.setScalar(sinAz * rx, y, zCenter + cosAz * rz);

  // Only sculpt facial features on the anterior hemisphere (cosAz > -0.25)
  const frontMask = Utils.smoothstep(-0.2, 0.25, cosAz);
  if (frontMask > 0) {
    // 1. Jawline & Gonion (mandible angle)
    const jawAngleLobe = symmetricLobe(target, new Vec3(5.6, -4.8, 1.2), new Vec3(2.8, 2.8, 3.2));
    target.x += Math.sign(target.x) * jawAngleLobe * 0.85 * frontMask;
    target.y -= jawAngleLobe * 0.45 * frontMask;

    // Taper lower jaw toward chin
    const chinTaper = Utils.smoothstep(-1.5, -7.2, y) * Utils.smoothstep(-10.0, -7.0, y);
    target.x *= 1.0 - chinTaper * 0.22 * Math.max(0, cosAz);

    // 2. Chin prominence (Mentalis) & sub-labial crease
    const chinLobe = gaussianLobe(target, new Vec3(0, -7.0, 6.2), new Vec3(2.4, 1.7, 3.0));
    const chinCleft = gaussianLobe(target, new Vec3(0, -7.2, 6.8), new Vec3(0.45, 1.2, 2.0));
    const subLabial = gaussianLobe(target, new Vec3(0, -5.3, 6.5), new Vec3(2.2, 0.75, 2.5));
    target.z += (chinLobe * 1.45 - chinCleft * 0.28 - subLabial * 0.55) * frontMask;
    target.y -= chinLobe * 0.35 * frontMask;

    // 3. Zygomatic arch & Cheekbones
    const cheekLobe = symmetricLobe(target, new Vec3(4.6, 0.2, 4.8), new Vec3(2.6, 2.4, 3.4));
    const buccalHollow = symmetricLobe(target, new Vec3(4.8, -3.2, 3.8), new Vec3(2.1, 2.2, 2.8));
    target.x += Math.sign(target.x) * (cheekLobe * 0.9 - buccalHollow * 0.42) * frontMask;
    target.z += (cheekLobe * 0.95 - buccalHollow * 0.45) * frontMask;

    // 4. Supraorbital Brow Ridge & Glabella
    const browRidge = symmetricLobe(target, new Vec3(2.8, 4.1, 6.8), new Vec3(2.8, 1.05, 2.8));
    const glabella = gaussianLobe(target, new Vec3(0, 4.0, 7.2), new Vec3(1.3, 1.1, 2.6));
    target.z += (browRidge * 1.35 + glabella * 0.95) * frontMask;
    target.y -= browRidge * 0.22 * frontMask;

    // 5. Orbital Eye Sockets & Eyelid Clefts (centered at +/- 2.85, +2.35, +5.8)
    const eyeSocket = symmetricLobe(target, new Vec3(2.85, 2.35, 6.8), new Vec3(1.95, 1.45, 3.2));
    const upperLidRim = symmetricLobe(target, new Vec3(2.85, 3.05, 6.8), new Vec3(1.75, 0.42, 2.5));
    const lowerLidRim = symmetricLobe(target, new Vec3(2.85, 1.62, 6.8), new Vec3(1.70, 0.38, 2.5));
    const palpebralFissure = symmetricLobe(target, new Vec3(2.85, 2.35, 6.8), new Vec3(1.48, 0.48, 2.8));
    target.z -= eyeSocket * 1.75 * frontMask;
    target.z += (upperLidRim * 0.72 + lowerLidRim * 0.52) * frontMask;
    // Open the eyelid aperture slightly so the eyeball sphere peeks through cleanly
    if (palpebralFissure > 0.15) {
      const dyEye = target.y - 2.35;
      target.y += (dyEye >= 0 ? 1 : -1) * palpebralFissure * 0.48 * frontMask;
      target.z -= palpebralFissure * 0.85 * frontMask;
    }

    // 6. Nasal Bridge, Dorsum, Tip, and Alar Wings (Nostrils)
    const noseBridge = gaussianLobe(target, new Vec3(0, 2.2, 7.2), new Vec3(0.95, 1.8, 3.0));
    const noseTip = gaussianLobe(target, new Vec3(0, 0.05, 7.6), new Vec3(1.15, 1.15, 3.2));
    const noseWings = symmetricLobe(target, new Vec3(1.15, -0.35, 7.0), new Vec3(0.85, 0.78, 2.5));
    const philtrum = gaussianLobe(target, new Vec3(0, -1.55, 7.2), new Vec3(0.55, 0.85, 2.4));
    target.z += (noseBridge * 1.85 + noseTip * 2.65 + noseWings * 1.25 - philtrum * 0.35) * frontMask;
    target.y -= noseTip * 0.25 * frontMask;
    target.x += Math.sign(target.x) * noseWings * 0.38 * frontMask;

    // 7. Oral Muzzle, Upper/Lower Vermilion Lips, and Oral Stomion Cleft
    const muzzleMound = gaussianLobe(target, new Vec3(0, -3.2, 6.8), new Vec3(3.1, 1.85, 3.0));
    const upperLip = gaussianLobe(target, new Vec3(0, -2.55, 7.4), new Vec3(2.25, 0.58, 2.6));
    const cupidsBow = gaussianLobe(target, new Vec3(0, -2.25, 7.6), new Vec3(0.45, 0.45, 2.0));
    const lowerLip = gaussianLobe(target, new Vec3(0, -3.85, 7.3), new Vec3(2.05, 0.65, 2.6));
    const mouthSlit = gaussianLobe(target, new Vec3(0, -3.20, 7.4), new Vec3(2.15, 0.36, 2.8));
    const mouthCorners = symmetricLobe(target, new Vec3(2.35, -3.25, 6.4), new Vec3(0.68, 0.62, 2.2));

    target.z += (muzzleMound * 0.65 + upperLip * 0.92 + lowerLip * 0.88 - cupidsBow * 0.22 - mouthCorners * 0.55) * frontMask;
    if (mouthSlit > 0.1) {
      const dyMouth = target.y - (-3.20);
      target.y += (dyMouth >= 0 ? 1 : -1) * mouthSlit * 0.18 * frontMask;
      target.z -= mouthSlit * 0.95 * frontMask;
    }
  }

  // 8. Ears (Pinna) on the lateral sides (|u| around 0.46)
  const earLobe = symmetricLobe(target, new Vec3(7.4, 1.2, -0.8), new Vec3(1.2, 2.2, 1.45));
  if (earLobe > 0.05) {
    target.x += Math.sign(target.x) * earLobe * 1.15;
    target.z -= earLobe * 0.35;
  }

  // Compute jaw influence weight in [0, 1] for this vertex
  let jawWeight = 0;
  if (y < -1.0 && v > 0.14) {
    const verticalJaw = Utils.smoothstep(-1.2, -5.8, y) * Utils.smoothstep(-9.8, -6.5, y);
    const forwardJaw = Utils.smoothstep(-2.5, 3.5, target.z);
    jawWeight = Utils.clamp(verticalJaw * forwardJaw, 0, 1);
    // Split sharply across the mouth opening at y = -3.20
    const mouthCenterLobe = gaussianLobe(target, new Vec3(0, -3.20, 7.0), new Vec3(2.6, 1.5, 3.2));
    if (mouthCenterLobe > 0.1) {
      const lowerLipFactor = Utils.smoothstep(-2.95, -3.45, y);
      jawWeight = Utils.lerp(jawWeight, lowerLipFactor, Utils.clamp(mouthCenterLobe * 1.2, 0, 1));
    }
  }

  return jawWeight;
}

/**
 * Append a UV sphere submesh (used for Left and Right Eyeballs) centered at `center`.
 */
function appendEyeballSphere(
  center: Vec3,
  radius: number,
  uvOffset: Vec2,
  uvScale: Vec2,
  regionName: SubmeshRegionName,
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  const segU = 20;
  const segV = 14;
  const startVertex = positions.length / 3;
  const startIndex = indices.length;

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    // Polar angle from front pole (+Z) to back pole (-Z) so the iris sits cleanly at the +Z pole
    const phi = v * Trigo.pi;
    const sinPhi = Trigo.sinePrecise(phi);
    const cosPhi = Trigo.cosinePrecise(phi);

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const theta = u * Trigo.twopi;
      const sinTheta = Trigo.sinePrecise(theta);
      const cosTheta = Trigo.cosinePrecise(theta);

      // Slightly bulge the cornea at the front pole (v < 0.28)
      const corneaBulge = v < 0.28 ? Trigo.cosinePrecise((v / 0.28) * Trigo.halfpi) * 0.14 : 0;
      const r = radius + corneaBulge;

      scratchPos.setScalar(
        center.x + r * sinPhi * cosTheta,
        center.y + r * sinPhi * sinTheta,
        center.z + r * cosPhi
      );
      positions.push(scratchPos.x, scratchPos.y, scratchPos.z);

      // Map front pole radially into the eye UV box
      const radial = Math.min(1, v * 1.65);
      scratchUv.setScalar(
        uvOffset.x + (0.5 + 0.48 * radial * cosTheta) * uvScale.x,
        uvOffset.y + (0.5 + 0.48 * radial * sinTheta) * uvScale.y
      );
      uvs.push(scratchUv.x, scratchUv.y);
      vertexRegionMap.push(REGION_ID[regionName]);
      jawWeights.push(0);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = startVertex + iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  submeshes.push({
    name: regionName,
    startIndex,
    indexCount: indices.length - startIndex,
    startVertex,
    vertexCount: positions.length / 3 - startVertex,
  });
}

/**
 * Append a curved dental arch submesh (Upper or Lower Teeth).
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
  const startVertex = positions.length / 3;
  const startIndex = indices.length;
  const archWidth = 2.05;
  const archDepth = 1.65;
  const zFront = 6.15;

  for (let row = 0; row <= 2; row++) {
    const v = row / 2;
    const y = yBase + (row === 1 ? yHeight : 0);
    const zInset = row === 2 ? -0.32 : 0;

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
    vertexCount: positions.length / 3 - startVertex,
  });
}

/**
 * Append inner oral cavity backwall and sculpted 3D eyebrows + hair cap.
 */
function appendMouthInnerAndBrows(
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  // 1. Inner mouth cavity backplate
  const startVertexMouth = positions.length / 3;
  const startIndexMouth = indices.length;
  const mw = 2.2;
  const myTop = -2.1;
  const myBot = -4.4;
  const mz = 5.1;

  const mouthPts = [
    new Vec3(-mw, myTop, mz),
    new Vec3(mw, myTop, mz),
    new Vec3(mw, myBot, mz),
    new Vec3(-mw, myBot, mz),
  ];
  const mouthJaws = [0.0, 0.0, 0.85, 0.85];
  for (let i = 0; i < 4; i++) {
    positions.push(mouthPts[i].x, mouthPts[i].y, mouthPts[i].z);
    uvs.push(0.88 + (i & 1) * 0.08, 0.88 + (i >> 1) * 0.08);
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

  // 2. Sculpted 3D Eyebrow strips (Left & Right) so brow muscles move distinct 3D eyebrows
  const startVertexBrows = positions.length / 3;
  const startIndexBrows = indices.length;
  const segBrow = 10;

  for (const side of [-1, 1]) {
    const baseV = positions.length / 3;
    for (let row = 0; row <= 1; row++) {
      const yOff = row === 0 ? -0.26 : 0.28;
      for (let i = 0; i <= segBrow; i++) {
        const t = i / segBrow;
        // t = 0 is inner brow, t = 1 is outer brow
        const x = side * Utils.lerp(0.95, 4.45, t);
        const arch = Trigo.sinePrecise(t * Trigo.pi) * 0.42;
        const y = 3.95 + arch + yOff * (1 - t * 0.35);
        const z = 8.15 - t * t * 1.28;

        positions.push(x, y, z);
        uvs.push(0.1 + t * 0.3, 0.90 + row * 0.06);
        vertexRegionMap.push(REGION_ID.browsHair);
        jawWeights.push(0);
      }
    }
    const stride = segBrow + 1;
    for (let i = 0; i < segBrow; i++) {
      const a = baseV + i;
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

  submeshes.push({
    name: 'browsHair',
    startIndex: startIndexBrows,
    indexCount: indices.length - startIndexBrows,
    startVertex: startVertexBrows,
    vertexCount: positions.length / 3 - startVertexBrows,
  });
}

/**
 * Generate the complete, high-polygon symmetrical anatomical base head mesh,
 * pivots, submeshes, and smooth normals using RoostR's CustomMesh.computeVertexNormals().
 */
export function buildAnatomicalBaseHead(segU: number = 56, segV: number = 44): IBaseHeadGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexRegionMap: number[] = [];
  const jawWeights: number[] = [];
  const submeshes: ISubmeshRange[] = [];

  // 1. Main Anatomical Head Skin Mesh
  const startSkinVertex = 0;
  const startSkinIndex = 0;

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    // Concentrate horizontal edge loops around the eyes/nose/mouth (v in [0.22, 0.72])
    const vRemapped = Utils.lerp(v, Utils.smoothstep(0, 1, v), 0.25);

    for (let iu = 0; iu <= segU; iu++) {
      const uNorm = iu / segU;
      const u = (uNorm - 0.5) * 2.0; // [-1, 1], with u = 0 on the anterior X=0 symmetry plane

      const jawW = shapeAnatomicalHeadPoint(u, vRemapped, scratchPos);
      positions.push(scratchPos.x, scratchPos.y, scratchPos.z);

      // Map skin UVs into the upper 75% of the texture atlas (v in [0.02, 0.74])
      scratchUv.setScalar(
        Utils.clamp(0.5 + u * 0.48, 0.01, 0.99),
        Utils.clamp(0.74 - vRemapped * 0.72, 0.02, 0.74)
      );
      uvs.push(scratchUv.x, scratchUv.y);
      vertexRegionMap.push(REGION_ID.skin);
      jawWeights.push(jawW);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = startSkinVertex + iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  submeshes.push({
    name: 'skin',
    startIndex: startSkinIndex,
    indexCount: indices.length,
    startVertex: startSkinVertex,
    vertexCount: positions.length / 3,
  });

  // 2. Define the 4 Anatomical Pivots (Vec3)
  const pivots: IFacePivots = {
    neck: new Vec3(0, -8.5, -1.2),
    jaw: new Vec3(0, -1.8, 1.6),
    eyeLeft: new Vec3(-2.85, 2.35, 5.55),
    eyeRight: new Vec3(2.85, 2.35, 5.55),
  };

  // 3. Left & Right Eyeballs (mapped to lower-left UV quadrant)
  appendEyeballSphere(
    pivots.eyeLeft,
    1.38,
    new Vec2(0.02, 0.76),
    new Vec2(0.22, 0.22),
    'eyeLeft',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  appendEyeballSphere(
    pivots.eyeRight,
    1.38,
    new Vec2(0.26, 0.76),
    new Vec2(0.22, 0.22),
    'eyeRight',
    positions,
    uvs,
    indices,
    vertexRegionMap,
    jawWeights,
    submeshes
  );

  // 4. Upper & Lower Dental Arches (Teeth)
  appendDentalArch(
    -2.35,
    -0.68,
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
    -3.95,
    0.68,
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

  // 5. Inner Oral Cavity & 3D Eyebrows
  appendMouthInnerAndBrows(
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
    if (Math.abs(scratchPos.x) < 1e-4) {
      scratchNorm.setArray(normArray, i);
      scratchNorm.x = 0;
      scratchNorm.normalize().toArray(normArray, i);
    }
  }
  return normArray;
}

export const createBaseHeadTopology = buildAnatomicalBaseHead;

let _cachedBaseHead: IBaseHeadGeometry | null = null;

export function getCanonicalBaseHead(): IBaseHeadGeometry {
  if (!_cachedBaseHead) {
    _cachedBaseHead = buildAnatomicalBaseHead();
  }
  return _cachedBaseHead;
}
