import { Vec2, Vec3 } from '@1pizzateam/spock';
import {
  BASE_HEAD_IDS,
  BaseHeadId,
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
  HAIRCUT_STYLES,
  HaircutStyleName,
  IMacroProportions,
  IFacePivots,
  ISparseMuscleDelta,
  IEmotionLayer,
  IPersonalityProfile,
  IFaceAppearance,
  IFaceCartridge
} from './interfaces';
import {
  getCanonicalBaseHead,
  computeSmoothNormals,
  parseObjToTopology,
  applyHaircutStyleToPositions,
  IBaseHeadGeometry
} from './anatomy/baseHead';
import { applyMacroProportions, computeFacsMuscles } from './anatomy/muscleTransfer';

function toVec2(val: unknown, defX: number, defY: number): Vec2 {
  if (val instanceof Vec2) {
    return new Vec2().copy(val);
  }
  if (Array.isArray(val) && val.length >= 2) {
    return new Vec2(Number(val[0]) || 0, Number(val[1]) || 0);
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return new Vec2(
      typeof obj.x === 'number' ? obj.x : defX,
      typeof obj.y === 'number' ? obj.y : defY
    );
  }
  return new Vec2(defX, defY);
}

function toVec3(val: unknown, defX: number, defY: number, defZ: number): Vec3 {
  if (val instanceof Vec3) {
    return new Vec3().copy(val);
  }
  if (Array.isArray(val) && val.length >= 3) {
    return new Vec3(Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0);
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return new Vec3(
      typeof obj.x === 'number' ? obj.x : defX,
      typeof obj.y === 'number' ? obj.y : defY,
      typeof obj.z === 'number' ? obj.z : defZ
    );
  }
  return new Vec3(defX, defY, defZ);
}

/**
 * Create default neutral macro anatomical proportions (`Vec3` fields).
 */
export function createDefaultProportions(): IMacroProportions {
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

/**
 * Create the 9 canonical Ken Perlin / DoomR emotion presets as layered FACS muscle recipes.
 */
export function createDefaultEmotions(): Record<string, IEmotionLayer> {
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

/**
 * Create default Ken Perlin autonomous behavioral personality profile.
 */
export function createDefaultPersonality(): IPersonalityProfile {
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

/**
 * Create default appearance palette (`Vec3` RGB colors in `0..1` + damage seed).
 */
export function createDefaultAppearance(): IFaceAppearance {
  return {
    baseHead: 'african_sculpt',
    skinColor: new Vec3(0.38, 0.23, 0.15),
    skinShadowColor: new Vec3(0.18, 0.10, 0.06),
    lipColor: new Vec3(0.34, 0.17, 0.15),
    irisColor: new Vec3(0.22, 0.13, 0.07),
    scleraColor: new Vec3(0.95, 0.93, 0.90),
    browColor: new Vec3(0.08, 0.05, 0.04),
    hairColor: new Vec3(0.07, 0.05, 0.04),
    hairStyle: 'bald',
    teethColor: new Vec3(0.94, 0.92, 0.88),
    damageSeed: 1337
  };
}

/**
 * Rebuild derived topology buffers (`positions`, `normals`, `pivots`, and optionally
 * the FACS `muscles`) on an `IFaceCartridge` after macro proportions, `baseHead`, `hairStyle`, or freeform
 * `sculptOffsets` have been modified.
 */
export function rebuildCartridgeRig(
  cartridge: IFaceCartridge,
  recomputeMuscles = true
): IFaceCartridge {
  const baseHead: IBaseHeadGeometry =
    ((cartridge as any)._baseTopology as IBaseHeadGeometry | undefined) ??
    getCanonicalBaseHead(cartridge.appearance?.baseHead ?? 'african_sculpt');

  if (!cartridge.sculptOffsets || cartridge.sculptOffsets.length !== baseHead.positions.length) {
    cartridge.sculptOffsets = new Float32Array(baseHead.positions.length);
  }
  if (!cartridge.positions || cartridge.positions.length !== baseHead.positions.length) {
    cartridge.positions = new Float32Array(baseHead.positions.length);
  }

  applyMacroProportions(
    baseHead,
    cartridge.proportions,
    cartridge.sculptOffsets,
    cartridge.positions,
    cartridge.pivots
  );

  applyHaircutStyleToPositions(
    cartridge.positions,
    cartridge.submeshes,
    cartridge.appearance?.hairStyle ?? 'bald'
  );

  cartridge.normals = computeSmoothNormals(cartridge.positions, cartridge.indices);

  if (recomputeMuscles) {
    cartridge.muscles = computeFacsMuscles(
      cartridge.positions,
      cartridge.indices,
      cartridge.vertexRegionMap,
      cartridge.pivots,
      cartridge.jawWeights
    );
  }

  return cartridge;
}

/**
 * Create a brand-new `IFaceCartridge` initialized with the high-poly anatomical
 * base head, macro proportions, auto-computed FACS muscles, 9 emotion layers,
 * Perlin personality profile, and appearance palette.
 */
export function createDefaultCartridge(
  name = 'Marine Face',
  id = 'marine_face'
): IFaceCartridge {
  const baseHead = getCanonicalBaseHead();
  const proportions = createDefaultProportions();
  const appearance = createDefaultAppearance();
  const sculptOffsets = new Float32Array(baseHead.positions.length);
  const positions = new Float32Array(baseHead.positions.length);
  const pivots: IFacePivots = {
    neck: new Vec3().copy(baseHead.pivots.neck),
    jaw: new Vec3().copy(baseHead.pivots.jaw),
    eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
    eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
  };

  applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
  applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);
  const normals = computeSmoothNormals(positions, baseHead.indices);
  const muscles = computeFacsMuscles(
    positions,
    baseHead.indices,
    baseHead.vertexRegionMap,
    pivots,
    baseHead.jawWeights
  );

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

/**
 * Parse a Wavefront `.obj` 3D head mesh string and automatically rig it into a
 * ready-to-animate `IFaceCartridge` with 32 FACS muscles, jaw weights, and
 * Ken Perlin personality parameters.
 */
export function parseObjToCartridge(
  objText: string,
  name = 'Imported .OBJ Head',
  id = 'imported_obj_head'
): IFaceCartridge {
  const baseHead = parseObjToTopology(objText);
  const proportions = createDefaultProportions();
  const appearance = createDefaultAppearance();
  const sculptOffsets = new Float32Array(baseHead.positions.length);
  const positions = new Float32Array(baseHead.positions.length);
  const pivots: IFacePivots = {
    neck: new Vec3().copy(baseHead.pivots.neck),
    jaw: new Vec3().copy(baseHead.pivots.jaw),
    eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
    eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
  };

  applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
  applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);
  const normals = computeSmoothNormals(positions, baseHead.indices);
  const muscles = computeFacsMuscles(
    positions,
    baseHead.indices,
    baseHead.vertexRegionMap,
    pivots,
    baseHead.jawWeights
  );

  const cartridge: IFaceCartridge = {
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

function roundNumber(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function vec2ToArray(v: Vec2): [number, number] {
  return [roundNumber(v.x), roundNumber(v.y)];
}

function vec3ToArray(v: Vec3): [number, number, number] {
  return [roundNumber(v.x), roundNumber(v.y), roundNumber(v.z)];
}

/**
 * Serialize an `IFaceCartridge` to a clean, portable `.facer` JSON-compatible object.
 */
export function serializeCartridge(cartridge: IFaceCartridge): Record<string, unknown> {
  const sparseSculptIndices: number[] = [];
  const sparseSculptValues: number[] = [];
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

  const serializedEmotions: Record<string, unknown> = {};
  for (const [key, layer] of Object.entries(cartridge.emotions)) {
    serializedEmotions[key] = {
      name: layer.name,
      muscles: { ...layer.muscles },
      headEulerOffset: vec3ToArray(layer.headEulerOffset)
    };
  }

  const serializedMuscles: Record<string, unknown> = {};
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
      baseHead: cartridge.appearance.baseHead ?? 'african_sculpt',
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

/**
 * Hydrate a raw `.facer` JSON object (or partial cartridge definition) into a
 * fully-typed, vector-first `IFaceCartridge` with live `Vec2`/`Vec3` instances
 * and `TypedArray` geometry buffers.
 */
export function hydrateCartridge(raw: unknown): IFaceCartridge {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const defProps = createDefaultProportions();
  const rawProps = obj.proportions || {};

  const defApp = createDefaultAppearance();
  const rawApp = obj.appearance || {};
  const rawBaseHead = rawApp.baseHead ?? obj.baseHead;
  const baseHeadId: BaseHeadId =
    typeof rawBaseHead === 'string' && (BASE_HEAD_IDS as readonly string[]).includes(rawBaseHead)
      ? (rawBaseHead as BaseHeadId)
      : (defApp.baseHead ?? 'african_sculpt');
  const baseHead = getCanonicalBaseHead(baseHeadId);

  const rawHairStyle = rawApp.hairStyle;
  const hairStyle: HaircutStyleName =
    typeof rawHairStyle === 'string' && (HAIRCUT_STYLES as readonly string[]).includes(rawHairStyle)
      ? (rawHairStyle as HaircutStyleName)
      : defApp.hairStyle;

  const appearance: IFaceAppearance = {
    baseHead: baseHeadId,
    skinColor: toVec3(rawApp.skinColor, defApp.skinColor.x, defApp.skinColor.y, defApp.skinColor.z),
    skinShadowColor: toVec3(rawApp.skinShadowColor, defApp.skinShadowColor.x, defApp.skinShadowColor.y, defApp.skinShadowColor.z),
    lipColor: toVec3(rawApp.lipColor, defApp.lipColor.x, defApp.lipColor.y, defApp.lipColor.z),
    irisColor: toVec3(rawApp.irisColor, defApp.irisColor.x, defApp.irisColor.y, defApp.irisColor.z),
    scleraColor: toVec3(rawApp.scleraColor, defApp.scleraColor.x, defApp.scleraColor.y, defApp.scleraColor.z),
    browColor: toVec3(rawApp.browColor, defApp.browColor.x, defApp.browColor.y, defApp.browColor.z),
    hairColor: toVec3(
      rawApp.hairColor ?? rawApp.browColor,
      defApp.hairColor.x,
      defApp.hairColor.y,
      defApp.hairColor.z
    ),
    hairStyle,
    teethColor: toVec3(rawApp.teethColor, defApp.teethColor.x, defApp.teethColor.y, defApp.teethColor.z),
    damageSeed: typeof rawApp.damageSeed === 'number' ? rawApp.damageSeed : defApp.damageSeed,
    customTierOverrides:
      rawApp.customTierOverrides && typeof rawApp.customTierOverrides === 'object'
        ? { ...rawApp.customTierOverrides }
        : undefined
  };

  const proportions: IMacroProportions = {
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
  } else if (obj.sculptSparse && Array.isArray(obj.sculptSparse.indices) && Array.isArray(obj.sculptSparse.dPos)) {
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
  const pivots: IFacePivots = {
    neck: new Vec3().copy(baseHead.pivots.neck),
    jaw: new Vec3().copy(baseHead.pivots.jaw),
    eyeLeft: new Vec3().copy(baseHead.pivots.eyeLeft),
    eyeRight: new Vec3().copy(baseHead.pivots.eyeRight)
  };

  applyMacroProportions(baseHead, proportions, sculptOffsets, positions, pivots);
  applyHaircutStyleToPositions(positions, baseHead.submeshes, appearance.hairStyle);

  if (obj.pivots) {
    if (obj.pivots.neck) pivots.neck = toVec3(obj.pivots.neck, pivots.neck.x, pivots.neck.y, pivots.neck.z);
    if (obj.pivots.jaw) pivots.jaw = toVec3(obj.pivots.jaw, pivots.jaw.x, pivots.jaw.y, pivots.jaw.z);
    if (obj.pivots.eyeLeft) pivots.eyeLeft = toVec3(obj.pivots.eyeLeft, pivots.eyeLeft.x, pivots.eyeLeft.y, pivots.eyeLeft.z);
    if (obj.pivots.eyeRight) pivots.eyeRight = toVec3(obj.pivots.eyeRight, pivots.eyeRight.x, pivots.eyeRight.y, pivots.eyeRight.z);
  }

  const normals = computeSmoothNormals(positions, baseHead.indices);

  let muscles: Record<FacsMuscleName, ISparseMuscleDelta>;
  const hasCompleteSavedMuscles =
    obj.muscles &&
    typeof obj.muscles === 'object' &&
    FACS_MUSCLE_NAMES.every(m => obj.muscles[m] && obj.muscles[m].indices && obj.muscles[m].dPos);

  if (hasCompleteSavedMuscles) {
    muscles = {} as Record<FacsMuscleName, ISparseMuscleDelta>;
    for (const m of FACS_MUSCLE_NAMES) {
      const rawM = obj.muscles[m];
      const indices =
        rawM.indices instanceof Uint16Array ? new Uint16Array(rawM.indices) : new Uint16Array(rawM.indices || []);
      const dPos =
        rawM.dPos instanceof Float32Array ? new Float32Array(rawM.dPos) : new Float32Array(rawM.dPos || []);
      const dNorm =
        rawM.dNorm instanceof Float32Array
          ? new Float32Array(rawM.dNorm)
          : new Float32Array(rawM.dNorm || new Float32Array(dPos.length));
      muscles[m] = { indices, dPos, dNorm };
    }
  } else {
    muscles = computeFacsMuscles(
      positions,
      baseHead.indices,
      baseHead.vertexRegionMap,
      pivots,
      baseHead.jawWeights
    );
  }

  const defEmotions = createDefaultEmotions();
  const emotions: Record<string, IEmotionLayer> = { ...defEmotions };
  if (obj.emotions && typeof obj.emotions === 'object') {
    for (const [k, rawLayer] of Object.entries(obj.emotions as Record<string, any>)) {
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
  const personality: IPersonalityProfile = {
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
