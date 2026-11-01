import { Rand, Utils, Vec2, Vec3 } from '@1pizzateam/spock';

const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;
const CHANNEL_STRIDE = 37;
const CHANNEL_PHASE_OFFSET = 17.371;

/**
 * Deterministic 1D Ken Perlin gradient noise and multi-octave FBM with
 * vector-first sampling into Vec2 and Vec3 targets.
 */
export class Perlin1D {

  private perm: Uint8Array;
  private grad: Float32Array;
  private seedValue: number;

  constructor(seed: number = 1997) {
    this.perm = new Uint8Array(TABLE_SIZE * 2);
    this.grad = new Float32Array(TABLE_SIZE);
    this.seedValue = seed;
    this.reseed(seed);
  }

  public get seed(): number {
    return this.seedValue;
  }

  /** Rebuild the permutation and 1D gradient tables from a seed using Spock's Rand. */
  public reseed(seed: number): this {
    this.seedValue = seed;
    const rng = Rand.create(seed);
    const p = new Uint8Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) {
      p[i] = i;
      this.grad[i] = rng.float(-1, 1);
    }
    for (let i = TABLE_SIZE - 1; i > 0; i--) {
      const j = rng.integer(0, i);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < TABLE_SIZE; i++) {
      this.perm[i] = p[i];
      this.perm[i + TABLE_SIZE] = p[i];
    }
    return this;
  }

  /** Sample 1D coherent gradient noise in [-1, 1] at coordinate x on the given channel. */
  public sample(x: number, channel: number = 0): number {
    const coord = x + channel * CHANNEL_PHASE_OFFSET;
    const xi = Utils.floor(coord, 0);
    const xf = coord - xi;
    const u = Utils.smoothstep(0, 1, xf);

    const idx = (xi + channel * CHANNEL_STRIDE) & TABLE_MASK;
    const g0 = this.grad[this.perm[idx]];
    const g1 = this.grad[this.perm[idx + 1]];

    const v0 = g0 * xf;
    const v1 = g1 * (xf - 1);
    return Utils.clampToExtent(Utils.lerp(v0, v1, u) * 2.0, 1.0);
  }

  /** Multi-octave 1D Fractional Brownian Motion in [-1, 1]. */
  public fbm(x: number, octaves: number = 2, channel: number = 0): number {
    let total = 0;
    let amp = 1.0;
    let freq = 1.0;
    let norm = 0;
    const count = Utils.clamp(octaves, 1, 6);
    for (let i = 0; i < count; i++) {
      total += this.sample(x * freq, channel + i * 13) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return norm > 0 ? total / norm : 0;
  }

  /** Sample 2 independent noise channels scaled by freq and amp into target Vec2. */
  public sampleVec2(
    time: number,
    freq: Vec2,
    amp: Vec2,
    target: Vec2 = new Vec2(),
    baseChannel: number = 0
  ): Vec2 {
    return target.setScalar(
      this.sample(time * freq.x, baseChannel) * amp.x,
      this.sample(time * freq.y, baseChannel + 1) * amp.y
    );
  }

  /** Sample 3 independent noise channels scaled by freq and amp into target Vec3. */
  public sampleVec3(
    time: number,
    freq: Vec3,
    amp: Vec3,
    target: Vec3 = new Vec3(),
    baseChannel: number = 0
  ): Vec3 {
    return target.setScalar(
      this.sample(time * freq.x, baseChannel) * amp.x,
      this.sample(time * freq.y, baseChannel + 1) * amp.y,
      this.sample(time * freq.z, baseChannel + 2) * amp.z
    );
  }

  /** Sample 2-octave FBM into target Vec2. */
  public fbmVec2(
    time: number,
    freq: Vec2,
    amp: Vec2,
    octaves: number = 2,
    target: Vec2 = new Vec2(),
    baseChannel: number = 0
  ): Vec2 {
    return target.setScalar(
      this.fbm(time * freq.x, octaves, baseChannel) * amp.x,
      this.fbm(time * freq.y, octaves, baseChannel + 1) * amp.y
    );
  }

  /** Sample 3-channel FBM into target Vec3. */
  public fbmVec3(
    time: number,
    freq: Vec3,
    amp: Vec3,
    octaves: number = 2,
    target: Vec3 = new Vec3(),
    baseChannel: number = 0
  ): Vec3 {
    return target.setScalar(
      this.fbm(time * freq.x, octaves, baseChannel) * amp.x,
      this.fbm(time * freq.y, octaves, baseChannel + 1) * amp.y,
      this.fbm(time * freq.z, octaves, baseChannel + 2) * amp.z
    );
  }

}
