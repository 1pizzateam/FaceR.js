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

import { Vec3, Vec2, Quat } from '@1pizzateam/spock';
export { Accumulator, Bezier, Box, Frustum, Mat3, Mat4, Mat4x3, Plane, Quat, Rand, Ray2, Ray3, Sphere, Time, Trigo, Utils, Vec2, Vec3 } from '@1pizzateam/spock';
import { CustomMesh, Mesh } from '@1pizzateam/roostr';

declare const FACS_MUSCLE_NAMES: readonly ["browInnerUp", "browDownL", "browDownR", "browOuterUpL", "browOuterUpR", "eyeBlinkL", "eyeBlinkR", "eyeSquintL", "eyeSquintR", "eyeWideL", "eyeWideR", "cheekSquintL", "cheekSquintR", "noseSneerL", "noseSneerR", "jawOpen", "jawForward", "jawLeft", "jawRight", "mouthSmileL", "mouthSmileR", "mouthFrownL", "mouthFrownR", "mouthPucker", "mouthFunnel", "mouthUpperUpL", "mouthUpperUpR", "mouthLowerDownL", "mouthLowerDownR", "mouthShrugUpper", "mouthPress"];
type FacsMuscleName = (typeof FACS_MUSCLE_NAMES)[number];
declare const SUBMESH_REGIONS: readonly ["skin", "eyeLeft", "eyeRight", "teethUpper", "teethLower", "mouthInner", "browsHair"];
declare const FACE_REGIONS: readonly ["skin", "eyeLeft", "eyeRight", "teethUpper", "teethLower", "mouthInner", "browsHair"];
type SubmeshRegionName = (typeof SUBMESH_REGIONS)[number];
type FaceRegionName = SubmeshRegionName;
declare const FACE_REGION_IDS: Record<SubmeshRegionName, number>;
interface ISubmeshRange {
    name: SubmeshRegionName;
    startIndex: number;
    indexCount: number;
    startVertex: number;
    vertexCount: number;
}
type ISubMeshRange = ISubmeshRange;
interface IMacroProportions {
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
interface IFacePivots {
    neck: Vec3;
    jaw: Vec3;
    eyeLeft: Vec3;
    eyeRight: Vec3;
}
interface ISparseMuscleDelta {
    indices: Uint16Array;
    dPos: Float32Array;
    dNorm: Float32Array;
}
interface IEmotionLayer {
    name: string;
    muscles: Partial<Record<FacsMuscleName, number>>;
    headEulerOffset: Vec3;
}
interface IPersonalityProfile {
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
type BaseHeadId = string;
type HaircutStyleName = string;
interface IFaceAppearance {
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
interface IFaceCartridge {
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
interface IFacePoseState {
    muscles: Record<FacsMuscleName, number>;
    neckQuat: Quat;
    jawQuat: Quat;
    eyeLeftQuat: Quat;
    eyeRightQuat: Quat;
    damageTier: number;
}
type ImpulseType = string;
interface IImpulseEvent {
    type: ImpulseType;
    intensity: number;
    duration: number;
    direction?: Vec3;
}

declare class Perlin1D {
    private perm;
    private grad;
    private seedValue;
    constructor(seed?: number);
    get seed(): number;
    reseed(seed: number): this;
    sample(x: number, channel?: number): number;
    fbm(x: number, octaves?: number, channel?: number): number;
    sampleVec2(time: number, freq: Vec2, amp: Vec2, target?: Vec2, baseChannel?: number): Vec2;
    sampleVec3(time: number, freq: Vec3, amp: Vec3, target?: Vec3, baseChannel?: number): Vec3;
    fbmVec2(time: number, freq: Vec2, amp: Vec2, octaves?: number, target?: Vec2, baseChannel?: number): Vec2;
    fbmVec3(time: number, freq: Vec3, amp: Vec3, octaves?: number, target?: Vec3, baseChannel?: number): Vec3;
}

declare const HAIR_CAP_VERTEX_COUNT: number;
interface IBaseHeadGeometry {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Int32Array;
    submeshes: ISubmeshRange[];
    vertexRegionMap: Uint8Array;
    jawWeights: Float32Array;
    pivots: IFacePivots;
    eyeballPlacement?: {
        offset: Vec3;
        scale: number;
    };
    eyeHolePlacement?: {
        offset: Vec3;
        scale: Vec2;
    };
    teethPlacement?: {
        offset: Vec3;
        scale: number;
        gap: number;
    };
    vertexCount: number;
    triangleCount: number;
}
type IBaseHeadTopology = IBaseHeadGeometry;
interface IHairStyle {
    id: string;
    capDelta: Float32Array;
    atlas: {
        size: number;
        shade: Uint8Array;
        skinMix: Uint8Array;
    };
}
declare function registerHairStyle(style: IHairStyle): void;
declare function hasHairStyle(id: string): boolean;
declare function getHairStyle(id: string): IHairStyle | undefined;
declare function deserializeHairStyle(data: unknown): IHairStyle;
declare function loadHairStyle(id: string, urlOrBase: string): Promise<IHairStyle>;
declare function applyHaircutStyleToPositions(positions: Float32Array, submeshes: ISubmeshRange[], hairStyle?: HaircutStyleName): void;
declare function parseObjToTopology(objText: string): IBaseHeadGeometry;
declare function computeSmoothNormals(positions: Float32Array, indices: Int32Array | Uint16Array | Uint32Array): Float32Array;
declare function registerBaseHead(id: string, geometry: IBaseHeadGeometry): void;
declare function hasBaseHead(id: string): boolean;
declare function getCanonicalBaseHead(baseHeadId: string): IBaseHeadGeometry;
declare function deserializeBaseHead(data: unknown): IBaseHeadGeometry;
declare function loadBaseHead(id: string, urlOrBase: string): Promise<IBaseHeadGeometry>;

interface IFaceProfile {
    id: string;
    defaultBaseHead?: string;
    emotions: Record<string, IEmotionLayer>;
    appearance?: Partial<IFaceAppearance>;
    personality?: IPersonalityProfile;
    material?: {
        ambient: Vec3;
        diffuse: Vec3;
        specular: Vec3;
        shininess: number;
    };
    damage?: IDamageProfile;
    impulses: Record<string, IImpulseRecipe>;
    holdShooting: {
        riseRate: number;
        fallRate: number;
    };
}
interface IDamageZone {
    id: string;
    center: Vec3;
    radii: Vec3;
    minTier: number;
    tierBase: number;
    weight: number;
    normal: [number, number, number];
    constant: [number, number, number];
}
interface IDamageMuscle {
    muscle: FacsMuscleName;
    minTier: number;
    tierBase: number;
    perTier: number;
    intensity: number;
    pant: number;
}
interface IDamageProfile {
    tierHealthThresholds: number[];
    minZ: number;
    zones: IDamageZone[];
    reaction: {
        intensityHealthRef: number;
        intensityPerTier: number;
        pant: {
            minTier: number;
            perTier: number;
            tierBase: number;
            floor: number;
            freqBase: number;
            freqIntensity: number;
        } | null;
        muscles: IDamageMuscle[];
    };
}
interface IImpulseRecipe {
    duration: number;
    attack: number;
    muscles: [FacsMuscleName, number][];
    headEuler: [number, number, number] | null;
    headEulerDirX: [number, number, number] | null;
    directionalMuscles: {
        muscle: FacsMuscleName;
        whenXNegative: number;
        otherwise: number;
    }[];
    gazeFromDir: {
        maxX: number;
        maxY: number;
    } | null;
}
declare function registerFaceProfile(profile: IFaceProfile | null): void;
declare function getFaceProfile(): IFaceProfile | null;
declare function deserializeFaceProfile(data: unknown): IFaceProfile;
declare function loadFaceProfile(url: string): Promise<IFaceProfile>;

declare function applyMacroProportions(baseHead: IBaseHeadTopology, proportions: IMacroProportions, sculptOffsets: Float32Array | null, outPositions: Float32Array, outPivots: IFacePivots): void;
declare function computeFacsMuscles(positions: Float32Array, indices: Int32Array | Uint16Array | Uint32Array, vertexRegionMap: Uint8Array, pivots: IFacePivots, jawWeights?: Float32Array): Record<FacsMuscleName, ISparseMuscleDelta>;

declare function createDefaultProportions(): IMacroProportions;
declare function createDefaultEmotions(): Record<string, IEmotionLayer>;
declare function createDefaultPersonality(): IPersonalityProfile;
declare function createDefaultAppearance(): IFaceAppearance;
declare function rebuildCartridgeRig(cartridge: IFaceCartridge, recomputeMuscles?: boolean): IFaceCartridge;
declare function createDefaultCartridge(name?: string, id?: string, baseHeadId?: string): IFaceCartridge;
declare function parseObjToCartridge(objText: string, name?: string, id?: string): IFaceCartridge;
declare function serializeCartridge(cartridge: IFaceCartridge): Record<string, unknown>;
declare function hydrateCartridge(raw: unknown): IFaceCartridge;

declare class ExpressionCompositor {
    readonly emotions: Record<string, IEmotionLayer>;
    readonly emotionWeights: Record<string, number>;
    readonly targetEmotionWeights: Record<string, number>;
    readonly directMuscleOverrides: Partial<Record<FacsMuscleName, number>>;
    readonly currentMuscles: Record<FacsMuscleName, number>;
    readonly currentHeadEuler: Vec3;
    private readonly _targetMuscles;
    private readonly _targetHeadEuler;
    private readonly _noise;
    private _time;
    constructor(emotions: Record<string, IEmotionLayer>, seed?: number);
    setEmotion(name: string, weight: number, immediate?: boolean): void;
    setExclusiveEmotion(name: string, weight?: number, immediate?: boolean): void;
    setMuscleOverride(muscle: FacsMuscleName, weight: number | null): void;
    clearMuscleOverrides(): void;
    update(dt: number, personality: IPersonalityProfile, impulseMuscles?: Partial<Record<FacsMuscleName, number>>, impulseHeadEuler?: Vec3, blinkLeft?: number, blinkRight?: number, eyelidPitchFollow?: number): void;
}

declare class GazeController {
    readonly targetGazeAngles: Vec2;
    readonly currentHeadAngles: Vec2;
    readonly currentEyeAngles: Vec2;
    readonly neckQuat: Quat;
    readonly eyeLeftQuat: Quat;
    readonly eyeRightQuat: Quat;
    lastGazeShiftMagnitude: number;
    private readonly _saccadeOffset;
    private readonly _headDriftEuler;
    private readonly _driftAmpVec3;
    private readonly _eulerScratch;
    private readonly _combinedTarget;
    private readonly _prevCombinedTarget;
    private readonly _lookDir;
    private readonly _noise;
    private _time;
    private _saccadeHoldTimer;
    constructor(seed?: number);
    setGazeAngles(angles: Vec2): void;
    lookAt(target: Vec3, headOrigin?: Vec3): void;
    update(dt: number, personality: IPersonalityProfile, extraHeadEulerOffset?: Vec3, impulseGazeOffset?: Vec2): void;
    applyHeadEuler(extraHeadEulerOffset?: Vec3): void;
}

declare class BlinkController {
    blinkLeft: number;
    blinkRight: number;
    eyelidPitchFollow: number;
    private readonly _noise;
    private _time;
    private _timeUntilNextBlink;
    private _blinkElapsed;
    private _activeDuration;
    constructor(seed?: number);
    triggerBlink(duration?: number): void;
    update(dt: number, personality: IPersonalityProfile, eyePitchRadians?: number, gazeShiftMagnitude?: number): void;
}

interface IActiveImpulse extends IImpulseEvent {
    elapsed: number;
}
declare class ImpulseController {
    readonly activeImpulses: IActiveImpulse[];
    readonly outputMuscles: Partial<Record<FacsMuscleName, number>>;
    readonly outputHeadEuler: Vec3;
    readonly outputGazeOffset: Vec2;
    private _shooting;
    private _shootHold;
    setShooting(on: boolean): void;
    isShooting(): boolean;
    private _accumulateRecipe;
    triggerImpulse(type: IImpulseEvent['type'], intensity?: number, direction?: Vec3, duration?: number): void;
    private _accumulateMuscle;
    update(dt: number): void;
}

declare function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3;
declare function invalidateDeformCache(cartridge: IFaceCartridge): void;
declare function evaluateFaceDeformation(cartridge: IFaceCartridge, pose: IFacePoseState, outPositions: Float32Array, outNormals: Float32Array): void;
type AtlasPainter = (appearance: IFaceAppearance, damageTier: number, size: number) => Uint8Array;
declare function registerAtlasPainter(painter: AtlasPainter | null): void;
declare function generateFaceAtlasPixels(appearance: IFaceAppearance, damageTier?: number, size?: number): Uint8Array;
declare function createRoostrFaceMesh(gl: WebGLRenderingContext, cartridge: IFaceCartridge, damageTier?: number, atlasSize?: number): {
    customMesh: CustomMesh;
    mesh: Mesh;
    atlasPixels: Uint8Array;
};
declare function syncRoostrMeshBuffers(mesh: Mesh, positions: Float32Array, normals: Float32Array): void;

interface IFaceROptions {
    seed?: number;
    gl?: WebGLRenderingContext;
    atlasSize?: number;
    autonomous?: boolean;
}
declare class FaceR {
    cartridge: IFaceCartridge;
    readonly compositor: ExpressionCompositor;
    readonly gaze: GazeController;
    readonly blink: BlinkController;
    readonly impulse: ImpulseController;
    deformedPositions: Float32Array;
    deformedNormals: Float32Array;
    readonly pose: IFacePoseState;
    autonomous: boolean;
    customMesh: CustomMesh | null;
    mesh: Mesh | null;
    atlasSize: number;
    private _gl;
    private _health;
    private _traumaTime;
    private _deadTime;
    constructor(cartridge?: IFaceCartridge | Record<string, unknown>, options?: IFaceROptions);
    bindWebGL(gl: WebGLRenderingContext): Mesh;
    loadCartridge(cartridge: IFaceCartridge | Record<string, unknown>): this;
    rebuildRig(recomputeMuscles?: boolean): this;
    setHairStyle(style: HaircutStyleName): this;
    setBaseHead(baseHead: string): this;
    refreshAtlasTexture(): Uint8Array;
    setEmotion(name: string, weight: number, immediate?: boolean): this;
    setExclusiveEmotion(name: string, weight?: number, immediate?: boolean): this;
    setMuscle(muscle: FacsMuscleName, weight: number | null): this;
    clearMuscleOverrides(): this;
    setGazeAngles(angles: Vec2): this;
    lookAt(target: Vec3, headOrigin?: Vec3): this;
    triggerBlink(duration?: number): this;
    triggerImpulse(type: IImpulseEvent['type'], intensity?: number, direction?: Vec3, duration?: number): this;
    setShooting(on: boolean): this;
    setHealth(healthPercent: number): this;
    getHealth(): number;
    setDamageTier(tier: number): this;
    update(dt: number): IFacePoseState;
}

export { BlinkController, ExpressionCompositor, FACE_REGIONS, FACE_REGION_IDS, FACS_MUSCLE_NAMES, FaceR, GazeController, HAIR_CAP_VERTEX_COUNT, ImpulseController, Perlin1D, applyHaircutStyleToPositions, applyMacroProportions, computeFacsMuscles, computeSmoothNormals, createDefaultAppearance, createDefaultCartridge, createDefaultEmotions, createDefaultPersonality, createDefaultProportions, createRoostrFaceMesh, deserializeBaseHead, deserializeFaceProfile, deserializeHairStyle, evaluateFaceDeformation, generateFaceAtlasPixels, getCanonicalBaseHead, getFaceProfile, getHairStyle, hasBaseHead, hasHairStyle, hydrateCartridge, invalidateDeformCache, loadBaseHead, loadFaceProfile, loadHairStyle, parseObjToCartridge, parseObjToTopology, rebuildCartridgeRig, registerAtlasPainter, registerBaseHead, registerFaceProfile, registerHairStyle, rotateVec3ByQuat, serializeCartridge, syncRoostrMeshBuffers };
export type { AtlasPainter, BaseHeadId, FaceRegionName, FacsMuscleName, HaircutStyleName, IBaseHeadTopology, IDamageMuscle, IDamageProfile, IDamageZone, IEmotionLayer, IFaceAppearance, IFaceCartridge, IFacePivots, IFacePoseState, IFaceProfile, IFaceROptions, IHairStyle, IImpulseEvent, IImpulseRecipe, IMacroProportions, IPersonalityProfile, ISparseMuscleDelta, ISubMeshRange };
