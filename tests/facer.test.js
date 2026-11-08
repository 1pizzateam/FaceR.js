import {
  FaceR,
  FACS_MUSCLE_NAMES,
  HAIR_CAP_VERTEX_COUNT,
  FACE_REGIONS,
  Perlin1D,
  getCanonicalBaseHead,
  registerBaseHead,
  hasBaseHead,
  deserializeBaseHead,
  deserializeHairStyle,
  registerHairStyle,
  hasHairStyle,
  createDefaultCartridge,
  parseObjToCartridge,
  serializeCartridge,
  hydrateCartridge,
  ExpressionCompositor,
  GazeController,
  BlinkController,
  ImpulseController,
  generateFaceAtlasPixels,
  registerAtlasPainter,
  deserializeFaceProfile,
  registerFaceProfile,
  getFaceProfile,
  createDefaultEmotions
} from '../dist/facer.js';
import { Vec2, Vec3 } from '@1pizzateam/spock';
import { readFileSync } from 'node:fs';

// FaceR owns no heads: the tests use the one head the documentation website serves.
const TEST_HEADS = ['african_sculpt'];
for (const id of TEST_HEADS) {
  const file = new URL(`../website/docs/public/heads/${id}.facerhead.json`, import.meta.url);
  registerBaseHead(id, deserializeBaseHead(JSON.parse(readFileSync(file, 'utf8'))));
}

// FaceR owns no look or reactions either: a small synthetic face profile stands in for the game's.
registerFaceProfile(deserializeFaceProfile({
  format: 'facer-profile', version: 1, id: 'test', defaultBaseHead: 'african_sculpt',
  emotions: {
    angry: { muscles: { browDownL: 0.92, browDownR: 0.92, eyeSquintL: 0.55, jawOpen: 0.06 }, headEulerOffset: [-0.08, 0, 0] },
    evilGrin: { muscles: { browDownL: 0.75, browDownR: 0.75, mouthSmileL: 0.95 }, headEulerOffset: [-0.05, 0.04, 0] },
    dead: { muscles: { eyeBlinkL: 0.82, eyeBlinkR: 0.88, jawOpen: 0.52 }, headEulerOffset: [-0.26, 0.14, -0.18] },
  },
  appearance: { skinColor: [0.38, 0.23, 0.15], damageSeed: 1337 },
  damage: {
    tierHealthThresholds: [95, 80, 60, 40], minZ: 2.2,
    zones: [{ id: 'malar', center: [-1.95, 1.05, 5.45], radii: [1.15, 0.85, 1.4], minTier: 1, tierBase: 0, weight: 0.085, normal: [1, 1, 1.15], constant: [0, -0.03, 0] }],
    reaction: { intensityHealthRef: 85, intensityPerTier: 0.22, pant: { minTier: 2, perTier: 0.085, tierBase: 1, floor: 0.45, freqBase: 2.6, freqIntensity: 2.4 },
      muscles: [{ muscle: 'eyeSquintL', minTier: 1, perTier: 0.16 }, { muscle: 'jawOpen', minTier: 2, pant: 1 }] },
  },
  impulses: {
    pain: { duration: 0.45, attack: 0.18, muscles: { eyeSquintL: 0.92, jawOpen: 0.65 }, headEuler: [0.18, 0, 0], headEulerDirX: [0, -0.25, 0.14] },
    shoot: { duration: 0.25, attack: 0.12, muscles: { browDownL: 0.88, mouthPress: 0.85 }, headEuler: [-0.08, 0, 0] },
  },
}));

// FaceR owns no hair styles either: register a synthetic one (cap lifted by 0.1 on Y, constant shade map).
const SHADE = Buffer.alloc(16, 200).toString('base64');
registerHairStyle(deserializeHairStyle({
  format: 'facer-hair', version: 1, id: 'test_style',
  capDelta: Array.from({ length: HAIR_CAP_VERTEX_COUNT * 3 }, (_, i) => (i % 3 === 1 ? 0.1 : 0)),
  atlas: { size: 4, shade: SHADE, skinMix: Buffer.alloc(16, 0).toString('base64') },
}));

describe('FaceR.js (@1pizzateam/facer)', () => {
  describe('Perlin1D coherent noise', () => {
    test('produces deterministic, smooth, bounded values in [-1, 1]', () => {
      const n1 = new Perlin1D(42);
      const n2 = new Perlin1D(42);
      const v2 = new Vec2();
      const v3 = new Vec3();

      for (let t = 0; t < 25; t += 0.17) {
        const s1 = n1.sample(t);
        const s2 = n2.sample(t);
        expect(s1).toBeCloseTo(s2, 6);
        expect(s1).toBeGreaterThanOrEqual(-1.0);
        expect(s1).toBeLessThanOrEqual(1.0);

        // Continuity check
        const sNext = n1.sample(t + 0.005);
        expect(Math.abs(sNext - s1)).toBeLessThan(0.05);
      }

      n1.sampleVec2(1.5, new Vec2(1.0, 1.0), new Vec2(1.0, 1.0), v2);
      expect(v2).toBeInstanceOf(Vec2);

      n1.fbmVec3(2.3, new Vec3(1.0, 1.0, 1.0), new Vec3(1.0, 1.0, 1.0), 3, v3);
      expect(v3).toBeInstanceOf(Vec3);
      expect(v3.getMagnitude()).toBeGreaterThan(0);
    });
  });

  describe('Anatomical Base Head & Automatic FACS Rig Transfer', () => {
    test('generates high-poly symmetrical head with 6 anatomical submeshes and all FACS muscles', () => {
      const base = getCanonicalBaseHead('african_sculpt');
      expect(base.vertexCount).toBeGreaterThan(1000);
      expect(base.triangleCount).toBeGreaterThan(1800);
      expect(base.submeshes.length).toBe(FACE_REGIONS.length);

      // Verify normals are unit length
      for (let i = 0; i < base.vertexCount; i++) {
        const idx = i * 3;
        const len = Math.hypot(
          base.normals[idx],
          base.normals[idx + 1],
          base.normals[idx + 2]
        );
        expect(len).toBeCloseTo(1.0, 2);
      }

      // Verify cartridge creation and all FACS muscle channels
      const cartridge = createDefaultCartridge('Doom Marine', 'doom_marine');
      expect(Object.keys(cartridge.muscles).length).toBe(FACS_MUSCLE_NAMES.length);

      for (const muscleName of FACS_MUSCLE_NAMES) {
        const delta = cartridge.muscles[muscleName];
        expect(delta).toBeDefined();
        expect(delta.indices.length).toBeGreaterThan(5);
        expect(delta.dPos.length).toBe(delta.indices.length * 3);
        expect(delta.dNorm.length).toBe(delta.indices.length * 3);
      }
    });

    test('parseObjToCartridge imports a Wavefront .obj mesh and auto-rigs FACS muscles', () => {
      const sampleObj = [
        'v -2.0 2.0 5.0',
        'v 2.0 2.0 5.0',
        'v 0.0 -2.0 6.0',
        'v 0.0 -5.0 5.0',
        'v -3.0 0.0 2.0',
        'v 3.0 0.0 2.0',
        'v 0.0 5.0 3.0',
        'v 0.0 0.0 -4.0',
        'f 1 3 2',
        'f 3 4 2',
        'f 1 4 3',
        'f 1 2 7',
        'f 5 1 7',
        'f 2 6 7',
        'f 5 8 6'
      ].join('\n');
      const imported = parseObjToCartridge(sampleObj, 'Custom OBJ Head', 'custom_obj');
      expect(imported.name).toBe('Custom OBJ Head');
      expect(imported.positions.length).toBe((8 + HAIR_CAP_VERTEX_COUNT) * 3);
      expect(Object.keys(imported.muscles).length).toBe(FACS_MUSCLE_NAMES.length);

      // Verify modular haircuts can be applied to both canonical and imported .OBJ heads
      const face = new FaceR(imported);
      for (const style of ['bald', 'test_style']) {
        face.setHairStyle(style);
        expect(face.cartridge.appearance.hairStyle).toBe(style);
      }
    });

    test('the atlas painter is supplied by the game: flat skin colour by default, the registered painter otherwise', () => {
      const face = new FaceR();
      const app = face.cartridge.appearance;
      const flat = generateFaceAtlasPixels(app, 0, 8);
      expect(flat.length).toBe(8 * 8 * 4);
      expect(flat[0]).toBe(Math.round(app.skinColor.x * 255));
      registerAtlasPainter((_a, tier, size) => new Uint8Array(size * size * 4).fill(tier + 1));
      expect(generateFaceAtlasPixels(app, 2, 8)[5]).toBe(3);
      registerAtlasPainter(() => new Uint8Array(3));
      expect(() => generateFaceAtlasPixels(app, 0, 8)).toThrow(/expected/);
      registerAtlasPainter(null);
      expect(generateFaceAtlasPixels(app, 0, 8)[0]).toBe(flat[0]);
    });

    test('without a face profile FaceR has neutral defaults, no damage and no reactions', () => {
      const profile = getFaceProfile();
      registerFaceProfile(null);
      try {
        expect(Object.keys(createDefaultEmotions())).toEqual(['neutral']);
        expect(() => createDefaultCartridge()).toThrow(/no base head named/);
        const face = new FaceR(createDefaultCartridge('Face', 'face', 'african_sculpt'));
        face.setHealth(10);
        expect(face.pose.damageTier).toBe(0);
        face.triggerImpulse('pain', 1);
        expect(face.impulse.activeImpulses.length).toBe(0);
      } finally {
        registerFaceProfile(profile);
      }
      const hurt = new FaceR();
      hurt.setHealth(50);
      expect(hurt.pose.damageTier).toBe(3);
      hurt.triggerImpulse('pain', 1);
      expect(hurt.impulse.activeImpulses.length).toBe(1);
    });

    test('hair styles are registered assets: unknown styles throw, a registered one moves the cap by its delta', () => {
      expect(hasHairStyle('bald')).toBe(true);
      expect(hasHairStyle('test_style')).toBe(true);
      expect(hasHairStyle('mohawk')).toBe(false);
      const face = new FaceR();
      expect(() => face.setHairStyle('mohawk')).toThrow(/not registered/);
      const sm = face.cartridge.submeshes.find((m) => m.name === 'browsHair');
      const capY = (sm.startVertex + sm.vertexCount - HAIR_CAP_VERTEX_COUNT) * 3 + 1;
      face.setHairStyle('bald');
      const bald = face.cartridge.positions[capY];
      face.setHairStyle('test_style');
      expect(face.cartridge.positions[capY]).not.toBeCloseTo(bald, 3);
      expect(() => deserializeHairStyle({ format: 'nope' })).toThrow();
    });

    test('supports a registered base head with haircuts', () => {
      const face = new FaceR();
      const canonicalCount = face.cartridge.positions.length;

      for (const id of TEST_HEADS) {
        expect(hasBaseHead(id)).toBe(true);
        const geom = getCanonicalBaseHead(id);
        // european_scan is a dedicated scan-based head with its own topology; all others share the canonical mesh
        if (id === 'european_scan') {
          expect(geom.positions.length).toBeGreaterThan(canonicalCount);
        } else {
          expect(geom.positions.length).toBe(canonicalCount);
        }
        face.setBaseHead(id);
        expect(face.cartridge.appearance.baseHead).toBe(id);
        face.setHairStyle('test_style');
        expect(face.cartridge.positions.length).toBe(geom.positions.length);
        expect(face.cartridge.indices.length).toBe(geom.indices.length);
        expect(Object.keys(face.cartridge.muscles).length).toBeGreaterThan(0);
      }
    });
  });

  describe('ExpressionCompositor & Behavioral Controllers', () => {
    test('blends multiple emotion layers using saturating one-minus product and clamps antagonists', () => {
      const cartridge = createDefaultCartridge();
      const comp = new ExpressionCompositor(cartridge.emotions, 77);

      comp.setEmotion('angry', 0.8, true);
      comp.setEmotion('evilGrin', 0.8, true);
      comp.update(0, cartridge.personality);

      // Both angry and evilGrin activate browDownL; saturating blend stays <= 1.0
      expect(comp.currentMuscles.browDownL).toBeGreaterThan(0.8);
      expect(comp.currentMuscles.browDownL).toBeLessThanOrEqual(1.0);
    });

    test('GazeController, BlinkController, and ImpulseController operate with Vec2/Vec3/Quat', () => {
      const cartridge = createDefaultCartridge();
      const gaze = new GazeController(123);
      const blink = new BlinkController(456);
      const impulse = new ImpulseController();

      gaze.lookAt(new Vec3(5, 2, 12));
      gaze.update(0.05, cartridge.personality);
      expect(gaze.lastGazeShiftMagnitude).toBeGreaterThan(0.2);

      // Large gaze shift triggers coupled reflex blink
      blink.update(0.016, cartridge.personality, gaze.currentEyeAngles.y, 0.5);
      expect(blink.blinkLeft).toBeGreaterThan(0);

      impulse.triggerImpulse('pain', 1.0, new Vec3(1, 0, 0), 0.4);
      impulse.update(0.05);
      expect(impulse.outputMuscles.eyeSquintL).toBeGreaterThan(0.3);
      expect(impulse.outputHeadEuler.getMagnitude()).toBeGreaterThan(0.01);
    });
  });

  describe('Cartridge Serialization & Hydration (.facer format)', () => {
    test('round-trips proportions (Vec3), personality (Vec2), sparse sculpt offsets, and muscles', () => {
      const cartridge = createDefaultCartridge('Cyber Baron', 'cyber_baron');
      cartridge.proportions.jawScale.setScalar(1.25, 1.1, 1.15);
      cartridge.proportions.browOffset.setScalar(0, -0.35, 0.65);
      cartridge.sculptOffsets[30] = 0.42;
      cartridge.sculptOffsets[31] = -0.18;
      cartridge.sculptOffsets[32] = 0.75;

      const json = serializeCartridge(cartridge);
      expect(json.sculptSparse.indices.length).toBe(1);

      const hydrated = hydrateCartridge(json);
      expect(hydrated.name).toBe('Cyber Baron');
      expect(hydrated.proportions.jawScale).toBeInstanceOf(Vec3);
      expect(hydrated.proportions.jawScale.x).toBeCloseTo(1.25, 3);
      expect(hydrated.personality.blinkIntervalRange).toBeInstanceOf(Vec2);
      expect(hydrated.sculptOffsets[30]).toBeCloseTo(0.42, 3);
      expect(hydrated.sculptOffsets[32]).toBeCloseTo(0.75, 3);
    });
  });

  describe('FaceR Runtime Controller & Performance', () => {
    test('updates pose, deforms vertices, generates damage tiers, and runs 1000 frames efficiently', () => {
      const face = new FaceR();
      face.setEmotion('angry', 0.9, true);
      face.setGazeAngles(new Vec2(0.35, -0.15));
      face.triggerImpulse('shoot', 1.0);
      face.setHealth(50);

      expect(face.pose.damageTier).toBe(3);

      const pixels = generateFaceAtlasPixels(face.cartridge.appearance, face.pose.damageTier, 128);
      expect(pixels.length).toBe(128 * 128 * 4);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        face.update(0.016);
      }
      const elapsedMs = performance.now() - start;
      expect(elapsedMs).toBeLessThan(2000);

      // Verify deformed positions differ from neutral positions
      let diffSum = 0;
      for (let i = 0; i < face.deformedPositions.length; i++) {
        diffSum += Math.abs(face.deformedPositions[i] - face.cartridge.positions[i]);
      }
      expect(diffSum).toBeGreaterThan(100);
    });
  });

  describe('Robustness (v0.1.0 audit)', () => {
    test('loadCartridge accepts the cartridge already loaded without losing emotions', () => {
      const face = new FaceR(undefined, { autonomous: false });
      const names = Object.keys(face.cartridge.emotions);
      face.loadCartridge(face.cartridge);
      expect(Object.keys(face.compositor.emotions)).toEqual(names);
      expect(names.length).toBeGreaterThan(0);
    });

    test('update ignores NaN / negative dt and non-finite inputs never corrupt the mesh', () => {
      const face = new FaceR();
      face.update(NaN);
      face.update(-1);
      face.update(1e6);
      face.setEmotion('angry', NaN);
      face.triggerImpulse('pain', NaN);
      face.setGazeAngles(new Vec2(NaN, 0));
      face.setHealth(NaN);
      face.update(1 / 60);
      for (const v of face.deformedPositions) expect(Number.isFinite(v)).toBe(true);
      for (const v of face.deformedNormals) expect(Number.isFinite(v)).toBe(true);
    });

    test('hydrateCartridge rejects malformed saved muscle deltas and recomputes them', () => {
      const raw = serializeCartridge(createDefaultCartridge());
      raw.muscles.jawOpen.indices = [999999];
      const cart = hydrateCartridge(raw);
      const vCount = cart.positions.length / 3;
      for (const idx of cart.muscles.jawOpen.indices) expect(idx).toBeLessThan(vCount);
      expect(cart.muscles.jawOpen.dPos.length).toBe(cart.muscles.jawOpen.indices.length * 3);
    });

    test('parseObjToCartridge ignores out-of-range faces and throws on empty geometry', () => {
      expect(() => parseObjToCartridge('# nothing here')).toThrow(/no usable geometry/);
      expect(() => parseObjToCartridge('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9')).toThrow(/no usable geometry/);
    });
  });
});
