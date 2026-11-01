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
 * Deform a cylindrical/cranial grid point (u in [-1, 1], v in [0, 1]) into a realistic,
 * anatomically proportioned 3D human head with a distinct neck, submental jawline overhang,
 * ovoid cranium, orbital sockets with wrapping eyelids, prominent 3D nose, lips, chin, and ears.
 */
function shapeAnatomicalHeadPoint(u: number, v: number, target: Vec3): number {
  // u in [-1, 1] wraps azimuth around Y (0 = anterior +Z midline, +/-1 = posterior -Z seam)
  const azimuth = u * Trigo.pi;
  const sinAz = Trigo.sinePrecise(azimuth);
  const cosAz = Trigo.cosinePrecise(azimuth);
  const absU = Math.abs(u);
  const signU = u >= 0 ? 1 : -1;

  // Parameterize 3 distinct anatomical zones along v in [0, 1]:
  // 1) v in [0.00, 0.20]: Muscular cylindrical neck & collar base (y: -11.0 -> -5.8)
  // 2) v in [0.20, 0.28]: Submental shelf (underside of jaw sweeping forward to chin) & occipital nape
  // 3) v in [0.28, 1.00]: Cranium + facial mask (y: -6.4 at chin -> +10.5 at crown)
  let x = 0;
  let y = 0;
  let z = 0;

  if (v < 0.20) {
    const t = Utils.normalize(v, 0.0, 0.20);
    y = Utils.lerp(-11.0, -5.8, t);
    // Slight trapezius/collar flare at the bottom, narrower mid-neck
    const collarFlare = Math.pow(1.0 - t, 1.8);
    const rx = Utils.lerp(3.55, 4.45, collarFlare);
    const rz = Utils.lerp(3.75, 4.55, collarFlare);
    const zCenter = Utils.lerp(-1.65, -1.35, t);
    // Sternocleidomastoid / Adam's apple anterior contour
    const throatBulge = Math.max(0, cosAz) * 0.32 * Math.sin(t * Trigo.pi);
    x = sinAz * rx;
    z = zCenter + cosAz * rz + throatBulge;
  } else {
    // Cranial + Mandibular envelope for v in [0.20, 1.00]
    // First compute how the lower jaw/neck transition behaves:
    // At v = 0.20, we are at the top of the neck (y = -5.8, rx = 3.55, rz = 3.75, zCenter = -1.35).
    // By v = 0.28, the anterior side has swept forward under the jaw to the lower border of the mandible/chin,
    // while the posterior side has swept smoothly into the occipital base.
    const vHead = Utils.clamp((v - 0.26) / 0.74, 0.0, 1.0);
    const submentalBlend = Utils.smoothstep(0.20, 0.28, v);

    // neck top reference point
    const neckX = sinAz * 3.55;
    const neckY = Utils.lerp(-5.8, -5.4, Utils.clamp((v - 0.20) / 0.08, 0, 1));
    const neckZ = -1.35 + cosAz * 3.75;

    // Head height from chin base (-6.35) to crown (+10.5)
    // Use dome latitude near the top (vHead > 0.72) so the crown closes smoothly at a single apex
    let domeFactor = 1.0;
    let headY = 0;
    if (vHead <= 0.74) {
      const tFace = vHead / 0.74;
      headY = Utils.lerp(-6.35, 6.4, tFace);
      domeFactor = 1.0;
    } else {
      const tDome = (vHead - 0.74) / 0.26;
      const phi = tDome * Trigo.halfpi;
      headY = 6.4 + Trigo.sinePrecise(phi) * 4.1; // reaches +10.5 at crown
      domeFactor = Math.pow(Math.max(0, Trigo.cosinePrecise(phi)), 0.82);
    }

    // Horizontal cranial width (rx) as a function of headY:
    // Narrower at chin/lower jaw, widest at cheekbones/parietal vault, tapering at temples
    const jawTaper = Utils.smoothstep(-6.4, -1.5, headY);
    const templeIndent = Math.exp(-Math.pow((headY - 2.8) / 2.2, 2)) * 0.28;
    const parietalFullness = Math.exp(-Math.pow((headY - 5.2) / 3.0, 2)) * 0.35;
    let rx = (Utils.lerp(4.2, 6.15, jawTaper) - templeIndent + parietalFullness) * domeFactor;

    // Anterior-posterior depth (rz) and zCenter:
    // Front of face projects forward (+Z); back of cranium (occiput) bulges backward (-Z) around headY = 1..5
    const occiputBulge = Math.exp(-Math.pow((headY - 2.6) / 4.2, 2)) * 1.15;
    const rzFront = Utils.lerp(6.5, 6.85, Utils.smoothstep(-6.4, 2.5, headY)) * domeFactor;
    const rzBack = (Utils.lerp(5.2, 6.95, Utils.smoothstep(-5.5, 2.0, headY)) + occiputBulge) * domeFactor;
    const zCenter = Utils.lerp(0.45, -0.55, Utils.smoothstep(-5.5, 4.5, headY)) * domeFactor;

    // Asymmetric front/back radius so the face is upright while the occiput rounds out in back
    const rz = cosAz >= 0 ? rzFront : rzBack;

    // Taper the anterior lower face into an anatomical V/U-shaped mandible + chin
    let frontXScale = 1.0;
    if (cosAz > 0 && headY < 0.5) {
      const lowerT = Utils.clamp((0.5 - headY) / 6.85, 0, 1);
      // Narrow toward the front midline (cosAz -> 1) at the chin
      frontXScale = 1.0 - lowerT * 0.38 * Math.pow(cosAz, 1.4);
    }

    // Flatten the front facial plane slightly (human faces have distinct front & side planes, not a cylinder)
    const facialPlaneFlatten = cosAz > 0.25
      ? 1.0 - 0.08 * Math.sin((cosAz - 0.25) / 0.75 * Trigo.pi) * Utils.smoothstep(7.0, 3.5, headY)
      : 1.0;

    const headX = sinAz * rx * frontXScale;
    const headZ = zCenter + cosAz * rz * facialPlaneFlatten;

    // Blend from neck top to head envelope across the submental jaw shelf (v in [0.20, 0.28])
    x = Utils.lerp(neckX, headX, submentalBlend);
    y = Utils.lerp(neckY, headY, submentalBlend);
    z = Utils.lerp(neckZ, headZ, submentalBlend);
  }

  target.setScalar(x, y, z);

  // Sculpt detailed anatomical features on the head above the neck (v > 0.22)
  const headMask = Utils.smoothstep(0.21, 0.29, v) * Utils.smoothstep(0.98, 0.88, v);
  const frontMask = Utils.smoothstep(-0.15, 0.25, cosAz) * headMask;

  if (frontMask > 0) {
    // 1. Mandibular Angle (Gonion) & Defined Jawline Ridge
    const gonion = symmetricLobe(target, new Vec3(4.75, -3.95, 1.35), new Vec3(1.85, 1.85, 2.5));
    const jawRidge = symmetricLobe(target, new Vec3(3.35, -5.15, 4.15), new Vec3(2.2, 1.25, 2.6));
    target.x += signU * (gonion * 0.65 + jawRidge * 0.28) * frontMask;
    target.y -= (gonion * 0.45 + jawRidge * 0.32) * frontMask;
    target.z += jawRidge * 0.35 * frontMask;

    // 2. Chin (Mentalis Protuberance) & Labiomental Crease
    const chinPad = gaussianLobe(target, new Vec3(0, -5.65, 6.2), new Vec3(1.85, 1.25, 2.8));
    const chinCleft = gaussianLobe(target, new Vec3(0, -5.75, 6.8), new Vec3(0.32, 0.95, 2.0));
    const labiomentalCrease = gaussianLobe(target, new Vec3(0, -4.35, 6.4), new Vec3(1.95, 0.62, 2.5));
    target.z += (chinPad * 1.15 - chinCleft * 0.18 - labiomentalCrease * 0.62) * frontMask;
    target.y -= chinPad * 0.28 * frontMask;

    // 3. Zygomatic Arch (Cheekbones), Nasolabial Fold & Buccal Hollow
    const malarProminence = symmetricLobe(target, new Vec3(4.15, 0.55, 5.2), new Vec3(2.15, 1.65, 2.8));
    const zygomaticArch = symmetricLobe(target, new Vec3(5.35, 0.75, 2.4), new Vec3(1.45, 1.15, 2.6));
    const buccalHollow = symmetricLobe(target, new Vec3(3.95, -2.35, 4.2), new Vec3(1.75, 1.75, 2.5));
    const nasolabial = symmetricLobe(target, new Vec3(1.85, -1.85, 6.4), new Vec3(0.55, 1.35, 2.2));
    target.x += signU * (malarProminence * 0.55 + zygomaticArch * 0.48 - buccalHollow * 0.38) * frontMask;
    target.z += (malarProminence * 0.78 - buccalHollow * 0.45 - nasolabial * 0.25) * frontMask;
    target.y += malarProminence * 0.15 * frontMask;

    // 4. Forehead Frontal Eminences, Temporal Hollows & Supraorbital Brow Ridge
    const foreheadBoss = symmetricLobe(target, new Vec3(2.15, 5.45, 6.2), new Vec3(2.6, 1.95, 2.8));
    const temporalHollow = symmetricLobe(target, new Vec3(5.25, 3.35, 3.2), new Vec3(1.45, 1.95, 2.4));
    const browArch = symmetricLobe(target, new Vec3(2.35, 3.15, 6.5), new Vec3(2.15, 0.78, 2.8));
    const glabella = gaussianLobe(target, new Vec3(0, 3.05, 6.6), new Vec3(1.15, 0.85, 2.6));
    const nasionIndent = gaussianLobe(target, new Vec3(0, 2.25, 6.6), new Vec3(0.95, 0.52, 2.5));
    target.x -= signU * temporalHollow * 0.42 * frontMask;
    target.z += (foreheadBoss * 0.42 + browArch * 0.92 + glabella * 0.65 - nasionIndent * 0.48) * frontMask;
    target.y -= browArch * 0.14 * frontMask;

    // 5. Orbital Sockets & Wrapping Upper/Lower Eyelids (centered at x = +/-2.35, y = 1.85)
    // Eyeball spheres sit at (+/-2.35, 1.85, 4.65) with radius 1.14 + 0.08 cornea (front pole at z = 5.87).
    // At x = +/-2.35, y = 1.85, the base facial surface is at z ~ 5.58.
    // We recess the orbital socket slightly, push the upper eyelid (y ~ 2.28) to z ~ 6.08 and lower eyelid
    // (y ~ 1.42) to z ~ 5.95 so they wrap cleanly over the top/bottom of the eyeball sphere (z = 5.71 at dy = +/-0.42),
    // and tuck the central almond palpebral slit (y ~ 1.85) back to z ~ 4.15 behind the cornea!
    const eyeSocketRecess = symmetricLobe(target, new Vec3(2.35, 1.95, 5.8), new Vec3(1.68, 1.22, 3.0));
    target.z -= eyeSocketRecess * 0.48 * frontMask;

    // Almond coordinate relative to the closest eye center (+/-2.35, 1.85)
    const dxEye = (Math.abs(target.x) - 2.35) / 1.22;
    const dyEye = (target.y - 1.85) / 0.64;
    const rEyeSq = dxEye * dxEye + dyEye * dyEye;
    if (rEyeSq < 3.2) {
      const almondProfile = Math.max(0, 1.0 - dxEye * dxEye);
      // Upper and lower eyelid cushions wrapping over the top and bottom of the eyeball
      const upperLidFold = Math.exp(-Math.pow((target.y - (1.85 + 0.42 * almondProfile)) / 0.28, 2)) * Math.exp(-dxEye * dxEye * 1.15);
      const lowerLidFold = Math.exp(-Math.pow((target.y - (1.85 - 0.38 * almondProfile)) / 0.26, 2)) * Math.exp(-dxEye * dxEye * 1.25);
      const lidCrease = Math.exp(-Math.pow((target.y - (1.85 + 0.76 * almondProfile)) / 0.16, 2)) * Math.exp(-dxEye * dxEye * 1.1);

      target.z += (upperLidFold * 1.05 + lowerLidFold * 0.88 - lidCrease * 0.32) * frontMask;

      // Smoothly part vertices inside the almond palpebral fissure toward the upper/lower lid rims
      // and tuck the inner slit behind the cornea so the eyeball sphere (z ~ 5.87) is cleanly framed!
      const fissureWeight = Math.exp(-dxEye * dxEye * 1.65) * Math.exp(-dyEye * dyEye * 2.1);
      if (fissureWeight > 0.02) {
        const smoothSignY = Math.tanh(dyEye * 4.5);
        target.y += smoothSignY * 0.30 * almondProfile * fissureWeight * frontMask;
        const innerSlit = Math.exp(-dyEye * dyEye * 4.8) * Math.exp(-dxEye * dxEye * 1.85);
        target.z -= innerSlit * 1.48 * frontMask;
      }
    }

    // 6. Sculpted 3D Nose: Nasal Bridge, Dorsum, Tip (Pronasale), Columella & Nostril Wings (Alae)
    const noseBridge = gaussianLobe(target, new Vec3(0, 1.35, 6.6), new Vec3(0.68, 1.15, 2.8));
    const noseDorsum = gaussianLobe(target, new Vec3(0, 0.25, 6.8), new Vec3(0.75, 0.95, 2.8));
    const noseTip = gaussianLobe(target, new Vec3(0, -0.68, 7.0), new Vec3(0.88, 0.78, 3.0));
    const columella = gaussianLobe(target, new Vec3(0, -1.28, 6.8), new Vec3(0.42, 0.48, 2.5));
    const nostrilWings = symmetricLobe(target, new Vec3(1.08, -0.95, 6.6), new Vec3(0.65, 0.58, 2.4));
    const alarGroove = symmetricLobe(target, new Vec3(1.52, -0.78, 6.3), new Vec3(0.42, 0.65, 2.2));
    const nostrilCavities = symmetricLobe(target, new Vec3(0.68, -1.22, 6.8), new Vec3(0.35, 0.28, 2.0));

    target.z += (
      noseBridge * 1.35 +
      noseDorsum * 1.85 +
      noseTip * 2.25 +
      columella * 1.15 +
      nostrilWings * 1.05 -
      alarGroove * 0.42 -
      nostrilCavities * 0.45
    ) * frontMask;
    target.y -= (noseTip * 0.18 - nostrilCavities * 0.16) * frontMask;
    target.x += signU * (nostrilWings * 0.28 - noseBridge * 0.16 * Math.min(1, Math.abs(target.x))) * frontMask;

    // 7. Philtrum, Upper & Lower Vermilion Lips, Cupid's Bow, and Oral Commissures
    const philtrumDimple = gaussianLobe(target, new Vec3(0, -1.85, 6.8), new Vec3(0.38, 0.55, 2.2));
    const philtrumColumns = symmetricLobe(target, new Vec3(0.42, -1.95, 6.8), new Vec3(0.28, 0.52, 2.2));
    const muzzleBarrel = gaussianLobe(target, new Vec3(0, -2.95, 6.4), new Vec3(2.45, 1.45, 2.8));
    const upperLip = gaussianLobe(target, new Vec3(0, -2.62, 6.9), new Vec3(1.75, 0.46, 2.5));
    const cupidsBowDip = gaussianLobe(target, new Vec3(0, -2.38, 7.2), new Vec3(0.32, 0.28, 2.0));
    const lowerLip = gaussianLobe(target, new Vec3(0, -3.58, 6.8), new Vec3(1.58, 0.52, 2.5));
    const mouthCorners = symmetricLobe(target, new Vec3(1.98, -3.12, 6.2), new Vec3(0.55, 0.52, 2.2));

    target.z += (
      muzzleBarrel * 0.58 +
      philtrumColumns * 0.22 -
      philtrumDimple * 0.28 +
      upperLip * 0.95 -
      cupidsBowDip * 0.22 +
      lowerLip * 0.92 -
      mouthCorners * 0.52
    ) * frontMask;

    // Smooth oral stomion crease at y = -3.10 (continuous tanh parting, no jagged step)
    const dxMouth = target.x / 1.82;
    const dyMouth = (target.y - (-3.10)) / 0.36;
    const mouthCrease = Math.exp(-dxMouth * dxMouth * 1.45) * Math.exp(-dyMouth * dyMouth * 2.4);
    if (mouthCrease > 0.02) {
      const lipRollY = Math.tanh(dyMouth * 3.5);
      target.y += lipRollY * 0.12 * mouthCrease * frontMask;
      target.z -= Math.exp(-dyMouth * dyMouth * 4.2) * 0.68 * mouthCrease * frontMask;
    }
  }

  // 8. Sculpted 3D Ears (Pinna: Helix rim, Concha hollow, and Earlobe) on lateral sides (|x| ~ 6.1, y ~ 0.4, z ~ -0.6)
  if (headMask > 0.1) {
    const earOuter = symmetricLobe(target, new Vec3(6.05, 0.45, -0.65), new Vec3(1.15, 1.85, 1.25));
    const earHelixRim = symmetricLobe(target, new Vec3(6.25, 0.65, -0.95), new Vec3(0.85, 1.65, 0.85));
    const earConcha = symmetricLobe(target, new Vec3(6.15, 0.35, -0.45), new Vec3(0.65, 0.92, 0.68));
    if (earOuter > 0.02) {
      target.x += signU * (earOuter * 0.95 + earHelixRim * 0.45 - earConcha * 0.42) * headMask;
      target.z -= (earOuter * 0.28 + earHelixRim * 0.22) * headMask;
    }

    // 9. Subtle 3D Haircut / Scalp Volume (hairline at y ~ 6.4 on forehead, sideburns at temples, nape at back)
    const foreheadHairlineY = 6.35 - 0.35 * Math.cos(absU * 14.0) * Utils.smoothstep(0.28, 0.0, absU);
    const frontHairMask = Utils.smoothstep(foreheadHairlineY - 0.35, foreheadHairlineY + 0.35, target.y);
    const sideburnMask = Utils.smoothstep(0.32, 0.38, absU) * Utils.smoothstep(0.47, 0.42, absU) *
      Utils.smoothstep(0.1, 0.8, target.y) * Utils.smoothstep(6.8, 5.5, target.y);
    const backScalpMask = Utils.smoothstep(0.36, 0.48, absU) * Utils.smoothstep(-3.6, -2.6, target.y);
    const hairVolume = Math.max(frontHairMask, sideburnMask * 0.75, backScalpMask) * Utils.smoothstep(10.4, 9.6, target.y);
    if (hairVolume > 0.01) {
      // Slight flattop/cropped military crown ridge + hair thickness
      const crownFlat = Utils.smoothstep(7.2, 9.5, target.y) * (1.0 - absU * 0.5);
      target.x += sinAz * (0.20 * hairVolume + 0.18 * crownFlat);
      target.y += 0.22 * hairVolume;
      target.z += cosAz * 0.22 * hairVolume;
    }
  }

  // Compute jaw influence weight in [0, 1] for mandible rotation
  let jawWeight = 0;
  if (v > 0.21 && target.y < -1.2) {
    const verticalJaw = Utils.smoothstep(-1.4, -4.8, target.y) * Utils.smoothstep(-6.8, -5.2, target.y);
    const forwardJaw = Utils.smoothstep(-1.5, 3.2, target.z);
    jawWeight = Utils.clamp(verticalJaw * forwardJaw * headMask, 0, 1);

    // Cleanly separate upper lip (jawWeight -> 0) from lower lip (jawWeight -> 1) across y = -3.10
    const mouthZone = gaussianLobe(target, new Vec3(0, -3.10, 6.8), new Vec3(2.3, 1.35, 3.0));
    if (mouthZone > 0.05) {
      const lowerLipFactor = Utils.smoothstep(-2.85, -3.35, target.y);
      jawWeight = Utils.lerp(jawWeight, lowerLipFactor, Utils.clamp(mouthZone * 1.25, 0, 1));
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

      // Slightly bulge the cornea at the front pole (v < 0.26)
      const corneaBulge = v < 0.26 ? Trigo.cosinePrecise((v / 0.26) * Trigo.halfpi) * 0.08 : 0;
      const r = radius + corneaBulge;
      const signCenter = center.x < 0 ? -1 : 1;

      scratchPos.setScalar(
        center.x + signCenter * r * sinPhi * cosTheta,
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
  const archWidth = 1.72;
  const archDepth = 1.35;
  const zFront = 5.45;

  for (let row = 0; row <= 2; row++) {
    const v = row / 2;
    const y = yBase + (row === 1 ? yHeight : 0);
    const zInset = row === 2 ? -0.28 : 0;

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
 * Append inner oral cavity backwall and surface-conforming 3D eyebrows.
 */
function appendMouthInnerAndBrows(
  positions: number[],
  uvs: number[],
  indices: number[],
  vertexRegionMap: number[],
  jawWeights: number[],
  submeshes: ISubmeshRange[]
): void {
  // 1. Inner mouth cavity backplate (behind teeth & oral commissures)
  const startVertexMouth = positions.length / 3;
  const startIndexMouth = indices.length;
  const mw = 1.85;
  const myTop = -2.25;
  const myBot = -4.05;
  const mz = 4.55;

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

  // 2. Surface-conforming 3D Eyebrow volumes (Left & Right)
  // Sample `shapeAnatomicalHeadPoint` directly along the supraorbital brow ridge so the 3D eyebrows
  // hug the forehead curvature with zero floating gap!
  const startVertexBrows = positions.length / 3;
  const startIndexBrows = indices.length;
  const segBrow = 12;
  const rowsBrow = 2;

  for (const side of [-1, 1]) {
    const baseV = positions.length / 3;
    for (let row = 0; row <= rowsBrow; row++) {
      const rowNorm = row / rowsBrow; // 0 = bottom edge, 0.5 = raised ridge crest, 1 = top edge
      const rowOffsetV = (rowNorm - 0.5) * 0.022;
      const crestLift = row === 1 ? 0.14 : 0.02;

      for (let i = 0; i <= segBrow; i++) {
        const t = i / segBrow; // 0 = medial (inner brow), 1 = lateral (outer brow tail)
        const uBrow = side * Utils.lerp(0.038, 0.198, t);
        // Natural masculine brow arch: slightly lower medially, peaking at t = 0.65, tapering laterally
        const archV = Math.sin(Math.pow(t, 0.85) * Trigo.pi) * 0.016 - (1.0 - t) * 0.005;
        const vBrow = 0.678 + archV + rowOffsetV * (1.0 - t * 0.38);

        shapeAnatomicalHeadPoint(uBrow, vBrow, scratchPos);
        // Taper lift at medial & lateral ends so the brow blends seamlessly into the skin
        const endTaper = Math.sin(t * Trigo.pi);
        const lift = crestLift * (0.35 + 0.65 * endTaper);

        positions.push(
          scratchPos.x + side * lift * 0.25,
          scratchPos.y,
          scratchPos.z + lift
        );
        uvs.push(0.85 + t * 0.13, 0.78 + rowNorm * 0.18);
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
export function buildAnatomicalBaseHead(segU: number = 64, segV: number = 48): IBaseHeadGeometry {
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
    // Concentrate horizontal edge loops around the eyes/nose/mouth (v in [0.24, 0.76])
    const vRemapped = Utils.lerp(v, Utils.smoothstep(0, 1, v), 0.22);

    for (let iu = 0; iu <= segU; iu++) {
      const u = (2 * iu - segU) / segU; // Exact symmetric [-1, 1], with u = 0 on the anterior X=0 symmetry plane

      const jawW = shapeAnatomicalHeadPoint(u, vRemapped, scratchPos);
      positions.push(scratchPos.x, scratchPos.y, scratchPos.z);

      // Map vertical UV coordinate directly from physical height Y (in [-11.0, +10.5]) on the head
      // so the procedural texture atlas aligns with 100% precision to every sculpted feature!
      const yHeightNorm = Utils.clamp((scratchPos.y + 11.0) / 21.5, 0.0, 1.0);
      const sv = Utils.lerp(vRemapped * 0.85, yHeightNorm, Utils.smoothstep(0.18, 0.28, vRemapped));

      // Map skin UVs into the upper 75% of the texture atlas (v in [0.02, 0.74])
      scratchUv.setScalar(
        Utils.clamp(0.5 + u * 0.48, 0.01, 0.99),
        Utils.clamp(0.74 - sv * 0.72, 0.02, 0.74)
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
    neck: new Vec3(0, -8.2, -1.5),
    jaw: new Vec3(0, -1.6, 1.4),
    eyeLeft: new Vec3(-2.35, 1.85, 4.65),
    eyeRight: new Vec3(2.35, 1.85, 4.65),
  };

  // 3. Left & Right Eyeballs (mapped to lower-left UV quadrant, tucked cleanly inside wrapping eyelids)
  appendEyeballSphere(
    pivots.eyeLeft,
    1.14,
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
    1.14,
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
    -2.55,
    -0.55,
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
    -3.65,
    0.55,
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

  // 5. Inner Oral Cavity & Surface-Conforming 3D Eyebrows
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
