import { Vec2, Vec3, Utils } from '@1pizzateam/spock';
import { FacsMuscleName, IImpulseEvent } from '../interfaces';

interface IActiveImpulse extends IImpulseEvent {
  elapsed: number;
}

const FORWARD_VEC3 = new Vec3(0, 0, 1);

/**
 * Transient Impulse Controller for high-priority reactive gameplay events
 * (`pain`, `shoot`, `surprise`, `glance`, `evilGrin`).
 * Outputs blended muscle weights, head Euler kick (`Vec3`), and gaze kick (`Vec2`).
 */
export class ImpulseController {
  public readonly activeImpulses: IActiveImpulse[] = [];
  public readonly outputMuscles: Partial<Record<FacsMuscleName, number>> = {};
  public readonly outputHeadEuler: Vec3 = new Vec3(0, 0, 0);
  public readonly outputGazeOffset: Vec2 = new Vec2(0, 0);

  /**
   * Trigger a transient impulse event.
   */
  public triggerImpulse(
    type: IImpulseEvent['type'],
    intensity = 1.0,
    direction?: Vec3,
    duration?: number
  ): void {
    const defaultDurations: Record<IImpulseEvent['type'], number> = {
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

  private _accumulateMuscle(name: FacsMuscleName, weight: number): void {
    const prev = this.outputMuscles[name] ?? 0;
    const clamped = Utils.clamp(weight, 0, 1);
    this.outputMuscles[name] = 1.0 - (1.0 - prev) * (1.0 - clamped);
  }

  /**
   * Advance all active impulses by `dt` seconds and compute blended outputs.
   */
  public update(dt: number): void {
    for (const k of Object.keys(this.outputMuscles) as FacsMuscleName[]) {
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
      const env =
        phase < 0.18
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
