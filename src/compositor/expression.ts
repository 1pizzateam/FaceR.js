import { Vec3, Utils } from '@1pizzateam/spock';
import {
  FACS_MUSCLE_NAMES,
  FacsMuscleName,
  IEmotionLayer,
  IPersonalityProfile
} from '../interfaces';
import { Perlin1D } from '../noise/perlin1d';

/**
 * Antagonistic muscle pairs where strong activation of the primary muscle
 * naturally suppresses the opposing muscle.
 */
const ANTAGONIST_PAIRS: ReadonlyArray<[FacsMuscleName, FacsMuscleName, number]> = [
  ['eyeBlinkL', 'eyeWideL', 0.95],
  ['eyeBlinkR', 'eyeWideR', 0.95],
  ['mouthSmileL', 'mouthFrownL', 0.55],
  ['mouthSmileR', 'mouthFrownR', 0.55],
  ['browDownL', 'browOuterUpL', 0.45],
  ['browDownR', 'browOuterUpR', 0.45]
];

const LEFT_MUSCLES: ReadonlySet<FacsMuscleName> = new Set([
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

const RIGHT_MUSCLES: ReadonlySet<FacsMuscleName> = new Set([
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

/**
 * Ken Perlin Layered Expression Compositor.
 * Combines emotion layers, direct muscle overrides, and transient impulse muscles
 * using non-linear saturating blending (`1 - prod(1 - w_i * m_i,k)`), opposing
 * muscle antagonism clamping, and `Perlin1D` micro-asymmetry.
 */
export class ExpressionCompositor {
  public readonly emotions: Record<string, IEmotionLayer>;
  public readonly emotionWeights: Record<string, number> = {};
  public readonly targetEmotionWeights: Record<string, number> = {};
  public readonly directMuscleOverrides: Partial<Record<FacsMuscleName, number>> = {};
  public readonly currentMuscles: Record<FacsMuscleName, number>;
  public readonly currentHeadEuler: Vec3 = new Vec3();

  private readonly _targetMuscles: Record<FacsMuscleName, number>;
  private readonly _targetHeadEuler: Vec3 = new Vec3();
  private readonly _noise: Perlin1D;
  private _time = 0;

  constructor(emotions: Record<string, IEmotionLayer>, seed = 101) {
    this.emotions = emotions;
    this._noise = new Perlin1D(seed);
    this.currentMuscles = {} as Record<FacsMuscleName, number>;
    this._targetMuscles = {} as Record<FacsMuscleName, number>;

    for (const m of FACS_MUSCLE_NAMES) {
      this.currentMuscles[m] = 0;
      this._targetMuscles[m] = 0;
    }

    for (const key of Object.keys(emotions)) {
      this.emotionWeights[key] = 0;
      this.targetEmotionWeights[key] = 0;
    }
  }

  /**
   * Set the target weight `[0..1]` of a named emotion layer.
   */
  public setEmotion(name: string, weight: number, immediate = false): void {
    if (!Number.isFinite(weight)) return;
    const clamped = Utils.clamp(weight, 0, 1);
    this.targetEmotionWeights[name] = clamped;
    if (immediate) {
      this.emotionWeights[name] = clamped;
    } else if (this.emotionWeights[name] === undefined) {
      this.emotionWeights[name] = 0;
    }
  }

  /**
   * Exclusively activate one primary emotion while smoothly fading others to `0`.
   */
  public setExclusiveEmotion(name: string, weight = 1.0, immediate = false): void {
    for (const key of Object.keys(this.emotions)) {
      this.setEmotion(key, key === name ? weight : 0, immediate);
    }
  }

  /**
   * Set a direct FACS muscle override (`0..1`), or pass `null` to clear the override.
   */
  public setMuscleOverride(muscle: FacsMuscleName, weight: number | null): void {
    if (weight === null || weight === undefined) {
      delete this.directMuscleOverrides[muscle];
    } else if (Number.isFinite(weight)) {
      this.directMuscleOverrides[muscle] = Utils.clamp(weight, 0, 1);
    }
  }

  /**
   * Clear all direct muscle overrides.
   */
  public clearMuscleOverrides(): void {
    for (const k of Object.keys(this.directMuscleOverrides) as FacsMuscleName[]) {
      delete this.directMuscleOverrides[k];
    }
  }

  /**
   * Advance the compositor by `dt` seconds, blending emotion layers, transient
   * impulse muscle weights, blink weights, and Perlin micro-asymmetry.
   */
  public update(
    dt: number,
    personality: IPersonalityProfile,
    impulseMuscles?: Partial<Record<FacsMuscleName, number>>,
    impulseHeadEuler?: Vec3,
    blinkLeft = 0,
    blinkRight = 0,
    eyelidPitchFollow = 0
  ): void {
    this._time += dt;
    const emotionRate = Math.max(2.0, personality.headDamping);

    // 1. Smoothly damp emotion layer weights & accumulate target head Euler offset
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

    // 2. Compute Ken Perlin one-minus saturating product across all active layers
    const asymNoiseL = this._noise.sample(this._time * 0.65 + 11.3) * personality.asymmetryAmount;
    const asymNoiseR = this._noise.sample(this._time * 0.65 + 47.9) * personality.asymmetryAmount;

    for (let i = 0; i < FACS_MUSCLE_NAMES.length; i++) {
      const m = FACS_MUSCLE_NAMES[i];
      let complementProd = 1.0;

      for (const name in emotions) {
        const layerW = this.emotionWeights[name] ?? 0;
        if (layerW <= 0.001) continue;
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

      // Apply organic Perlin left/right micro-asymmetry to non-zero expressions
      if (combined > 0.02 && personality.asymmetryAmount > 0) {
        if (LEFT_MUSCLES.has(m)) {
          combined = Utils.clamp(combined * (1.0 + asymNoiseL), 0, 1);
        } else if (RIGHT_MUSCLES.has(m)) {
          combined = Utils.clamp(combined * (1.0 + asymNoiseR), 0, 1);
        }
      }

      this._targetMuscles[m] = combined;
    }

    // 3. Layer autonomous eyelid pitch follow & blink closure
    if (eyelidPitchFollow > 0) {
      this._targetMuscles.eyeWideL = 1.0 - (1.0 - this._targetMuscles.eyeWideL) * (1.0 - eyelidPitchFollow);
      this._targetMuscles.eyeWideR = 1.0 - (1.0 - this._targetMuscles.eyeWideR) * (1.0 - eyelidPitchFollow);
    } else if (eyelidPitchFollow < 0) {
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

    // 4. Resolve opposing muscle antagonism
    for (let i = 0; i < ANTAGONIST_PAIRS.length; i++) {
      const [dominant, recessive, factor] = ANTAGONIST_PAIRS[i];
      const domVal = this._targetMuscles[dominant];
      if (domVal > 0.01) {
        this._targetMuscles[recessive] *= Math.max(0, 1.0 - domVal * factor);
      }
    }

    // 5. Apply direct muscle overrides (used by FaceGun Rig Studio & explicit API calls)
    const overrides = this.directMuscleOverrides;
    for (const m in overrides) {
      const val = overrides[m as FacsMuscleName];
      if (typeof val === 'number') {
        this._targetMuscles[m as FacsMuscleName] = Utils.clamp(val, 0, 1);
      }
    }

    // 6. Smoothly damp muscle activations and head Euler offsets (impulses already shape their own attack/release)
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

    const hasImpulseHead =
      impulseHeadEuler !== undefined &&
      (impulseHeadEuler.x !== 0 || impulseHeadEuler.y !== 0 || impulseHeadEuler.z !== 0);
    if (dt > 0 && !hasImpulseHead) {
      this.currentHeadEuler.x = Utils.damp(this.currentHeadEuler.x, this._targetHeadEuler.x, emotionRate, dt);
      this.currentHeadEuler.y = Utils.damp(this.currentHeadEuler.y, this._targetHeadEuler.y, emotionRate, dt);
      this.currentHeadEuler.z = Utils.damp(this.currentHeadEuler.z, this._targetHeadEuler.z, emotionRate, dt);
    } else {
      this.currentHeadEuler.copy(this._targetHeadEuler);
    }
  }
}
