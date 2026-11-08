import { Vec2, Vec3, Quat, Utils } from '@1pizzateam/spock';
import { IPersonalityProfile } from '../interfaces';
import { Perlin1D } from '../noise/perlin1d';

const ZERO_VEC2 = new Vec2(0, 0);
const ZERO_VEC3 = new Vec3(0, 0, 0);
const SACCADE_FREQ_VEC2 = new Vec2(1.35, 1.35);
const DRIFT_FREQ_VEC3 = new Vec3(0.48, 0.41, 0.53);

/**
 * Ken Perlin Eye Saccade & Head-Follow Controller (Vector-First).
 * Uses `Vec2` for `(yaw, pitch)`, `Vec3` for 3D target tracking and Euler drift,
 * and `Quat` for smooth neck and left/right eyeball orientations.
 */
export class GazeController {
  public readonly targetGazeAngles: Vec2 = new Vec2(0, 0);
  public readonly currentHeadAngles: Vec2 = new Vec2(0, 0);
  public readonly currentEyeAngles: Vec2 = new Vec2(0, 0);

  public readonly neckQuat: Quat = new Quat();
  public readonly eyeLeftQuat: Quat = new Quat();
  public readonly eyeRightQuat: Quat = new Quat();

  /** Magnitude of the most recent rapid gaze shift (triggers coupled blink reflex). */
  public lastGazeShiftMagnitude = 0;

  private readonly _saccadeOffset: Vec2 = new Vec2(0, 0);
  private readonly _headDriftEuler: Vec3 = new Vec3(0, 0, 0);
  private readonly _driftAmpVec3: Vec3 = new Vec3(1, 1, 1);
  private readonly _eulerScratch: Vec3 = new Vec3(0, 0, 0);
  private readonly _combinedTarget: Vec2 = new Vec2(0, 0);
  private readonly _prevCombinedTarget: Vec2 = new Vec2(0, 0);
  private readonly _lookDir: Vec3 = new Vec3(0, 0, 1);
  private readonly _noise: Perlin1D;
  private _time = 0;
  private _saccadeHoldTimer = 0;

  constructor(seed = 202) {
    this._noise = new Perlin1D(seed);
  }

  /**
   * Set explicit gaze angles (`angles.x = yaw`, `angles.y = pitch` in radians).
   */
  public setGazeAngles(angles: Vec2): void {
    if (!Number.isFinite(angles.x) || !Number.isFinite(angles.y)) return;
    this.targetGazeAngles.setScalar(
      Utils.clamp(angles.x, -0.85, 0.85),
      Utils.clamp(angles.y, -0.65, 0.65)
    );
  }

  /**
   * Orient gaze toward a 3D world/local point `target` (`Vec3`) relative to `headOrigin` (`Vec3`).
   */
  public lookAt(target: Vec3, headOrigin: Vec3 = ZERO_VEC3): void {
    this._lookDir.subVectors(target, headOrigin);
    const len = this._lookDir.getMagnitude();
    if (!Number.isFinite(len)) return;
    if (len < 1e-5) {
      this.targetGazeAngles.origin();
      return;
    }
    this._lookDir.divideScalar(len);
    const yaw = Math.atan2(this._lookDir.x, Math.max(0.01, this._lookDir.z));
    const pitch = Math.asin(Utils.clamp(this._lookDir.y, -0.95, 0.95));
    this.setGazeAngles(this._combinedTarget.setScalar(yaw, pitch));
  }

  /**
   * Update autonomous saccades, eye tracking, and spring-damped neck follow-through.
   */
  public update(
    dt: number,
    personality: IPersonalityProfile,
    extraHeadEulerOffset: Vec3 = ZERO_VEC3,
    impulseGazeOffset: Vec2 = ZERO_VEC2
  ): void {
    this._time += dt;

    // 1. Sample quantized Perlin1D saccades (step-and-hold Fixation -> Saccade behavior)
    this._saccadeHoldTimer -= dt * Math.max(0.1, personality.saccadeFrequency);
    if (this._saccadeHoldTimer <= 0) {
      this._noise.sampleVec2(
        this._time + 7.1,
        SACCADE_FREQ_VEC2,
        personality.saccadeAmplitude,
        this._saccadeOffset,
        2
      );
      const holdNoise = (this._noise.sample(this._time * 0.9 + 19.4, 5) + 1) * 0.5;
      this._saccadeHoldTimer = Utils.lerp(0.35, 1.35, holdNoise);
    }

    // 2. Combine explicit target gaze + autonomous saccade + impulse glance offset
    this._combinedTarget
      .copy(this.targetGazeAngles)
      .add(this._saccadeOffset)
      .add(impulseGazeOffset);

    this._combinedTarget.x = Utils.clamp(this._combinedTarget.x, -0.95, 0.95);
    this._combinedTarget.y = Utils.clamp(this._combinedTarget.y, -0.70, 0.70);

    // Measure sudden gaze shift delta for BlinkController coupling
    this.lastGazeShiftMagnitude = this._combinedTarget.getDistance(this._prevCombinedTarget);
    this._prevCombinedTarget.copy(this._combinedTarget);

    // 3. Head follows a fraction (`headFollowRatio`) of total gaze with slower damping
    const targetHeadYaw = this._combinedTarget.x * personality.headFollowRatio;
    const targetHeadPitch = this._combinedTarget.y * personality.headFollowRatio;

    if (dt > 0) {
      this.currentHeadAngles.x = Utils.damp(
        this.currentHeadAngles.x,
        targetHeadYaw,
        personality.headDamping,
        dt
      );
      this.currentHeadAngles.y = Utils.damp(
        this.currentHeadAngles.y,
        targetHeadPitch,
        personality.headDamping,
        dt
      );
    } else {
      this.currentHeadAngles.setScalar(targetHeadYaw, targetHeadPitch);
    }

    // 4. Eyes cover the residual gaze angle with high-speed oculomotor damping (`eyeDamping`)
    const residualYaw = Utils.clamp(this._combinedTarget.x - this.currentHeadAngles.x, -0.58, 0.58);
    const residualPitch = Utils.clamp(this._combinedTarget.y - this.currentHeadAngles.y, -0.42, 0.42);

    if (dt > 0) {
      this.currentEyeAngles.x = Utils.damp(
        this.currentEyeAngles.x,
        residualYaw,
        personality.eyeDamping,
        dt
      );
      this.currentEyeAngles.y = Utils.damp(
        this.currentEyeAngles.y,
        residualPitch,
        personality.eyeDamping,
        dt
      );
    } else {
      this.currentEyeAngles.setScalar(residualYaw, residualPitch);
    }

    // 5. Continuous 3-axis Perlin micro-postural head sway
    const jitter = personality.microJitterAmount;
    this._driftAmpVec3.setScalar(jitter, jitter, jitter * 0.7);
    this._noise.fbmVec3(this._time, DRIFT_FREQ_VEC3, this._driftAmpVec3, 2, this._headDriftEuler, 8);

    this.applyHeadEuler(extraHeadEulerOffset);

    // Build Left & Right Eyeball Quaternions (with slight natural vergence)
    const eyePitch = -this.currentEyeAngles.y;
    const eyeYaw = this.currentEyeAngles.x;
    const vergence = 0.025;
    this.eyeLeftQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw + vergence, 0));
    this.eyeRightQuat.setFromEuler(this._eulerScratch.setScalar(eyePitch, eyeYaw - vergence, 0));
  }

  /**
   * Rebuild `neckQuat` from current gaze follow angles, postural drift, and `extraHeadEulerOffset`.
   */
  public applyHeadEuler(extraHeadEulerOffset: Vec3 = ZERO_VEC3): void {
    const neckPitch = -this.currentHeadAngles.y + extraHeadEulerOffset.x + this._headDriftEuler.x;
    const neckYaw = this.currentHeadAngles.x + extraHeadEulerOffset.y + this._headDriftEuler.y;
    const neckRoll = extraHeadEulerOffset.z + this._headDriftEuler.z - this.currentHeadAngles.x * 0.08;
    this.neckQuat.setFromEuler(this._eulerScratch.setScalar(neckPitch, neckYaw, neckRoll));
  }
}
