import { Vec2, Vec3 } from '@1pizzateam/spock';
import { FACS_MUSCLE_NAMES, FacsMuscleName, IEmotionLayer, IFaceAppearance, IPersonalityProfile } from './interfaces';

/**
 * The face profile: everything about how a face *looks and reacts* that belongs to the game, not to the engine.
 * FaceR ships none; the game loads a `.facerprofile.json` asset (see `deserializeFaceProfile`, `loadFaceProfile`)
 * and registers it once. Sections are optional: without them FaceR falls back to neutral defaults, no damage and no reactions.
 */
export interface IFaceProfile {
  id: string;
  /** Base head used by `createDefaultCartridge` when none is named. */
  defaultBaseHead?: string;
  /** Emotion layers (muscle recipes), by name. */
  emotions: Record<string, IEmotionLayer>;
  /** Default colours and damage seed. `baseHead` and `hairStyle` are not part of it. */
  appearance?: Partial<IFaceAppearance>;
  personality?: IPersonalityProfile;
  /** Phong material of the face mesh. */
  material?: { ambient: Vec3; diffuse: Vec3; specular: Vec3; shininess: number };
  damage?: IDamageProfile;
  /** Transient reaction recipes (`pain`, `shoot`, ...), by type. */
  impulses: Record<string, IImpulseRecipe>;
  /** Easing rates of the held shooting snarl (`setShooting`), which uses the `shoot` recipe. */
  holdShooting: { riseRate: number; fallRate: number };
}

/** A swelling zone: `displacement = falloff * weight * (tier - tierBase) * (normal * vertexNormal + constant)` per axis. */
export interface IDamageZone {
  id: string;
  center: Vec3;
  radii: Vec3;
  minTier: number;
  tierBase: number;
  weight: number;
  normal: [number, number, number];
  constant: [number, number, number];
}

/** `muscle += perTier * (tier - tierBase) + intensity * traumaIntensity + pant * pantAmount` while injured (tier >= minTier). */
export interface IDamageMuscle {
  muscle: FacsMuscleName;
  minTier: number;
  tierBase: number;
  perTier: number;
  intensity: number;
  pant: number;
}

export interface IDamageProfile {
  /** Descending health values: health below the first gives tier 1, below the second tier 2, and so on. */
  tierHealthThresholds: number[];
  /** Skin vertices at or above this rest Z are candidates for the zones. */
  minZ: number;
  zones: IDamageZone[];
  reaction: {
    intensityHealthRef: number;
    intensityPerTier: number;
    pant: { minTier: number; perTier: number; tierBase: number; floor: number; freqBase: number; freqIntensity: number } | null;
    muscles: IDamageMuscle[];
  };
}

/** A transient reaction (see `ImpulseController`): muscle weights scale with the impulse envelope. */
export interface IImpulseRecipe {
  duration: number;
  attack: number;
  muscles: [FacsMuscleName, number][];
  /** Added x envelope. */
  headEuler: [number, number, number] | null;
  /** Added x direction.x x envelope. */
  headEulerDirX: [number, number, number] | null;
  /** Weight picked by the sign of direction.x. */
  directionalMuscles: { muscle: FacsMuscleName; whenXNegative: number; otherwise: number }[];
  gazeFromDir: { maxX: number; maxY: number } | null;
}

let _profile: IFaceProfile | null = null;

/** Register the face profile used by every face (pass `null` to go back to neutral defaults). */
export function registerFaceProfile(profile: IFaceProfile | null): void {
  _profile = profile;
}

export function getFaceProfile(): IFaceProfile | null {
  return _profile;
}

/** The base head named by the profile, used when a cartridge is created without naming one. */
export function defaultBaseHeadId(): string {
  const id = _profile?.defaultBaseHead;
  if (!id) {
    throw new Error('FaceR: no base head named. Pass a head id, or register a face profile with a defaultBaseHead.');
  }
  return id;
}

const MUSCLE_SET = new Set<string>(FACS_MUSCLE_NAMES);

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`deserializeFaceProfile: ${what} must be [x, y, z].`);
  }
  return new Vec3(v[0], v[1], v[2]);
}

function triple(v: unknown, what: string): [number, number, number] {
  const t = vec3(v, what);
  return [t.x, t.y, t.z];
}

function muscleName(name: string, what: string): FacsMuscleName {
  if (!MUSCLE_SET.has(name)) throw new Error(`deserializeFaceProfile: unknown muscle "${name}" in ${what}.`);
  return name as FacsMuscleName;
}

function muscleWeights(o: unknown, what: string): [FacsMuscleName, number][] {
  const out: [FacsMuscleName, number][] = [];
  for (const [name, w] of Object.entries((o ?? {}) as Record<string, unknown>)) {
    out.push([muscleName(name, what), num(w, 0)]);
  }
  return out;
}

/** Decode and validate a `.facerprofile.json` asset. */
export function deserializeFaceProfile(data: unknown): IFaceProfile {
  const o = data as Record<string, any>;
  if (!o || o.format !== 'facer-profile' || typeof o.id !== 'string') {
    throw new Error('deserializeFaceProfile: not a facer-profile asset.');
  }

  const emotions: Record<string, IEmotionLayer> = {};
  for (const [name, layer] of Object.entries((o.emotions ?? {}) as Record<string, any>)) {
    const muscles: Partial<Record<FacsMuscleName, number>> = {};
    for (const [m, w] of muscleWeights(layer?.muscles, `emotion "${name}"`)) muscles[m] = w;
    emotions[name] = { name, muscles, headEulerOffset: layer?.headEulerOffset ? vec3(layer.headEulerOffset, `emotion "${name}" headEulerOffset`) : new Vec3(0, 0, 0) };
  }

  let appearance: Partial<IFaceAppearance> | undefined;
  if (o.appearance) {
    appearance = { damageSeed: num(o.appearance.damageSeed, 1337) };
    for (const k of ['skinColor', 'skinShadowColor', 'lipColor', 'irisColor', 'scleraColor', 'browColor', 'hairColor', 'teethColor'] as const) {
      if (o.appearance[k] !== undefined) appearance[k] = vec3(o.appearance[k], `appearance.${k}`);
    }
  }

  let personality: IPersonalityProfile | undefined;
  if (o.personality) {
    const p = o.personality;
    const v2 = (a: unknown, d: [number, number]) => (Array.isArray(a) ? new Vec2(num(a[0], d[0]), num(a[1], d[1])) : new Vec2(d[0], d[1]));
    personality = {
      blinkIntervalRange: v2(p.blinkIntervalRange, [2.2, 5.2]),
      blinkDuration: num(p.blinkDuration, 0.16),
      saccadeFrequency: num(p.saccadeFrequency, 0.85),
      saccadeAmplitude: v2(p.saccadeAmplitude, [0.28, 0.16]),
      headFollowRatio: num(p.headFollowRatio, 0.42),
      headDamping: num(p.headDamping, 7.5),
      eyeDamping: num(p.eyeDamping, 26),
      asymmetryAmount: num(p.asymmetryAmount, 0.08),
      microJitterAmount: num(p.microJitterAmount, 0.04)
    };
  }

  let material: IFaceProfile['material'];
  if (o.material) {
    material = {
      ambient: vec3(o.material.ambient, 'material.ambient'),
      diffuse: vec3(o.material.diffuse, 'material.diffuse'),
      specular: vec3(o.material.specular, 'material.specular'),
      shininess: num(o.material.shininess, 22)
    };
  }

  let damage: IDamageProfile | undefined;
  if (o.damage) {
    const d = o.damage;
    const thresholds = (Array.isArray(d.tierHealthThresholds) ? d.tierHealthThresholds : []).map((n: unknown) => num(n, 0));
    const zones: IDamageZone[] = (Array.isArray(d.zones) ? d.zones : []).map((z: any) => ({
      id: String(z.id),
      center: vec3(z.center, `zone ${z.id} center`),
      radii: vec3(z.radii, `zone ${z.id} radii`),
      minTier: num(z.minTier, 1),
      tierBase: num(z.tierBase, 0),
      weight: num(z.weight, 0),
      normal: triple(z.normal ?? [0, 0, 0], `zone ${z.id} normal`),
      constant: triple(z.constant ?? [0, 0, 0], `zone ${z.id} constant`)
    }));
    const r = d.reaction ?? {};
    damage = {
      tierHealthThresholds: thresholds,
      minZ: num(d.minZ, 0),
      zones,
      reaction: {
        intensityHealthRef: num(r.intensityHealthRef, 85),
        intensityPerTier: num(r.intensityPerTier, 0),
        pant: r.pant
          ? {
              minTier: num(r.pant.minTier, 2), perTier: num(r.pant.perTier, 0), tierBase: num(r.pant.tierBase, 0),
              floor: num(r.pant.floor, 0), freqBase: num(r.pant.freqBase, 1), freqIntensity: num(r.pant.freqIntensity, 0)
            }
          : null,
        muscles: (Array.isArray(r.muscles) ? r.muscles : []).map((m: any) => ({
          muscle: muscleName(String(m.muscle), 'damage.reaction'),
          minTier: num(m.minTier, 1), tierBase: num(m.tierBase, 0),
          perTier: num(m.perTier, 0), intensity: num(m.intensity, 0), pant: num(m.pant, 0)
        }))
      }
    };
  }

  const impulses: Record<string, IImpulseRecipe> = {};
  for (const [type, r] of Object.entries((o.impulses ?? {}) as Record<string, any>)) {
    impulses[type] = {
      duration: num(r.duration, 0.5),
      attack: num(r.attack, 0.18),
      muscles: muscleWeights(r.muscles, `impulse "${type}"`),
      headEuler: r.headEuler ? triple(r.headEuler, `impulse "${type}" headEuler`) : null,
      headEulerDirX: r.headEulerDirX ? triple(r.headEulerDirX, `impulse "${type}" headEulerDirX`) : null,
      directionalMuscles: (Array.isArray(r.directionalMuscles) ? r.directionalMuscles : []).map((m: any) => ({
        muscle: muscleName(String(m.muscle), `impulse "${type}"`),
        whenXNegative: num(m.whenXNegative, 0),
        otherwise: num(m.otherwise, 0)
      })),
      gazeFromDir: r.gazeFromDir ? { maxX: num(r.gazeFromDir.maxX, 0), maxY: num(r.gazeFromDir.maxY, 0) } : null
    };
  }

  return {
    id: o.id,
    defaultBaseHead: typeof o.defaultBaseHead === 'string' ? o.defaultBaseHead : undefined,
    emotions,
    appearance,
    personality,
    material,
    damage,
    impulses,
    holdShooting: { riseRate: num(o.holdShooting?.holdRiseRate, 35), fallRate: num(o.holdShooting?.holdFallRate, 22) }
  };
}

/** Fetch a `.facerprofile.json` from `url`, decode it and register it as the active profile. */
export async function loadFaceProfile(url: string): Promise<IFaceProfile> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FaceR: could not load the face profile from ${url} (HTTP ${res.status}).`);
  const profile = deserializeFaceProfile(await res.json());
  registerFaceProfile(profile);
  return profile;
}
