import { Vec2, Vec3, Quat, Mat4x3, Utils, Rand } from '@1pizzateam/spock';
import { CustomMesh, Mesh, Texture, Material, PhongShader } from '@1pizzateam/roostr';
import {
  FACS_MUSCLE_NAMES,
  FACE_REGION_IDS,
  IFaceAppearance,
  IFaceCartridge,
  IFacePoseState
} from '../interfaces';

/**
 * Build a 4x3 affine matrix (`Mat4x3`) that rotates around `pivot` (`Vec3`) by `q` (`Quat`).
 */
function buildPivotMatrix(pivot: Vec3, q: Quat, mat: Mat4x3, unitScale: Vec3, negPivot: Vec3): Mat4x3 {
  negPivot.oppositeVector(pivot);
  return mat.compose(pivot, q, unitScale).translate(negPivot);
}

/**
 * Rotate a 3D vector `v` (`Vec3`) in-place by unit quaternion `q` (`Quat`)
 * using Spock's `Quat.multiplyVector`.
 */
export function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3 {
  return q.multiplyVector(v, v);
}

const _unitScale = new Vec3(1, 1, 1);
const _negPivot = new Vec3();
const _eyeLeftMat = new Mat4x3();
const _eyeRightMat = new Mat4x3();
const _jawMat = new Mat4x3();
const _neckMat = new Mat4x3();

/**
 * Evaluate the complete sparse FACS muscle morphs + eyeball, jaw, and neck
 * `Quat` / `Mat4x3` pivot rotations into `outPositions` and `outNormals`.
 * Zero heap allocations per frame.
 */
export function evaluateFaceDeformation(
  cartridge: IFaceCartridge,
  pose: IFacePoseState,
  outPositions: Float32Array,
  outNormals: Float32Array
): void {
  outPositions.set(cartridge.positions);
  outNormals.set(cartridge.normals);

  // 1. Accumulate active sparse FACS muscle deltas (`w > 0.001`)
  const muscles = cartridge.muscles;
  const weights = pose.muscles;

  for (let m = 0; m < FACS_MUSCLE_NAMES.length; m++) {
    const name = FACS_MUSCLE_NAMES[m];
    const w = weights[name];
    if (!w || Math.abs(w) <= 0.001) continue;

    const delta = muscles[name];
    if (!delta) continue;

    const indices = delta.indices;
    const dPos = delta.dPos;
    const dNorm = delta.dNorm;
    const count = indices.length;

    for (let k = 0; k < count; k++) {
      const vIdx = indices[k] * 3;
      const dIdx = k * 3;
      outPositions[vIdx] += dPos[dIdx] * w;
      outPositions[vIdx + 1] += dPos[dIdx + 1] * w;
      outPositions[vIdx + 2] += dPos[dIdx + 2] * w;

      outNormals[vIdx] += dNorm[dIdx] * w;
      outNormals[vIdx + 1] += dNorm[dIdx + 1] * w;
      outNormals[vIdx + 2] += dNorm[dIdx + 2] * w;
    }
  }

  // 2. Precompute 4x3 affine pivot matrices (`Mat4x3`) for eyeball, jaw, and neck rotations
  const vertexCount = (outPositions.length / 3) | 0;
  const regionMap = cartridge.vertexRegionMap;
  const jawWeights = cartridge.jawWeights;
  const pivots = cartridge.pivots;
  const basePositions = cartridge.positions;

  const hasEyeL = pose.eyeLeftQuat.vector.getMagnitude(true) > 1e-8;
  const hasEyeR = pose.eyeRightQuat.vector.getMagnitude(true) > 1e-8;
  const hasJaw = pose.jawQuat.vector.getMagnitude(true) > 1e-8;
  const hasNeck = pose.neckQuat.vector.getMagnitude(true) > 1e-8;

  if (!hasEyeL && !hasEyeR && !hasJaw && !hasNeck) {
    return;
  }

  if (hasEyeL) {
    buildPivotMatrix(pivots.eyeLeft, pose.eyeLeftQuat, _eyeLeftMat, _unitScale, _negPivot);
  }
  if (hasEyeR) {
    buildPivotMatrix(pivots.eyeRight, pose.eyeRightQuat, _eyeRightMat, _unitScale, _negPivot);
  }
  if (hasJaw) {
    buildPivotMatrix(pivots.jaw, pose.jawQuat, _jawMat, _unitScale, _negPivot);
  }
  if (hasNeck) {
    buildPivotMatrix(pivots.neck, pose.neckQuat, _neckMat, _unitScale, _negPivot);
  }

  const elm = _eyeLeftMat.toArray();
  const erm = _eyeRightMat.toArray();
  const jm = _jawMat.toArray();
  const nm = _neckMat.toArray();

  const elm0 = elm[0], elm1 = elm[1], elm2 = elm[2];
  const elm4 = elm[4], elm5 = elm[5], elm6 = elm[6];
  const elm8 = elm[8], elm9 = elm[9], elm10 = elm[10];
  const elm12 = elm[12], elm13 = elm[13], elm14 = elm[14];

  const erm0 = erm[0], erm1 = erm[1], erm2 = erm[2];
  const erm4 = erm[4], erm5 = erm[5], erm6 = erm[6];
  const erm8 = erm[8], erm9 = erm[9], erm10 = erm[10];
  const erm12 = erm[12], erm13 = erm[13], erm14 = erm[14];

  const jm0 = jm[0], jm1 = jm[1], jm2 = jm[2];
  const jm4 = jm[4], jm5 = jm[5], jm6 = jm[6];
  const jm8 = jm[8], jm9 = jm[9], jm10 = jm[10];
  const jm12 = jm[12], jm13 = jm[13], jm14 = jm[14];

  const nm0 = nm[0], nm1 = nm[1], nm2 = nm[2];
  const nm4 = nm[4], nm5 = nm[5], nm6 = nm[6];
  const nm8 = nm[8], nm9 = nm[9], nm10 = nm[10];
  const nm12 = nm[12], nm13 = nm[13], nm14 = nm[14];

  for (let i = 0; i < vertexCount; i++) {
    const region = regionMap[i];
    const jw = jawWeights[i];
    const idx = i * 3;

    const doEyeL = region === FACE_REGION_IDS.eyeLeft && hasEyeL;
    const doEyeR = region === FACE_REGION_IDS.eyeRight && hasEyeR;
    const doJaw = hasJaw && jw > 0.001;

    if (!doEyeL && !doEyeR && !doJaw && !hasNeck) {
      continue;
    }

    let px = outPositions[idx];
    let py = outPositions[idx + 1];
    let pz = outPositions[idx + 2];

    let nx = outNormals[idx];
    let ny = outNormals[idx + 1];
    let nz = outNormals[idx + 2];

    // Eyeball local rotations around eyeLeft / eyeRight pivot
    if (doEyeL) {
      const rx = elm0 * px + elm4 * py + elm8 * pz + elm12;
      const ry = elm1 * px + elm5 * py + elm9 * pz + elm13;
      const rz = elm2 * px + elm6 * py + elm10 * pz + elm14;
      px = rx; py = ry; pz = rz;

      const rnx = elm0 * nx + elm4 * ny + elm8 * nz;
      const rny = elm1 * nx + elm5 * ny + elm9 * nz;
      const rnz = elm2 * nx + elm6 * ny + elm10 * nz;
      nx = rnx; ny = rny; nz = rnz;
    } else if (doEyeR) {
      const rx = erm0 * px + erm4 * py + erm8 * pz + erm12;
      const ry = erm1 * px + erm5 * py + erm9 * pz + erm13;
      const rz = erm2 * px + erm6 * py + erm10 * pz + erm14;
      px = rx; py = ry; pz = rz;

      const rnx = erm0 * nx + erm4 * ny + erm8 * nz;
      const rny = erm1 * nx + erm5 * ny + erm9 * nz;
      const rnz = erm2 * nx + erm6 * ny + erm10 * nz;
      nx = rnx; ny = rny; nz = rnz;
    }

    // Jaw rotation around mandibular condyle pivot weighted by jawWeights[i]
    if (doJaw) {
      const rx = jm0 * px + jm4 * py + jm8 * pz + jm12;
      const ry = jm1 * px + jm5 * py + jm9 * pz + jm13;
      const rz = jm2 * px + jm6 * py + jm10 * pz + jm14;

      const rnx = jm0 * nx + jm4 * ny + jm8 * nz;
      const rny = jm1 * nx + jm5 * ny + jm9 * nz;
      const rnz = jm2 * nx + jm6 * ny + jm10 * nz;

      if (jw >= 0.999) {
        px = rx; py = ry; pz = rz;
        nx = rnx; ny = rny; nz = rnz;
      } else {
        px += (rx - px) * jw;
        py += (ry - py) * jw;
        pz += (rz - pz) * jw;
        nx += (rnx - nx) * jw;
        ny += (rny - ny) * jw;
        nz += (rnz - nz) * jw;
      }
    }

    // Neck rotation around cervical pivot (smoothly weighted from base collar y=-9.8 up to y=-5.8)
    if (hasNeck) {
      const baseY = basePositions[idx + 1];
      if (region !== FACE_REGION_IDS.skin || baseY >= -5.8) {
        const rx = nm0 * px + nm4 * py + nm8 * pz + nm12;
        const ry = nm1 * px + nm5 * py + nm9 * pz + nm13;
        const rz = nm2 * px + nm6 * py + nm10 * pz + nm14;
        px = rx; py = ry; pz = rz;

        const rnx = nm0 * nx + nm4 * ny + nm8 * nz;
        const rny = nm1 * nx + nm5 * ny + nm9 * nz;
        const rnz = nm2 * nx + nm6 * ny + nm10 * nz;
        nx = rnx; ny = rny; nz = rnz;
      } else if (baseY > -9.8) {
        const neckWeight = Utils.smoothstep(-9.8, -5.8, baseY);
        const rx = nm0 * px + nm4 * py + nm8 * pz + nm12;
        const ry = nm1 * px + nm5 * py + nm9 * pz + nm13;
        const rz = nm2 * px + nm6 * py + nm10 * pz + nm14;
        px += (rx - px) * neckWeight;
        py += (ry - py) * neckWeight;
        pz += (rz - pz) * neckWeight;

        const rnx = nm0 * nx + nm4 * ny + nm8 * nz;
        const rny = nm1 * nx + nm5 * ny + nm9 * nz;
        const rnz = nm2 * nx + nm6 * ny + nm10 * nz;
        nx += (rnx - nx) * neckWeight;
        ny += (rny - ny) * neckWeight;
        nz += (rnz - nz) * neckWeight;
      }
    }

    outPositions[idx] = px;
    outPositions[idx + 1] = py;
    outPositions[idx + 2] = pz;

    outNormals[idx] = nx;
    outNormals[idx + 1] = ny;
    outNormals[idx + 2] = nz;
  }
}

/**
 * Generate a procedural RGBA texture atlas (`Uint8Array` of length `size * size * 4`)
 * for the UV layout of `buildAnatomicalBaseHead` (Skin in `v: 0..0.75`, Left/Right Eyes
 * in `u: 0..0.5, v: 0.75..1.0`, Teeth/Mouth/Brows in `u: 0.5..1.0, v: 0.75..1.0`) plus
 * progressive damage/gore splatters for `damageTier` (`0 = 100%..80% HP` .. `4 = <20% HP`).
 */
export function generateFaceAtlasPixels(
  appearance: IFaceAppearance,
  damageTier = 0,
  size = 256
): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const rng = Rand.create(appearance.damageSeed + damageTier * 97);

  const skin = appearance.skinColor;
  const shadow = appearance.skinShadowColor;
  const lip = appearance.lipColor;
  const iris = appearance.irisColor;
  const sclera = appearance.scleraColor;
  const brow = appearance.browColor;
  const teeth = appearance.teethColor;

  const col = new Vec3();

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const pIdx = (y * size + x) * 4;

      if (v < 0.75) {
        // Upper 75% (v: 0..0.75, u: 0..1): Facial Skin, Hairline, Brows, Eyelids, Nose & Lips
        // In baseHead: u_uv = 0.5 + uGrid * 0.48, v_uv = 0.74 - sv * 0.72 where sv = (y + 11.0) / 21.5
        const uGrid = (u - 0.5) / 0.48;
        const absU = Math.abs(uGrid);
        const sv = Utils.clamp((0.74 - v) / 0.72, 0.0, 1.0);
        const yHead = Utils.lerp(-11.0, 10.5, sv);

        const shade = Utils.smoothstep(0.0, 0.25, sv) * (1.0 - absU * 0.22);
        col.setScalar(
          Utils.lerp(shadow.x, skin.x, shade),
          Utils.lerp(shadow.y, skin.y, shade),
          Utils.lerp(shadow.z, skin.z, shade)
        );

        // Subtle skin pore variation
        const pore = rng.float(-0.010, 0.010);
        col.addScalar(pore);

        // Submental under-chin & neck transition shadow (yHead around -6.6..-5.5)
        const submentalShadow =
          Math.exp(-Math.pow((yHead - -6.1) / 0.75, 2)) *
          Math.exp(-Math.pow(absU / 0.34, 2));
        col.scale(1.0 - submentalShadow * 0.26);

        // Subtle lower-face / jawline beard-stubble cool tone (yHead in -6.2..-1.8, anterior)
        const jawStubble =
          Utils.smoothstep(-6.4, -5.2, yHead) *
          Utils.smoothstep(-1.5, -2.8, yHead) *
          Utils.smoothstep(0.38, 0.16, absU) *
          (1.0 - Math.exp(-Math.pow((yHead - -3.10) / 0.65, 2)) * Math.exp(-Math.pow(absU / 0.09, 2)));
        if (jawStubble > 0.01) {
          const stubbleNoise = 0.85 + 0.15 * Math.sin(uGrid * 190.0 + yHead * 45.0);
          const stW = jawStubble * 0.14 * stubbleNoise;
          col.x = Utils.lerp(col.x, brow.x * 0.85, stW);
          col.y = Utils.lerp(col.y, brow.y * 0.88, stW);
          col.z = Utils.lerp(col.z, brow.z * 0.95, stW);
        }

        // Cheek & nasal warmth around mid-face (yHead in -1.2..2.0)
        const cheekWarmth =
          Math.exp(-Math.pow((yHead - 0.35) / 1.65, 2)) *
          Math.exp(-Math.pow((absU - 0.16) / 0.14, 2));
        col.x += cheekWarmth * 0.055;
        col.y -= cheekWarmth * 0.012;
        col.z -= cheekWarmth * 0.015;

        // Nasolabial fold & philtrum shading
        const philtrumGroove =
          Math.exp(-Math.pow(absU / 0.016, 2)) *
          Math.exp(-Math.pow((yHead - -1.95) / 0.55, 2));
        const philtrumColumns =
          Math.exp(-Math.pow((absU - 0.024) / 0.010, 2)) *
          Math.exp(-Math.pow((yHead - -1.95) / 0.55, 2));
        col.scale(1.0 - philtrumGroove * 0.14 + philtrumColumns * 0.05);

        const nlTargetU = 0.062 + Math.max(0, -0.9 - yHead) * 0.022;
        const nasolabial =
          Math.exp(-Math.pow((absU - nlTargetU) / 0.014, 2)) *
          Utils.smoothstep(-0.7, -1.3, yHead) *
          Utils.smoothstep(-3.6, -2.6, yHead);
        col.scale(1.0 - nasolabial * 0.18);

        // Nasal bridge highlight, alar crease, and dark nostril cavities
        const noseBridgeHighlight =
          Math.exp(-Math.pow(absU / 0.022, 2)) *
          Utils.smoothstep(-0.85, -0.35, yHead) *
          Utils.smoothstep(2.6, 1.5, yHead);
        col.addScalar(noseBridgeHighlight * 0.055);

        const alarShadow =
          Math.exp(-Math.pow((absU - 0.064) / 0.016, 2)) *
          Math.exp(-Math.pow((yHead - -0.92) / 0.42, 2));
        col.scale(1.0 - alarShadow * 0.24);

        const nostrilDark =
          Math.exp(-Math.pow((absU - 0.035) / 0.016, 2)) *
          Math.exp(-Math.pow((yHead - -1.16) / 0.22, 2));
        if (nostrilDark > 0.01) {
          const nW = Utils.clamp(nostrilDark * 0.88, 0.0, 0.88);
          col.x = Utils.lerp(col.x, 0.08, nW);
          col.y = Utils.lerp(col.y, 0.04, nW);
          col.z = Utils.lerp(col.z, 0.04, nW);
        }

        // Vermilion upper & lower lips + Cupid's bow + oral stomion crease (yHead ~ -3.10)
        const lipArch = Math.max(0, 1.0 - Math.pow(absU / 0.095, 2));
        if (lipArch > 0.0 && yHead > -3.85 && yHead < -2.35) {
          const cupidDip = 0.10 * Math.exp(-Math.pow(absU / 0.018, 2));
          const cupidPeak = 0.12 * Math.exp(-Math.pow((absU - 0.028) / 0.018, 2));
          const upperBorderY = -3.10 + (0.52 + cupidPeak - cupidDip) * lipArch;
          const lowerBorderY = -3.10 - 0.62 * lipArch;

          if (yHead >= lowerBorderY && yHead <= upperBorderY) {
            const distToEdge = Math.min(upperBorderY - yHead, yHead - lowerBorderY);
            const lipW = Utils.smoothstep(0.0, 0.16, distToEdge) * Utils.smoothstep(0.0, 0.25, lipArch);
            const isUpperLip = yHead >= -3.10;
            // Upper lip angles downward (slightly darker), lower lip catches light (specular highlight)
            const lipShade = isUpperLip
              ? 0.84
              : 1.04 + 0.14 * Math.exp(-Math.pow((yHead - -3.38) / 0.16, 2)) * Math.exp(-Math.pow(absU / 0.045, 2));
            col.x = Utils.lerp(col.x, lip.x * lipShade, lipW);
            col.y = Utils.lerp(col.y, lip.y * lipShade, lipW);
            col.z = Utils.lerp(col.z, lip.z * lipShade, lipW);
          }

          // Crisp dark oral stomion parting line at yHead = -3.10
          const stomionLine =
            Math.exp(-Math.pow((yHead - -3.10) / 0.075, 2)) *
            Utils.smoothstep(0.0, 0.15, lipArch);
          if (stomionLine > 0.01) {
            const stLineW = Utils.clamp(stomionLine * 0.82, 0.0, 0.82);
            col.x = Utils.lerp(col.x, 0.12, stLineW);
            col.y = Utils.lerp(col.y, 0.04, stLineW);
            col.z = Utils.lerp(col.z, 0.05, stLineW);
          }
        }

        // Orbital socket shading, eyelids, upper eyelash line & supra-tarsal crease (eye center: absU = 0.123, yHead = 1.85)
        const dSocket = Math.hypot((absU - 0.123) / 0.075, (yHead - 1.92) / 0.95);
        if (dSocket < 1.5) {
          const socketAO = Math.exp(-dSocket * dSocket * 1.65);
          col.scale(1.0 - socketAO * 0.18);
        }

        const eyeArchX = Math.max(0, 1.0 - Math.pow((absU - 0.123) / 0.062, 2));
        if (eyeArchX > 0.0) {
          // Dark upper eyelash margin
          const upperLashY = 1.85 + 0.36 * eyeArchX;
          const lashW = Math.exp(-Math.pow((yHead - upperLashY) / 0.09, 2)) * Utils.smoothstep(0.0, 0.2, eyeArchX);
          if (lashW > 0.01) {
            col.x = Utils.lerp(col.x, brow.x * 0.35, lashW * 0.85);
            col.y = Utils.lerp(col.y, brow.y * 0.35, lashW * 0.85);
            col.z = Utils.lerp(col.z, brow.z * 0.35, lashW * 0.85);
          }
          // Supra-tarsal upper eyelid fold crease
          const foldY = 1.85 + 0.68 * eyeArchX;
          const foldW = Math.exp(-Math.pow((yHead - foldY) / 0.08, 2)) * Utils.smoothstep(0.0, 0.25, eyeArchX);
          col.scale(1.0 - foldW * 0.28);

          // Lower eyelid rim shadow
          const lowerRimY = 1.85 - 0.36 * eyeArchX;
          const lowerW = Math.exp(-Math.pow((yHead - lowerRimY) / 0.09, 2)) * Utils.smoothstep(0.0, 0.2, eyeArchX);
          col.scale(1.0 - lowerW * 0.22);
        }

        // Painted eyebrow hair bed (absU in 0.040..0.198, yHead ~ 3.15)
        if (absU > 0.032 && absU < 0.210 && yHead > 2.65 && yHead < 3.75) {
          const browT = Utils.clamp((absU - 0.038) / 0.160, 0.0, 1.0);
          const browCenterY = 3.05 + 0.26 * Math.sin(browT * Math.PI * 0.85);
          const browHalfH = 0.24 * (1.0 - 0.45 * Math.pow(browT, 1.6));
          const dBrowY = Math.abs(yHead - browCenterY) / Math.max(0.05, browHalfH);
          if (dBrowY < 1.35) {
            const browEndFade = Utils.smoothstep(0.0, 0.12, browT) * Utils.smoothstep(1.0, 0.82, browT);
            const browW = Utils.smoothstep(1.35, 0.25, dBrowY) * browEndFade;
            const browStroke = 0.78 + 0.22 * Math.sin((absU * 260.0) - (yHead * 32.0));
            col.x = Utils.lerp(col.x, brow.x * browStroke, browW * 0.88);
            col.y = Utils.lerp(col.y, brow.y * browStroke, browW * 0.88);
            col.z = Utils.lerp(col.z, brow.z * browStroke, browW * 0.88);
          }
        }

        // Ear concha & antihelix shading (absU around 0.46..0.54, yHead in -1.3..2.1)
        const earConcha =
          Math.exp(-Math.pow((absU - 0.50) / 0.035, 2)) *
          Math.exp(-Math.pow((yHead - 0.35) / 1.05, 2));
        col.scale(1.0 - earConcha * 0.24);

        // Sculpted Haircut, Forehead Hairline, Sideburns & Nape Hair
        const foreheadHairlineY =
          6.35 -
          0.32 * Math.exp(-Math.pow(absU / 0.05, 2)) +
          0.55 * Math.exp(-Math.pow((absU - 0.19) / 0.07, 2));
        const foreheadHair =
          Utils.smoothstep(foreheadHairlineY - 0.30, foreheadHairlineY + 0.22, yHead) *
          Utils.smoothstep(0.40, 0.26, absU);
        const sideburnHair =
          Utils.smoothstep(0.28, 0.34, absU) *
          Utils.smoothstep(0.47, 0.43, absU) *
          Utils.smoothstep(-0.15, 0.45, yHead) *
          Utils.smoothstep(7.5, 5.0, yHead);
        const backScalpHair =
          Utils.smoothstep(0.38, 0.46, absU) *
          Utils.smoothstep(-3.8, -3.1, yHead);
        const crownCapHair = Utils.smoothstep(6.45, 7.05, yHead);
        const hairMask = Utils.clamp(
          Math.max(foreheadHair, sideburnHair, backScalpHair, crownCapHair),
          0.0,
          1.0
        );
        if (hairMask > 0.01) {
          const strand =
            0.84 +
            0.16 * Math.sin(uGrid * 185.0 + yHead * 14.0) * Math.cos(yHead * 26.0);
          const crownSpec = 1.0 + 0.18 * Utils.smoothstep(5.5, 8.8, yHead) * (1.0 - absU * 0.5);
          const hR = brow.x * strand * crownSpec;
          const hG = brow.y * strand * crownSpec;
          const hB = brow.z * strand * crownSpec;
          col.x = Utils.lerp(col.x, hR, hairMask);
          col.y = Utils.lerp(col.y, hG, hairMask);
          col.z = Utils.lerp(col.z, hB, hairMask);
        }
      } else if (u < 0.50) {
        // Bottom-Left (u: 0..0.50, v: 0.75..1.0): Left Eyeball (0.02..0.24) & Right Eyeball (0.26..0.48)
        const eyeCenterU = u < 0.25 ? 0.13 : 0.37;
        const eyeCenterV = 0.87;
        const dx = (u - eyeCenterU) / 0.11;
        const dy = (v - eyeCenterV) / 0.11;
        const r = Math.hypot(dx, dy);

        const vignette = Utils.clamp(1.0 - r * 0.18, 0.72, 1.0);
        col.copy(sclera).scale(vignette);

        if (r < 0.50) {
          const limbus = Utils.smoothstep(0.50, 0.43, r);
          const angle = Math.atan2(dy, dx);
          const fiber = 0.88 + 0.18 * Math.sin(angle * 24.0) * Math.cos(r * 18.0);
          const limbalDark = Utils.smoothstep(0.36, 0.48, r) * 0.45;
          const irR = iris.x * fiber * (1.0 - limbalDark);
          const irG = iris.y * fiber * (1.0 - limbalDark);
          const irB = iris.z * fiber * (1.0 - limbalDark);
          col.setScalar(
            Utils.lerp(col.x, irR, limbus),
            Utils.lerp(col.y, irG, limbus),
            Utils.lerp(col.z, irB, limbus)
          );
        }

        if (r < 0.22) {
          const pupilW = Utils.smoothstep(0.22, 0.16, r);
          col.scale(1.0 - pupilW * 0.94);
        }

        const dSpec = Math.hypot(dx + 0.11, dy - 0.11);
        if (dSpec < 0.09) {
          const specW = Utils.smoothstep(0.09, 0.02, dSpec);
          col.x = Utils.lerp(col.x, 1.0, specW);
          col.y = Utils.lerp(col.y, 1.0, specW);
          col.z = Utils.lerp(col.z, 1.0, specW);
        }
      } else if (u < 0.84 && v < 0.94) {
        // Bottom-Right Teeth region (u: 0.50..0.84, v: 0.75..0.94): Upper & Lower Dental Arches
        const tu = (u - 0.52) / 0.30;
        const tv = (v - 0.78) / 0.15;
        const toothGroove = Math.pow(Math.abs(Math.sin(tu * Math.PI * 8.0)), 0.35);
        const gumBlend = Utils.smoothstep(0.0, 0.18, tv) * Utils.smoothstep(1.0, 0.82, tv);
        const shade = (0.75 + 0.25 * toothGroove) * (0.72 + 0.28 * gumBlend);
        col.copy(teeth).scale(shade);
      } else if (u < 0.84 && v >= 0.94) {
        // Inner Oral Cavity (u: 0.50..0.84, v: 0.94..1.0)
        col.setScalar(0.22, 0.06, 0.07);
      } else {
        // Eyebrow & Hair region (u: 0.84..1.0, v: 0.75..1.0)
        const bu = (u - 0.84) / 0.16;
        const hairStreak = 0.82 + 0.24 * Math.sin(bu * 65.0 + v * 18.0);
        col.copy(brow).scale(hairStreak);
      }

      pixels[pIdx] = Utils.clamp(Math.round(col.x * 255), 0, 255);
      pixels[pIdx + 1] = Utils.clamp(Math.round(col.y * 255), 0, 255);
      pixels[pIdx + 2] = Utils.clamp(Math.round(col.z * 255), 0, 255);
      pixels[pIdx + 3] = 255;
    }
  }

  // Layer progressive procedural bruises & blood splatters on the Skin region (v < 0.75)
  const skinHeight = Math.floor(size * 0.74);
  const clampedTier = Utils.clamp(damageTier | 0, 0, 4);
  if (clampedTier > 0) {
    const splatterCount = clampedTier * 8;
    for (let s = 0; s < splatterCount; s++) {
      const cx = Math.floor(rng.float(0.32, 0.68) * size);
      const cy = Math.floor(rng.float(0.24, 0.76) * skinHeight);
      const radius = Math.floor(rng.float(3, 7 + clampedTier * 3) * (size / 256));
      const isBlood = s % 2 === 0 || clampedTier >= 3;

      for (let dy = -radius; dy <= radius; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= skinHeight) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const px = cx + dx;
          if (px < 0 || px >= size) continue;
          const dist = Math.hypot(dx, dy) / Math.max(1, radius);
          if (dist <= 1.0) {
            const w = Utils.smoothstep(1.0, 0.15, dist) * (0.55 + 0.45 * (clampedTier / 4));
            const pIdx = (py * size + px) * 4;
            const targetR = isBlood ? 145 : 92;
            const targetG = isBlood ? 14 : 38;
            const targetB = isBlood ? 18 : 68;
            pixels[pIdx] = Math.round(Utils.lerp(pixels[pIdx], targetR, w));
            pixels[pIdx + 1] = Math.round(Utils.lerp(pixels[pIdx + 1], targetG, w));
            pixels[pIdx + 2] = Math.round(Utils.lerp(pixels[pIdx + 2], targetB, w));
          }
        }
      }
    }

    // Nasal/oral bleeding streaks for heavy damage tiers (Tier 3 & Tier 4)
    if (clampedTier >= 3) {
      const noseX = Math.floor(0.5 * size);
      const startY = Math.floor(0.52 * skinHeight);
      const endY = Math.floor((0.68 + (clampedTier - 2) * 0.08) * skinHeight);
      const streakWidth = Math.max(2, Math.floor((clampedTier * 2.5 * size) / 256));
      for (let py = startY; py <= Math.min(skinHeight - 1, endY); py++) {
        for (let dx = -streakWidth; dx <= streakWidth; dx++) {
          const px = noseX + dx;
          if (px < 0 || px >= size) continue;
          const w = Utils.smoothstep(streakWidth + 1, 0, Math.abs(dx)) * 0.85;
          const pIdx = (py * size + px) * 4;
          pixels[pIdx] = Math.round(Utils.lerp(pixels[pIdx], 132, w));
          pixels[pIdx + 1] = Math.round(Utils.lerp(pixels[pIdx + 1], 12, w));
          pixels[pIdx + 2] = Math.round(Utils.lerp(pixels[pIdx + 2], 14, w));
        }
      }
    }
  }

  // Apply custom painted overrides if present for this tier
  const customOverrides = appearance.customTierOverrides?.[clampedTier];
  if (Array.isArray(customOverrides)) {
    for (let i = 0; i + 4 < customOverrides.length; i += 5) {
      const pIdx = customOverrides[i] * 4;
      if (pIdx >= 0 && pIdx + 3 < pixels.length) {
        pixels[pIdx] = customOverrides[i + 1];
        pixels[pIdx + 1] = customOverrides[i + 2];
        pixels[pIdx + 2] = customOverrides[i + 3];
        pixels[pIdx + 3] = customOverrides[i + 4];
      }
    }
  }

  return pixels;
}

/**
 * Create a live `@1pizzateam/roostr` `Mesh` + `CustomMesh` pair bound to a WebGL context,
 * configured with `DYNAMIC_DRAW` vertex/normal buffers and a procedural RGBA atlas texture.
 */
export function createRoostrFaceMesh(
  gl: WebGLRenderingContext,
  cartridge: IFaceCartridge,
  damageTier = 0,
  atlasSize = 256
): { customMesh: CustomMesh; mesh: Mesh; atlasPixels: Uint8Array } {
  const customMesh = new CustomMesh();
  customMesh.vertices = new Float32Array(cartridge.positions);
  customMesh.indices = new Int32Array(cartridge.indices);
  customMesh.normals = new Float32Array(cartridge.normals);
  customMesh.uvs = new Float32Array(cartridge.uvs);
  customMesh.bufferUsage = 'DYNAMIC_DRAW';

  const mesh = new Mesh(customMesh, gl);
  const mat = new Material({
    ambient: new Vec3(0.38, 0.34, 0.34),
    diffuse: new Vec3(0.92, 0.90, 0.88),
    specular: new Vec3(0.22, 0.20, 0.18),
    shininess: 22
  });
  mesh.addProgram(PhongShader.vertex, PhongShader.fragment, mat);

  const atlasPixels = generateFaceAtlasPixels(cartridge.appearance, damageTier, atlasSize);
  const tex = Texture.create(atlasPixels, gl, {
    size: new Vec2(atlasSize, atlasSize),
    flipY: false,
    generateMipmaps: true
  });
  if (tex) {
    mesh.setSharedTexture(tex);
  }

  return { customMesh, mesh, atlasPixels };
}

/**
 * Upload deformed `positions` and `normals` into a bound `@1pizzateam/roostr` `Mesh`'s
 * WebGL buffers using `bufferSubData` while keeping `MeshRenderer`'s `GLState` in sync.
 */
export function syncRoostrMeshBuffers(
  mesh: Mesh,
  positions: Float32Array,
  normals: Float32Array
): void {
  if (mesh.vertices instanceof Float32Array && mesh.vertices.length === positions.length) {
    mesh.vertices.set(positions);
  }
  if (mesh.normals instanceof Float32Array && mesh.normals.length === normals.length) {
    mesh.normals.set(normals);
  }

  const gl = mesh.context;
  if (!gl) return;

  if (mesh.vertexBuffer) {
    mesh.renderer.bindBuffer('ARRAY_BUFFER', mesh.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
  }
  if (mesh.normalBuffer) {
    mesh.renderer.bindBuffer('ARRAY_BUFFER', mesh.normalBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
  }
}
