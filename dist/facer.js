/*
MIT License

Copyright (c) 2026 Ludovic CLUBER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

https://github.com/1pizzateam/FaceR.js
*/

import { Rand, Utils, Vec2, Vec3, Trigo, Quat, Mat4x3 } from '@1pizzateam/spock';
export { Accumulator, Bezier, Box, Frustum, Mat3, Mat4, Mat4x3, Plane, Quat, Rand, Ray2, Ray3, Sphere, Time, Trigo, Utils, Vec2, Vec3 } from '@1pizzateam/spock';
import { CustomMesh, Mesh, Material, PhongShader, Texture } from '@1pizzateam/roostr';

const FACS_MUSCLE_NAMES = [
    'browInnerUp',
    'browDownL',
    'browDownR',
    'browOuterUpL',
    'browOuterUpR',
    'eyeBlinkL',
    'eyeBlinkR',
    'eyeSquintL',
    'eyeSquintR',
    'eyeWideL',
    'eyeWideR',
    'cheekSquintL',
    'cheekSquintR',
    'noseSneerL',
    'noseSneerR',
    'jawOpen',
    'jawForward',
    'jawLeft',
    'jawRight',
    'mouthSmileL',
    'mouthSmileR',
    'mouthFrownL',
    'mouthFrownR',
    'mouthPucker',
    'mouthFunnel',
    'mouthUpperUpL',
    'mouthUpperUpR',
    'mouthLowerDownL',
    'mouthLowerDownR',
    'mouthShrugUpper',
    'mouthPress'
];
const SUBMESH_REGIONS = [
    'skin',
    'eyeLeft',
    'eyeRight',
    'teethUpper',
    'teethLower',
    'mouthInner',
    'browsHair'
];
const FACE_REGIONS = SUBMESH_REGIONS;
const FACE_REGION_IDS = {
    skin: 0,
    eyeLeft: 1,
    eyeRight: 2,
    teethUpper: 3,
    teethLower: 4,
    mouthInner: 5,
    browsHair: 6
};

const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;
const CHANNEL_STRIDE = 37;
const CHANNEL_PHASE_OFFSET = 17.371;
class Perlin1D {
    perm;
    grad;
    seedValue;
    constructor(seed = 1997) {
        this.perm = new Uint8Array(TABLE_SIZE * 2);
        this.grad = new Float32Array(TABLE_SIZE);
        this.seedValue = seed;
        this.reseed(seed);
    }
    get seed() {
        return this.seedValue;
    }
    reseed(seed) {
        this.seedValue = seed;
        const rng = Rand.create(seed);
        const p = new Uint8Array(TABLE_SIZE);
        for (let i = 0; i < TABLE_SIZE; i++) {
            p[i] = i;
            this.grad[i] = rng.float(-1, 1);
        }
        for (let i = TABLE_SIZE - 1; i > 0; i--) {
            const j = rng.integer(0, i);
            const tmp = p[i];
            p[i] = p[j];
            p[j] = tmp;
        }
        for (let i = 0; i < TABLE_SIZE; i++) {
            this.perm[i] = p[i];
            this.perm[i + TABLE_SIZE] = p[i];
        }
        return this;
    }
    sample(x, channel = 0) {
        const coord = x + channel * CHANNEL_PHASE_OFFSET;
        const xi = Utils.floor(coord, 0);
        const xf = coord - xi;
        const u = Utils.smoothstep(0, 1, xf);
        const idx = (xi + channel * CHANNEL_STRIDE) & TABLE_MASK;
        const g0 = this.grad[this.perm[idx]];
        const g1 = this.grad[this.perm[idx + 1]];
        const v0 = g0 * xf;
        const v1 = g1 * (xf - 1);
        return Utils.clampToExtent(Utils.lerp(v0, v1, u) * 2.0, 1.0);
    }
    fbm(x, octaves = 2, channel = 0) {
        let total = 0;
        let amp = 1.0;
        let freq = 1.0;
        let norm = 0;
        const count = Utils.clamp(octaves, 1, 6);
        for (let i = 0; i < count; i++) {
            total += this.sample(x * freq, channel + i * 13) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2.03;
        }
        return norm > 0 ? total / norm : 0;
    }
    sampleVec2(time, freq, amp, target = new Vec2(), baseChannel = 0) {
        return target.setScalar(this.sample(time * freq.x, baseChannel) * amp.x, this.sample(time * freq.y, baseChannel + 1) * amp.y);
    }
    sampleVec3(time, freq, amp, target = new Vec3(), baseChannel = 0) {
        return target.setScalar(this.sample(time * freq.x, baseChannel) * amp.x, this.sample(time * freq.y, baseChannel + 1) * amp.y, this.sample(time * freq.z, baseChannel + 2) * amp.z);
    }
    fbmVec2(time, freq, amp, octaves = 2, target = new Vec2(), baseChannel = 0) {
        return target.setScalar(this.fbm(time * freq.x, octaves, baseChannel) * amp.x, this.fbm(time * freq.y, octaves, baseChannel + 1) * amp.y);
    }
    fbmVec3(time, freq, amp, octaves = 2, target = new Vec3(), baseChannel = 0) {
        return target.setScalar(this.fbm(time * freq.x, octaves, baseChannel) * amp.x, this.fbm(time * freq.y, octaves, baseChannel + 1) * amp.y, this.fbm(time * freq.z, octaves, baseChannel + 2) * amp.z);
    }
}

const REGION_ID = {
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
function gaussianLobe(pos, center, radii) {
    const dx = (pos.x - center.x) / radii.x;
    const dy = (pos.y - center.y) / radii.y;
    const dz = (pos.z - center.z) / radii.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 9.0)
        return 0;
    return Math.exp(-d2);
}
function symmetricLobe(pos, absCenter, radii) {
    scratchCenter.setScalar(-absCenter.x, absCenter.y, absCenter.z);
    const left = gaussianLobe(pos, scratchCenter, radii);
    scratchCenter.setScalar(absCenter.x, absCenter.y, absCenter.z);
    const right = gaussianLobe(pos, scratchCenter, radii);
    return left + right;
}
function shapeAnatomicalHeadPoint(u, v, target) {
    const azimuth = u * Trigo.pi;
    const sinAz = Trigo.sinePrecise(azimuth);
    const cosAz = Trigo.cosinePrecise(azimuth);
    const absU = Math.abs(u);
    const signU = u >= 0 ? 1 : -1;
    let x = 0;
    let y = 0;
    let z = 0;
    if (v < 0.20) {
        const t = Utils.normalize(v, 0.0, 0.20);
        y = Utils.lerp(-11, -5.8, t);
        const collarFlare = Math.pow(1.0 - t, 1.8);
        const rx = Utils.lerp(3.55, 4.45, collarFlare);
        const rz = Utils.lerp(3.75, 4.55, collarFlare);
        const zCenter = Utils.lerp(-1.65, -1.35, t);
        const throatBulge = Math.max(0, cosAz) * 0.32 * Math.sin(t * Trigo.pi);
        x = sinAz * rx;
        z = zCenter + cosAz * rz + throatBulge;
    }
    else {
        const vHead = Utils.clamp((v - 0.26) / 0.74, 0.0, 1.0);
        const submentalBlend = Utils.smoothstep(0.20, 0.28, v);
        const neckX = sinAz * 3.55;
        const neckY = Utils.lerp(-5.8, -5.4, Utils.clamp((v - 0.20) / 0.08, 0, 1));
        const neckZ = -1.35 + cosAz * 3.75;
        let domeFactor = 1.0;
        let headY = 0;
        if (vHead <= 0.74) {
            const tFace = vHead / 0.74;
            headY = Utils.lerp(-6.35, 6.4, tFace);
            domeFactor = 1.0;
        }
        else {
            const tDome = (vHead - 0.74) / 0.26;
            const phi = tDome * Trigo.halfpi;
            headY = 6.4 + Trigo.sinePrecise(phi) * 4.1;
            domeFactor = Math.pow(Math.max(0, Trigo.cosinePrecise(phi)), 0.82);
        }
        const jawTaper = Utils.smoothstep(-6.4, -1.5, headY);
        const templeIndent = Math.exp(-Math.pow((headY - 2.8) / 2.2, 2)) * 0.28;
        const parietalFullness = Math.exp(-Math.pow((headY - 5.2) / 3.0, 2)) * 0.35;
        let rx = (Utils.lerp(4.2, 6.15, jawTaper) - templeIndent + parietalFullness) * domeFactor;
        const occiputBulge = Math.exp(-Math.pow((headY - 2.6) / 4.2, 2)) * 1.15;
        const rzFront = Utils.lerp(6.5, 6.85, Utils.smoothstep(-6.4, 2.5, headY)) * domeFactor;
        const rzBack = (Utils.lerp(5.2, 6.95, Utils.smoothstep(-5.5, 2.0, headY)) + occiputBulge) * domeFactor;
        const zCenter = Utils.lerp(0.45, -0.55, Utils.smoothstep(-5.5, 4.5, headY)) * domeFactor;
        const rz = cosAz >= 0 ? rzFront : rzBack;
        let frontXScale = 1.0;
        if (cosAz > 0 && headY < 0.5) {
            const lowerT = Utils.clamp((0.5 - headY) / 6.85, 0, 1);
            frontXScale = 1.0 - lowerT * 0.38 * Math.pow(cosAz, 1.4);
        }
        const facialPlaneFlatten = cosAz > 0.25
            ? 1.0 - 0.08 * Math.sin((cosAz - 0.25) / 0.75 * Trigo.pi) * Utils.smoothstep(7.0, 3.5, headY)
            : 1.0;
        const headX = sinAz * rx * frontXScale;
        const headZ = zCenter + cosAz * rz * facialPlaneFlatten;
        x = Utils.lerp(neckX, headX, submentalBlend);
        y = Utils.lerp(neckY, headY, submentalBlend);
        z = Utils.lerp(neckZ, headZ, submentalBlend);
    }
    target.setScalar(x, y, z);
    const headMask = Utils.smoothstep(0.21, 0.29, v) * Utils.smoothstep(0.98, 0.88, v);
    const frontMask = Utils.smoothstep(-0.15, 0.25, cosAz) * headMask;
    if (frontMask > 0) {
        const gonion = symmetricLobe(target, new Vec3(4.75, -3.95, 1.35), new Vec3(1.85, 1.85, 2.5));
        const jawRidge = symmetricLobe(target, new Vec3(3.35, -5.15, 4.15), new Vec3(2.2, 1.25, 2.6));
        target.x += signU * (gonion * 0.65 + jawRidge * 0.28) * frontMask;
        target.y -= (gonion * 0.45 + jawRidge * 0.32) * frontMask;
        target.z += jawRidge * 0.35 * frontMask;
        const chinPad = gaussianLobe(target, new Vec3(0, -5.65, 6.2), new Vec3(1.85, 1.25, 2.8));
        const chinCleft = gaussianLobe(target, new Vec3(0, -5.75, 6.8), new Vec3(0.32, 0.95, 2.0));
        const labiomentalCrease = gaussianLobe(target, new Vec3(0, -4.35, 6.4), new Vec3(1.95, 0.62, 2.5));
        target.z += (chinPad * 1.15 - chinCleft * 0.18 - labiomentalCrease * 0.62) * frontMask;
        target.y -= chinPad * 0.28 * frontMask;
        const malarProminence = symmetricLobe(target, new Vec3(4.15, 0.55, 5.2), new Vec3(2.15, 1.65, 2.8));
        const zygomaticArch = symmetricLobe(target, new Vec3(5.35, 0.75, 2.4), new Vec3(1.45, 1.15, 2.6));
        const buccalHollow = symmetricLobe(target, new Vec3(3.95, -2.35, 4.2), new Vec3(1.75, 1.75, 2.5));
        const nasolabial = symmetricLobe(target, new Vec3(1.85, -1.85, 6.4), new Vec3(0.55, 1.35, 2.2));
        target.x += signU * (malarProminence * 0.55 + zygomaticArch * 0.48 - buccalHollow * 0.38) * frontMask;
        target.z += (malarProminence * 0.78 - buccalHollow * 0.45 - nasolabial * 0.25) * frontMask;
        target.y += malarProminence * 0.15 * frontMask;
        const foreheadBoss = symmetricLobe(target, new Vec3(2.15, 5.45, 6.2), new Vec3(2.6, 1.95, 2.8));
        const temporalHollow = symmetricLobe(target, new Vec3(5.25, 3.35, 3.2), new Vec3(1.45, 1.95, 2.4));
        const browArch = symmetricLobe(target, new Vec3(2.35, 3.15, 6.5), new Vec3(2.15, 0.78, 2.8));
        const glabella = gaussianLobe(target, new Vec3(0, 3.05, 6.6), new Vec3(1.15, 0.85, 2.6));
        const nasionIndent = gaussianLobe(target, new Vec3(0, 2.25, 6.6), new Vec3(0.95, 0.52, 2.5));
        target.x -= signU * temporalHollow * 0.42 * frontMask;
        target.z += (foreheadBoss * 0.42 + browArch * 0.92 + glabella * 0.65 - nasionIndent * 0.48) * frontMask;
        target.y -= browArch * 0.14 * frontMask;
        const eyeSocketRecess = symmetricLobe(target, new Vec3(2.35, 1.95, 5.8), new Vec3(1.68, 1.22, 3.0));
        target.z -= eyeSocketRecess * 0.48 * frontMask;
        const dxEye = (Math.abs(target.x) - 2.35) / 1.22;
        const dyEye = (target.y - 1.85) / 0.64;
        const rEyeSq = dxEye * dxEye + dyEye * dyEye;
        if (rEyeSq < 3.2) {
            const almondProfile = Math.max(0, 1.0 - dxEye * dxEye);
            const upperLidFold = Math.exp(-Math.pow((target.y - (1.85 + 0.42 * almondProfile)) / 0.28, 2)) * Math.exp(-dxEye * dxEye * 1.15);
            const lowerLidFold = Math.exp(-Math.pow((target.y - (1.85 - 0.38 * almondProfile)) / 0.26, 2)) * Math.exp(-dxEye * dxEye * 1.25);
            const lidCrease = Math.exp(-Math.pow((target.y - (1.85 + 0.76 * almondProfile)) / 0.16, 2)) * Math.exp(-dxEye * dxEye * 1.1);
            target.z += (upperLidFold * 1.05 + lowerLidFold * 0.88 - lidCrease * 0.32) * frontMask;
            const fissureWeight = Math.exp(-dxEye * dxEye * 1.65) * Math.exp(-dyEye * dyEye * 2.1);
            if (fissureWeight > 0.02) {
                const smoothSignY = Math.tanh(dyEye * 4.5);
                target.y += smoothSignY * 0.30 * almondProfile * fissureWeight * frontMask;
                const innerSlit = Math.exp(-dyEye * dyEye * 4.8) * Math.exp(-dxEye * dxEye * 1.85);
                target.z -= innerSlit * 1.48 * frontMask;
            }
        }
        const noseBridge = gaussianLobe(target, new Vec3(0, 1.35, 6.6), new Vec3(0.68, 1.15, 2.8));
        const noseDorsum = gaussianLobe(target, new Vec3(0, 0.25, 6.8), new Vec3(0.75, 0.95, 2.8));
        const noseTip = gaussianLobe(target, new Vec3(0, -0.68, 7.0), new Vec3(0.88, 0.78, 3.0));
        const columella = gaussianLobe(target, new Vec3(0, -1.28, 6.8), new Vec3(0.42, 0.48, 2.5));
        const nostrilWings = symmetricLobe(target, new Vec3(1.08, -0.95, 6.6), new Vec3(0.65, 0.58, 2.4));
        const alarGroove = symmetricLobe(target, new Vec3(1.52, -0.78, 6.3), new Vec3(0.42, 0.65, 2.2));
        const nostrilCavities = symmetricLobe(target, new Vec3(0.68, -1.22, 6.8), new Vec3(0.35, 0.28, 2.0));
        target.z += (noseBridge * 1.35 +
            noseDorsum * 1.85 +
            noseTip * 2.25 +
            columella * 1.15 +
            nostrilWings * 1.05 -
            alarGroove * 0.42 -
            nostrilCavities * 0.45) * frontMask;
        target.y -= (noseTip * 0.18 - nostrilCavities * 0.16) * frontMask;
        target.x += signU * (nostrilWings * 0.28 - noseBridge * 0.16 * Math.min(1, Math.abs(target.x))) * frontMask;
        const philtrumDimple = gaussianLobe(target, new Vec3(0, -1.85, 6.8), new Vec3(0.38, 0.55, 2.2));
        const philtrumColumns = symmetricLobe(target, new Vec3(0.42, -1.95, 6.8), new Vec3(0.28, 0.52, 2.2));
        const muzzleBarrel = gaussianLobe(target, new Vec3(0, -2.95, 6.4), new Vec3(2.45, 1.45, 2.8));
        const upperLip = gaussianLobe(target, new Vec3(0, -2.62, 6.9), new Vec3(1.75, 0.46, 2.5));
        const cupidsBowDip = gaussianLobe(target, new Vec3(0, -2.38, 7.2), new Vec3(0.32, 0.28, 2.0));
        const lowerLip = gaussianLobe(target, new Vec3(0, -3.58, 6.8), new Vec3(1.58, 0.52, 2.5));
        const mouthCorners = symmetricLobe(target, new Vec3(1.98, -3.12, 6.2), new Vec3(0.55, 0.52, 2.2));
        target.z += (muzzleBarrel * 0.58 +
            philtrumColumns * 0.22 -
            philtrumDimple * 0.28 +
            upperLip * 0.95 -
            cupidsBowDip * 0.22 +
            lowerLip * 0.92 -
            mouthCorners * 0.52) * frontMask;
        const dxMouth = target.x / 1.82;
        const dyMouth = (target.y - (-3.1)) / 0.36;
        const mouthCrease = Math.exp(-dxMouth * dxMouth * 1.45) * Math.exp(-dyMouth * dyMouth * 2.4);
        if (mouthCrease > 0.02) {
            const lipRollY = Math.tanh(dyMouth * 3.5);
            target.y += lipRollY * 0.12 * mouthCrease * frontMask;
            target.z -= Math.exp(-dyMouth * dyMouth * 4.2) * 0.68 * mouthCrease * frontMask;
        }
    }
    if (headMask > 0.1) {
        const earOuter = symmetricLobe(target, new Vec3(6.05, 0.45, -0.65), new Vec3(1.15, 1.85, 1.25));
        const earHelixRim = symmetricLobe(target, new Vec3(6.25, 0.65, -0.95), new Vec3(0.85, 1.65, 0.85));
        const earConcha = symmetricLobe(target, new Vec3(6.15, 0.35, -0.45), new Vec3(0.65, 0.92, 0.68));
        if (earOuter > 0.02) {
            target.x += signU * (earOuter * 0.95 + earHelixRim * 0.45 - earConcha * 0.42) * headMask;
            target.z -= (earOuter * 0.28 + earHelixRim * 0.22) * headMask;
        }
        const foreheadHairlineY = 6.35 - 0.35 * Math.cos(absU * 14.0) * Utils.smoothstep(0.28, 0.0, absU);
        const frontHairMask = Utils.smoothstep(foreheadHairlineY - 0.35, foreheadHairlineY + 0.35, target.y);
        const sideburnMask = Utils.smoothstep(0.32, 0.38, absU) * Utils.smoothstep(0.47, 0.42, absU) *
            Utils.smoothstep(0.1, 0.8, target.y) * Utils.smoothstep(6.8, 5.5, target.y);
        const backScalpMask = Utils.smoothstep(0.36, 0.48, absU) * Utils.smoothstep(-3.6, -2.6, target.y);
        const hairVolume = Math.max(frontHairMask, sideburnMask * 0.75, backScalpMask) * Utils.smoothstep(10.4, 9.6, target.y);
        if (hairVolume > 0.01) {
            const crownFlat = Utils.smoothstep(7.2, 9.5, target.y) * (1.0 - absU * 0.5);
            target.x += sinAz * (0.20 * hairVolume + 0.18 * crownFlat);
            target.y += 0.22 * hairVolume;
            target.z += cosAz * 0.22 * hairVolume;
        }
    }
    let jawWeight = 0;
    if (v > 0.21 && target.y < -1.2) {
        const verticalJaw = Utils.smoothstep(-1.4, -4.8, target.y) * Utils.smoothstep(-6.8, -5.2, target.y);
        const forwardJaw = Utils.smoothstep(-1.5, 3.2, target.z);
        jawWeight = Utils.clamp(verticalJaw * forwardJaw * headMask, 0, 1);
        const mouthZone = gaussianLobe(target, new Vec3(0, -3.1, 6.8), new Vec3(2.3, 1.35, 3.0));
        if (mouthZone > 0.05) {
            const lowerLipFactor = Utils.smoothstep(-2.85, -3.35, target.y);
            jawWeight = Utils.lerp(jawWeight, lowerLipFactor, Utils.clamp(mouthZone * 1.25, 0, 1));
        }
    }
    return jawWeight;
}
function appendEyeballSphere(center, radius, uvOffset, uvScale, regionName, positions, uvs, indices, vertexRegionMap, jawWeights, submeshes) {
    const segU = 20;
    const segV = 14;
    const startVertex = positions.length / 3;
    const startIndex = indices.length;
    for (let iv = 0; iv <= segV; iv++) {
        const v = iv / segV;
        const phi = v * Trigo.pi;
        const sinPhi = Trigo.sinePrecise(phi);
        const cosPhi = Trigo.cosinePrecise(phi);
        for (let iu = 0; iu <= segU; iu++) {
            const u = iu / segU;
            const theta = u * Trigo.twopi;
            const sinTheta = Trigo.sinePrecise(theta);
            const cosTheta = Trigo.cosinePrecise(theta);
            const corneaBulge = v < 0.26 ? Trigo.cosinePrecise((v / 0.26) * Trigo.halfpi) * 0.08 : 0;
            const r = radius + corneaBulge;
            const signCenter = center.x < 0 ? -1 : 1;
            scratchPos.setScalar(center.x + signCenter * r * sinPhi * cosTheta, center.y + r * sinPhi * sinTheta, center.z + r * cosPhi);
            positions.push(scratchPos.x, scratchPos.y, scratchPos.z);
            const radial = Math.min(1, v * 1.65);
            scratchUv.setScalar(uvOffset.x + (0.5 + 0.48 * radial * cosTheta) * uvScale.x, uvOffset.y + (0.5 + 0.48 * radial * sinTheta) * uvScale.y);
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
function appendDentalArch(yBase, yHeight, jawWeight, uvBoxMin, uvBoxMax, regionName, positions, uvs, indices, vertexRegionMap, jawWeights, submeshes) {
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
            uvs.push(Utils.lerp(uvBoxMin.x, uvBoxMax.x, u), Utils.lerp(uvBoxMin.y, uvBoxMax.y, v));
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
            }
            else {
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
function appendMouthInnerAndBrows(positions, uvs, indices, vertexRegionMap, jawWeights, submeshes) {
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
    indices.push(startVertexMouth, startVertexMouth + 2, startVertexMouth + 1, startVertexMouth, startVertexMouth + 3, startVertexMouth + 2);
    submeshes.push({
        name: 'mouthInner',
        startIndex: startIndexMouth,
        indexCount: 6,
        startVertex: startVertexMouth,
        vertexCount: 4,
    });
    const startVertexBrows = positions.length / 3;
    const startIndexBrows = indices.length;
    const segBrow = 12;
    const rowsBrow = 2;
    for (const side of [-1, 1]) {
        const baseV = positions.length / 3;
        for (let row = 0; row <= rowsBrow; row++) {
            const rowNorm = row / rowsBrow;
            const rowOffsetV = (rowNorm - 0.5) * 0.022;
            const crestLift = row === 1 ? 0.14 : 0.02;
            for (let i = 0; i <= segBrow; i++) {
                const t = i / segBrow;
                const uBrow = side * Utils.lerp(0.038, 0.198, t);
                const archV = Math.sin(Math.pow(t, 0.85) * Trigo.pi) * 0.016 - (1.0 - t) * 0.005;
                const vBrow = 0.678 + archV + rowOffsetV * (1.0 - t * 0.38);
                shapeAnatomicalHeadPoint(uBrow, vBrow, scratchPos);
                const endTaper = Math.sin(t * Trigo.pi);
                const lift = crestLift * (0.35 + 0.65 * endTaper);
                positions.push(scratchPos.x + side * lift * 0.25, scratchPos.y, scratchPos.z + lift);
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
                }
                else {
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
function buildAnatomicalBaseHead(segU = 64, segV = 48) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const vertexRegionMap = [];
    const jawWeights = [];
    const submeshes = [];
    const startSkinVertex = 0;
    const startSkinIndex = 0;
    for (let iv = 0; iv <= segV; iv++) {
        const v = iv / segV;
        const vRemapped = Utils.lerp(v, Utils.smoothstep(0, 1, v), 0.22);
        for (let iu = 0; iu <= segU; iu++) {
            const u = (2 * iu - segU) / segU;
            const jawW = shapeAnatomicalHeadPoint(u, vRemapped, scratchPos);
            positions.push(scratchPos.x, scratchPos.y, scratchPos.z);
            const yHeightNorm = Utils.clamp((scratchPos.y + 11.0) / 21.5, 0.0, 1.0);
            const sv = Utils.lerp(vRemapped * 0.85, yHeightNorm, Utils.smoothstep(0.18, 0.28, vRemapped));
            scratchUv.setScalar(Utils.clamp(0.5 + u * 0.48, 0.01, 0.99), Utils.clamp(0.74 - sv * 0.72, 0.02, 0.74));
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
    const pivots = {
        neck: new Vec3(0, -8.2, -1.5),
        jaw: new Vec3(0, -1.6, 1.4),
        eyeLeft: new Vec3(-2.35, 1.85, 4.65),
        eyeRight: new Vec3(2.35, 1.85, 4.65),
    };
    appendEyeballSphere(pivots.eyeLeft, 1.14, new Vec2(0.02, 0.76), new Vec2(0.22, 0.22), 'eyeLeft', positions, uvs, indices, vertexRegionMap, jawWeights, submeshes);
    appendEyeballSphere(pivots.eyeRight, 1.14, new Vec2(0.26, 0.76), new Vec2(0.22, 0.22), 'eyeRight', positions, uvs, indices, vertexRegionMap, jawWeights, submeshes);
    appendDentalArch(-2.55, -0.55, 0.0, new Vec2(0.52, 0.78), new Vec2(0.82, 0.85), 'teethUpper', positions, uvs, indices, vertexRegionMap, jawWeights, submeshes);
    appendDentalArch(-3.65, 0.55, 1.0, new Vec2(0.52, 0.86), new Vec2(0.82, 0.93), 'teethLower', positions, uvs, indices, vertexRegionMap, jawWeights, submeshes);
    appendMouthInnerAndBrows(positions, uvs, indices, vertexRegionMap, jawWeights, submeshes);
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
function computeSmoothNormals(positions, indices) {
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
const createBaseHeadTopology = buildAnatomicalBaseHead;
let _cachedBaseHead = null;
function getCanonicalBaseHead() {
    if (!_cachedBaseHead) {
        _cachedBaseHead = buildAnatomicalBaseHead();
    }
    return _cachedBaseHead;
}

function regionFalloff(pos, center, radii) {
    const dx = (pos.x - center.x) / radii.x;
    const dy = (pos.y - center.y) / radii.y;
    const dz = (pos.z - center.z) / radii.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 9.0)
        return 0;
    return Math.exp(-d2);
}
function symmetricFalloff(pos, center, radii) {
    const dx = (Math.abs(pos.x) - center.x) / radii.x;
    const dy = (pos.y - center.y) / radii.y;
    const dz = (pos.z - center.z) / radii.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 9.0)
        return 0;
    return Math.exp(-d2);
}
function applyMacroProportions(baseHead, proportions, sculptOffsets, outPositions, outPivots) {
    const srcPos = baseHead.positions;
    const regionMap = baseHead.vertexRegionMap;
    const vertexCount = baseHead.vertexCount;
    const basePivots = baseHead.pivots;
    outPivots.neck.copy(basePivots.neck);
    outPivots.jaw.setScalar(basePivots.jaw.x, basePivots.jaw.y * proportions.jawScale.y, basePivots.jaw.z * proportions.jawScale.z);
    outPivots.eyeLeft.setScalar(basePivots.eyeLeft.x - proportions.eyeSocketOffset.x, basePivots.eyeLeft.y + proportions.eyeSocketOffset.y, basePivots.eyeLeft.z + proportions.eyeSocketOffset.z);
    outPivots.eyeRight.setScalar(basePivots.eyeRight.x + proportions.eyeSocketOffset.x, basePivots.eyeRight.y + proportions.eyeSocketOffset.y, basePivots.eyeRight.z + proportions.eyeSocketOffset.z);
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
    const cMouth = new Vec3(0, -3.1, 6.6);
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
        }
        else if (region === FACE_REGION_IDS.eyeRight) {
            p.x += proportions.eyeSocketOffset.x;
            p.y += proportions.eyeSocketOffset.y;
            p.z += proportions.eyeSocketOffset.z;
        }
        else if (region === FACE_REGION_IDS.browsHair) {
            p.x += signX * (proportions.browOffset.x + proportions.eyeSocketOffset.x * 0.65);
            p.y += proportions.browOffset.y + proportions.eyeSocketOffset.y * 0.65;
            p.z += proportions.browOffset.z + proportions.eyeSocketOffset.z * 0.65;
        }
        else if (region === FACE_REGION_IDS.teethUpper ||
            region === FACE_REGION_IDS.teethLower ||
            region === FACE_REGION_IDS.mouthInner) {
            p.x *= Utils.lerp(1.0, proportions.mouthScale.x, 0.65);
            p.y += (proportions.jawScale.y - 1.0) * -1.8;
            p.z += (proportions.mouthScale.z - 1.0) * 1.2;
        }
        else {
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
function evaluateSingleMuscleDisplacement(muscleName, pos, region, pivots, outDelta) {
    outDelta.origin();
    if (region === FACE_REGION_IDS.eyeLeft ||
        region === FACE_REGION_IDS.eyeRight ||
        region === FACE_REGION_IDS.teethUpper) {
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
            if (region === FACE_REGION_IDS.browsHair)
                break;
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
            if (region === FACE_REGION_IDS.browsHair)
                break;
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
                outDelta.setScalar(signX * (0.78 * wCorner + 0.28 * wCheek), 0.95 * wCorner + 0.45 * wCheek, -0.22 * wCorner + 0.32 * wCheek);
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
            const w = regionFalloff(pos, new Vec3(0, -3.1, 6.6), new Vec3(2.6, 1.48, 2.6));
            if (w > 0.002) {
                outDelta.setScalar(-pos.x * 0.38 * w, 0, 0.88 * w);
            }
            break;
        }
        case 'mouthFunnel': {
            const w = regionFalloff(pos, new Vec3(0, -3.1, 6.6), new Vec3(2.5, 1.48, 2.6));
            if (w > 0.002) {
                const dy = pos.y - -3.1;
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
                outDelta.setScalar(signX * 0.18 * w, -0.8 * w, 0.22 * w);
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
            const w = regionFalloff(pos, new Vec3(0, -3.1, 6.8), new Vec3(2.3, 1.15, 2.4));
            if (w > 0.002) {
                const dy = pos.y - -3.1;
                outDelta.setScalar(0, -dy * 0.45 * w, -0.35 * w);
            }
            break;
        }
    }
}
function computeFacsMuscles(positions, indices, vertexRegionMap, pivots) {
    const vertexCount = (positions.length / 3) | 0;
    const baseNormals = computeSmoothNormals(positions, indices);
    const deformedPos = new Float32Array(positions.length);
    const posVec = new Vec3();
    const deltaVec = new Vec3();
    const activeIndices = [];
    const activeDPos = [];
    const result = {};
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

function toVec2(val, defX, defY) {
    if (val instanceof Vec2) {
        return new Vec2().copy(val);
    }
    if (Array.isArray(val) && val.length >= 2) {
        return new Vec2(Number(val[0]) || 0, Number(val[1]) || 0);
    }
    if (val && typeof val === 'object') {
        const obj = val;
        return new Vec2(typeof obj.x === 'number' ? obj.x : defX, typeof obj.y === 'number' ? obj.y : defY);
    }
    return new Vec2(defX, defY);
}
function toVec3(val, defX, defY, defZ) {
    if (val instanceof Vec3) {
        return new Vec3().copy(val);
    }
    if (Array.isArray(val) && val.length >= 3) {
        return new Vec3(Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0);
    }
    if (val && typeof val === 'object') {
        const obj = val;
        return new Vec3(typeof obj.x === 'number' ? obj.x : defX, typeof obj.y === 'number' ? obj.y : defY, typeof obj.z === 'number' ? obj.z : defZ);
    }
    return new Vec3(defX, defY, defZ);
}
function createDefaultProportions() {
    return {
        craniumScale: new Vec3(1, 1, 1),
        jawScale: new Vec3(1, 1, 1),
        chinOffset: new Vec3(0, 0, 0),
        cheekboneOffset: new Vec3(0, 0, 0),
        browOffset: new Vec3(0, 0, 0),
        eyeSocketOffset: new Vec3(0, 0, 0),
        noseScale: new Vec3(1, 1, 1),
        mouthScale: new Vec3(1, 1, 1),
        earScale: new Vec3(1, 1, 1)
    };
}
function createDefaultEmotions() {
    return {
        neutral: {
            name: 'neutral',
            muscles: {},
            headEulerOffset: new Vec3(0, 0, 0)
        },
        angry: {
            name: 'angry',
            muscles: {
                browDownL: 0.92,
                browDownR: 0.92,
                eyeSquintL: 0.55,
                eyeSquintR: 0.55,
                noseSneerL: 0.65,
                noseSneerR: 0.65,
                mouthUpperUpL: 0.48,
                mouthUpperUpR: 0.48,
                mouthLowerDownL: 0.35,
                mouthLowerDownR: 0.35,
                jawForward: 0.42,
                jawOpen: 0.22
            },
            headEulerOffset: new Vec3(-0.08, 0, 0)
        },
        evilGrin: {
            name: 'evilGrin',
            muscles: {
                browDownL: 0.75,
                browDownR: 0.75,
                browOuterUpL: 0.45,
                browOuterUpR: 0.45,
                eyeSquintL: 0.65,
                eyeSquintR: 0.65,
                cheekSquintL: 0.72,
                cheekSquintR: 0.72,
                mouthSmileL: 0.95,
                mouthSmileR: 0.95,
                mouthUpperUpL: 0.35,
                mouthUpperUpR: 0.35,
                jawOpen: 0.28
            },
            headEulerOffset: new Vec3(-0.05, 0.04, 0)
        },
        pain: {
            name: 'pain',
            muscles: {
                browInnerUp: 0.85,
                browDownL: 0.65,
                browDownR: 0.65,
                eyeBlinkL: 0.75,
                eyeBlinkR: 0.75,
                eyeSquintL: 0.90,
                eyeSquintR: 0.90,
                cheekSquintL: 0.80,
                cheekSquintR: 0.80,
                noseSneerL: 0.60,
                noseSneerR: 0.60,
                jawOpen: 0.68,
                mouthFrownL: 0.65,
                mouthFrownR: 0.65,
                mouthLowerDownL: 0.55,
                mouthLowerDownR: 0.55
            },
            headEulerOffset: new Vec3(0.12, -0.06, 0.05)
        },
        surprised: {
            name: 'surprised',
            muscles: {
                browInnerUp: 0.88,
                browOuterUpL: 0.82,
                browOuterUpR: 0.82,
                eyeWideL: 0.92,
                eyeWideR: 0.92,
                jawOpen: 0.62,
                mouthFunnel: 0.55
            },
            headEulerOffset: new Vec3(0.06, 0, 0)
        },
        skeptical: {
            name: 'skeptical',
            muscles: {
                browDownL: 0.82,
                browOuterUpR: 0.88,
                browInnerUp: 0.32,
                eyeSquintL: 0.62,
                mouthSmileR: 0.42,
                mouthFrownL: 0.35,
                mouthShrugUpper: 0.38
            },
            headEulerOffset: new Vec3(-0.03, -0.06, 0.05)
        },
        tired: {
            name: 'tired',
            muscles: {
                browInnerUp: 0.38,
                eyeBlinkL: 0.48,
                eyeBlinkR: 0.48,
                mouthFrownL: 0.35,
                mouthFrownR: 0.35,
                jawOpen: 0.18
            },
            headEulerOffset: new Vec3(-0.12, 0, -0.03)
        },
        alert: {
            name: 'alert',
            muscles: {
                browDownL: 0.42,
                browDownR: 0.42,
                eyeWideL: 0.55,
                eyeWideR: 0.55,
                mouthPress: 0.48,
                jawForward: 0.25
            },
            headEulerOffset: new Vec3(-0.04, 0, 0)
        },
        dead: {
            name: 'dead',
            muscles: {
                eyeBlinkL: 0.82,
                eyeBlinkR: 0.88,
                jawOpen: 0.52,
                jawLeft: 0.25,
                mouthFrownL: 0.32,
                mouthFrownR: 0.32
            },
            headEulerOffset: new Vec3(-0.26, 0.14, -0.18)
        }
    };
}
function createDefaultPersonality() {
    return {
        blinkIntervalRange: new Vec2(2.2, 5.2),
        blinkDuration: 0.16,
        saccadeFrequency: 0.85,
        saccadeAmplitude: new Vec2(0.28, 0.16),
        headFollowRatio: 0.42,
        headDamping: 7.5,
        eyeDamping: 26.0,
        asymmetryAmount: 0.08,
        microJitterAmount: 0.04
    };
}
function createDefaultAppearance() {
    return {
        skinColor: new Vec3(0.86, 0.67, 0.54),
        skinShadowColor: new Vec3(0.58, 0.38, 0.30),
        lipColor: new Vec3(0.72, 0.42, 0.38),
        irisColor: new Vec3(0.24, 0.46, 0.62),
        scleraColor: new Vec3(0.95, 0.94, 0.92),
        browColor: new Vec3(0.22, 0.15, 0.10),
        teethColor: new Vec3(0.93, 0.91, 0.86),
        damageSeed: 1337
    };
}
function rebuildCartridgeRig(cartridge, recomputeMuscles = true) {
    const baseHead = getCanonicalBaseHead();
    if (!cartridge.sculptOffsets || cartridge.sculptOffsets.length !== baseHead.positions.length) {
        cartridge.sculptOffsets = new Float32Array(baseHead.positions.length);
    }
    if (!cartridge.positions || cartridge.positions.length !== baseHead.positions.length) {
        cartridge.positions = new Float32Array(baseHead.positions.length);
    }
    applyMacroProportions(baseHead, cartridge.proportions, cartridge.sculptOffsets, cartridge.positions, cartridge.pivots);
    cartridge.normals = computeSmoothNormals(cartridge.positions, cartridge.indices);
    if (recomputeMuscles) {
        cartridge.muscles = computeFacsMuscles(cartridge.positions, cartridge.indices, cartridge.vertexRegionMap, cartridge.pivots);
    }
    return cartridge;
}
function createDefaultCartridge(name = 'Marine Face', id = 'marine_face') {
    const baseHead = getCanonicalBaseHead();
    const proportions = createDefaultProportions();
    const sculptOffsets = new Float32Array(baseHead.positions.length);
    const positions = new Float32Array(baseHead.positions.length);
    const pivots = {
        neck: new Vec3().copy(baseHead.pivots.neck),
        jaw: new Vec3().copy(baseHead.pivots.jaw),
        eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
        eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
    };
    applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
    const normals = computeSmoothNormals(positions, baseHead.indices);
    const muscles = computeFacsMuscles(positions, baseHead.indices, baseHead.vertexRegionMap, pivots);
    return {
        version: '1.0',
        id,
        name,
        proportions,
        sculptOffsets,
        positions,
        normals,
        uvs: new Float32Array(baseHead.uvs),
        indices: new Int32Array(baseHead.indices),
        submeshes: baseHead.submeshes.map(sm => ({ ...sm })),
        vertexRegionMap: new Uint8Array(baseHead.vertexRegionMap),
        jawWeights: new Float32Array(baseHead.jawWeights),
        pivots,
        muscles,
        emotions: createDefaultEmotions(),
        personality: createDefaultPersonality(),
        appearance: createDefaultAppearance()
    };
}
function roundNumber(n) {
    return Math.round(n * 10000) / 10000;
}
function vec2ToArray(v) {
    return [roundNumber(v.x), roundNumber(v.y)];
}
function vec3ToArray(v) {
    return [roundNumber(v.x), roundNumber(v.y), roundNumber(v.z)];
}
function serializeCartridge(cartridge) {
    const sparseSculptIndices = [];
    const sparseSculptValues = [];
    if (cartridge.sculptOffsets) {
        const vCount = (cartridge.sculptOffsets.length / 3) | 0;
        for (let i = 0; i < vCount; i++) {
            const idx = i * 3;
            const dx = cartridge.sculptOffsets[idx];
            const dy = cartridge.sculptOffsets[idx + 1];
            const dz = cartridge.sculptOffsets[idx + 2];
            if (dx * dx + dy * dy + dz * dz > 1e-7) {
                sparseSculptIndices.push(i);
                sparseSculptValues.push(roundNumber(dx), roundNumber(dy), roundNumber(dz));
            }
        }
    }
    const serializedEmotions = {};
    for (const [key, layer] of Object.entries(cartridge.emotions)) {
        serializedEmotions[key] = {
            name: layer.name,
            muscles: { ...layer.muscles },
            headEulerOffset: vec3ToArray(layer.headEulerOffset)
        };
    }
    const serializedMuscles = {};
    for (const name of FACS_MUSCLE_NAMES) {
        const delta = cartridge.muscles[name];
        if (delta) {
            serializedMuscles[name] = {
                indices: Array.from(delta.indices),
                dPos: Array.from(delta.dPos, roundNumber),
                dNorm: Array.from(delta.dNorm, roundNumber)
            };
        }
    }
    return {
        version: '1.0',
        id: cartridge.id,
        name: cartridge.name,
        proportions: {
            craniumScale: vec3ToArray(cartridge.proportions.craniumScale),
            jawScale: vec3ToArray(cartridge.proportions.jawScale),
            chinOffset: vec3ToArray(cartridge.proportions.chinOffset),
            cheekboneOffset: vec3ToArray(cartridge.proportions.cheekboneOffset),
            browOffset: vec3ToArray(cartridge.proportions.browOffset),
            eyeSocketOffset: vec3ToArray(cartridge.proportions.eyeSocketOffset),
            noseScale: vec3ToArray(cartridge.proportions.noseScale),
            mouthScale: vec3ToArray(cartridge.proportions.mouthScale),
            earScale: vec3ToArray(cartridge.proportions.earScale)
        },
        sculptSparse: {
            indices: sparseSculptIndices,
            dPos: sparseSculptValues
        },
        pivots: {
            neck: vec3ToArray(cartridge.pivots.neck),
            jaw: vec3ToArray(cartridge.pivots.jaw),
            eyeLeft: vec3ToArray(cartridge.pivots.eyeLeft),
            eyeRight: vec3ToArray(cartridge.pivots.eyeRight)
        },
        muscles: serializedMuscles,
        emotions: serializedEmotions,
        personality: {
            blinkIntervalRange: vec2ToArray(cartridge.personality.blinkIntervalRange),
            blinkDuration: cartridge.personality.blinkDuration,
            saccadeFrequency: cartridge.personality.saccadeFrequency,
            saccadeAmplitude: vec2ToArray(cartridge.personality.saccadeAmplitude),
            headFollowRatio: cartridge.personality.headFollowRatio,
            headDamping: cartridge.personality.headDamping,
            eyeDamping: cartridge.personality.eyeDamping,
            asymmetryAmount: cartridge.personality.asymmetryAmount,
            microJitterAmount: cartridge.personality.microJitterAmount
        },
        appearance: {
            skinColor: vec3ToArray(cartridge.appearance.skinColor),
            skinShadowColor: vec3ToArray(cartridge.appearance.skinShadowColor),
            lipColor: vec3ToArray(cartridge.appearance.lipColor),
            irisColor: vec3ToArray(cartridge.appearance.irisColor),
            scleraColor: vec3ToArray(cartridge.appearance.scleraColor),
            browColor: vec3ToArray(cartridge.appearance.browColor),
            teethColor: vec3ToArray(cartridge.appearance.teethColor),
            damageSeed: cartridge.appearance.damageSeed,
            customTierOverrides: cartridge.appearance.customTierOverrides
                ? { ...cartridge.appearance.customTierOverrides }
                : undefined
        }
    };
}
function hydrateCartridge(raw) {
    const obj = (raw && typeof raw === 'object' ? raw : {});
    const baseHead = getCanonicalBaseHead();
    const defProps = createDefaultProportions();
    const rawProps = obj.proportions || {};
    const proportions = {
        craniumScale: toVec3(rawProps.craniumScale, defProps.craniumScale.x, defProps.craniumScale.y, defProps.craniumScale.z),
        jawScale: toVec3(rawProps.jawScale, defProps.jawScale.x, defProps.jawScale.y, defProps.jawScale.z),
        chinOffset: toVec3(rawProps.chinOffset, defProps.chinOffset.x, defProps.chinOffset.y, defProps.chinOffset.z),
        cheekboneOffset: toVec3(rawProps.cheekboneOffset, defProps.cheekboneOffset.x, defProps.cheekboneOffset.y, defProps.cheekboneOffset.z),
        browOffset: toVec3(rawProps.browOffset, defProps.browOffset.x, defProps.browOffset.y, defProps.browOffset.z),
        eyeSocketOffset: toVec3(rawProps.eyeSocketOffset, defProps.eyeSocketOffset.x, defProps.eyeSocketOffset.y, defProps.eyeSocketOffset.z),
        noseScale: toVec3(rawProps.noseScale, defProps.noseScale.x, defProps.noseScale.y, defProps.noseScale.z),
        mouthScale: toVec3(rawProps.mouthScale, defProps.mouthScale.x, defProps.mouthScale.y, defProps.mouthScale.z),
        earScale: toVec3(rawProps.earScale, defProps.earScale.x, defProps.earScale.y, defProps.earScale.z)
    };
    const sculptOffsets = new Float32Array(baseHead.positions.length);
    if (obj.sculptOffsets instanceof Float32Array && obj.sculptOffsets.length === sculptOffsets.length) {
        sculptOffsets.set(obj.sculptOffsets);
    }
    else if (obj.sculptSparse && Array.isArray(obj.sculptSparse.indices) && Array.isArray(obj.sculptSparse.dPos)) {
        const sIdx = obj.sculptSparse.indices;
        const sPos = obj.sculptSparse.dPos;
        for (let k = 0; k < sIdx.length; k++) {
            const vIdx = sIdx[k] * 3;
            const pIdx = k * 3;
            if (vIdx + 2 < sculptOffsets.length && pIdx + 2 < sPos.length) {
                sculptOffsets[vIdx] = Number(sPos[pIdx]) || 0;
                sculptOffsets[vIdx + 1] = Number(sPos[pIdx + 1]) || 0;
                sculptOffsets[vIdx + 2] = Number(sPos[pIdx + 2]) || 0;
            }
        }
    }
    const positions = new Float32Array(baseHead.positions.length);
    const pivots = {
        neck: new Vec3().copy(baseHead.pivots.neck),
        jaw: new Vec3().copy(baseHead.pivots.jaw),
        eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
        eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
    };
    applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
    if (obj.pivots) {
        if (obj.pivots.neck)
            pivots.neck = toVec3(obj.pivots.neck, pivots.neck.x, pivots.neck.y, pivots.neck.z);
        if (obj.pivots.jaw)
            pivots.jaw = toVec3(obj.pivots.jaw, pivots.jaw.x, pivots.jaw.y, pivots.jaw.z);
        if (obj.pivots.eyeLeft)
            pivots.eyeLeft = toVec3(obj.pivots.eyeLeft, pivots.eyeLeft.x, pivots.eyeLeft.y, pivots.eyeLeft.z);
        if (obj.pivots.eyeRight)
            pivots.eyeRight = toVec3(obj.pivots.eyeRight, pivots.eyeRight.x, pivots.eyeRight.y, pivots.eyeRight.z);
    }
    const normals = computeSmoothNormals(positions, baseHead.indices);
    let muscles;
    const hasCompleteSavedMuscles = obj.muscles &&
        typeof obj.muscles === 'object' &&
        FACS_MUSCLE_NAMES.every(m => obj.muscles[m] && obj.muscles[m].indices && obj.muscles[m].dPos);
    if (hasCompleteSavedMuscles) {
        muscles = {};
        for (const m of FACS_MUSCLE_NAMES) {
            const rawM = obj.muscles[m];
            const indices = rawM.indices instanceof Uint16Array ? new Uint16Array(rawM.indices) : new Uint16Array(rawM.indices || []);
            const dPos = rawM.dPos instanceof Float32Array ? new Float32Array(rawM.dPos) : new Float32Array(rawM.dPos || []);
            const dNorm = rawM.dNorm instanceof Float32Array
                ? new Float32Array(rawM.dNorm)
                : new Float32Array(rawM.dNorm || new Float32Array(dPos.length));
            muscles[m] = { indices, dPos, dNorm };
        }
    }
    else {
        muscles = computeFacsMuscles(positions, baseHead.indices, baseHead.vertexRegionMap, pivots);
    }
    const defEmotions = createDefaultEmotions();
    const emotions = { ...defEmotions };
    if (obj.emotions && typeof obj.emotions === 'object') {
        for (const [k, rawLayer] of Object.entries(obj.emotions)) {
            if (rawLayer && typeof rawLayer === 'object') {
                emotions[k] = {
                    name: typeof rawLayer.name === 'string' ? rawLayer.name : k,
                    muscles: { ...(rawLayer.muscles || {}) },
                    headEulerOffset: toVec3(rawLayer.headEulerOffset, 0, 0, 0)
                };
            }
        }
    }
    const defPers = createDefaultPersonality();
    const rawPers = obj.personality || {};
    const personality = {
        blinkIntervalRange: toVec2(rawPers.blinkIntervalRange, defPers.blinkIntervalRange.x, defPers.blinkIntervalRange.y),
        blinkDuration: typeof rawPers.blinkDuration === 'number' ? rawPers.blinkDuration : defPers.blinkDuration,
        saccadeFrequency: typeof rawPers.saccadeFrequency === 'number' ? rawPers.saccadeFrequency : defPers.saccadeFrequency,
        saccadeAmplitude: toVec2(rawPers.saccadeAmplitude, defPers.saccadeAmplitude.x, defPers.saccadeAmplitude.y),
        headFollowRatio: typeof rawPers.headFollowRatio === 'number' ? rawPers.headFollowRatio : defPers.headFollowRatio,
        headDamping: typeof rawPers.headDamping === 'number' ? rawPers.headDamping : defPers.headDamping,
        eyeDamping: typeof rawPers.eyeDamping === 'number' ? rawPers.eyeDamping : defPers.eyeDamping,
        asymmetryAmount: typeof rawPers.asymmetryAmount === 'number' ? rawPers.asymmetryAmount : defPers.asymmetryAmount,
        microJitterAmount: typeof rawPers.microJitterAmount === 'number' ? rawPers.microJitterAmount : defPers.microJitterAmount
    };
    const defApp = createDefaultAppearance();
    const rawApp = obj.appearance || {};
    const appearance = {
        skinColor: toVec3(rawApp.skinColor, defApp.skinColor.x, defApp.skinColor.y, defApp.skinColor.z),
        skinShadowColor: toVec3(rawApp.skinShadowColor, defApp.skinShadowColor.x, defApp.skinShadowColor.y, defApp.skinShadowColor.z),
        lipColor: toVec3(rawApp.lipColor, defApp.lipColor.x, defApp.lipColor.y, defApp.lipColor.z),
        irisColor: toVec3(rawApp.irisColor, defApp.irisColor.x, defApp.irisColor.y, defApp.irisColor.z),
        scleraColor: toVec3(rawApp.scleraColor, defApp.scleraColor.x, defApp.scleraColor.y, defApp.scleraColor.z),
        browColor: toVec3(rawApp.browColor, defApp.browColor.x, defApp.browColor.y, defApp.browColor.z),
        teethColor: toVec3(rawApp.teethColor, defApp.teethColor.x, defApp.teethColor.y, defApp.teethColor.z),
        damageSeed: typeof rawApp.damageSeed === 'number' ? rawApp.damageSeed : defApp.damageSeed,
        customTierOverrides: rawApp.customTierOverrides && typeof rawApp.customTierOverrides === 'object'
            ? { ...rawApp.customTierOverrides }
            : undefined
    };
    return {
        version: '1.0',
        id: typeof obj.id === 'string' ? obj.id : 'custom_face',
        name: typeof obj.name === 'string' ? obj.name : 'Custom Face',
        proportions,
        sculptOffsets,
        positions,
        normals,
        uvs: new Float32Array(baseHead.uvs),
        indices: new Int32Array(baseHead.indices),
        submeshes: baseHead.submeshes.map(sm => ({ ...sm })),
        vertexRegionMap: new Uint8Array(baseHead.vertexRegionMap),
        jawWeights: new Float32Array(baseHead.jawWeights),
        pivots,
        muscles,
        emotions,
        personality,
        appearance
    };
}

const ANTAGONIST_PAIRS = [
    ['eyeBlinkL', 'eyeWideL', 0.95],
    ['eyeBlinkR', 'eyeWideR', 0.95],
    ['mouthSmileL', 'mouthFrownL', 0.55],
    ['mouthSmileR', 'mouthFrownR', 0.55],
    ['browDownL', 'browOuterUpL', 0.45],
    ['browDownR', 'browOuterUpR', 0.45]
];
const LEFT_MUSCLES = new Set([
    'browDownL',
    'browOuterUpL',
    'eyeBlinkL',
    'eyeSquintL',
    'eyeWideL',
    'cheekSquintL',
    'noseSneerL',
    'jawLeft',
    'mouthSmileL',
    'mouthFrownL',
    'mouthUpperUpL',
    'mouthLowerDownL'
]);
const RIGHT_MUSCLES = new Set([
    'browDownR',
    'browOuterUpR',
    'eyeBlinkR',
    'eyeSquintR',
    'eyeWideR',
    'cheekSquintR',
    'noseSneerR',
    'jawRight',
    'mouthSmileR',
    'mouthFrownR',
    'mouthUpperUpR',
    'mouthLowerDownR'
]);
class ExpressionCompositor {
    emotions;
    emotionWeights = {};
    targetEmotionWeights = {};
    directMuscleOverrides = {};
    currentMuscles;
    currentHeadEuler = new Vec3();
    _targetMuscles;
    _targetHeadEuler = new Vec3();
    _noise;
    _time = 0;
    constructor(emotions, seed = 101) {
        this.emotions = emotions;
        this._noise = new Perlin1D(seed);
        this.currentMuscles = {};
        this._targetMuscles = {};
        for (const m of FACS_MUSCLE_NAMES) {
            this.currentMuscles[m] = 0;
            this._targetMuscles[m] = 0;
        }
        for (const key of Object.keys(emotions)) {
            this.emotionWeights[key] = 0;
            this.targetEmotionWeights[key] = 0;
        }
    }
    setEmotion(name, weight, immediate = false) {
        const clamped = Utils.clamp(weight, 0, 1);
        this.targetEmotionWeights[name] = clamped;
        if (immediate) {
            this.emotionWeights[name] = clamped;
        }
        else if (this.emotionWeights[name] === undefined) {
            this.emotionWeights[name] = 0;
        }
    }
    setExclusiveEmotion(name, weight = 1.0, immediate = false) {
        for (const key of Object.keys(this.emotions)) {
            this.setEmotion(key, key === name ? weight : 0, immediate);
        }
    }
    setMuscleOverride(muscle, weight) {
        if (weight === null || weight === undefined) {
            delete this.directMuscleOverrides[muscle];
        }
        else {
            this.directMuscleOverrides[muscle] = Utils.clamp(weight, 0, 1);
        }
    }
    clearMuscleOverrides() {
        for (const k of Object.keys(this.directMuscleOverrides)) {
            delete this.directMuscleOverrides[k];
        }
    }
    update(dt, personality, impulseMuscles, impulseHeadEuler, blinkLeft = 0, blinkRight = 0, eyelidPitchFollow = 0) {
        this._time += dt;
        const emotionRate = Math.max(2.0, personality.headDamping);
        this._targetHeadEuler.origin();
        const emotions = this.emotions;
        for (const name in emotions) {
            const layer = emotions[name];
            const targetW = this.targetEmotionWeights[name] ?? 0;
            const curW = this.emotionWeights[name] ?? 0;
            const nextW = dt > 0 ? Utils.damp(curW, targetW, emotionRate, dt) : targetW;
            this.emotionWeights[name] = nextW;
            if (nextW > 0.001 && layer.headEulerOffset) {
                this._targetHeadEuler.x += layer.headEulerOffset.x * nextW;
                this._targetHeadEuler.y += layer.headEulerOffset.y * nextW;
                this._targetHeadEuler.z += layer.headEulerOffset.z * nextW;
            }
        }
        if (impulseHeadEuler) {
            this._targetHeadEuler.add(impulseHeadEuler);
        }
        const asymNoiseL = this._noise.sample(this._time * 0.65 + 11.3) * personality.asymmetryAmount;
        const asymNoiseR = this._noise.sample(this._time * 0.65 + 47.9) * personality.asymmetryAmount;
        for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
            const m = FACS_MUSCLE_NAMES[i];
            let complementProd = 1.0;
            for (const name in emotions) {
                const layerW = this.emotionWeights[name] ?? 0;
                if (layerW <= 0.001)
                    continue;
                const mWeight = emotions[name].muscles[m];
                if (mWeight && mWeight > 0) {
                    const contribution = Utils.clamp(layerW * mWeight, 0, 1);
                    complementProd *= 1.0 - contribution;
                }
            }
            if (impulseMuscles) {
                const impW = impulseMuscles[m];
                if (impW && impW > 0) {
                    complementProd *= 1.0 - Utils.clamp(impW, 0, 1);
                }
            }
            let combined = 1.0 - complementProd;
            if (combined > 0.02 && personality.asymmetryAmount > 0) {
                if (LEFT_MUSCLES.has(m)) {
                    combined = Utils.clamp(combined * (1.0 + asymNoiseL), 0, 1);
                }
                else if (RIGHT_MUSCLES.has(m)) {
                    combined = Utils.clamp(combined * (1.0 + asymNoiseR), 0, 1);
                }
            }
            this._targetMuscles[m] = combined;
        }
        if (eyelidPitchFollow > 0) {
            this._targetMuscles.eyeWideL = 1.0 - (1.0 - this._targetMuscles.eyeWideL) * (1.0 - eyelidPitchFollow);
            this._targetMuscles.eyeWideR = 1.0 - (1.0 - this._targetMuscles.eyeWideR) * (1.0 - eyelidPitchFollow);
        }
        else if (eyelidPitchFollow < 0) {
            const lidDrop = Math.min(0.45, -eyelidPitchFollow);
            this._targetMuscles.eyeBlinkL = 1.0 - (1.0 - this._targetMuscles.eyeBlinkL) * (1.0 - lidDrop);
            this._targetMuscles.eyeBlinkR = 1.0 - (1.0 - this._targetMuscles.eyeBlinkR) * (1.0 - lidDrop);
        }
        if (blinkLeft > 0) {
            this._targetMuscles.eyeBlinkL = 1.0 - (1.0 - this._targetMuscles.eyeBlinkL) * (1.0 - blinkLeft);
        }
        if (blinkRight > 0) {
            this._targetMuscles.eyeBlinkR = 1.0 - (1.0 - this._targetMuscles.eyeBlinkR) * (1.0 - blinkRight);
        }
        for (let i = 0; i < ANTAGONIST_PAIRS.length; i++) {
            const [dominant, recessive, factor] = ANTAGONIST_PAIRS[i];
            const domVal = this._targetMuscles[dominant];
            if (domVal > 0.01) {
                this._targetMuscles[recessive] *= Math.max(0, 1.0 - domVal * factor);
            }
        }
        const overrides = this.directMuscleOverrides;
        for (const m in overrides) {
            const val = overrides[m];
            if (typeof val === 'number') {
                this._targetMuscles[m] = Utils.clamp(val, 0, 1);
            }
        }
        const muscleRate = Math.max(12.0, personality.headDamping * 2.2);
        for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
            const m = FACS_MUSCLE_NAMES[i];
            const isBlink = m === 'eyeBlinkL' || m === 'eyeBlinkR';
            const rate = isBlink ? 45.0 : muscleRate;
            this.currentMuscles[m] =
                dt > 0 ? Utils.damp(this.currentMuscles[m], this._targetMuscles[m], rate, dt) : this._targetMuscles[m];
        }
        if (dt > 0) {
            this.currentHeadEuler.x = Utils.damp(this.currentHeadEuler.x, this._targetHeadEuler.x, emotionRate, dt);
            this.currentHeadEuler.y = Utils.damp(this.currentHeadEuler.y, this._targetHeadEuler.y, emotionRate, dt);
            this.currentHeadEuler.z = Utils.damp(this.currentHeadEuler.z, this._targetHeadEuler.z, emotionRate, dt);
        }
        else {
            this.currentHeadEuler.copy(this._targetHeadEuler);
        }
    }
}

const ZERO_VEC2 = new Vec2(0, 0);
const ZERO_VEC3$1 = new Vec3(0, 0, 0);
const SACCADE_FREQ_VEC2 = new Vec2(1.35, 1.35);
const DRIFT_FREQ_VEC3 = new Vec3(0.48, 0.41, 0.53);
class GazeController {
    targetGazeAngles = new Vec2(0, 0);
    currentHeadAngles = new Vec2(0, 0);
    currentEyeAngles = new Vec2(0, 0);
    neckQuat = new Quat();
    eyeLeftQuat = new Quat();
    eyeRightQuat = new Quat();
    lastGazeShiftMagnitude = 0;
    _saccadeOffset = new Vec2(0, 0);
    _headDriftEuler = new Vec3(0, 0, 0);
    _driftAmpVec3 = new Vec3(1, 1, 1);
    _eulerScratch = new Vec3(0, 0, 0);
    _combinedTarget = new Vec2(0, 0);
    _prevCombinedTarget = new Vec2(0, 0);
    _lookDir = new Vec3(0, 0, 1);
    _noise;
    _time = 0;
    _saccadeHoldTimer = 0;
    constructor(seed = 202) {
        this._noise = new Perlin1D(seed);
    }
    setGazeAngles(angles) {
        this.targetGazeAngles.setScalar(Utils.clamp(angles.x, -0.85, 0.85), Utils.clamp(angles.y, -0.65, 0.65));
    }
    lookAt(target, headOrigin = ZERO_VEC3$1) {
        this._lookDir.subVectors(target, headOrigin);
        const len = this._lookDir.getMagnitude();
        if (len < 1e-5) {
            this.targetGazeAngles.origin();
            return;
        }
        this._lookDir.divideScalar(len);
        const yaw = Math.atan2(this._lookDir.x, Math.max(0.01, this._lookDir.z));
        const pitch = Math.asin(Utils.clamp(this._lookDir.y, -0.95, 0.95));
        this.setGazeAngles(this._combinedTarget.setScalar(yaw, pitch));
    }
    update(dt, personality, extraHeadEulerOffset = ZERO_VEC3$1, impulseGazeOffset = ZERO_VEC2) {
        this._time += dt;
        this._saccadeHoldTimer -= dt * Math.max(0.1, personality.saccadeFrequency);
        if (this._saccadeHoldTimer <= 0) {
            this._noise.sampleVec2(this._time + 7.1, SACCADE_FREQ_VEC2, personality.saccadeAmplitude, this._saccadeOffset, 2);
            const holdNoise = (this._noise.sample(this._time * 0.9 + 19.4, 5) + 1) * 0.5;
            this._saccadeHoldTimer = Utils.lerp(0.35, 1.35, holdNoise);
        }
        this._combinedTarget
            .copy(this.targetGazeAngles)
            .add(this._saccadeOffset)
            .add(impulseGazeOffset);
        this._combinedTarget.x = Utils.clamp(this._combinedTarget.x, -0.95, 0.95);
        this._combinedTarget.y = Utils.clamp(this._combinedTarget.y, -0.7, 0.70);
        this.lastGazeShiftMagnitude = this._combinedTarget.getDistance(this._prevCombinedTarget);
        this._prevCombinedTarget.copy(this._combinedTarget);
        const targetHeadYaw = this._combinedTarget.x * personality.headFollowRatio;
        const targetHeadPitch = this._combinedTarget.y * personality.headFollowRatio;
        if (dt > 0) {
            this.currentHeadAngles.x = Utils.damp(this.currentHeadAngles.x, targetHeadYaw, personality.headDamping, dt);
            this.currentHeadAngles.y = Utils.damp(this.currentHeadAngles.y, targetHeadPitch, personality.headDamping, dt);
        }
        else {
            this.currentHeadAngles.setScalar(targetHeadYaw, targetHeadPitch);
        }
        const residualYaw = Utils.clamp(this._combinedTarget.x - this.currentHeadAngles.x, -0.58, 0.58);
        const residualPitch = Utils.clamp(this._combinedTarget.y - this.currentHeadAngles.y, -0.42, 0.42);
        if (dt > 0) {
            this.currentEyeAngles.x = Utils.damp(this.currentEyeAngles.x, residualYaw, personality.eyeDamping, dt);
            this.currentEyeAngles.y = Utils.damp(this.currentEyeAngles.y, residualPitch, personality.eyeDamping, dt);
        }
        else {
            this.currentEyeAngles.setScalar(residualYaw, residualPitch);
        }
        const jitter = personality.microJitterAmount;
        this._driftAmpVec3.setScalar(jitter, jitter, jitter * 0.7);
        this._noise.fbmVec3(this._time, DRIFT_FREQ_VEC3, this._driftAmpVec3, 2, this._headDriftEuler, 8);
        const neckPitch = -this.currentHeadAngles.y + extraHeadEulerOffset.x + this._headDriftEuler.x;
        const neckYaw = this.currentHeadAngles.x + extraHeadEulerOffset.y + this._headDriftEuler.y;
        const neckRoll = extraHeadEulerOffset.z + this._headDriftEuler.z - this.currentHeadAngles.x * 0.08;
        this.neckQuat.setFromEuler(this._eulerScratch.setScalar(neckPitch, neckYaw, neckRoll));
        const eyePitch = -this.currentEyeAngles.y;
        const eyeYaw = this.currentEyeAngles.x;
        const vergence = 0.025;
        this.eyeLeftQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw + vergence, 0));
        this.eyeRightQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw - vergence, 0));
    }
}

class BlinkController {
    blinkLeft = 0;
    blinkRight = 0;
    eyelidPitchFollow = 0;
    _noise;
    _time = 0;
    _timeUntilNextBlink = 2.8;
    _blinkElapsed = -1;
    _activeDuration = 0.16;
    constructor(seed = 303) {
        this._noise = new Perlin1D(seed);
    }
    triggerBlink(duration) {
        if (this._blinkElapsed < 0) {
            this._blinkElapsed = 0;
            if (duration && duration > 0.04) {
                this._activeDuration = duration;
            }
        }
    }
    update(dt, personality, eyePitchRadians = 0, gazeShiftMagnitude = 0) {
        this._time += dt;
        if (gazeShiftMagnitude > 0.32 && this._blinkElapsed < 0) {
            this.triggerBlink(personality.blinkDuration * 0.9);
        }
        this._timeUntilNextBlink -= dt;
        if (this._timeUntilNextBlink <= 0 && this._blinkElapsed < 0) {
            this.triggerBlink(personality.blinkDuration);
            const minInterval = Math.max(0.4, personality.blinkIntervalRange.x);
            const maxInterval = Math.max(minInterval + 0.2, personality.blinkIntervalRange.y);
            const u = (this._noise.sample(this._time * 1.7 + 31.7) + 1) * 0.5;
            this._timeUntilNextBlink = Utils.lerp(minInterval, maxInterval, u);
        }
        if (this._blinkElapsed >= 0) {
            this._blinkElapsed += dt;
            const dur = Math.max(0.06, this._activeDuration || personality.blinkDuration);
            const phase = this._blinkElapsed / dur;
            if (phase >= 1.0) {
                this._blinkElapsed = -1;
                this.blinkLeft = 0;
                this.blinkRight = 0;
            }
            else {
                let weight = 0;
                if (phase < 0.32) {
                    weight = Utils.smoothstep(0, 0.32, phase);
                }
                else {
                    weight = 1.0 - Utils.smoothstep(0.32, 1.0, phase);
                }
                this.blinkLeft = weight;
                const rightPhase = Utils.clamp(phase - personality.asymmetryAmount * 0.08, 0, 1);
                this.blinkRight =
                    rightPhase < 0.32
                        ? Utils.smoothstep(0, 0.32, rightPhase)
                        : 1.0 - Utils.smoothstep(0.32, 1.0, rightPhase);
            }
        }
        else {
            this.blinkLeft = 0;
            this.blinkRight = 0;
        }
        this.eyelidPitchFollow = Utils.clamp(eyePitchRadians * 0.85, -0.45, 0.55);
    }
}

const FORWARD_VEC3 = new Vec3(0, 0, 1);
class ImpulseController {
    activeImpulses = [];
    outputMuscles = {};
    outputHeadEuler = new Vec3(0, 0, 0);
    outputGazeOffset = new Vec2(0, 0);
    triggerImpulse(type, intensity = 1.0, direction, duration) {
        const defaultDurations = {
            pain: 0.45,
            shoot: 0.25,
            surprise: 0.65,
            glance: 0.90,
            evilGrin: 1.40
        };
        this.activeImpulses.push({
            type,
            intensity: Utils.clamp(intensity, 0, 1.5),
            duration: duration ?? defaultDurations[type] ?? 0.5,
            direction: direction ? new Vec3().copy(direction) : new Vec3(0, 0, 1),
            elapsed: 0
        });
    }
    _accumulateMuscle(name, weight) {
        const prev = this.outputMuscles[name] ?? 0;
        const clamped = Utils.clamp(weight, 0, 1);
        this.outputMuscles[name] = 1.0 - (1.0 - prev) * (1.0 - clamped);
    }
    update(dt) {
        for (const k of Object.keys(this.outputMuscles)) {
            delete this.outputMuscles[k];
        }
        this.outputHeadEuler.origin();
        this.outputGazeOffset.origin();
        for (let i = this.activeImpulses.length - 1; i >= 0; i--) {
            const imp = this.activeImpulses[i];
            imp.elapsed += dt;
            if (imp.elapsed >= imp.duration) {
                this.activeImpulses.splice(i, 1);
                continue;
            }
            const phase = imp.elapsed / imp.duration;
            const env = phase < 0.18
                ? Utils.smoothstep(0, 0.18, phase)
                : 1.0 - Utils.smoothstep(0.18, 1.0, phase);
            const w = env * imp.intensity;
            const dir = imp.direction || FORWARD_VEC3;
            switch (imp.type) {
                case 'pain': {
                    this._accumulateMuscle('browInnerUp', 0.85 * w);
                    this._accumulateMuscle('browDownL', 0.70 * w);
                    this._accumulateMuscle('browDownR', 0.70 * w);
                    this._accumulateMuscle('eyeSquintL', 0.92 * w);
                    this._accumulateMuscle('eyeSquintR', 0.92 * w);
                    this._accumulateMuscle('eyeBlinkL', 0.75 * w);
                    this._accumulateMuscle('eyeBlinkR', 0.75 * w);
                    this._accumulateMuscle('cheekSquintL', 0.80 * w);
                    this._accumulateMuscle('cheekSquintR', 0.80 * w);
                    this._accumulateMuscle('noseSneerL', 0.65 * w);
                    this._accumulateMuscle('noseSneerR', 0.65 * w);
                    this._accumulateMuscle('jawOpen', 0.65 * w);
                    this._accumulateMuscle('mouthFrownL', 0.65 * w);
                    this._accumulateMuscle('mouthFrownR', 0.65 * w);
                    this.outputHeadEuler.x += 0.18 * w;
                    this.outputHeadEuler.y += -dir.x * 0.25 * w;
                    this.outputHeadEuler.z += dir.x * 0.14 * w;
                    break;
                }
                case 'shoot': {
                    this._accumulateMuscle('browDownL', 0.88 * w);
                    this._accumulateMuscle('browDownR', 0.88 * w);
                    this._accumulateMuscle('eyeSquintL', 0.65 * w);
                    this._accumulateMuscle('eyeSquintR', 0.65 * w);
                    this._accumulateMuscle('noseSneerL', 0.72 * w);
                    this._accumulateMuscle('noseSneerR', 0.72 * w);
                    this._accumulateMuscle('mouthUpperUpL', 0.65 * w);
                    this._accumulateMuscle('mouthUpperUpR', 0.65 * w);
                    this._accumulateMuscle('mouthLowerDownL', 0.55 * w);
                    this._accumulateMuscle('mouthLowerDownR', 0.55 * w);
                    this._accumulateMuscle('jawForward', 0.55 * w);
                    this._accumulateMuscle('jawOpen', 0.28 * w);
                    this.outputHeadEuler.x -= 0.08 * w;
                    break;
                }
                case 'surprise': {
                    this._accumulateMuscle('browInnerUp', 0.92 * w);
                    this._accumulateMuscle('browOuterUpL', 0.85 * w);
                    this._accumulateMuscle('browOuterUpR', 0.85 * w);
                    this._accumulateMuscle('eyeWideL', 0.95 * w);
                    this._accumulateMuscle('eyeWideR', 0.95 * w);
                    this._accumulateMuscle('jawOpen', 0.58 * w);
                    this._accumulateMuscle('mouthFunnel', 0.52 * w);
                    this.outputHeadEuler.x += 0.10 * w;
                    break;
                }
                case 'glance': {
                    this._accumulateMuscle('browOuterUpL', dir.x < 0 ? 0.45 * w : 0.15 * w);
                    this._accumulateMuscle('browOuterUpR', dir.x >= 0 ? 0.45 * w : 0.15 * w);
                    this.outputGazeOffset.x += Utils.clamp(dir.x, -0.75, 0.75) * w;
                    this.outputGazeOffset.y += Utils.clamp(dir.y, -0.45, 0.45) * w;
                    break;
                }
                case 'evilGrin': {
                    this._accumulateMuscle('browDownL', 0.80 * w);
                    this._accumulateMuscle('browDownR', 0.80 * w);
                    this._accumulateMuscle('browOuterUpL', 0.48 * w);
                    this._accumulateMuscle('browOuterUpR', 0.48 * w);
                    this._accumulateMuscle('eyeSquintL', 0.68 * w);
                    this._accumulateMuscle('eyeSquintR', 0.68 * w);
                    this._accumulateMuscle('cheekSquintL', 0.78 * w);
                    this._accumulateMuscle('cheekSquintR', 0.78 * w);
                    this._accumulateMuscle('mouthSmileL', 0.96 * w);
                    this._accumulateMuscle('mouthSmileR', 0.96 * w);
                    this._accumulateMuscle('mouthUpperUpL', 0.42 * w);
                    this._accumulateMuscle('mouthUpperUpR', 0.42 * w);
                    this._accumulateMuscle('jawOpen', 0.25 * w);
                    this.outputHeadEuler.x -= 0.06 * w;
                    break;
                }
            }
        }
    }
}

function buildPivotMatrix(pivot, q, mat, unitScale, negPivot) {
    negPivot.oppositeVector(pivot);
    return mat.compose(pivot, q, unitScale).translate(negPivot);
}
function rotateVec3ByQuat(v, q) {
    return q.multiplyVector(v, v);
}
const _unitScale = new Vec3(1, 1, 1);
const _negPivot = new Vec3();
const _eyeLeftMat = new Mat4x3();
const _eyeRightMat = new Mat4x3();
const _jawMat = new Mat4x3();
const _neckMat = new Mat4x3();
function evaluateFaceDeformation(cartridge, pose, outPositions, outNormals) {
    outPositions.set(cartridge.positions);
    outNormals.set(cartridge.normals);
    const muscles = cartridge.muscles;
    const weights = pose.muscles;
    for (let m = 0; m < FACS_MUSCLE_NAMES.length; m++) {
        const name = FACS_MUSCLE_NAMES[m];
        const w = weights[name];
        if (!w || Math.abs(w) <= 0.001)
            continue;
        const delta = muscles[name];
        if (!delta)
            continue;
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
        if (doEyeL) {
            const rx = elm0 * px + elm4 * py + elm8 * pz + elm12;
            const ry = elm1 * px + elm5 * py + elm9 * pz + elm13;
            const rz = elm2 * px + elm6 * py + elm10 * pz + elm14;
            px = rx;
            py = ry;
            pz = rz;
            const rnx = elm0 * nx + elm4 * ny + elm8 * nz;
            const rny = elm1 * nx + elm5 * ny + elm9 * nz;
            const rnz = elm2 * nx + elm6 * ny + elm10 * nz;
            nx = rnx;
            ny = rny;
            nz = rnz;
        }
        else if (doEyeR) {
            const rx = erm0 * px + erm4 * py + erm8 * pz + erm12;
            const ry = erm1 * px + erm5 * py + erm9 * pz + erm13;
            const rz = erm2 * px + erm6 * py + erm10 * pz + erm14;
            px = rx;
            py = ry;
            pz = rz;
            const rnx = erm0 * nx + erm4 * ny + erm8 * nz;
            const rny = erm1 * nx + erm5 * ny + erm9 * nz;
            const rnz = erm2 * nx + erm6 * ny + erm10 * nz;
            nx = rnx;
            ny = rny;
            nz = rnz;
        }
        if (doJaw) {
            const rx = jm0 * px + jm4 * py + jm8 * pz + jm12;
            const ry = jm1 * px + jm5 * py + jm9 * pz + jm13;
            const rz = jm2 * px + jm6 * py + jm10 * pz + jm14;
            const rnx = jm0 * nx + jm4 * ny + jm8 * nz;
            const rny = jm1 * nx + jm5 * ny + jm9 * nz;
            const rnz = jm2 * nx + jm6 * ny + jm10 * nz;
            if (jw >= 0.999) {
                px = rx;
                py = ry;
                pz = rz;
                nx = rnx;
                ny = rny;
                nz = rnz;
            }
            else {
                px += (rx - px) * jw;
                py += (ry - py) * jw;
                pz += (rz - pz) * jw;
                nx += (rnx - nx) * jw;
                ny += (rny - ny) * jw;
                nz += (rnz - nz) * jw;
            }
        }
        if (hasNeck) {
            const baseY = basePositions[idx + 1];
            if (region !== FACE_REGION_IDS.skin || baseY >= -5.8) {
                const rx = nm0 * px + nm4 * py + nm8 * pz + nm12;
                const ry = nm1 * px + nm5 * py + nm9 * pz + nm13;
                const rz = nm2 * px + nm6 * py + nm10 * pz + nm14;
                px = rx;
                py = ry;
                pz = rz;
                const rnx = nm0 * nx + nm4 * ny + nm8 * nz;
                const rny = nm1 * nx + nm5 * ny + nm9 * nz;
                const rnz = nm2 * nx + nm6 * ny + nm10 * nz;
                nx = rnx;
                ny = rny;
                nz = rnz;
            }
            else if (baseY > -9.8) {
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
function generateFaceAtlasPixels(appearance, damageTier = 0, size = 256) {
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
                const uGrid = (u - 0.5) / 0.48;
                const absU = Math.abs(uGrid);
                const sv = Utils.clamp((0.74 - v) / 0.72, 0.0, 1.0);
                const yHead = Utils.lerp(-11, 10.5, sv);
                const shade = Utils.smoothstep(0.0, 0.25, sv) * (1.0 - absU * 0.22);
                col.setScalar(Utils.lerp(shadow.x, skin.x, shade), Utils.lerp(shadow.y, skin.y, shade), Utils.lerp(shadow.z, skin.z, shade));
                const pore = rng.float(-0.01, 0.010);
                col.addScalar(pore);
                const submentalShadow = Math.exp(-Math.pow((yHead - -6.1) / 0.75, 2)) *
                    Math.exp(-Math.pow(absU / 0.34, 2));
                col.scale(1.0 - submentalShadow * 0.26);
                const jawStubble = Utils.smoothstep(-6.4, -5.2, yHead) *
                    Utils.smoothstep(-1.5, -2.8, yHead) *
                    Utils.smoothstep(0.38, 0.16, absU) *
                    (1.0 - Math.exp(-Math.pow((yHead - -3.1) / 0.65, 2)) * Math.exp(-Math.pow(absU / 0.09, 2)));
                if (jawStubble > 0.01) {
                    const stubbleNoise = 0.85 + 0.15 * Math.sin(uGrid * 190.0 + yHead * 45.0);
                    const stW = jawStubble * 0.14 * stubbleNoise;
                    col.x = Utils.lerp(col.x, brow.x * 0.85, stW);
                    col.y = Utils.lerp(col.y, brow.y * 0.88, stW);
                    col.z = Utils.lerp(col.z, brow.z * 0.95, stW);
                }
                const cheekWarmth = Math.exp(-Math.pow((yHead - 0.35) / 1.65, 2)) *
                    Math.exp(-Math.pow((absU - 0.16) / 0.14, 2));
                col.x += cheekWarmth * 0.055;
                col.y -= cheekWarmth * 0.012;
                col.z -= cheekWarmth * 0.015;
                const philtrumGroove = Math.exp(-Math.pow(absU / 0.016, 2)) *
                    Math.exp(-Math.pow((yHead - -1.95) / 0.55, 2));
                const philtrumColumns = Math.exp(-Math.pow((absU - 0.024) / 0.010, 2)) *
                    Math.exp(-Math.pow((yHead - -1.95) / 0.55, 2));
                col.scale(1.0 - philtrumGroove * 0.14 + philtrumColumns * 0.05);
                const nlTargetU = 0.062 + Math.max(0, -0.9 - yHead) * 0.022;
                const nasolabial = Math.exp(-Math.pow((absU - nlTargetU) / 0.014, 2)) *
                    Utils.smoothstep(-0.7, -1.3, yHead) *
                    Utils.smoothstep(-3.6, -2.6, yHead);
                col.scale(1.0 - nasolabial * 0.18);
                const noseBridgeHighlight = Math.exp(-Math.pow(absU / 0.022, 2)) *
                    Utils.smoothstep(-0.85, -0.35, yHead) *
                    Utils.smoothstep(2.6, 1.5, yHead);
                col.addScalar(noseBridgeHighlight * 0.055);
                const alarShadow = Math.exp(-Math.pow((absU - 0.064) / 0.016, 2)) *
                    Math.exp(-Math.pow((yHead - -0.92) / 0.42, 2));
                col.scale(1.0 - alarShadow * 0.24);
                const nostrilDark = Math.exp(-Math.pow((absU - 0.035) / 0.016, 2)) *
                    Math.exp(-Math.pow((yHead - -1.16) / 0.22, 2));
                if (nostrilDark > 0.01) {
                    const nW = Utils.clamp(nostrilDark * 0.88, 0.0, 0.88);
                    col.x = Utils.lerp(col.x, 0.08, nW);
                    col.y = Utils.lerp(col.y, 0.04, nW);
                    col.z = Utils.lerp(col.z, 0.04, nW);
                }
                const lipArch = Math.max(0, 1.0 - Math.pow(absU / 0.095, 2));
                if (lipArch > 0.0 && yHead > -3.85 && yHead < -2.35) {
                    const cupidDip = 0.10 * Math.exp(-Math.pow(absU / 0.018, 2));
                    const cupidPeak = 0.12 * Math.exp(-Math.pow((absU - 0.028) / 0.018, 2));
                    const upperBorderY = -3.1 + (0.52 + cupidPeak - cupidDip) * lipArch;
                    const lowerBorderY = -3.1 - 0.62 * lipArch;
                    if (yHead >= lowerBorderY && yHead <= upperBorderY) {
                        const distToEdge = Math.min(upperBorderY - yHead, yHead - lowerBorderY);
                        const lipW = Utils.smoothstep(0.0, 0.16, distToEdge) * Utils.smoothstep(0.0, 0.25, lipArch);
                        const isUpperLip = yHead >= -3.1;
                        const lipShade = isUpperLip
                            ? 0.84
                            : 1.04 + 0.14 * Math.exp(-Math.pow((yHead - -3.38) / 0.16, 2)) * Math.exp(-Math.pow(absU / 0.045, 2));
                        col.x = Utils.lerp(col.x, lip.x * lipShade, lipW);
                        col.y = Utils.lerp(col.y, lip.y * lipShade, lipW);
                        col.z = Utils.lerp(col.z, lip.z * lipShade, lipW);
                    }
                    const stomionLine = Math.exp(-Math.pow((yHead - -3.1) / 0.075, 2)) *
                        Utils.smoothstep(0.0, 0.15, lipArch);
                    if (stomionLine > 0.01) {
                        const stLineW = Utils.clamp(stomionLine * 0.82, 0.0, 0.82);
                        col.x = Utils.lerp(col.x, 0.12, stLineW);
                        col.y = Utils.lerp(col.y, 0.04, stLineW);
                        col.z = Utils.lerp(col.z, 0.05, stLineW);
                    }
                }
                const dSocket = Math.hypot((absU - 0.123) / 0.075, (yHead - 1.92) / 0.95);
                if (dSocket < 1.5) {
                    const socketAO = Math.exp(-dSocket * dSocket * 1.65);
                    col.scale(1.0 - socketAO * 0.18);
                }
                const eyeArchX = Math.max(0, 1.0 - Math.pow((absU - 0.123) / 0.062, 2));
                if (eyeArchX > 0.0) {
                    const upperLashY = 1.85 + 0.36 * eyeArchX;
                    const lashW = Math.exp(-Math.pow((yHead - upperLashY) / 0.09, 2)) * Utils.smoothstep(0.0, 0.2, eyeArchX);
                    if (lashW > 0.01) {
                        col.x = Utils.lerp(col.x, brow.x * 0.35, lashW * 0.85);
                        col.y = Utils.lerp(col.y, brow.y * 0.35, lashW * 0.85);
                        col.z = Utils.lerp(col.z, brow.z * 0.35, lashW * 0.85);
                    }
                    const foldY = 1.85 + 0.68 * eyeArchX;
                    const foldW = Math.exp(-Math.pow((yHead - foldY) / 0.08, 2)) * Utils.smoothstep(0.0, 0.25, eyeArchX);
                    col.scale(1.0 - foldW * 0.28);
                    const lowerRimY = 1.85 - 0.36 * eyeArchX;
                    const lowerW = Math.exp(-Math.pow((yHead - lowerRimY) / 0.09, 2)) * Utils.smoothstep(0.0, 0.2, eyeArchX);
                    col.scale(1.0 - lowerW * 0.22);
                }
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
                const earConcha = Math.exp(-Math.pow((absU - 0.50) / 0.035, 2)) *
                    Math.exp(-Math.pow((yHead - 0.35) / 1.05, 2));
                col.scale(1.0 - earConcha * 0.24);
                const foreheadHairlineY = 6.35 -
                    0.32 * Math.exp(-Math.pow(absU / 0.05, 2)) +
                    0.55 * Math.exp(-Math.pow((absU - 0.19) / 0.07, 2));
                const foreheadHair = Utils.smoothstep(foreheadHairlineY - 0.30, foreheadHairlineY + 0.22, yHead) *
                    Utils.smoothstep(0.40, 0.26, absU);
                const sideburnHair = Utils.smoothstep(0.28, 0.34, absU) *
                    Utils.smoothstep(0.47, 0.43, absU) *
                    Utils.smoothstep(-0.15, 0.45, yHead) *
                    Utils.smoothstep(7.5, 5.0, yHead);
                const backScalpHair = Utils.smoothstep(0.38, 0.46, absU) *
                    Utils.smoothstep(-3.8, -3.1, yHead);
                const crownCapHair = Utils.smoothstep(6.45, 7.05, yHead);
                const hairMask = Utils.clamp(Math.max(foreheadHair, sideburnHair, backScalpHair, crownCapHair), 0.0, 1.0);
                if (hairMask > 0.01) {
                    const strand = 0.84 +
                        0.16 * Math.sin(uGrid * 185.0 + yHead * 14.0) * Math.cos(yHead * 26.0);
                    const crownSpec = 1.0 + 0.18 * Utils.smoothstep(5.5, 8.8, yHead) * (1.0 - absU * 0.5);
                    const hR = brow.x * strand * crownSpec;
                    const hG = brow.y * strand * crownSpec;
                    const hB = brow.z * strand * crownSpec;
                    col.x = Utils.lerp(col.x, hR, hairMask);
                    col.y = Utils.lerp(col.y, hG, hairMask);
                    col.z = Utils.lerp(col.z, hB, hairMask);
                }
            }
            else if (u < 0.50) {
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
                    col.setScalar(Utils.lerp(col.x, irR, limbus), Utils.lerp(col.y, irG, limbus), Utils.lerp(col.z, irB, limbus));
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
            }
            else if (u < 0.84 && v < 0.94) {
                const tu = (u - 0.52) / 0.30;
                const tv = (v - 0.78) / 0.15;
                const toothGroove = Math.pow(Math.abs(Math.sin(tu * Math.PI * 8.0)), 0.35);
                const gumBlend = Utils.smoothstep(0.0, 0.18, tv) * Utils.smoothstep(1.0, 0.82, tv);
                const shade = (0.75 + 0.25 * toothGroove) * (0.72 + 0.28 * gumBlend);
                col.copy(teeth).scale(shade);
            }
            else if (u < 0.84 && v >= 0.94) {
                col.setScalar(0.22, 0.06, 0.07);
            }
            else {
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
                if (py < 0 || py >= skinHeight)
                    continue;
                for (let dx = -radius; dx <= radius; dx++) {
                    const px = cx + dx;
                    if (px < 0 || px >= size)
                        continue;
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
        if (clampedTier >= 3) {
            const noseX = Math.floor(0.5 * size);
            const startY = Math.floor(0.52 * skinHeight);
            const endY = Math.floor((0.68 + (clampedTier - 2) * 0.08) * skinHeight);
            const streakWidth = Math.max(2, Math.floor((clampedTier * 2.5 * size) / 256));
            for (let py = startY; py <= Math.min(skinHeight - 1, endY); py++) {
                for (let dx = -streakWidth; dx <= streakWidth; dx++) {
                    const px = noseX + dx;
                    if (px < 0 || px >= size)
                        continue;
                    const w = Utils.smoothstep(streakWidth + 1, 0, Math.abs(dx)) * 0.85;
                    const pIdx = (py * size + px) * 4;
                    pixels[pIdx] = Math.round(Utils.lerp(pixels[pIdx], 132, w));
                    pixels[pIdx + 1] = Math.round(Utils.lerp(pixels[pIdx + 1], 12, w));
                    pixels[pIdx + 2] = Math.round(Utils.lerp(pixels[pIdx + 2], 14, w));
                }
            }
        }
    }
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
function createRoostrFaceMesh(gl, cartridge, damageTier = 0, atlasSize = 256) {
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
function syncRoostrMeshBuffers(mesh, positions, normals) {
    if (mesh.vertices instanceof Float32Array && mesh.vertices.length === positions.length) {
        mesh.vertices.set(positions);
    }
    if (mesh.normals instanceof Float32Array && mesh.normals.length === normals.length) {
        mesh.normals.set(normals);
    }
    const gl = mesh.context;
    if (!gl)
        return;
    if (mesh.vertexBuffer) {
        mesh.renderer.bindBuffer('ARRAY_BUFFER', mesh.vertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    }
    if (mesh.normalBuffer) {
        mesh.renderer.bindBuffer('ARRAY_BUFFER', mesh.normalBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
    }
}

const ZERO_VEC3 = new Vec3(0, 0, 0);
const _eulerScratch = new Vec3(0, 0, 0);
class FaceR {
    cartridge;
    compositor;
    gaze;
    blink;
    impulse;
    deformedPositions;
    deformedNormals;
    pose;
    autonomous;
    customMesh = null;
    mesh = null;
    atlasSize;
    _gl = null;
    _health = 100;
    constructor(cartridge, options = {}) {
        const seed = options.seed ?? 1337;
        this.atlasSize = options.atlasSize ?? 256;
        this.autonomous = options.autonomous ?? true;
        if (!cartridge) {
            this.cartridge = createDefaultCartridge();
        }
        else if ('positions' in cartridge &&
            cartridge.positions instanceof Float32Array &&
            'proportions' in cartridge &&
            cartridge.proportions.craniumScale instanceof Vec3) {
            this.cartridge = cartridge;
        }
        else {
            this.cartridge = hydrateCartridge(cartridge);
        }
        this.compositor = new ExpressionCompositor(this.cartridge.emotions, seed + 11);
        this.gaze = new GazeController(seed + 23);
        this.blink = new BlinkController(seed + 37);
        this.impulse = new ImpulseController();
        this.deformedPositions = new Float32Array(this.cartridge.positions);
        this.deformedNormals = new Float32Array(this.cartridge.normals);
        const initialMuscles = {};
        for (const m of FACS_MUSCLE_NAMES) {
            initialMuscles[m] = 0;
        }
        this.pose = {
            muscles: initialMuscles,
            neckQuat: new Quat(),
            jawQuat: new Quat(),
            eyeLeftQuat: new Quat(),
            eyeRightQuat: new Quat(),
            damageTier: 0
        };
        if (options.gl) {
            this.bindWebGL(options.gl);
        }
    }
    bindWebGL(gl) {
        this._gl = gl;
        const built = createRoostrFaceMesh(gl, this.cartridge, this.pose.damageTier, this.atlasSize);
        this.customMesh = built.customMesh;
        this.mesh = built.mesh;
        return this.mesh;
    }
    loadCartridge(cartridge) {
        this.cartridge =
            'positions' in cartridge && cartridge.positions instanceof Float32Array
                ? cartridge
                : hydrateCartridge(cartridge);
        for (const key of Object.keys(this.compositor.emotions)) {
            delete this.compositor.emotions[key];
        }
        for (const [k, layer] of Object.entries(this.cartridge.emotions)) {
            this.compositor.emotions[k] = layer;
            if (this.compositor.emotionWeights[k] === undefined) {
                this.compositor.emotionWeights[k] = 0;
                this.compositor.targetEmotionWeights[k] = 0;
            }
        }
        this.deformedPositions.set(this.cartridge.positions);
        this.deformedNormals.set(this.cartridge.normals);
        this.refreshAtlasTexture();
        this.update(0);
        return this;
    }
    rebuildRig(recomputeMuscles = true) {
        rebuildCartridgeRig(this.cartridge, recomputeMuscles);
        this.update(0);
        return this;
    }
    refreshAtlasTexture() {
        const pixels = generateFaceAtlasPixels(this.cartridge.appearance, this.pose.damageTier, this.atlasSize);
        if (this._gl && this.mesh) {
            const tex = Texture.create(pixels, this._gl, {
                size: new Vec2(this.atlasSize, this.atlasSize),
                flipY: false,
                generateMipmaps: true
            });
            if (tex) {
                this.mesh.setSharedTexture(tex);
            }
        }
        return pixels;
    }
    setEmotion(name, weight, immediate = false) {
        this.compositor.setEmotion(name, weight, immediate);
        return this;
    }
    setExclusiveEmotion(name, weight = 1.0, immediate = false) {
        this.compositor.setExclusiveEmotion(name, weight, immediate);
        return this;
    }
    setMuscle(muscle, weight) {
        this.compositor.setMuscleOverride(muscle, weight);
        return this;
    }
    clearMuscleOverrides() {
        this.compositor.clearMuscleOverrides();
        return this;
    }
    setGazeAngles(angles) {
        this.gaze.setGazeAngles(angles);
        return this;
    }
    lookAt(target, headOrigin = ZERO_VEC3) {
        this.gaze.lookAt(target, headOrigin);
        return this;
    }
    triggerBlink(duration) {
        this.blink.triggerBlink(duration);
        return this;
    }
    triggerImpulse(type, intensity = 1.0, direction, duration) {
        this.impulse.triggerImpulse(type, intensity, direction, duration);
        return this;
    }
    setHealth(healthPercent) {
        this._health = Utils.clamp(healthPercent, 0, 100);
        let tier = 0;
        if (this._health <= 0) {
            tier = 4;
            this.setExclusiveEmotion('dead', 1.0);
        }
        else if (this._health < 20) {
            tier = 4;
        }
        else if (this._health < 40) {
            tier = 3;
        }
        else if (this._health < 60) {
            tier = 2;
        }
        else if (this._health < 80) {
            tier = 1;
        }
        this.setDamageTier(tier);
        return this;
    }
    getHealth() {
        return this._health;
    }
    setDamageTier(tier) {
        const clamped = Utils.clamp(tier | 0, 0, 4);
        if (this.pose.damageTier !== clamped) {
            this.pose.damageTier = clamped;
            this.refreshAtlasTexture();
        }
        return this;
    }
    update(dt) {
        const pers = this.cartridge.personality;
        this.impulse.update(dt);
        if (this.autonomous) {
            this.gaze.update(dt, pers, this.compositor.currentHeadEuler, this.impulse.outputGazeOffset);
            this.blink.update(dt, pers, this.gaze.currentEyeAngles.y, this.gaze.lastGazeShiftMagnitude);
        }
        else {
            this.gaze.neckQuat.setFromEuler(this.compositor.currentHeadEuler);
            this.gaze.eyeLeftQuat.setFromEuler(_eulerScratch.setScalar(-this.gaze.targetGazeAngles.y, this.gaze.targetGazeAngles.x, 0));
            this.gaze.eyeRightQuat.setFromEuler(_eulerScratch.setScalar(-this.gaze.targetGazeAngles.y, this.gaze.targetGazeAngles.x, 0));
            this.blink.blinkLeft = 0;
            this.blink.blinkRight = 0;
            this.blink.eyelidPitchFollow = 0;
        }
        this.compositor.update(dt, pers, this.impulse.outputMuscles, this.impulse.outputHeadEuler, this.blink.blinkLeft, this.blink.blinkRight, this.blink.eyelidPitchFollow);
        for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
            const m = FACS_MUSCLE_NAMES[i];
            this.pose.muscles[m] = this.compositor.currentMuscles[m];
        }
        this.pose.neckQuat.copy(this.gaze.neckQuat);
        this.pose.eyeLeftQuat.copy(this.gaze.eyeLeftQuat);
        this.pose.eyeRightQuat.copy(this.gaze.eyeRightQuat);
        const jawOpenPitch = this.pose.muscles.jawOpen * 0.36;
        const jawLateralYaw = (this.pose.muscles.jawRight - this.pose.muscles.jawLeft) * 0.14;
        this.pose.jawQuat.setFromEuler(_eulerScratch.setScalar(jawOpenPitch, jawLateralYaw, 0));
        evaluateFaceDeformation(this.cartridge, this.pose, this.deformedPositions, this.deformedNormals);
        if (this.customMesh) {
            this.customMesh.vertices = this.deformedPositions;
            this.customMesh.normals = this.deformedNormals;
        }
        if (this.mesh) {
            syncRoostrMeshBuffers(this.mesh, this.deformedPositions, this.deformedNormals);
        }
        return this.pose;
    }
}

export { BlinkController, ExpressionCompositor, FACE_REGIONS, FACE_REGION_IDS, FACS_MUSCLE_NAMES, FaceR, GazeController, ImpulseController, Perlin1D, applyMacroProportions, computeFacsMuscles, computeSmoothNormals, createBaseHeadTopology, createDefaultAppearance, createDefaultCartridge, createDefaultEmotions, createDefaultPersonality, createDefaultProportions, createRoostrFaceMesh, evaluateFaceDeformation, generateFaceAtlasPixels, getCanonicalBaseHead, hydrateCartridge, rebuildCartridgeRig, rotateVec3ByQuat, serializeCartridge, syncRoostrMeshBuffers };
