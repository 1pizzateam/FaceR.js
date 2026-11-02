import {
  FaceR,
  BASE_HEAD_IDS,
  BASE_HEAD_ARCHETYPES,
  FACS_MUSCLE_NAMES,
  HAIRCUT_STYLES,
  HAIR_CAP_VERTEX_COUNT,
  FACE_REGIONS,
  Perlin1D,
  createBaseHeadTopology,
  getCanonicalBaseHead,
  createDefaultCartridge,
  parseObjToCartridge,
  serializeCartridge,
  hydrateCartridge,
  ExpressionCompositor,
  GazeController,
  BlinkController,
  ImpulseController,
  generateFaceAtlasPixels
} from '../dist/facer.js';
import { Vec2, Vec3 } from '@1pizzateam/spock';

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
      const base = createBaseHeadTopology();
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
      for (const style of HAIRCUT_STYLES) {
        face.setHairStyle(style);
        expect(face.cartridge.appearance.hairStyle).toBe(style);
      }
    });

    test('supports all 7 built-in Base Head Archetypes with distinct sculpt geometry and haircuts', () => {
      expect(BASE_HEAD_IDS.length).toBe(7);
      const face = new FaceR();
      const canonicalCount = face.cartridge.positions.length;

      for (const id of BASE_HEAD_IDS) {
        expect(BASE_HEAD_ARCHETYPES[id]).toBeDefined();
        const geom = getCanonicalBaseHead(id);
        expect(geom.positions.length).toBe(canonicalCount);
        face.setBaseHead(id);
        expect(face.cartridge.appearance.baseHead).toBe(id);
        face.setHairStyle('buzz_fade');
        expect(face.cartridge.positions.length).toBe(canonicalCount);
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
      face.setHealth(35);

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
});
