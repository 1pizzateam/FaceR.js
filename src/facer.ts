import { Vec2, Vec3, Quat, Utils } from '@1pizzateam/spock';
import { CustomMesh, Mesh, Texture } from '@1pizzateam/roostr';
import {
  BASE_HEAD_IDS,
  BaseHeadId,
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
  HAIRCUT_STYLES,
  HaircutStyleName,
  FACE_REGIONS,
  FACE_REGION_IDS,
  FaceRegionName,
  IMacroProportions,
  IFacePivots,
  ISparseMuscleDelta,
  IEmotionLayer,
  IPersonalityProfile,
  IFaceAppearance,
  ISubMeshRange,
  IFaceCartridge,
  IFacePoseState,
  IImpulseEvent
} from './interfaces';
import { Perlin1D } from './noise/perlin1d';
import {
  BASE_HEAD_ARCHETYPES,
  IBaseHeadTopology,
  HAIR_CAP_VERTEX_COUNT,
  createBaseHeadTopology,
  getCanonicalBaseHead,
  computeSmoothNormals,
  parseObjToTopology,
  applyHaircutStyleToPositions
} from './anatomy/baseHead';
import { applyMacroProportions, computeFacsMuscles } from './anatomy/muscleTransfer';
import {
  createDefaultProportions,
  createDefaultEmotions,
  createDefaultPersonality,
  createDefaultAppearance,
  createDefaultCartridge,
  parseObjToCartridge,
  rebuildCartridgeRig,
  serializeCartridge,
  hydrateCartridge
} from './schema';
import { ExpressionCompositor } from './compositor/expression';
import { GazeController } from './controllers/gaze';
import { BlinkController } from './controllers/blink';
import { ImpulseController } from './controllers/impulse';
import {
  rotateVec3ByQuat,
  evaluateFaceDeformation,
  generateFaceAtlasPixels,
  createRoostrFaceMesh,
  syncRoostrMeshBuffers
} from './deformer/facerMesh';

export interface IFaceROptions {
  seed?: number;
  gl?: WebGLRenderingContext;
  atlasSize?: number;
  autonomous?: boolean;
}

const ZERO_VEC3 = new Vec3(0, 0, 0);
const _eulerScratch = new Vec3(0, 0, 0);

/**
 * High-level Ken Perlin Responsive Face runtime controller (`FaceR`).
 * Evaluates layered FACS emotions, autonomous 1D Perlin eye saccades, coupled
 * head/neck follow-through, stochastic blinking, transient combat impulses, and
 * sparse vertex/normal deformation.
 */
export class FaceR {
  public cartridge: IFaceCartridge;
  public readonly compositor: ExpressionCompositor;
  public readonly gaze: GazeController;
  public readonly blink: BlinkController;
  public readonly impulse: ImpulseController;

  public readonly deformedPositions: Float32Array;
  public readonly deformedNormals: Float32Array;
  public readonly pose: IFacePoseState;

  public autonomous: boolean;
  public customMesh: CustomMesh | null = null;
  public mesh: Mesh | null = null;
  public atlasSize: number;

  private _gl: WebGLRenderingContext | null = null;
  private _health = 100;
  private _traumaTime = 0;

  constructor(
    cartridge?: IFaceCartridge | Record<string, unknown>,
    options: IFaceROptions = {}
  ) {
    const seed = options.seed ?? 1337;
    this.atlasSize = options.atlasSize ?? 256;
    this.autonomous = options.autonomous ?? true;

    if (!cartridge) {
      this.cartridge = createDefaultCartridge();
    } else if (
      'positions' in cartridge &&
      cartridge.positions instanceof Float32Array &&
      'proportions' in cartridge &&
      (cartridge.proportions as IMacroProportions).craniumScale instanceof Vec3
    ) {
      this.cartridge = cartridge as IFaceCartridge;
    } else {
      this.cartridge = hydrateCartridge(cartridge);
    }

    this.compositor = new ExpressionCompositor(this.cartridge.emotions, seed + 11);
    this.gaze = new GazeController(seed + 23);
    this.blink = new BlinkController(seed + 37);
    this.impulse = new ImpulseController();

    this.deformedPositions = new Float32Array(this.cartridge.positions);
    this.deformedNormals = new Float32Array(this.cartridge.normals);

    const initialMuscles = {} as Record<FacsMuscleName, number>;
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

  /**
   * Attach this `FaceR` instance to a WebGLRenderingContext and create its
   * `@1pizzateam/roostr` `Mesh` and `CustomMesh`.
   */
  public bindWebGL(gl: WebGLRenderingContext): Mesh {
    this._gl = gl;
    const built = createRoostrFaceMesh(gl, this.cartridge, this.pose.damageTier, this.atlasSize);
    this.customMesh = built.customMesh;
    this.mesh = built.mesh;
    return this.mesh;
  }

  /**
   * Load a new `IFaceCartridge` (or serialized `.facer` JSON object) into this instance.
   */
  public loadCartridge(cartridge: IFaceCartridge | Record<string, unknown>): this {
    this.cartridge =
      'positions' in cartridge && cartridge.positions instanceof Float32Array
        ? (cartridge as IFaceCartridge)
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

    const topologyChanged =
      this.deformedPositions.length !== this.cartridge.positions.length;

    if (topologyChanged) {
      (this as any).deformedPositions = new Float32Array(this.cartridge.positions);
      (this as any).deformedNormals = new Float32Array(this.cartridge.normals);
      if (this._gl) {
        this.bindWebGL(this._gl);
      }
    } else {
      this.deformedPositions.set(this.cartridge.positions);
      this.deformedNormals.set(this.cartridge.normals);
      this.refreshAtlasTexture();
    }

    this.update(0);
    return this;
  }

  /**
   * Rebuild the anatomical rig (`positions`, `normals`, `pivots`, and FACS `muscles`)
   * after modifying `cartridge.proportions`, `cartridge.appearance.hairStyle`, or `cartridge.sculptOffsets`.
   */
  public rebuildRig(recomputeMuscles = true): this {
    rebuildCartridgeRig(this.cartridge, recomputeMuscles);
    this.update(0);
    return this;
  }

  /**
   * Switch the active 3D haircut / headgear style (`'bald'`, `'buzz_fade'`, `'flattop'`,
   * `'afro_short'`, `'mohawk'`, `'slick_back'`, `'dreadlocks'`, `'combat_helmet'`) on any head.
   */
  public setHairStyle(style: HaircutStyleName): this {
    this.cartridge.appearance.hairStyle = style;
    this.rebuildRig(false);
    if (this._gl && this.mesh) {
      this.refreshAtlasTexture();
    }
    return this;
  }

  /**
   * Switch the underlying 3D Base Head Archetype (`'african_sculpt'`, `'european_scan'`,
   * `'boggie_sculpt'`, `'walt_classic'`, `'east_asian'`, `'nordic_angular'`, `'gracile_feminine'`)
   * non-destructively while preserving all macro proportion sliders, haircut, and appearance colors.
   */
  public setBaseHead(baseHead: BaseHeadId): this {
    this.cartridge.appearance.baseHead = baseHead;
    if ('_baseTopology' in (this.cartridge as any)) {
      delete (this.cartridge as any)._baseTopology;
    }
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
      (this as any).deformedPositions = new Float32Array(canonical.positions.length);
      (this as any).deformedNormals = new Float32Array(canonical.normals.length);
    }
    this.rebuildRig(true);
    if (topologyChanged && this._gl) {
      this.bindWebGL(this._gl);
    }
    return this;
  }

  /**
   * Regenerate the procedural RGBA texture atlas and upload it to the bound `RoostR` `Mesh`.
   */
  public refreshAtlasTexture(): Uint8Array {
    const pixels = generateFaceAtlasPixels(
      this.cartridge.appearance,
      this.pose.damageTier,
      this.atlasSize
    );
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

  /**
   * Set the target weight `[0..1]` of a named emotion layer (e.g., `'angry'`, `'evilGrin'`).
   */
  public setEmotion(name: string, weight: number, immediate = false): this {
    this.compositor.setEmotion(name, weight, immediate);
    return this;
  }

  /**
   * Exclusively activate one emotion layer while fading all others to `0`.
   */
  public setExclusiveEmotion(name: string, weight = 1.0, immediate = false): this {
    this.compositor.setExclusiveEmotion(name, weight, immediate);
    return this;
  }

  /**
   * Directly override an individual FACS muscle weight `[0..1]`, or pass `null` to release it.
   */
  public setMuscle(muscle: FacsMuscleName, weight: number | null): this {
    this.compositor.setMuscleOverride(muscle, weight);
    return this;
  }

  /**
   * Release all direct FACS muscle overrides.
   */
  public clearMuscleOverrides(): this {
    this.compositor.clearMuscleOverrides();
    return this;
  }

  /**
   * Set explicit 2D gaze angles (`angles.x = yaw`, `angles.y = pitch` in radians).
   */
  public setGazeAngles(angles: Vec2): this {
    this.gaze.setGazeAngles(angles);
    return this;
  }

  /**
   * Orient gaze toward a 3D target point `target` (`Vec3`) relative to `headOrigin` (`Vec3`).
   */
  public lookAt(target: Vec3, headOrigin: Vec3 = ZERO_VEC3): this {
    this.gaze.lookAt(target, headOrigin);
    return this;
  }

  /**
   * Trigger an immediate natural blink envelope.
   */
  public triggerBlink(duration?: number): this {
    this.blink.triggerBlink(duration);
    return this;
  }

  /**
   * Trigger a transient reactive impulse (`'pain'`, `'shoot'`, `'surprise'`, `'glance'`, `'evilGrin'`).
   */
  public triggerImpulse(
    type: IImpulseEvent['type'],
    intensity = 1.0,
    direction?: Vec3,
    duration?: number
  ): this {
    this.impulse.triggerImpulse(type, intensity, direction, duration);
    return this;
  }

  /**
   * Set character health percentage (`0..100`), automatically updating the 5-tier
   * progressive damage state (`0..4`) and refreshing the skin texture if changed.
   */
  public setHealth(healthPercent: number): this {
    const wasDead = this._health <= 0;
    this._health = Utils.clamp(healthPercent, 0, 100);
    let tier = 0;
    if (this._health <= 0) {
      tier = 4;
      this.setExclusiveEmotion('dead', 1.0);
    } else {
      if (wasDead) {
        this.setEmotion('dead', 0.0, true);
      }
      if (this._health < 20) {
        tier = 4;
      } else if (this._health < 40) {
        tier = 3;
      } else if (this._health < 60) {
        tier = 2;
      } else if (this._health < 80) {
        tier = 1;
      }
    }
    this.setDamageTier(tier);
    return this;
  }

  public getHealth(): number {
    return this._health;
  }

  /**
   * Explicitly set the progressive damage tier (`0..4`).
   */
  public setDamageTier(tier: number): this {
    const clamped = Utils.clamp(tier | 0, 0, 4);
    if (this.pose.damageTier !== clamped) {
      this.pose.damageTier = clamped;
      this.refreshAtlasTexture();
    }
    return this;
  }

  /**
   * Advance the responsive face simulation by `dt` seconds and deform the mesh buffers.
   */
  public update(dt: number): IFacePoseState {
    const pers = this.cartridge.personality;

    // 1. Update transient impulses
    this.impulse.update(dt);

    // 2. Update gaze, saccades, and neck follow-through
    if (this.autonomous) {
      this.gaze.update(
        dt,
        pers,
        this.compositor.currentHeadEuler,
        this.impulse.outputGazeOffset
      );
      this.blink.update(
        dt,
        pers,
        this.gaze.currentEyeAngles.y,
        this.gaze.lastGazeShiftMagnitude
      );
    } else {
      this.gaze.neckQuat.setFromEuler(this.compositor.currentHeadEuler);
      this.gaze.eyeLeftQuat.setFromEuler(
        _eulerScratch.setScalar(-this.gaze.targetGazeAngles.y, this.gaze.targetGazeAngles.x, 0)
      );
      this.gaze.eyeRightQuat.setFromEuler(
        _eulerScratch.setScalar(-this.gaze.targetGazeAngles.y, this.gaze.targetGazeAngles.x, 0)
      );
      this.blink.blinkLeft = 0;
      this.blink.blinkRight = 0;
      this.blink.eyelidPitchFollow = 0;
    }

    // 3. Update layered expression compositor
    this.compositor.update(
      dt,
      pers,
      this.impulse.outputMuscles,
      this.impulse.outputHeadEuler,
      this.blink.blinkLeft,
      this.blink.blinkRight,
      this.blink.eyelidPitchFollow
    );

    // 4. Populate current pose state
    for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
      const m = FACS_MUSCLE_NAMES[i];
      this.pose.muscles[m] = this.compositor.currentMuscles[m];
    }

    // 4b. Layer dynamic wounded facial grimace, swollen left-eye squint & labored panting when injured
    this._traumaTime += dt;
    if (this.pose.damageTier > 0 && this._health > 0 && this.autonomous) {
      const tier = this.pose.damageTier;
      const traumaIntensity = Math.max(
        Utils.clamp((85 - this._health) / 85, 0, 1),
        tier * 0.22
      );
      const m = this.pose.muscles;

      // Swollen left eye squint & protective orbital wince
      m.eyeSquintL = Utils.clamp(m.eyeSquintL + 0.16 * tier, 0, 1);
      m.eyeBlinkL = Utils.clamp(m.eyeBlinkL + 0.11 * tier, 0, 1);
      m.cheekSquintL = Utils.clamp(m.cheekSquintL + 0.14 * tier, 0, 1);
      m.browDownL = Utils.clamp(m.browDownL + 0.12 * tier, 0, 1);
      m.browInnerUp = Utils.clamp(m.browInnerUp + 0.14 * traumaIntensity, 0, 1);

      if (tier >= 2) {
        // Pain sneer & labored mouth-breathing wave
        const breathFreq = 2.6 + traumaIntensity * 2.4;
        const breathWave = 0.5 + 0.5 * Math.sin(this._traumaTime * breathFreq);
        const pantAmount = (tier - 1) * 0.085 * (0.45 + 0.55 * breathWave);

        m.noseSneerL = Utils.clamp(m.noseSneerL + 0.12 * (tier - 1), 0, 1);
        m.mouthUpperUpL = Utils.clamp(m.mouthUpperUpL + 0.09 * (tier - 1), 0, 1);
        m.mouthFrownL = Utils.clamp(m.mouthFrownL + 0.10 * (tier - 1), 0, 1);
        m.mouthFrownR = Utils.clamp(m.mouthFrownR + 0.10 * (tier - 1), 0, 1);
        m.jawOpen = Utils.clamp(m.jawOpen + pantAmount, 0, 1);
        m.mouthLowerDownL = Utils.clamp(m.mouthLowerDownL + pantAmount * 0.75, 0, 1);
        m.mouthLowerDownR = Utils.clamp(m.mouthLowerDownR + pantAmount * 0.75, 0, 1);
      }
    }

    this.pose.neckQuat.copy(this.gaze.neckQuat);
    this.pose.eyeLeftQuat.copy(this.gaze.eyeLeftQuat);
    this.pose.eyeRightQuat.copy(this.gaze.eyeRightQuat);

    // Compute mandibular condyle hinge rotation (`jawQuat`) from `jawOpen`, `jawLeft`, `jawRight`
    const jawOpenPitch = this.pose.muscles.jawOpen * 0.36;
    const jawLateralYaw = (this.pose.muscles.jawRight - this.pose.muscles.jawLeft) * 0.14;
    this.pose.jawQuat.setFromEuler(_eulerScratch.setScalar(jawOpenPitch, jawLateralYaw, 0));

    // 5. Evaluate sparse CPU morph targets + pivot rotations into deformed buffers
    evaluateFaceDeformation(
      this.cartridge,
      this.pose,
      this.deformedPositions,
      this.deformedNormals
    );

    // 6. Sync deformed buffers to CustomMesh & WebGL Mesh if bound
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

export {
  BASE_HEAD_IDS,
  BaseHeadId,
  BASE_HEAD_ARCHETYPES,
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
  HAIRCUT_STYLES,
  HaircutStyleName,
  FACE_REGIONS,
  FACE_REGION_IDS,
  FaceRegionName,
  IMacroProportions,
  IFacePivots,
  ISparseMuscleDelta,
  IEmotionLayer,
  IPersonalityProfile,
  IFaceAppearance,
  ISubMeshRange,
  IFaceCartridge,
  IFacePoseState,
  IImpulseEvent,
  Perlin1D,
  IBaseHeadTopology,
  HAIR_CAP_VERTEX_COUNT,
  createBaseHeadTopology,
  getCanonicalBaseHead,
  computeSmoothNormals,
  parseObjToTopology,
  applyHaircutStyleToPositions,
  applyMacroProportions,
  computeFacsMuscles,
  createDefaultProportions,
  createDefaultEmotions,
  createDefaultPersonality,
  createDefaultAppearance,
  createDefaultCartridge,
  parseObjToCartridge,
  rebuildCartridgeRig,
  serializeCartridge,
  hydrateCartridge,
  ExpressionCompositor,
  GazeController,
  BlinkController,
  ImpulseController,
  rotateVec3ByQuat,
  evaluateFaceDeformation,
  generateFaceAtlasPixels,
  createRoostrFaceMesh,
  syncRoostrMeshBuffers
};

export {
  Vec2,
  Vec3,
  Quat,
  Mat3,
  Mat4,
  Mat4x3,
  Box,
  Sphere,
  Ray2,
  Ray3,
  Plane,
  Frustum,
  Trigo,
  Utils,
  Rand,
  Bezier,
  Time,
  Accumulator
} from '@1pizzateam/spock';
