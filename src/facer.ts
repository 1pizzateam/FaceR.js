import { Vec2, Vec3, Quat, Utils } from '@1pizzateam/spock';
import { CustomMesh, Mesh, Texture } from '@1pizzateam/roostr';
import {
  BaseHeadId,
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
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
  IBaseHeadTopology,
  HAIR_CAP_VERTEX_COUNT,
  getCanonicalBaseHead,
  registerBaseHead,
  hasBaseHead,
  deserializeBaseHead,
  loadBaseHead,
  computeSmoothNormals,
  parseObjToTopology,
  applyHaircutStyleToPositions,
  IHairStyle,
  registerHairStyle,
  hasHairStyle,
  getHairStyle,
  deserializeHairStyle,
  loadHairStyle
} from './anatomy/baseHead';
import {
  getFaceProfile,
  registerFaceProfile,
  deserializeFaceProfile,
  loadFaceProfile,
  IFaceProfile,
  IDamageProfile,
  IDamageZone,
  IDamageMuscle,
  IImpulseRecipe
} from './profile';
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
  invalidateDeformCache,
  generateFaceAtlasPixels,
  registerAtlasPainter,
  AtlasPainter,
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
const MAX_DT = 0.25;
/** Seconds a dying face keeps settling into its death expression before it is frozen for good. */
const DEAD_SETTLE = 1.5;
const _eulerScratch = new Vec3(0, 0, 0);

function sanitizeAtlasSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return 256;
  return Utils.clamp(Math.round(size), 16, 4096);
}

function isHydratedCartridge(c: IFaceCartridge | Record<string, unknown>): boolean {
  return (
    c.positions instanceof Float32Array &&
    typeof c.proportions === 'object' &&
    c.proportions !== null &&
    (c.proportions as IMacroProportions).craniumScale instanceof Vec3
  );
}

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

  public deformedPositions: Float32Array;
  public deformedNormals: Float32Array;
  public readonly pose: IFacePoseState;

  public autonomous: boolean;
  public customMesh: CustomMesh | null = null;
  public mesh: Mesh | null = null;
  public atlasSize: number;

  private _gl: WebGLRenderingContext | null = null;
  private _health = 100;
  private _traumaTime = 0;
  private _deadTime = 0;

  constructor(
    cartridge?: IFaceCartridge | Record<string, unknown>,
    options: IFaceROptions = {}
  ) {
    const seed = options.seed ?? 1337;
    this.atlasSize = sanitizeAtlasSize(options.atlasSize);
    this.autonomous = options.autonomous ?? true;

    if (!cartridge) {
      this.cartridge = createDefaultCartridge();
    } else if (isHydratedCartridge(cartridge)) {
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
    this.cartridge = isHydratedCartridge(cartridge)
      ? (cartridge as IFaceCartridge)
      : hydrateCartridge(cartridge);

    // Snapshot first: the compositor may share its emotions object with the cartridge being reloaded.
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

    const topologyChanged =
      this.deformedPositions.length !== this.cartridge.positions.length;

    if (topologyChanged) {
      this.deformedPositions = new Float32Array(this.cartridge.positions);
      this.deformedNormals = new Float32Array(this.cartridge.normals);
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
   * Switch the active hair style: `'bald'` (built in) or a style loaded with `loadHairStyle` / `registerHairStyle`
   * (FaceR ships none; the game provides them).
   */
  public setHairStyle(style: HaircutStyleName): this {
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

  /**
   * Switch the underlying base head to one registered with `registerBaseHead` (FaceR ships no heads:
   * load `heads/<id>.facerhead.json`, decode it with `deserializeBaseHead`, then register it)
   * non-destructively while preserving all macro proportion sliders, haircut, and appearance colors.
   */
  public setBaseHead(baseHead: string): this {
    this.cartridge.appearance.baseHead = baseHead;
    delete (this.cartridge as { _baseTopology?: unknown })._baseTopology;
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
    // the dead do not flinch
    if (this._health > 0)
      this.impulse.triggerImpulse(type, intensity, direction, duration);
    return this;
  }

  /**
   * Holds the clenched shooting snarl while `on` is true (a weapon that keeps firing), easing in and out.
   */
  public setShooting(on: boolean): this {
    this.impulse.setShooting(on && this._health > 0);
    return this;
  }

  /**
   * Set character health percentage (`0..100`), automatically updating the 5-tier
   * progressive damage state (`0..4`) and refreshing the skin texture if changed.
   */
  public setHealth(healthPercent: number): this {
    if (!Number.isFinite(healthPercent)) return this;
    const wasDead = this._health <= 0;
    this._health = Utils.clamp(healthPercent, 0, 100);
    // damage tiers come from the face profile (health below each threshold raises the tier); no profile means no damage
    const thresholds = getFaceProfile()?.damage?.tierHealthThresholds ?? [];
    let tier = 0;
    if (this._health <= 0) {
      tier = thresholds.length;
      if (!wasDead) {
        // a dead character stops moving: drop every reaction in flight and let the eyes and head settle on their rest pose
        this.impulse.activeImpulses.length = 0;
        this.impulse.setShooting(false);
        this.gaze.targetGazeAngles.origin();
        this._deadTime = 0;
      }
      this.setExclusiveEmotion('dead', 1.0);
    } else {
      if (wasDead) {
        this.setEmotion('dead', 0.0, true);
      }
      for (let i = 0; i < thresholds.length; i++) {
        if (this._health < thresholds[i]) tier = i + 1;
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
    // Guard against NaN / negative deltas and clamp long stalls (e.g. a backgrounded tab) to keep the simulation stable.
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    const pers = this.cartridge.personality;

    // A dead character does not move. The face is given DEAD_SETTLE seconds to ease into its death expression, then it is
    // frozen exactly as it is: no gaze, blink, neck follow-through or noise, until the health is raised again.
    const dead = this._health <= 0;
    if (dead && dt > 0) {
      this._deadTime += dt;
      if (this._deadTime > DEAD_SETTLE)
        return this.pose;
    }

    // 1. Update transient impulses
    this.impulse.update(dt);

    // 2. Update gaze, saccades, and neck follow-through
    if (this.autonomous && !dead) {
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

    if (this.autonomous && !dead) {
      this.gaze.applyHeadEuler(this.compositor.currentHeadEuler);
    } else {
      this.gaze.neckQuat.setFromEuler(this.compositor.currentHeadEuler);
    }

    // 4. Populate current pose state
    for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
      const m = FACS_MUSCLE_NAMES[i];
      this.pose.muscles[m] = this.compositor.currentMuscles[m];
    }

    // 4b. Layer the profile's wounded grimace (squint, wince, labored panting) when injured
    this._traumaTime += dt;
    const reaction = getFaceProfile()?.damage?.reaction;
    if (reaction && this.pose.damageTier > 0 && this._health > 0 && this.autonomous) {
      const tier = this.pose.damageTier;
      const traumaIntensity = Math.max(
        Utils.clamp((reaction.intensityHealthRef - this._health) / reaction.intensityHealthRef, 0, 1),
        tier * reaction.intensityPerTier
      );
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
        if (tier < r.minTier) continue;
        m[r.muscle] = Utils.clamp(
          m[r.muscle] + r.perTier * (tier - r.tierBase) + r.intensity * traumaIntensity + r.pant * pantAmount,
          0,
          1
        );
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
  BaseHeadId,
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
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
  getCanonicalBaseHead,
  registerBaseHead,
  hasBaseHead,
  deserializeBaseHead,
  loadBaseHead,
  computeSmoothNormals,
  parseObjToTopology,
  applyHaircutStyleToPositions,
  IHairStyle,
  registerHairStyle,
  hasHairStyle,
  getHairStyle,
  deserializeHairStyle,
  loadHairStyle,
  IFaceProfile,
  IDamageProfile,
  IDamageZone,
  IDamageMuscle,
  IImpulseRecipe,
  registerFaceProfile,
  getFaceProfile,
  deserializeFaceProfile,
  loadFaceProfile,
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
  invalidateDeformCache,
  generateFaceAtlasPixels,
  registerAtlasPainter,
  AtlasPainter,
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
