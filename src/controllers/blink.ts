import { Utils } from '@1pizzateam/spock';
import { IPersonalityProfile } from '../interfaces';
import { Perlin1D } from '../noise/perlin1d';

/**
 * Ken Perlin Stochastic Blink & Eyelid-Follow Controller.
 * Generates natural asymmetric blink envelopes (`fast downstroke -> brief closure -> smooth upstroke`),
 * triggers coupled reflex blinks on large gaze shifts, and computes upper eyelid
 * elevation/depression following vertical eye pitch.
 */
export class BlinkController {
  public blinkLeft = 0;
  public blinkRight = 0;
  public eyelidPitchFollow = 0;

  private readonly _noise: Perlin1D;
  private _time = 0;
  private _timeUntilNextBlink = 2.8;
  private _blinkElapsed = -1;
  private _activeDuration = 0.16;

  constructor(seed = 303) {
    this._noise = new Perlin1D(seed);
  }

  /**
   * Trigger an immediate blink envelope.
   */
  public triggerBlink(duration?: number): void {
    if (this._blinkElapsed < 0) {
      this._blinkElapsed = 0;
      if (duration && duration > 0.04) {
        this._activeDuration = duration;
      }
    }
  }

  /**
   * Update blink state for `dt` seconds.
   */
  public update(
    dt: number,
    personality: IPersonalityProfile,
    eyePitchRadians = 0,
    gazeShiftMagnitude = 0
  ): void {
    this._time += dt;

    // 1. Coupled gaze-shift blink reflex (Perlin Responsive Face signature behavior)
    if (gazeShiftMagnitude > 0.32 && this._blinkElapsed < 0) {
      this.triggerBlink(personality.blinkDuration * 0.9);
    }

    // 2. Stochastic Perlin timer for spontaneous blinking
    this._timeUntilNextBlink -= dt;
    if (this._timeUntilNextBlink <= 0 && this._blinkElapsed < 0) {
      this.triggerBlink(personality.blinkDuration);
      const minInterval = Math.max(0.4, personality.blinkIntervalRange.x);
      const maxInterval = Math.max(minInterval + 0.2, personality.blinkIntervalRange.y);
      const u = (this._noise.sample(this._time * 1.7 + 31.7) + 1) * 0.5;
      this._timeUntilNextBlink = Utils.lerp(minInterval, maxInterval, u);
    }

    // 3. Evaluate fast-close / slow-open asymmetric blink curve
    if (this._blinkElapsed >= 0) {
      this._blinkElapsed += dt;
      const dur = Math.max(0.06, this._activeDuration || personality.blinkDuration);
      const phase = this._blinkElapsed / dur;

      if (phase >= 1.0) {
        this._blinkElapsed = -1;
        this.blinkLeft = 0;
        this.blinkRight = 0;
      } else {
        // Peak closure occurs at 32% of duration (rapid closing, softer opening)
        let weight = 0;
        if (phase < 0.32) {
          weight = Utils.smoothstep(0, 0.32, phase);
        } else {
          weight = 1.0 - Utils.smoothstep(0.32, 1.0, phase);
        }
        this.blinkLeft = weight;
        // Subtle 10ms right-eye phase offset when asymmetryAmount > 0
        const rightPhase = Utils.clamp(phase - personality.asymmetryAmount * 0.08, 0, 1);
        this.blinkRight =
          rightPhase < 0.32
            ? Utils.smoothstep(0, 0.32, rightPhase)
            : 1.0 - Utils.smoothstep(0.32, 1.0, rightPhase);
      }
    } else {
      this.blinkLeft = 0;
      this.blinkRight = 0;
    }

    // 4. Eyelid pitch follow: looking up raises upper lid, looking down lowers it
    this.eyelidPitchFollow = Utils.clamp(eyePitchRadians * 0.85, -0.45, 0.55);
  }
}
