<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FaceR, Vec3, loadBaseHead, loadFaceProfile, registerAtlasPainter } from '@1pizzateam/facer';
import { paintFaceAtlas } from '../skin/atlas.js';
import { withBase } from 'vitepress';
import { Scene, PerspectiveCamera, DirectionalLight, AmbientLight, Vec2 } from '@1pizzateam/roostr';
import { Player } from '@1pizzateam/loopr';

const canvasRef = ref(null);
const active = ref('neutral');
const supported = ref(true);
const hitLevel = ref(0);

const EMOTIONS = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'evilGrin', label: 'Grin' },
  { id: 'angry', label: 'Angry' },
  { id: 'skeptical', label: 'Skeptical' },
  { id: 'tired', label: 'Tired' },
];

let gl, scene, camera, face, player, resizeObserver;
let lastInteraction = 0;
let autoIndex = 0;
let autoTimer = 0;
let health = 100;
const gazeTarget = new Vec3(0, 0, 1);

function setEmotion(id) {
  active.value = id;
  face.setExclusiveEmotion(id, 1);
  lastInteraction = performance.now();
}

// Hit! steps through the damage tiers (healthy, then four worse states) and wraps back to unhurt.
// Health values sit inside each tier's range: 100 = tier 0, then tiers 1..4.
const HEALTH_LEVELS = [100, 88, 70, 50, 30];

function hit() {
  hitLevel.value = (hitLevel.value + 1) % HEALTH_LEVELS.length;
  health = HEALTH_LEVELS[hitLevel.value];
  if (hitLevel.value > 0) {
    face.triggerImpulse('pain', 1.3, new Vec3(Math.random() < 0.5 ? -1 : 1, 0, 0), 1.0);
    face.triggerBlink(0.25);
  }
  lastInteraction = performance.now();
}

function onPointer(event) {
  const nx = (event.clientX / window.innerWidth) * 2 - 1;
  const ny = 1 - (event.clientY / window.innerHeight) * 2;
  gazeTarget.setScalar(nx * 1.4, ny * 0.9, 1);
  face.lookAt(gazeTarget);
}

function resize() {
  const canvas = canvasRef.value;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(canvas.clientWidth * ratio);
  if (size > 0 && (canvas.width !== size || canvas.height !== size)) {
    canvas.width = size;
    canvas.height = size;
    gl.viewport(0, 0, size, size);
    camera.setProjectionMatrix(new Vec2(size, size));
  }
}

onMounted(async () => {
  const canvas = canvasRef.value;
  gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) {
    supported.value = false;
    return;
  }
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  scene = new Scene(gl);
  camera = new PerspectiveCamera(32, new Vec2(1, 200), gl);
  camera.setPosition(new Vec3(0, 0.2, 46));
  camera.lookAt(new Vec3(0, 0.2, 0));

  const key = new DirectionalLight(new Vec3(-0.4, -0.5, -1));
  key.setDiffuse(new Vec3(1.0, 0.94, 0.88));
  key.setSpecular(new Vec3(0.5, 0.5, 0.5));
  scene.addLight(key);
  scene.addLight(new AmbientLight(new Vec3(0.5, 0.5, 0.55)));

  // FaceR ships no heads or skin look: this page brings its own painter and fetches its head (docs/public/heads)
  registerAtlasPainter(paintFaceAtlas);
  try {
    await loadFaceProfile(withBase('/face/doomr.facerprofile.json'));
    await loadBaseHead('african_sculpt', withBase('/heads'));
  } catch (err) {
    console.error(err);
    supported.value = false;
    return;
  }
  face = new FaceR(undefined, { gl, seed: 2026 });
  scene.addMesh(face.mesh);
  resize();

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('pointermove', onPointer);

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  player = new Player((delta) => {
    const dt = Math.min(delta, 0.05);
    const now = performance.now();

    // Idle: wander through expressions until the visitor takes over.
    if (!reduce && now - lastInteraction > 6000) {
      autoTimer += dt;
      if (autoTimer > 3.2) {
        autoTimer = 0;
        autoIndex = (autoIndex + 1) % EMOTIONS.length;
        active.value = EMOTIONS[autoIndex].id;
        face.setExclusiveEmotion(active.value, 1);
        if (autoIndex === 3 && Math.random() < 0.5) face.triggerImpulse('pain', 0.8, new Vec3(1, 0, 0));
      }
    }

    face.setHealth(health);

    face.update(reduce ? 0 : dt);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    scene.render(camera);
  });
  player.start();
});

onBeforeUnmount(() => {
  player?.stop();
  resizeObserver?.disconnect();
  window.removeEventListener('pointermove', onPointer);
  scene?.clearMeshes();
});
</script>

<template>
  <div class="face-hero">
    <canvas ref="canvasRef" aria-label="Animated FaceR head that follows your cursor" />
    <p v-if="!supported" class="face-hero-caption">WebGL is not available in this browser.</p>
    <template v-else>
      <div class="face-hero-chips">
        <button
          v-for="e in EMOTIONS"
          :key="e.id"
          class="face-hero-chip"
          :class="{ active: active === e.id }"
          @click="setEmotion(e.id)"
        >{{ e.label }}</button>
        <button class="face-hero-chip" @click="hit">{{ hitLevel === HEALTH_LEVELS.length - 1 ? 'Heal' : 'Hit!' }}</button>
      </div>
    </template>
  </div>
</template>
