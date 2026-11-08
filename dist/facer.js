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

import { Rand, Utils, Vec2, Vec3, Trigo, Box, Mat4x3, Quat } from '@1pizzateam/spock';
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

const HAIR_CAP_SEG_U = 20;
const HAIR_CAP_ROWS_V = 10;
const HAIR_CAP_VERTEX_COUNT = 2 * (HAIR_CAP_ROWS_V + 1) * (HAIR_CAP_SEG_U + 1);
const IMPORTED_EYE_PIVOT_ABS = [1.9538, 1.8642, 4.0475];
const CRANIAL_CENTER_X = 0.0;
const CRANIAL_CENTER_Y = 3.0;
const CRANIAL_CENTER_Z = -0.8;
const REGION_ID = {
    skin: 0,
    browsHair: 6,
};
const scratchPos = new Vec3();
const scratchNorm = new Vec3();
const HAIRLINE_AZ0 = [
    0.00, 0.22, 0.46, 0.71, 0.77,
    1.01, 1.19,
    1.22, 1.35, 1.40,
    1.51, 1.61, 1.71, 1.80,
    1.88, 1.98, 2.12,
    2.34, 2.59, 2.86, Trigo.pi,
];
const HAIRLINE_AZ_SMOOTH = [
    0.00, 0.22, 0.46, 0.73, 0.90,
    1.08, 1.25,
    1.33, 1.39, 1.46,
    1.54, 1.63, 1.72, 1.81,
    1.91, 2.02, 2.16,
    2.36, 2.60, 2.86, Trigo.pi,
];
const HAIRLINE_PHI0 = [
    0.44, 0.46, 0.49, 0.49, 0.27,
    0.12, -0.06,
    -0.38, -0.38, -0.17,
    -0.14, -0.13, -0.14, -0.2,
    -0.38, -0.6, -0.71,
    -0.74, -0.74, -0.72, -0.7,
];
const HAIRLINE_PHI_SMOOTH = [
    0.44, 0.46, 0.50, 0.50, 0.36,
    0.22, 0.10,
    -0.02, -0.08, -0.11,
    -0.12, -0.11, -0.12, -0.15,
    -0.28, -0.44, -0.58,
    -0.68, -0.72, -0.71, -0.7,
];
function computeEarWallLimitX(skinPositions, skinVertCount, side) {
    let maxSkullX = 0.0;
    for (let i = 0; i < skinVertCount; i++) {
        const x = skinPositions[i * 3] * side;
        const y = skinPositions[i * 3 + 1];
        const z = skinPositions[i * 3 + 2];
        if (x > 0.0 && y >= 2.72 && y <= 3.45 && z >= -1.95 && z <= 0.45) {
            if (x > maxSkullX)
                maxSkullX = x;
        }
    }
    if (maxSkullX < 3.0)
        maxSkullX = 4.78;
    return maxSkullX + 0.14;
}
function raycastSkullDistance(dx, dy, dz, skinPositions, skinIndices, earWallLimitX) {
    let bestT = -1;
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
        if (Math.abs(det) < eps)
            continue;
        const invDet = 1.0 / det;
        const sx = CRANIAL_CENTER_X - ax;
        const sy = CRANIAL_CENTER_Y - ay;
        const sz = CRANIAL_CENTER_Z - az;
        const u = (sx * hx + sy * hy + sz * hz) * invDet;
        if (u < -1e-4 || u > 1.0001)
            continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * invDet;
        if (v < -1e-4 || u + v > 1.0002)
            continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (t > 2.5) {
            if (t > bestT)
                bestT = t;
            if (t < minEarT)
                minEarT = t;
        }
    }
    if (bestT > 2.5) {
        const hitX = CRANIAL_CENTER_X + dx * bestT;
        const hitY = CRANIAL_CENTER_Y + dy * bestT;
        const hitZ = CRANIAL_CENTER_Z + dz * bestT;
        if (Math.abs(hitX) > earWallLimitX && hitY < 2.65 && hitZ > -2.4 && hitZ < 1.15) {
            const innerT = minEarT < bestT ? minEarT : bestT;
            bestT = Math.min(innerT, earWallLimitX / Math.max(0.2, Math.abs(dx)));
        }
        return bestT;
    }
    return 1.0 / Math.hypot(dx / 4.85, dy / 6.35, dz / 6.10);
}
function computeScalpRayDirection(side, iu, v, outDir) {
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
    const archV = Math.sin(v * Trigo.pi * 0.5);
    const dx = Utils.lerp(dx0, dx1, v);
    const dy = Utils.lerp(dy0, dy1, archV);
    const dz = Utils.lerp(dz0, dz1, v);
    return outDir.setScalar(dx, dy, dz).normalize();
}
function appendHairCapVertices(skinPositions, skinIndices, positions, uvs, indices, vertexRegionMap, jawWeights) {
    const segU = HAIR_CAP_SEG_U;
    const rowsV = HAIR_CAP_ROWS_V;
    const stride = segU + 1;
    const rayDir = new Vec3();
    const skinVertCount = (skinPositions.length / 3) | 0;
    const gridCount = (rowsV + 1) * stride;
    const sideGrids = new Map();
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
                skullDistGrid[gIdx] = raycastSkullDistance(rayDir.x, rayDir.y, rayDir.z, skinPositions, skinIndices, earWallLimitX);
            }
        }
        const isOuterEarPinna = (x, y, z) => x * side > earWallLimitX && y < 2.65 && z > -2.4 && z < 1.15;
        const sampleDirsAndR = [];
        const pushSkinSample = (x, y, z) => {
            if (x * side < -0.01 || y < -1.2 || isOuterEarPinna(x, y, z))
                return;
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
                        if (dx * rayX[a] + dy * rayY[a] + dz * rayZ[a] < 0.82)
                            continue;
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
                            if (Math.abs(det) < 1e-6)
                                continue;
                            const inv = 1.0 / det;
                            const u = (-ax * hx - ay * hy - az * hz) * inv;
                            if (u < -1e-4 || u > 1.0001)
                                continue;
                            const qx = -ay * e1z + az * e1y;
                            const qy = -az * e1x + ax * e1z;
                            const qz = -ax * e1y + ay * e1x;
                            const v = (dx * qx + dy * qy + dz * qz) * inv;
                            if (v < -1e-4 || u + v > 1.0002)
                                continue;
                            const tHair = (e2x * qx + e2y * qy + e2z * qz) * inv;
                            if (tHair <= 1.5)
                                continue;
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
                        if (matched)
                            break;
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
    const gridNeg = sideGrids.get(-1);
    const gridPos = sideGrids.get(1);
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
        const skullDistGrid = sideGrids.get(side);
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
                }
                else {
                    indices.push(a, c, b, b, c, d);
                }
            }
        }
    }
}
const _registeredHairStyles = new Map();
function registerHairStyle(style) {
    _registeredHairStyles.set(style.id, style);
}
function hasHairStyle(id) {
    return id === 'bald' || _registeredHairStyles.has(id);
}
function getHairStyle(id) {
    return _registeredHairStyles.get(id);
}
function decodeBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
function deserializeHairStyle(data) {
    const o = data;
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
async function loadHairStyle(id, urlOrBase) {
    const existing = _registeredHairStyles.get(id);
    if (existing)
        return existing;
    const url = urlOrBase.endsWith('.json') ? urlOrBase : `${urlOrBase.replace(/\/+$/, '')}/${id}.facerhair.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok)
        throw new Error(`FaceR: could not load hair style "${id}" from ${url} (HTTP ${res.status}).`);
    const style = deserializeHairStyle(await res.json());
    _registeredHairStyles.set(id, style);
    return style;
}
function applyHaircutStyleToPositions(positions, submeshes, hairStyle = 'bald') {
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
        throw new Error(`FaceR: hair style "${hairStyle}" is not registered. Load its .facerhair.json file and call ` +
            `registerHairStyle(deserializeHairStyle(json)) (or loadHairStyle) first.`);
    }
    const base = hairStartVertex * 3;
    for (let i = 0; i < HAIR_CAP_VERTEX_COUNT * 3; i++) {
        positions[base + i] += style.capDelta[i];
    }
}
function finiteOr0(token) {
    const n = Number(token);
    return Number.isFinite(n) ? n : 0;
}
function parseObjToTopology(objText) {
    const rawVerts = [];
    const rawTris = [];
    let faceCount = 0;
    const lines = objText.split(/\r?\n/);
    for (let l = 0; l < lines.length; l++) {
        const line = lines[l].trim();
        if (!line || line.charCodeAt(0) === 35)
            continue;
        if (line.startsWith('v ')) {
            const parts = line.split(/\s+/);
            if (parts.length >= 4) {
                rawVerts.push(finiteOr0(parts[1]), finiteOr0(parts[2]), finiteOr0(parts[3]));
            }
        }
        else if (line.startsWith('f ')) {
            const parts = line.split(/\s+/);
            const vCount = (rawVerts.length / 3) | 0;
            const poly = [];
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
    const validTris = [];
    for (let t = 0; t + 2 < rawTris.length; t += 3) {
        const a = rawTris[t], b = rawTris[t + 1], c = rawTris[t + 2];
        if (a < 0 || b < 0 || c < 0 || a >= vCount || b >= vCount || c >= vCount)
            continue;
        if (a === b || b === c || a === c)
            continue;
        validTris.push(a, b, c);
    }
    rawTris.length = 0;
    for (let t = 0; t < validTris.length; t++)
        rawTris.push(validTris[t]);
    if (vCount < 3 || rawTris.length < 3) {
        throw new Error(`parseObjToTopology: OBJ has no usable geometry (${vCount} vertices, ${rawTris.length / 3} valid triangles from ${faceCount} faces).`);
    }
    const bounds = new Box().setFromPoints(rawVerts, 3);
    const minX = bounds.min.x, maxX = bounds.max.x;
    const minY = bounds.min.y, maxY = bounds.max.y;
    const maxZ = bounds.max.z;
    const spanX = Math.max(1e-5, maxX - minX);
    const spanY = Math.max(1e-5, maxY - minY);
    const cx = 0.5 * (minX + maxX);
    const aspectYX = spanY / spanX;
    const scale = aspectYX >= 1.45 ? 20.5 / spanY : 12.2 / spanX;
    const targetMaxY = aspectYX >= 1.45 ? 9.4 : 6.8;
    const targetMaxZ = 7.09;
    const positions = [];
    const uvs = [];
    const jawWeights = [];
    const vertexRegionMap = [];
    for (let i = 0; i < vCount; i++) {
        const idx = i * 3;
        const x = (rawVerts[idx] - cx) * scale;
        const y = (rawVerts[idx + 1] - maxY) * scale + targetMaxY;
        const z = (rawVerts[idx + 2] - maxZ) * scale + targetMaxZ;
        positions.push(x, y, z);
        const uGrid = Math.atan2(x, z - -0.8) / Trigo.pi;
        const sv = Utils.clamp((y + 11.0) / 21.5, 0.0, 1.0);
        uvs.push(Utils.clamp(0.5 + uGrid * 0.48, 0.01, 0.99), Utils.clamp(0.74 - sv * 0.72, 0.02, 0.74));
        vertexRegionMap.push(REGION_ID.skin);
        const wTop = Utils.smoothstep(-2.15, -2.55, y);
        const wBot = Utils.smoothstep(-6.2, -4.8, y);
        const wFront = Utils.smoothstep(0.0, 2.5, z);
        jawWeights.push(Utils.clamp(wTop * wBot * wFront, 0.0, 1.0));
    }
    const indices = [...rawTris];
    const backSeamCloneMap = new Map();
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const i0 = indices[t];
        const i1 = indices[t + 1];
        const i2 = indices[t + 2];
        const zAvg = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
        if (zAvg >= -0.8)
            continue;
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
    const hairStartVertex = (positions.length / 3) | 0;
    const hairStartIndex = indices.length;
    appendHairCapVertices(positions, rawTris, positions, uvs, indices, vertexRegionMap, jawWeights);
    const posArray = new Float32Array(positions);
    const uvArray = new Float32Array(uvs);
    const indArray = new Int32Array(indices);
    const normals = computeSmoothNormals(posArray, indArray);
    unfoldNostrilCavityUVs(posArray, normals, uvArray, skinVertexCount);
    const submeshes = [
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
    const pivots = {
        neck: new Vec3(0, -7.8, -0.8),
        jaw: new Vec3(0, -1.25, 1.45),
        eyeLeft: new Vec3(-1.9538, IMPORTED_EYE_PIVOT_ABS[1], IMPORTED_EYE_PIVOT_ABS[2]),
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
function unfoldNostrilCavityUVs(positions, normals, uvs, skinVertexCount) {
    for (let i = 0; i < skinVertexCount; i++) {
        const pIdx = i * 3;
        const x = positions[pIdx];
        const absX = Math.abs(x);
        const y = positions[pIdx + 1];
        const z = positions[pIdx + 2];
        const ny = normals[pIdx + 1];
        if (absX >= 0.30 &&
            absX <= 1.20 &&
            y >= -0.6 &&
            y <= -0.14 &&
            z >= 5.75 &&
            z <= 6.58 &&
            ny < -0.58) {
            const cavityW = Utils.clamp((-ny - 0.58) / 0.25, 0.0, 1.0);
            const targetYHead = -0.45;
            const targetSv = Utils.clamp((targetYHead + 11.0) / 21.5, 0.0, 1.0);
            const targetV = Utils.clamp(0.74 - targetSv * 0.72, 0.02, 0.74);
            const signX = x < 0 ? -1 : 1.0;
            const targetU = 0.5 + signX * 0.032;
            const uIdx = i * 2;
            uvs[uIdx] = Utils.lerp(uvs[uIdx], targetU, cavityW * 0.85);
            uvs[uIdx + 1] = Utils.lerp(uvs[uIdx + 1], targetV, cavityW);
        }
    }
}
function computeSmoothNormals(positions, indices) {
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
                scratchNorm.setScalar(0, scratchPos.y - CRANIAL_CENTER_Y, scratchPos.z - CRANIAL_CENTER_Z);
            }
            scratchNorm.normalize().toArray(normArray, i);
        }
    }
    return normArray;
}
const _registeredBaseHeads = new Map();
function registerBaseHead(id, geometry) {
    _registeredBaseHeads.set(id, geometry);
}
function hasBaseHead(id) {
    return _registeredBaseHeads.has(id);
}
function getCanonicalBaseHead(baseHeadId) {
    const head = _registeredBaseHeads.get(baseHeadId);
    if (!head) {
        throw new Error(`FaceR: base head "${baseHeadId}" is not registered. Load its .facerhead.json file and call ` +
            `registerBaseHead(id, deserializeBaseHead(json)) first.`);
    }
    return head;
}
function deserializeBaseHead(data) {
    const o = data;
    if (!o || o.format !== 'facer-head' || !Array.isArray(o.positions) || !Array.isArray(o.indices)) {
        throw new Error('deserializeBaseHead: not a facer-head asset.');
    }
    const v3 = (a) => new Vec3(a[0], a[1], a[2]);
    const positions = new Float32Array(o.positions);
    const indices = new Int32Array(o.indices);
    const vertexCount = (positions.length / 3) | 0;
    if (o.normals.length !== positions.length || o.jawWeights.length !== vertexCount || o.vertexRegionMap.length !== vertexCount) {
        throw new Error('deserializeBaseHead: inconsistent buffer sizes.');
    }
    for (let i = 0; i < indices.length; i++) {
        if (indices[i] < 0 || indices[i] >= vertexCount)
            throw new Error('deserializeBaseHead: index out of range.');
    }
    let eyeballPlacement;
    if (o.eyeballPlacement && typeof o.eyeballPlacement === 'object') {
        const off = o.eyeballPlacement.offset;
        const sc = Number(o.eyeballPlacement.scale);
        eyeballPlacement = {
            offset: Array.isArray(off) && off.length >= 3 ? v3(off) : new Vec3(0, 0, 0),
            scale: Number.isFinite(sc) && sc > 0 ? sc : 1.0,
        };
    }
    let eyeHolePlacement;
    if (o.eyeHolePlacement && typeof o.eyeHolePlacement === 'object') {
        const off = o.eyeHolePlacement.offset;
        const sc = o.eyeHolePlacement.scale;
        const sx = Array.isArray(sc) ? Number(sc[0]) : Number(sc?.x ?? sc);
        const sy = Array.isArray(sc) ? Number(sc[1]) : Number(sc?.y ?? sc);
        eyeHolePlacement = {
            offset: Array.isArray(off) && off.length >= 3 ? v3(off) : new Vec3(0, 0, 0),
            scale: new Vec2(Number.isFinite(sx) && sx > 0 ? sx : 1.0, Number.isFinite(sy) && sy > 0 ? sy : 1.0),
        };
    }
    let teethPlacement;
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
        submeshes: o.submeshes.map((s) => ({ ...s })),
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
async function loadBaseHead(id, urlOrBase) {
    const existing = _registeredBaseHeads.get(id);
    if (existing)
        return existing;
    const url = urlOrBase.endsWith('.json') ? urlOrBase : `${urlOrBase.replace(/\/+$/, '')}/${id}.facerhead.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok)
        throw new Error(`FaceR: could not load base head "${id}" from ${url} (HTTP ${res.status}).`);
    const head = deserializeBaseHead(await res.json());
    _registeredBaseHeads.set(id, head);
    return head;
}

let _profile = null;
function registerFaceProfile(profile) {
    _profile = profile;
}
function getFaceProfile() {
    return _profile;
}
function defaultBaseHeadId() {
    const id = _profile?.defaultBaseHead;
    if (!id) {
        throw new Error('FaceR: no base head named. Pass a head id, or register a face profile with a defaultBaseHead.');
    }
    return id;
}
const MUSCLE_SET = new Set(FACS_MUSCLE_NAMES);
function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function vec3(v, what) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error(`deserializeFaceProfile: ${what} must be [x, y, z].`);
    }
    return new Vec3(v[0], v[1], v[2]);
}
function triple(v, what) {
    const t = vec3(v, what);
    return [t.x, t.y, t.z];
}
function muscleName(name, what) {
    if (!MUSCLE_SET.has(name))
        throw new Error(`deserializeFaceProfile: unknown muscle "${name}" in ${what}.`);
    return name;
}
function muscleWeights(o, what) {
    const out = [];
    for (const [name, w] of Object.entries((o ?? {}))) {
        out.push([muscleName(name, what), num(w, 0)]);
    }
    return out;
}
function deserializeFaceProfile(data) {
    const o = data;
    if (!o || o.format !== 'facer-profile' || typeof o.id !== 'string') {
        throw new Error('deserializeFaceProfile: not a facer-profile asset.');
    }
    const emotions = {};
    for (const [name, layer] of Object.entries((o.emotions ?? {}))) {
        const muscles = {};
        for (const [m, w] of muscleWeights(layer?.muscles, `emotion "${name}"`))
            muscles[m] = w;
        emotions[name] = { name, muscles, headEulerOffset: layer?.headEulerOffset ? vec3(layer.headEulerOffset, `emotion "${name}" headEulerOffset`) : new Vec3(0, 0, 0) };
    }
    let appearance;
    if (o.appearance) {
        appearance = { damageSeed: num(o.appearance.damageSeed, 1337) };
        for (const k of ['skinColor', 'skinShadowColor', 'lipColor', 'irisColor', 'scleraColor', 'browColor', 'hairColor', 'teethColor']) {
            if (o.appearance[k] !== undefined)
                appearance[k] = vec3(o.appearance[k], `appearance.${k}`);
        }
    }
    let personality;
    if (o.personality) {
        const p = o.personality;
        const v2 = (a, d) => (Array.isArray(a) ? new Vec2(num(a[0], d[0]), num(a[1], d[1])) : new Vec2(d[0], d[1]));
        personality = {
            blinkIntervalRange: v2(p.blinkIntervalRange, [2.2, 5.2]),
            blinkDuration: num(p.blinkDuration, 0.16),
            saccadeFrequency: num(p.saccadeFrequency, 0.85),
            saccadeAmplitude: v2(p.saccadeAmplitude, [0.28, 0.16]),
            headFollowRatio: num(p.headFollowRatio, 0.42),
            headDamping: num(p.headDamping, 7.5),
            eyeDamping: num(p.eyeDamping, 26),
            asymmetryAmount: num(p.asymmetryAmount, 0.08),
            microJitterAmount: num(p.microJitterAmount, 0.04)
        };
    }
    let material;
    if (o.material) {
        material = {
            ambient: vec3(o.material.ambient, 'material.ambient'),
            diffuse: vec3(o.material.diffuse, 'material.diffuse'),
            specular: vec3(o.material.specular, 'material.specular'),
            shininess: num(o.material.shininess, 22)
        };
    }
    let damage;
    if (o.damage) {
        const d = o.damage;
        const thresholds = (Array.isArray(d.tierHealthThresholds) ? d.tierHealthThresholds : []).map((n) => num(n, 0));
        const zones = (Array.isArray(d.zones) ? d.zones : []).map((z) => ({
            id: String(z.id),
            center: vec3(z.center, `zone ${z.id} center`),
            radii: vec3(z.radii, `zone ${z.id} radii`),
            minTier: num(z.minTier, 1),
            tierBase: num(z.tierBase, 0),
            weight: num(z.weight, 0),
            normal: triple(z.normal ?? [0, 0, 0], `zone ${z.id} normal`),
            constant: triple(z.constant ?? [0, 0, 0], `zone ${z.id} constant`)
        }));
        const r = d.reaction ?? {};
        damage = {
            tierHealthThresholds: thresholds,
            minZ: num(d.minZ, 0),
            zones,
            reaction: {
                intensityHealthRef: num(r.intensityHealthRef, 85),
                intensityPerTier: num(r.intensityPerTier, 0),
                pant: r.pant
                    ? {
                        minTier: num(r.pant.minTier, 2), perTier: num(r.pant.perTier, 0), tierBase: num(r.pant.tierBase, 0),
                        floor: num(r.pant.floor, 0), freqBase: num(r.pant.freqBase, 1), freqIntensity: num(r.pant.freqIntensity, 0)
                    }
                    : null,
                muscles: (Array.isArray(r.muscles) ? r.muscles : []).map((m) => ({
                    muscle: muscleName(String(m.muscle), 'damage.reaction'),
                    minTier: num(m.minTier, 1), tierBase: num(m.tierBase, 0),
                    perTier: num(m.perTier, 0), intensity: num(m.intensity, 0), pant: num(m.pant, 0)
                }))
            }
        };
    }
    const impulses = {};
    for (const [type, r] of Object.entries((o.impulses ?? {}))) {
        impulses[type] = {
            duration: num(r.duration, 0.5),
            attack: num(r.attack, 0.18),
            muscles: muscleWeights(r.muscles, `impulse "${type}"`),
            headEuler: r.headEuler ? triple(r.headEuler, `impulse "${type}" headEuler`) : null,
            headEulerDirX: r.headEulerDirX ? triple(r.headEulerDirX, `impulse "${type}" headEulerDirX`) : null,
            directionalMuscles: (Array.isArray(r.directionalMuscles) ? r.directionalMuscles : []).map((m) => ({
                muscle: muscleName(String(m.muscle), `impulse "${type}"`),
                whenXNegative: num(m.whenXNegative, 0),
                otherwise: num(m.otherwise, 0)
            })),
            gazeFromDir: r.gazeFromDir ? { maxX: num(r.gazeFromDir.maxX, 0), maxY: num(r.gazeFromDir.maxY, 0) } : null
        };
    }
    return {
        id: o.id,
        defaultBaseHead: typeof o.defaultBaseHead === 'string' ? o.defaultBaseHead : undefined,
        emotions,
        appearance,
        personality,
        material,
        damage,
        impulses,
        holdShooting: { riseRate: num(o.holdShooting?.holdRiseRate, 35), fallRate: num(o.holdShooting?.holdFallRate, 22) }
    };
}
async function loadFaceProfile(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok)
        throw new Error(`FaceR: could not load the face profile from ${url} (HTTP ${res.status}).`);
    const profile = deserializeFaceProfile(await res.json());
    registerFaceProfile(profile);
    return profile;
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
function computeUvEyeHoleWeight(u, v) {
    if (v >= 0.74)
        return 0;
    const uGrid = (u - 0.5) / 0.48;
    const absU = Math.abs(uGrid);
    const sv = Utils.clamp((0.74 - v) / 0.72, 0.0, 1.0);
    const yHead = -11 + sv * 21.5;
    const wMedial = Utils.smoothstep(0.048, 0.058, absU);
    const wLateral = Utils.smoothstep(0.200, 0.178, absU);
    const wBrow = Utils.smoothstep(2.445, 2.385, yHead);
    const wLower = Utils.smoothstep(1.12, 1.48, yHead);
    const du = (absU - 0.116) / 0.078;
    const dy = (yHead - 1.95) / 0.78;
    const wEllipse = Utils.smoothstep(1.25, 0.82, Math.hypot(du, dy));
    return wMedial * wLateral * wBrow * wLower * wEllipse;
}
function applyMacroProportions(baseHead, proportions, sculptOffsets, outPositions, outPivots) {
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
    outPivots.jaw.setScalar(basePivots.jaw.x, basePivots.jaw.y * proportions.jawScale.y, basePivots.jaw.z * proportions.jawScale.z);
    outPivots.eyeLeft.setScalar(basePivots.eyeLeft.x - eyeDx, basePivots.eyeLeft.y + eyeDy, basePivots.eyeLeft.z + eyeDz);
    outPivots.eyeRight.setScalar(basePivots.eyeRight.x + eyeDx, basePivots.eyeRight.y + eyeDy, basePivots.eyeRight.z + eyeDz);
    const smBrows = baseHead.submeshes.find(sm => sm.name === 'browsHair');
    const hairStartVertex = smBrows && smBrows.vertexCount >= HAIR_CAP_VERTEX_COUNT
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
        }
        else if (region === FACE_REGION_IDS.eyeRight) {
            p.x += eyeDx;
            p.y += eyeDy;
            p.z += eyeDz;
        }
        else if (region === FACE_REGION_IDS.browsHair && i < hairStartVertex) {
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
        }
        else if (region === FACE_REGION_IDS.browsHair && i >= hairStartVertex) {
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
        }
        else if (region === FACE_REGION_IDS.teethUpper ||
            region === FACE_REGION_IDS.teethLower ||
            region === FACE_REGION_IDS.mouthInner) {
            p.x *= Utils.lerp(1.0, proportions.mouthScale.x, 0.65);
            p.y += (proportions.jawScale.y - 1.0) * -1.4;
            p.z += (proportions.mouthScale.z - 1.0) * 1.1;
        }
        else {
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
            const wEye3d = symmetricFalloff(p, cEye, rEye) *
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
function evaluateSingleMuscleDisplacement(muscleName, pos, region, jawW, pivots, outDelta) {
    outDelta.origin();
    if (region === FACE_REGION_IDS.eyeLeft ||
        region === FACE_REGION_IDS.eyeRight ||
        region === FACE_REGION_IDS.teethUpper) {
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
            if (region === FACE_REGION_IDS.browsHair)
                break;
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
            if (region === FACE_REGION_IDS.browsHair)
                break;
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
                outDelta.setScalar(signX * (0.68 * wCorner + 0.24 * wCheek), 0.78 * wCorner + 0.38 * wCheek, -0.18 * wCorner + 0.26 * wCheek);
            }
            break;
        }
        case 'mouthFrownL':
        case 'mouthFrownR': {
            const isLeft = muscleName === 'mouthFrownL';
            const signX = isLeft ? -1 : 1;
            const w = regionFalloff(pos, new Vec3(signX * 1.72, -2.38, 5.86), new Vec3(1.38, 1.15, 2.2));
            if (w > 0.002) {
                outDelta.setScalar(signX * 0.18 * w, -0.76 * w, -0.1 * w);
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
function computeFacsMuscles(positions, indices, vertexRegionMap, pivots, jawWeights) {
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
const _scratchPoint = new Vec3();
const NECK_WEIGHT_BASE_Y = -9.8;
const NECK_FULL_WEIGHT_Y = -5.8;
function buildTraumaZone(candidates, basePositions, center, radii) {
    const idx = [];
    const fall = [];
    for (let c = 0; c < candidates.length; c++) {
        const i = candidates[c];
        _scratchPoint.setArray(basePositions, i * 3);
        const d = _scratchPoint.getEllipsoidDistance(center, radii);
        if (d < 1.0) {
            idx.push(i);
            fall.push(Utils.smoothstep(1.0, 0.0, d));
        }
    }
    return { indices: Uint32Array.from(idx), falloff: Float32Array.from(fall) };
}
function buildDeformCache(cartridge) {
    const base = cartridge.positions;
    const regionMap = cartridge.vertexRegionMap;
    const jawW = cartridge.jawWeights;
    const vertexCount = (base.length / 3) | 0;
    const eyeLeft = [];
    const eyeRight = [];
    const jaw = [];
    const jawWeights = [];
    const neck = [];
    const neckWeights = [];
    const traumaCandidates = [];
    const damage = getFaceProfile()?.damage;
    const traumaMinZ = damage ? damage.minZ : Infinity;
    for (let i = 0; i < vertexCount; i++) {
        const region = regionMap[i];
        if (region === FACE_REGION_IDS.eyeLeft)
            eyeLeft.push(i);
        else if (region === FACE_REGION_IDS.eyeRight)
            eyeRight.push(i);
        if (jawW[i] > 0.001) {
            jaw.push(i);
            jawWeights.push(jawW[i]);
        }
        const baseY = base[i * 3 + 1];
        if (region !== FACE_REGION_IDS.skin || baseY >= NECK_FULL_WEIGHT_Y) {
            neck.push(i);
            neckWeights.push(1);
        }
        else if (baseY > NECK_WEIGHT_BASE_Y) {
            neck.push(i);
            neckWeights.push(Utils.smoothstep(NECK_WEIGHT_BASE_Y, NECK_FULL_WEIGHT_Y, baseY));
        }
        if (region === FACE_REGION_IDS.skin && base[i * 3 + 2] >= traumaMinZ) {
            traumaCandidates.push(i);
        }
    }
    return {
        vertexCount,
        eyeLeft: Uint32Array.from(eyeLeft),
        eyeRight: Uint32Array.from(eyeRight),
        jaw: Uint32Array.from(jaw),
        jawWeights: Float32Array.from(jawWeights),
        neck: Uint32Array.from(neck),
        neckWeights: Float32Array.from(neckWeights),
        zoneSpecs: damage ? damage.zones : [],
        zones: (damage ? damage.zones : []).map((z) => buildTraumaZone(traumaCandidates, base, z.center, z.radii))
    };
}
function getDeformCache(cartridge) {
    const holder = cartridge;
    const cached = holder._deformCache;
    if (cached && cached.vertexCount === ((cartridge.positions.length / 3) | 0)) {
        return cached;
    }
    const built = buildDeformCache(cartridge);
    Object.defineProperty(cartridge, '_deformCache', {
        value: built,
        enumerable: false,
        writable: true,
        configurable: true
    });
    return built;
}
function invalidateDeformCache(cartridge) {
    delete cartridge._deformCache;
}
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
        for (let k = 0, n = indices.length; k < n; k++) {
            const v = indices[k] * 3;
            const d = k * 3;
            outPositions[v] += dPos[d] * w;
            outPositions[v + 1] += dPos[d + 1] * w;
            outPositions[v + 2] += dPos[d + 2] * w;
            outNormals[v] += dNorm[d] * w;
            outNormals[v + 1] += dNorm[d + 1] * w;
            outNormals[v + 2] += dNorm[d + 2] * w;
        }
    }
    const cache = getDeformCache(cartridge);
    const pivots = cartridge.pivots;
    const tier = Utils.clamp(pose.damageTier | 0, 0, 4);
    if (tier > 0) {
        applyTrauma(cache, tier, outPositions, outNormals);
    }
    if (pose.eyeLeftQuat.vector.getMagnitude(true) > 1e-8) {
        buildPivotMatrix(pivots.eyeLeft, pose.eyeLeftQuat, _eyeLeftMat, _unitScale, _negPivot);
        _eyeLeftMat.transformPoints(outPositions, cache.eyeLeft);
        _eyeLeftMat.transformDirections(outNormals, cache.eyeLeft);
    }
    if (pose.eyeRightQuat.vector.getMagnitude(true) > 1e-8) {
        buildPivotMatrix(pivots.eyeRight, pose.eyeRightQuat, _eyeRightMat, _unitScale, _negPivot);
        _eyeRightMat.transformPoints(outPositions, cache.eyeRight);
        _eyeRightMat.transformDirections(outNormals, cache.eyeRight);
    }
    if (pose.jawQuat.vector.getMagnitude(true) > 1e-8) {
        buildPivotMatrix(pivots.jaw, pose.jawQuat, _jawMat, _unitScale, _negPivot);
        _jawMat.transformPoints(outPositions, cache.jaw, cache.jawWeights);
        _jawMat.transformDirections(outNormals, cache.jaw, cache.jawWeights);
    }
    if (pose.neckQuat.vector.getMagnitude(true) > 1e-8) {
        buildPivotMatrix(pivots.neck, pose.neckQuat, _neckMat, _unitScale, _negPivot);
        _neckMat.transformPoints(outPositions, cache.neck, cache.neckWeights);
        _neckMat.transformDirections(outNormals, cache.neck, cache.neckWeights);
    }
}
function applyTrauma(cache, tier, pos, nrm) {
    for (let z = 0; z < cache.zones.length; z++) {
        const spec = cache.zoneSpecs[z];
        if (tier < spec.minTier)
            continue;
        const zone = cache.zones[z];
        const scale = spec.weight * (tier - spec.tierBase);
        const [nx, ny, nz] = spec.normal;
        const [cx, cy, cz] = spec.constant;
        for (let k = 0; k < zone.indices.length; k++) {
            const i = zone.indices[k] * 3;
            const w = zone.falloff[k] * scale;
            pos[i] += (nrm[i] * nx + cx) * w;
            pos[i + 1] += (nrm[i + 1] * ny + cy) * w;
            pos[i + 2] += (nrm[i + 2] * nz + cz) * w;
        }
    }
}
let _atlasPainter = null;
function registerAtlasPainter(painter) {
    _atlasPainter = painter;
}
function generateFaceAtlasPixels(appearance, damageTier = 0, size = 256) {
    if (_atlasPainter) {
        const painted = _atlasPainter(appearance, damageTier, size);
        if (painted.length !== size * size * 4) {
            throw new Error(`FaceR: the atlas painter returned ${painted.length} bytes, expected ${size * size * 4}.`);
        }
        return painted;
    }
    const pixels = new Uint8Array(size * size * 4);
    const r = Utils.clamp(Math.round(appearance.skinColor.x * 255), 0, 255);
    const g = Utils.clamp(Math.round(appearance.skinColor.y * 255), 0, 255);
    const b = Utils.clamp(Math.round(appearance.skinColor.z * 255), 0, 255);
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
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
    const look = getFaceProfile()?.material ?? {
        ambient: new Vec3(0.4, 0.4, 0.4), diffuse: new Vec3(0.8, 0.8, 0.8), specular: new Vec3(0, 0, 0), shininess: 1
    };
    const mat = new Material({
        ambient: new Vec3().copy(look.ambient),
        diffuse: new Vec3().copy(look.diffuse),
        specular: new Vec3().copy(look.specular),
        shininess: look.shininess
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

function isValidMuscleDelta(raw, vertexCount) {
    if (!raw || typeof raw !== 'object' || !raw.indices || !raw.dPos)
        return false;
    const n = raw.indices.length;
    if (typeof n !== 'number' || raw.dPos.length !== n * 3)
        return false;
    if (raw.dNorm && raw.dNorm.length !== n * 3)
        return false;
    for (let i = 0; i < n; i++) {
        const v = raw.indices[i];
        if (!Number.isInteger(v) || v < 0 || v >= vertexCount)
            return false;
    }
    for (let i = 0; i < n * 3; i++) {
        if (!Number.isFinite(Number(raw.dPos[i])))
            return false;
    }
    return true;
}
function sanitizeMuscleWeights(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object')
        return out;
    for (const m of FACS_MUSCLE_NAMES) {
        const v = Number(raw[m]);
        if (Number.isFinite(v) && v !== 0)
            out[m] = Math.min(1, Math.max(0, v));
    }
    return out;
}
function numOr(val, def) {
    return typeof val === 'number' && Number.isFinite(val) ? val : def;
}
function toVec2(val, defX, defY) {
    if (val instanceof Vec2) {
        return new Vec2().copy(val);
    }
    if (Array.isArray(val) && val.length >= 2) {
        return new Vec2(numOr(Number(val[0]), 0), numOr(Number(val[1]), 0));
    }
    if (val && typeof val === 'object') {
        const obj = val;
        return new Vec2(numOr(obj.x, defX), numOr(obj.y, defY));
    }
    return new Vec2(defX, defY);
}
function toVec3(val, defX, defY, defZ) {
    if (val instanceof Vec3) {
        return new Vec3().copy(val);
    }
    if (Array.isArray(val) && val.length >= 3) {
        return new Vec3(numOr(Number(val[0]), 0), numOr(Number(val[1]), 0), numOr(Number(val[2]), 0));
    }
    if (val && typeof val === 'object') {
        const obj = val;
        return new Vec3(numOr(obj.x, defX), numOr(obj.y, defY), numOr(obj.z, defZ));
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
    const out = {
        neutral: { name: 'neutral', muscles: {}, headEulerOffset: new Vec3(0, 0, 0) }
    };
    const profile = getFaceProfile();
    if (profile) {
        for (const [name, layer] of Object.entries(profile.emotions)) {
            out[name] = { name, muscles: { ...layer.muscles }, headEulerOffset: new Vec3().copy(layer.headEulerOffset) };
        }
    }
    return out;
}
function createDefaultPersonality() {
    const p = getFaceProfile()?.personality;
    if (p) {
        return {
            ...p,
            blinkIntervalRange: new Vec2().copy(p.blinkIntervalRange),
            saccadeAmplitude: new Vec2().copy(p.saccadeAmplitude)
        };
    }
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
    const a = getFaceProfile()?.appearance ?? {};
    const col = (v, d) => new Vec3().copy(v ?? new Vec3(d[0], d[1], d[2]));
    return {
        baseHead: getFaceProfile()?.defaultBaseHead ?? '',
        skinColor: col(a.skinColor, [0.6, 0.5, 0.45]),
        skinShadowColor: col(a.skinShadowColor, [0.3, 0.24, 0.2]),
        lipColor: col(a.lipColor, [0.5, 0.3, 0.28]),
        irisColor: col(a.irisColor, [0.25, 0.2, 0.15]),
        scleraColor: col(a.scleraColor, [0.95, 0.93, 0.9]),
        browColor: col(a.browColor, [0.15, 0.1, 0.08]),
        hairColor: col(a.hairColor, [0.15, 0.1, 0.08]),
        hairStyle: 'bald',
        teethColor: col(a.teethColor, [0.94, 0.92, 0.88]),
        damageSeed: a.damageSeed ?? 1337
    };
}
function rebuildCartridgeRig(cartridge, recomputeMuscles = true) {
    const baseHead = cartridge._baseTopology ??
        getCanonicalBaseHead(cartridge.appearance?.baseHead || defaultBaseHeadId());
    if (cartridge.positions.length !== baseHead.positions.length ||
        cartridge.indices.length !== baseHead.indices.length ||
        cartridge.uvs.length !== baseHead.uvs.length) {
        cartridge.uvs = new Float32Array(baseHead.uvs);
        cartridge.indices = new Int32Array(baseHead.indices);
        cartridge.submeshes = baseHead.submeshes.map(sm => ({ ...sm }));
        cartridge.vertexRegionMap = new Uint8Array(baseHead.vertexRegionMap);
        cartridge.jawWeights = new Float32Array(baseHead.jawWeights);
        cartridge.sculptOffsets = new Float32Array(baseHead.positions.length);
    }
    if (!cartridge.sculptOffsets || cartridge.sculptOffsets.length !== baseHead.positions.length) {
        cartridge.sculptOffsets = new Float32Array(baseHead.positions.length);
    }
    if (!cartridge.positions || cartridge.positions.length !== baseHead.positions.length) {
        cartridge.positions = new Float32Array(baseHead.positions.length);
    }
    applyMacroProportions(baseHead, cartridge.proportions, cartridge.sculptOffsets, cartridge.positions, cartridge.pivots);
    applyHaircutStyleToPositions(cartridge.positions, cartridge.submeshes, cartridge.appearance?.hairStyle ?? 'bald');
    cartridge.normals = computeSmoothNormals(cartridge.positions, cartridge.indices);
    if (recomputeMuscles) {
        cartridge.muscles = computeFacsMuscles(cartridge.positions, cartridge.indices, cartridge.vertexRegionMap, cartridge.pivots, cartridge.jawWeights);
    }
    invalidateDeformCache(cartridge);
    return cartridge;
}
function createDefaultCartridge(name = 'Face', id = 'face', baseHeadId = defaultBaseHeadId()) {
    const baseHead = getCanonicalBaseHead(baseHeadId);
    const proportions = createDefaultProportions();
    const appearance = createDefaultAppearance();
    appearance.baseHead = baseHeadId;
    const sculptOffsets = new Float32Array(baseHead.positions.length);
    const positions = new Float32Array(baseHead.positions.length);
    const pivots = {
        neck: new Vec3().copy(baseHead.pivots.neck),
        jaw: new Vec3().copy(baseHead.pivots.jaw),
        eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
        eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
    };
    applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
    applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);
    const normals = computeSmoothNormals(positions, baseHead.indices);
    const muscles = computeFacsMuscles(positions, baseHead.indices, baseHead.vertexRegionMap, pivots, baseHead.jawWeights);
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
        appearance
    };
}
function parseObjToCartridge(objText, name = 'Imported .OBJ Head', id = 'imported_obj_head') {
    const baseHead = parseObjToTopology(objText);
    const proportions = createDefaultProportions();
    const appearance = createDefaultAppearance();
    const sculptOffsets = new Float32Array(baseHead.positions.length);
    const positions = new Float32Array(baseHead.positions.length);
    const pivots = {
        neck: new Vec3().copy(baseHead.pivots.neck),
        jaw: new Vec3().copy(baseHead.pivots.jaw),
        eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
        eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
    };
    applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
    applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);
    const normals = computeSmoothNormals(positions, baseHead.indices);
    const muscles = computeFacsMuscles(positions, baseHead.indices, baseHead.vertexRegionMap, pivots, baseHead.jawWeights);
    const cartridge = {
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
        appearance
    };
    Object.defineProperty(cartridge, '_baseTopology', {
        value: baseHead,
        enumerable: false,
        writable: true,
        configurable: true
    });
    return cartridge;
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
            baseHead: cartridge.appearance.baseHead ?? '',
            skinColor: vec3ToArray(cartridge.appearance.skinColor),
            skinShadowColor: vec3ToArray(cartridge.appearance.skinShadowColor),
            lipColor: vec3ToArray(cartridge.appearance.lipColor),
            irisColor: vec3ToArray(cartridge.appearance.irisColor),
            scleraColor: vec3ToArray(cartridge.appearance.scleraColor),
            browColor: vec3ToArray(cartridge.appearance.browColor),
            hairColor: vec3ToArray(cartridge.appearance.hairColor ?? cartridge.appearance.browColor),
            hairStyle: cartridge.appearance.hairStyle ?? 'bald',
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
    const defProps = createDefaultProportions();
    const rawProps = obj.proportions || {};
    const defApp = createDefaultAppearance();
    const rawApp = obj.appearance || {};
    const rawBaseHead = rawApp.baseHead ?? obj.baseHead;
    const baseHeadId = typeof rawBaseHead === 'string' && hasBaseHead(rawBaseHead)
        ? rawBaseHead
        : (defApp.baseHead || defaultBaseHeadId());
    const baseHead = getCanonicalBaseHead(baseHeadId);
    const rawHairStyle = rawApp.hairStyle;
    const hairStyle = typeof rawHairStyle === 'string' && hasHairStyle(rawHairStyle)
        ? rawHairStyle
        : defApp.hairStyle;
    const appearance = {
        baseHead: baseHeadId,
        skinColor: toVec3(rawApp.skinColor, defApp.skinColor.x, defApp.skinColor.y, defApp.skinColor.z),
        skinShadowColor: toVec3(rawApp.skinShadowColor, defApp.skinShadowColor.x, defApp.skinShadowColor.y, defApp.skinShadowColor.z),
        lipColor: toVec3(rawApp.lipColor, defApp.lipColor.x, defApp.lipColor.y, defApp.lipColor.z),
        irisColor: toVec3(rawApp.irisColor, defApp.irisColor.x, defApp.irisColor.y, defApp.irisColor.z),
        scleraColor: toVec3(rawApp.scleraColor, defApp.scleraColor.x, defApp.scleraColor.y, defApp.scleraColor.z),
        browColor: toVec3(rawApp.browColor, defApp.browColor.x, defApp.browColor.y, defApp.browColor.z),
        hairColor: toVec3(rawApp.hairColor ?? rawApp.browColor, defApp.hairColor.x, defApp.hairColor.y, defApp.hairColor.z),
        hairStyle,
        teethColor: toVec3(rawApp.teethColor, defApp.teethColor.x, defApp.teethColor.y, defApp.teethColor.z),
        damageSeed: numOr(rawApp.damageSeed, defApp.damageSeed),
        customTierOverrides: rawApp.customTierOverrides && typeof rawApp.customTierOverrides === 'object'
            ? { ...rawApp.customTierOverrides }
            : undefined
    };
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
    applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);
    const normals = computeSmoothNormals(positions, baseHead.indices);
    let muscles;
    const vertexCount = (positions.length / 3) | 0;
    const hasCompleteSavedMuscles = obj.muscles &&
        typeof obj.muscles === 'object' &&
        FACS_MUSCLE_NAMES.every(m => isValidMuscleDelta(obj.muscles[m], vertexCount));
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
        muscles = computeFacsMuscles(positions, baseHead.indices, baseHead.vertexRegionMap, pivots, baseHead.jawWeights);
    }
    const defEmotions = createDefaultEmotions();
    const emotions = { ...defEmotions };
    if (obj.emotions && typeof obj.emotions === 'object') {
        for (const [k, rawLayer] of Object.entries(obj.emotions)) {
            if (rawLayer && typeof rawLayer === 'object') {
                emotions[k] = {
                    name: typeof rawLayer.name === 'string' ? rawLayer.name : k,
                    muscles: sanitizeMuscleWeights(rawLayer.muscles),
                    headEulerOffset: toVec3(rawLayer.headEulerOffset, 0, 0, 0)
                };
            }
        }
    }
    const defPers = createDefaultPersonality();
    const rawPers = obj.personality || {};
    const personality = {
        blinkIntervalRange: toVec2(rawPers.blinkIntervalRange, defPers.blinkIntervalRange.x, defPers.blinkIntervalRange.y),
        blinkDuration: numOr(rawPers.blinkDuration, defPers.blinkDuration),
        saccadeFrequency: numOr(rawPers.saccadeFrequency, defPers.saccadeFrequency),
        saccadeAmplitude: toVec2(rawPers.saccadeAmplitude, defPers.saccadeAmplitude.x, defPers.saccadeAmplitude.y),
        headFollowRatio: numOr(rawPers.headFollowRatio, defPers.headFollowRatio),
        headDamping: numOr(rawPers.headDamping, defPers.headDamping),
        eyeDamping: numOr(rawPers.eyeDamping, defPers.eyeDamping),
        asymmetryAmount: numOr(rawPers.asymmetryAmount, defPers.asymmetryAmount),
        microJitterAmount: numOr(rawPers.microJitterAmount, defPers.microJitterAmount)
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
        if (!Number.isFinite(weight))
            return;
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
        else if (Number.isFinite(weight)) {
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
            if ((impulseMuscles?.[m] ?? 0) > 0) {
                this.currentMuscles[m] = this._targetMuscles[m];
                continue;
            }
            const isBlink = m === 'eyeBlinkL' || m === 'eyeBlinkR';
            const rate = isBlink ? 45.0 : muscleRate;
            this.currentMuscles[m] =
                dt > 0 ? Utils.damp(this.currentMuscles[m], this._targetMuscles[m], rate, dt) : this._targetMuscles[m];
        }
        const hasImpulseHead = impulseHeadEuler !== undefined &&
            (impulseHeadEuler.x !== 0 || impulseHeadEuler.y !== 0 || impulseHeadEuler.z !== 0);
        if (dt > 0 && !hasImpulseHead) {
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
        if (!Number.isFinite(angles.x) || !Number.isFinite(angles.y))
            return;
        this.targetGazeAngles.setScalar(Utils.clamp(angles.x, -0.85, 0.85), Utils.clamp(angles.y, -0.65, 0.65));
    }
    lookAt(target, headOrigin = ZERO_VEC3$1) {
        this._lookDir.subVectors(target, headOrigin);
        const len = this._lookDir.getMagnitude();
        if (!Number.isFinite(len))
            return;
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
        this.applyHeadEuler(extraHeadEulerOffset);
        const eyePitch = -this.currentEyeAngles.y;
        const eyeYaw = this.currentEyeAngles.x;
        const vergence = 0.025;
        this.eyeLeftQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw + vergence, 0));
        this.eyeRightQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw - vergence, 0));
    }
    applyHeadEuler(extraHeadEulerOffset = ZERO_VEC3$1) {
        const neckPitch = -this.currentHeadAngles.y + extraHeadEulerOffset.x + this._headDriftEuler.x;
        const neckYaw = this.currentHeadAngles.x + extraHeadEulerOffset.y + this._headDriftEuler.y;
        const neckRoll = extraHeadEulerOffset.z + this._headDriftEuler.z - this.currentHeadAngles.x * 0.08;
        this.neckQuat.setFromEuler(this._eulerScratch.setScalar(neckPitch, neckYaw, neckRoll));
    }
}

const DEFAULT_BLINK_DURATION = 0.16;
class BlinkController {
    blinkLeft = 0;
    blinkRight = 0;
    eyelidPitchFollow = 0;
    _noise;
    _time = 0;
    _timeUntilNextBlink = 2.8;
    _blinkElapsed = -1;
    _activeDuration = DEFAULT_BLINK_DURATION;
    constructor(seed = 303) {
        this._noise = new Perlin1D(seed);
    }
    triggerBlink(duration) {
        if (this._blinkElapsed < 0) {
            this._blinkElapsed = 0;
            this._activeDuration = duration !== undefined && duration > 0.04 ? duration : DEFAULT_BLINK_DURATION;
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

const MAX_ACTIVE_IMPULSES = 32;
const FORWARD_VEC3 = new Vec3(0, 0, 1);
class ImpulseController {
    activeImpulses = [];
    outputMuscles = {};
    outputHeadEuler = new Vec3(0, 0, 0);
    outputGazeOffset = new Vec2(0, 0);
    _shooting = false;
    _shootHold = 0;
    setShooting(on) {
        this._shooting = on;
    }
    isShooting() {
        return this._shooting;
    }
    _accumulateRecipe(r, w, dir) {
        for (let i = 0; i < r.muscles.length; i++) {
            this._accumulateMuscle(r.muscles[i][0], r.muscles[i][1] * w);
        }
        for (let i = 0; i < r.directionalMuscles.length; i++) {
            const d = r.directionalMuscles[i];
            this._accumulateMuscle(d.muscle, (dir.x < 0 ? d.whenXNegative : d.otherwise) * w);
        }
        if (r.headEuler) {
            this.outputHeadEuler.x += r.headEuler[0] * w;
            this.outputHeadEuler.y += r.headEuler[1] * w;
            this.outputHeadEuler.z += r.headEuler[2] * w;
        }
        if (r.headEulerDirX) {
            this.outputHeadEuler.x += r.headEulerDirX[0] * dir.x * w;
            this.outputHeadEuler.y += r.headEulerDirX[1] * dir.x * w;
            this.outputHeadEuler.z += r.headEulerDirX[2] * dir.x * w;
        }
        if (r.gazeFromDir) {
            this.outputGazeOffset.x += Utils.clamp(dir.x, -r.gazeFromDir.maxX, r.gazeFromDir.maxX) * w;
            this.outputGazeOffset.y += Utils.clamp(dir.y, -r.gazeFromDir.maxY, r.gazeFromDir.maxY) * w;
        }
    }
    triggerImpulse(type, intensity = 1.0, direction, duration) {
        const recipe = getFaceProfile()?.impulses[type];
        if (!recipe || !Number.isFinite(intensity))
            return;
        if (this.activeImpulses.length >= MAX_ACTIVE_IMPULSES) {
            this.activeImpulses.shift();
        }
        const fallback = recipe.duration;
        this.activeImpulses.push({
            type,
            intensity: Utils.clamp(intensity, 0, 1.5),
            duration: duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : fallback,
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
        const profile = getFaceProfile();
        const shootRecipe = profile?.impulses.shoot;
        const hold = profile?.holdShooting ?? { riseRate: 35, fallRate: 22 };
        const rate = this._shooting ? hold.riseRate : hold.fallRate;
        const target = this._shooting ? 1 : 0;
        this._shootHold = dt > 0 ? Utils.damp(this._shootHold, target, rate, dt) : target;
        if (!this._shooting && this._shootHold < 0.002)
            this._shootHold = 0;
        if (this._shootHold > 0 && shootRecipe)
            this._accumulateRecipe(shootRecipe, this._shootHold, FORWARD_VEC3);
        for (let i = this.activeImpulses.length - 1; i >= 0; i--) {
            const imp = this.activeImpulses[i];
            imp.elapsed += dt;
            if (imp.elapsed >= imp.duration) {
                this.activeImpulses.splice(i, 1);
                continue;
            }
            const recipe = profile?.impulses[imp.type];
            if (!recipe)
                continue;
            const phase = imp.elapsed / imp.duration;
            const attack = recipe.attack;
            const env = phase < attack
                ? Utils.smoothstep(0, attack, phase)
                : 1.0 - Utils.smoothstep(attack, 1.0, phase);
            this._accumulateRecipe(recipe, env * imp.intensity, imp.direction || FORWARD_VEC3);
        }
    }
}

const ZERO_VEC3 = new Vec3(0, 0, 0);
const MAX_DT = 0.25;
const DEAD_SETTLE = 1.5;
const _eulerScratch = new Vec3(0, 0, 0);
function sanitizeAtlasSize(size) {
    if (size === undefined || !Number.isFinite(size))
        return 256;
    return Utils.clamp(Math.round(size), 16, 4096);
}
function isHydratedCartridge(c) {
    return (c.positions instanceof Float32Array &&
        typeof c.proportions === 'object' &&
        c.proportions !== null &&
        c.proportions.craniumScale instanceof Vec3);
}
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
    _traumaTime = 0;
    _deadTime = 0;
    constructor(cartridge, options = {}) {
        const seed = options.seed ?? 1337;
        this.atlasSize = sanitizeAtlasSize(options.atlasSize);
        this.autonomous = options.autonomous ?? true;
        if (!cartridge) {
            this.cartridge = createDefaultCartridge();
        }
        else if (isHydratedCartridge(cartridge)) {
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
        this.cartridge = isHydratedCartridge(cartridge)
            ? cartridge
            : hydrateCartridge(cartridge);
        const nextEmotions = Object.entries(this.cartridge.emotions);
        const emotions = this.compositor.emotions;
        for (const key of Object.keys(emotions)) {
            delete emotions[key];
            delete this.compositor.emotionWeights[key];
            delete this.compositor.targetEmotionWeights[key];
        }
        for (const [k, layer] of nextEmotions) {
            emotions[k] = layer;
            this.compositor.emotionWeights[k] = 0;
            this.compositor.targetEmotionWeights[k] = 0;
        }
        const topologyChanged = this.deformedPositions.length !== this.cartridge.positions.length;
        if (topologyChanged) {
            this.deformedPositions = new Float32Array(this.cartridge.positions);
            this.deformedNormals = new Float32Array(this.cartridge.normals);
            if (this._gl) {
                this.bindWebGL(this._gl);
            }
        }
        else {
            this.deformedPositions.set(this.cartridge.positions);
            this.deformedNormals.set(this.cartridge.normals);
            this.refreshAtlasTexture();
        }
        this.update(0);
        return this;
    }
    rebuildRig(recomputeMuscles = true) {
        rebuildCartridgeRig(this.cartridge, recomputeMuscles);
        this.update(0);
        return this;
    }
    setHairStyle(style) {
        if (!hasHairStyle(style)) {
            throw new Error(`FaceR: hair style "${style}" is not registered. Load its .facerhair.json (loadHairStyle) first.`);
        }
        this.cartridge.appearance.hairStyle = style;
        this.rebuildRig(false);
        if (this._gl && this.mesh) {
            this.refreshAtlasTexture();
        }
        return this;
    }
    setBaseHead(baseHead) {
        this.cartridge.appearance.baseHead = baseHead;
        delete this.cartridge._baseTopology;
        const canonical = getCanonicalBaseHead(baseHead);
        const topologyChanged = this.cartridge.positions.length !== canonical.positions.length;
        if (topologyChanged) {
            this.cartridge.positions = new Float32Array(canonical.positions);
            this.cartridge.normals = new Float32Array(canonical.normals);
            this.cartridge.uvs = new Float32Array(canonical.uvs);
            this.cartridge.indices = new Int32Array(canonical.indices);
            this.cartridge.submeshes = canonical.submeshes.map(sm => ({ ...sm }));
            this.cartridge.vertexRegionMap = new Uint8Array(canonical.vertexRegionMap);
            this.cartridge.jawWeights = new Float32Array(canonical.jawWeights);
            this.cartridge.sculptOffsets = new Float32Array(canonical.positions.length);
            this.deformedPositions = new Float32Array(canonical.positions.length);
            this.deformedNormals = new Float32Array(canonical.normals.length);
        }
        this.rebuildRig(true);
        if (topologyChanged && this._gl) {
            this.bindWebGL(this._gl);
        }
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
        if (this._health > 0)
            this.impulse.triggerImpulse(type, intensity, direction, duration);
        return this;
    }
    setShooting(on) {
        this.impulse.setShooting(on && this._health > 0);
        return this;
    }
    setHealth(healthPercent) {
        if (!Number.isFinite(healthPercent))
            return this;
        const wasDead = this._health <= 0;
        this._health = Utils.clamp(healthPercent, 0, 100);
        const thresholds = getFaceProfile()?.damage?.tierHealthThresholds ?? [];
        let tier = 0;
        if (this._health <= 0) {
            tier = thresholds.length;
            if (!wasDead) {
                this.impulse.activeImpulses.length = 0;
                this.impulse.setShooting(false);
                this.gaze.targetGazeAngles.origin();
                this._deadTime = 0;
            }
            this.setExclusiveEmotion('dead', 1.0);
        }
        else {
            if (wasDead) {
                this.setEmotion('dead', 0.0, true);
            }
            for (let i = 0; i < thresholds.length; i++) {
                if (this._health < thresholds[i])
                    tier = i + 1;
            }
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
        dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
        const pers = this.cartridge.personality;
        const dead = this._health <= 0;
        if (dead && dt > 0) {
            this._deadTime += dt;
            if (this._deadTime > DEAD_SETTLE)
                return this.pose;
        }
        this.impulse.update(dt);
        if (this.autonomous && !dead) {
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
        if (this.autonomous && !dead) {
            this.gaze.applyHeadEuler(this.compositor.currentHeadEuler);
        }
        else {
            this.gaze.neckQuat.setFromEuler(this.compositor.currentHeadEuler);
        }
        for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
            const m = FACS_MUSCLE_NAMES[i];
            this.pose.muscles[m] = this.compositor.currentMuscles[m];
        }
        this._traumaTime += dt;
        const reaction = getFaceProfile()?.damage?.reaction;
        if (reaction && this.pose.damageTier > 0 && this._health > 0 && this.autonomous) {
            const tier = this.pose.damageTier;
            const traumaIntensity = Math.max(Utils.clamp((reaction.intensityHealthRef - this._health) / reaction.intensityHealthRef, 0, 1), tier * reaction.intensityPerTier);
            const m = this.pose.muscles;
            let pantAmount = 0;
            const pant = reaction.pant;
            if (pant && tier >= pant.minTier) {
                const breathFreq = pant.freqBase + traumaIntensity * pant.freqIntensity;
                const breathWave = 0.5 + 0.5 * Math.sin(this._traumaTime * breathFreq);
                pantAmount = (tier - pant.tierBase) * pant.perTier * (pant.floor + (1 - pant.floor) * breathWave);
            }
            for (let i = 0; i < reaction.muscles.length; i++) {
                const r = reaction.muscles[i];
                if (tier < r.minTier)
                    continue;
                m[r.muscle] = Utils.clamp(m[r.muscle] + r.perTier * (tier - r.tierBase) + r.intensity * traumaIntensity + r.pant * pantAmount, 0, 1);
            }
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

export { BlinkController, ExpressionCompositor, FACE_REGIONS, FACE_REGION_IDS, FACS_MUSCLE_NAMES, FaceR, GazeController, HAIR_CAP_VERTEX_COUNT, ImpulseController, Perlin1D, applyHaircutStyleToPositions, applyMacroProportions, computeFacsMuscles, computeSmoothNormals, createDefaultAppearance, createDefaultCartridge, createDefaultEmotions, createDefaultPersonality, createDefaultProportions, createRoostrFaceMesh, deserializeBaseHead, deserializeFaceProfile, deserializeHairStyle, evaluateFaceDeformation, generateFaceAtlasPixels, getCanonicalBaseHead, getFaceProfile, getHairStyle, hasBaseHead, hasHairStyle, hydrateCartridge, invalidateDeformCache, loadBaseHead, loadFaceProfile, loadHairStyle, parseObjToCartridge, parseObjToTopology, rebuildCartridgeRig, registerAtlasPainter, registerBaseHead, registerFaceProfile, registerHairStyle, rotateVec3ByQuat, serializeCartridge, syncRoostrMeshBuffers };
