import { Vec2, Vec3, Utils } from '@1pizzateam/spock';
import { FacsMuscleName, IImpulseEvent } from '../interfaces';
import { getFaceProfile, IImpulseRecipe } from '../profile';

interface IActiveImpulse extends IImpulseEvent {
  elapsed: number;
}

const MAX_ACTIVE_IMPULSES = 32;
const FORWARD_VEC3 = new Vec3(0, 0, 1);

/**
 * Transient Impulse Controller for high-priority reactive gameplay events. The recipes (`pain`, `shoot`, ...)
 * come from the face profile's `impulses`; FaceR ships none, so unknown types do nothing.
 * Outputs blended muscle weights, head Euler kick (`Vec3`), and gaze kick (`Vec2`).
 */
export class ImpulseController {
  public readonly activeImpulses: IActiveImpulse[] = [];
  public readonly outputMuscles: Partial<Record<FacsMuscleName, number>> = {};
  public readonly outputHeadEuler: Vec3 = new Vec3(0, 0, 0);
  public readonly outputGazeOffset: Vec2 = new Vec2(0, 0);

  // the held snarl of a weapon that keeps firing (chainsaw, chaingun, railgun): eased in and out instead of a one-off blip
  private _shooting = false;
  private _shootHold = 0;

  /**
   * Holds (or releases) the shooting snarl for as long as a weapon keeps firing. It eases in fast and out slower, and it
   * blends with any transient impulses, so a pain flinch still shows through while the snarl is held.
   */
  public setShooting(on: boolean): void {
    this._shooting = on;
  }

  public isShooting(): boolean {
    return this._shooting;
  }

  /** Accumulate a recipe at envelope weight `w` (direction only matters to `headEulerDirX`, `directionalMuscles` and `gazeFromDir`). */
  private _accumulateRecipe(r: IImpulseRecipe, w: number, dir: Vec3): void {
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

  /**
   * Trigger a transient impulse event.
   */
  public triggerImpulse(
    type: IImpulseEvent['type'],
    intensity = 1.0,
    direction?: Vec3,
    duration?: number
  ): void {
    const recipe = getFaceProfile()?.impulses[type];
    if (!recipe || !Number.isFinite(intensity)) return;
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
      if (!recipe) continue;
      const phase = imp.elapsed / imp.duration;
      const attack = recipe.attack;
      const env =
        phase < attack
          ? Utils.smoothstep(0, attack, phase)
          : 1.0 - Utils.smoothstep(attack, 1.0, phase);
      this._accumulateRecipe(recipe, env * imp.intensity, imp.direction || FORWARD_VEC3);
    }
  }
}
