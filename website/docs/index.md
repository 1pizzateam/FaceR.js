---
layout: home

hero:
  name: FaceR.js
  text: Living faces for the web
  tagline: A rigged anatomical head with FACS muscles, layered emotions and Perlin-driven gaze, blinking and combat reactions. CPU-animated, zero allocation per frame.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/overview
    - theme: alt
      text: API Reference
      link: /api/

features:
  - icon: 🧬
    title: FACS rig on any head
    details: 31 sparse muscle morph targets computed for any head you load, from a .facerhead.json asset or your own .obj.
  - icon: 🎭
    title: Layered emotions
    details: Saturating blending with antagonist clamping, plus direct per-muscle overrides.
  - icon: 👁️
    title: Autonomous behaviour
    details: Eye saccades, head follow-through, asymmetric blinks and micro-asymmetry from seeded Perlin noise.
  - icon: 💥
    title: Impulses and damage
    details: Timed reactions and a health-driven damage state, with recipes and tiers from your face profile.
  - icon: ⚡
    title: Fast
    details: Cached per-rig tables and Spock bulk transforms; the default head updates in about 0.1 ms.
  - icon: 💾
    title: Portable cartridges
    details: Serialize a face to validated, JSON-safe .facer data and load it back anywhere.
---

```ts
import { FaceR, Vec3, loadBaseHead, loadFaceProfile } from '@1pizzateam/facer';

await loadFaceProfile('/face/my.facerprofile.json');  // emotions, damage, reactions: your game's content
await loadBaseHead('my_head', '/heads');             // heads are separate files, not bundled
const face = new FaceR(undefined, { gl });       // gl is optional
face.setExclusiveEmotion('angry', 0.8);
face.lookAt(new Vec3(0.4, 0.1, 2));

function frame(dt: number) {
  face.update(dt);                               // deform and sync the RoostR mesh
}
```
