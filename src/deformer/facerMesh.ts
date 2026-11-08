import { Vec2, Vec3, Quat, Mat4x3, Utils } from '@1pizzateam/spock';
import { CustomMesh, Mesh, Texture, Material, PhongShader } from '@1pizzateam/roostr';
import { getFaceProfile, IDamageZone } from '../profile';
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
const _scratchPoint = new Vec3();

const NECK_WEIGHT_BASE_Y = -9.8;
const NECK_FULL_WEIGHT_Y = -5.8;

interface ITraumaZone {
  indices: Uint32Array;
  falloff: Float32Array;
}

/**
 * Per-rig lookup tables for the deformer: which vertices each pivot moves (with weights), and the
 * static falloff of each trauma zone. They only depend on the rest pose, so they are built once and
 * dropped by `rebuildCartridgeRig` whenever the rest pose changes.
 */
interface IDeformCache {
  vertexCount: number;
  eyeLeft: Uint32Array;
  eyeRight: Uint32Array;
  jaw: Uint32Array;
  jawWeights: Float32Array;
  neck: Uint32Array;
  neckWeights: Float32Array;
  /** Swelling zones from the face profile's damage section (none without one), in profile order. */
  zones: ITraumaZone[];
  zoneSpecs: IDamageZone[];
}

function buildTraumaZone(
  candidates: number[],
  basePositions: Float32Array,
  center: Vec3,
  radii: Vec3
): ITraumaZone {
  const idx: number[] = [];
  const fall: number[] = [];
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

function buildDeformCache(cartridge: IFaceCartridge): IDeformCache {
  const base = cartridge.positions;
  const regionMap = cartridge.vertexRegionMap;
  const jawW = cartridge.jawWeights;
  const vertexCount = (base.length / 3) | 0;

  const eyeLeft: number[] = [];
  const eyeRight: number[] = [];
  const jaw: number[] = [];
  const jawWeights: number[] = [];
  const neck: number[] = [];
  const neckWeights: number[] = [];
  const traumaCandidates: number[] = [];
  const damage = getFaceProfile()?.damage;
  const traumaMinZ = damage ? damage.minZ : Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const region = regionMap[i];
    if (region === FACE_REGION_IDS.eyeLeft) eyeLeft.push(i);
    else if (region === FACE_REGION_IDS.eyeRight) eyeRight.push(i);

    if (jawW[i] > 0.001) {
      jaw.push(i);
      jawWeights.push(jawW[i]);
    }

    const baseY = base[i * 3 + 1];
    if (region !== FACE_REGION_IDS.skin || baseY >= NECK_FULL_WEIGHT_Y) {
      neck.push(i);
      neckWeights.push(1);
    } else if (baseY > NECK_WEIGHT_BASE_Y) {
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

function getDeformCache(cartridge: IFaceCartridge): IDeformCache {
  const holder = cartridge as { _deformCache?: IDeformCache };
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

/**
 * Drop the cached deformer lookup tables of a cartridge. Call after changing its rest pose
 * (`positions`, `vertexRegionMap`, `jawWeights`) by hand; `rebuildCartridgeRig` does it for you.
 */
export function invalidateDeformCache(cartridge: IFaceCartridge): void {
  delete (cartridge as { _deformCache?: IDeformCache })._deformCache;
}

/**
 * Evaluate the complete sparse FACS muscle morphs + eyeball, jaw, and neck
 * `Quat` / `Mat4x3` pivot rotations into `outPositions` and `outNormals`.
 * Zero heap allocations per frame once the cartridge's lookup tables are built.
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

  // 2. Apply 3D physical trauma swelling & broken-nose deflection when `pose.damageTier > 0`
  const tier = Utils.clamp(pose.damageTier | 0, 0, 4);
  if (tier > 0) {
    applyTrauma(cache, tier, outPositions, outNormals);
  }

  // 3. Rotate eyeballs, jaw and neck about their pivots (`Mat4x3`), in that order, weighted per vertex
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

function applyTrauma(
  cache: IDeformCache,
  tier: number,
  pos: Float32Array,
  nrm: Float32Array
): void {
  // Each profile zone swells (or sags) with the damage tier: displacement = falloff * weight * (tier - tierBase) * (normal * n + constant)
  for (let z = 0; z < cache.zones.length; z++) {
    const spec = cache.zoneSpecs[z];
    if (tier < spec.minTier) continue;
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

/**
 * Paints the RGBA skin atlas for `appearance` at `damageTier` (`0 = 100%..95% HP` .. `4 = <40% HP`): a `size * size * 4` byte array.
 * FaceR owns no look of its own, so the game provides the painter (it knows the UV layout of its heads); see `registerAtlasPainter`.
 */
export type AtlasPainter = (appearance: IFaceAppearance, damageTier: number, size: number) => Uint8Array;

let _atlasPainter: AtlasPainter | null = null;

/** Register the atlas painter used by every face (pass `null` to go back to the flat default). */
export function registerAtlasPainter(painter: AtlasPainter | null): void {
  _atlasPainter = painter;
}

/**
 * Generate the RGBA texture atlas (`Uint8Array` of length `size * size * 4`). Uses the registered painter; without one
 * the atlas is a flat `appearance.skinColor`.
 */
export function generateFaceAtlasPixels(
  appearance: IFaceAppearance,
  damageTier = 0,
  size = 256
): Uint8Array {
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
  // the Phong look comes from the face profile; without one the face is plain matte grey
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
