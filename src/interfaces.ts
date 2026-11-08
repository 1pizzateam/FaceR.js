import type { Quat, Vec2, Vec3 } from '@1pizzateam/spock';

export const FACER_FORMAT = 'facer';
export const FACER_VERSION = 1;

/**
 * 24 Anatomical FACS Muscle Channels (Left/Right/Symmetric).
 */
export const FACS_MUSCLE_NAMES = [
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
] as const;

export type FacsMuscleName = (typeof FACS_MUSCLE_NAMES)[number];

/**
 * 7 Anatomical Submesh Regions in `buildAnatomicalBaseHead`.
 */
export const SUBMESH_REGIONS = [
  'skin',
  'eyeLeft',
  'eyeRight',
  'teethUpper',
  'teethLower',
  'mouthInner',
  'browsHair'
] as const;

export const FACE_REGIONS = SUBMESH_REGIONS;

export type SubmeshRegionName = (typeof SUBMESH_REGIONS)[number];
export type FaceRegionName = SubmeshRegionName;

export const FACE_REGION_IDS: Record<SubmeshRegionName, number> = {
  skin: 0,
  eyeLeft: 1,
  eyeRight: 2,
  teethUpper: 3,
  teethLower: 4,
  mouthInner: 5,
  browsHair: 6
};

export interface ISubmeshRange {
  name: SubmeshRegionName;
  startIndex: number;
  indexCount: number;
  startVertex: number;
  vertexCount: number;
}

export type ISubMeshRange = ISubmeshRange;

/**
 * Macro Anatomical Proportions (100% Vector-First `Vec3` fields).
 */
export interface IMacroProportions {
  craniumScale: Vec3;
  jawScale: Vec3;
  chinOffset: Vec3;
  cheekboneOffset: Vec3;
  browOffset: Vec3;
  eyeSocketOffset: Vec3;
  noseScale: Vec3;
  mouthScale: Vec3;
  earScale: Vec3;
}

/**
 * 4 Anatomical Skeletal/Oculomotor Pivot Centers (`Vec3`).
 */
export interface IFacePivots {
  neck: Vec3;
  jaw: Vec3;
  eyeLeft: Vec3;
  eyeRight: Vec3;
}

/**
 * Sparse FACS Muscle Morph Target Delta (`indices`, `dPos`, `dNorm`).
 */
export interface ISparseMuscleDelta {
  indices: Uint16Array;
  dPos: Float32Array;
  dNorm: Float32Array;
}

/**
 * Named Emotion Layer Preset (FACS muscle recipe + `Vec3` head posture offset).
 */
export interface IEmotionLayer {
  name: string;
  muscles: Partial<Record<FacsMuscleName, number>>;
  headEulerOffset: Vec3;
}

/**
 * Ken Perlin Autonomous Behavioral Personality Profile (`Vec2` ranges & amplitudes).
 */
export interface IPersonalityProfile {
  blinkIntervalRange: Vec2;
  blinkDuration: number;
  saccadeFrequency: number;
  saccadeAmplitude: Vec2;
  headFollowRatio: number;
  headDamping: number;
  eyeDamping: number;
  asymmetryAmount: number;
  microJitterAmount: number;
}

/**
 * A base head id: any head registered with `registerBaseHead` (FaceR ships none).
 */
export type BaseHeadId = string;

/**
 * A hair style id: `'bald'` (no hair, built in) or a style registered with `registerHairStyle` (FaceR ships none).
 */
export type HaircutStyleName = string;

/**
 * Procedural Skin, Eyes, Teeth, Brows, Hair & Progressive 5-Tier Damage Palette (`Vec3` RGB in `0..1`).
 */
export interface IFaceAppearance {
  /** Id of a base head registered with `registerBaseHead` . */
  baseHead?: string;
  skinColor: Vec3;
  skinShadowColor: Vec3;
  lipColor: Vec3;
  irisColor: Vec3;
  scleraColor: Vec3;
  browColor: Vec3;
  hairColor: Vec3;
  hairStyle: HaircutStyleName;
  teethColor: Vec3;
  damageSeed: number;
  customTierOverrides?: Record<number, number[]>;
}

/**
 * Complete `.facer` Face Cartridge Data Structure.
 */
export interface IFaceCartridge {
  version: string;
  id: string;
  name: string;
  proportions: IMacroProportions;
  sculptOffsets: Float32Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Int32Array;
  submeshes: ISubmeshRange[];
  vertexRegionMap: Uint8Array;
  jawWeights: Float32Array;
  pivots: IFacePivots;
  muscles: Record<FacsMuscleName, ISparseMuscleDelta>;
  emotions: Record<string, IEmotionLayer>;
  personality: IPersonalityProfile;
  appearance: IFaceAppearance;
}

/**
 * Per-Frame Evaluated Pose State (`Quat` pivots + muscle activation map).
 */
export interface IFacePoseState {
  muscles: Record<FacsMuscleName, number>;
  neckQuat: Quat;
  jawQuat: Quat;
  eyeLeftQuat: Quat;
  eyeRightQuat: Quat;
  damageTier: number;
}

/** An impulse type: a name from the face profile's `impulses` (for example `pain`, `shoot`). Unknown types are ignored. */
export type ImpulseType = string;

/**
 * Transient Reactive Gameplay Impulse Event.
 */
export interface IImpulseEvent {
  type: ImpulseType;
  intensity: number;
  duration: number;
  direction?: Vec3;
}
