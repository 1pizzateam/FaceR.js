# Overview

## What it does

FaceR.js gives your web app a face that feels alive. You provide an emotion, a gaze target and the occasional impulse; the library turns them into smooth, natural facial motion in real time.

- **Rigs your head:** give it a head mesh (a `.facerhead.json` asset or a Wavefront `.obj`) and it builds the FACS rig. Everything that defines a face's look and reactions is a loaded asset: heads, hair styles, the face profile and the skin painter.
- **Expressions:** layered emotions (angry, evil grin, pain, surprised, ...) built from 31 FACS muscles.
- **Autonomous life:** blinking, eye saccades, head follow-through and micro-asymmetry, so the face is never frozen.
- **Reactions and damage:** timed impulses and a health-driven wound state, with the recipes and tiers defined by your face profile.
- **Fast and portable:** CPU-animated with no per-frame allocation (about 0.1 ms per update), and faces save to JSON `.facer` cartridges.

## What it needs

| Requirement | Details |
| --- | --- |
| **Runtime** | A modern browser, or Node.js 22+. ESM only. |
| **Head assets** | FaceR contains no meshes, hair styles or skin look. Serve your `.facerhead.json` (and `.facerhair.json`) files from your app's static folder and load them with `loadBaseHead` / `loadHairStyle` before creating a face. |
| **Face profile** | A `.facerprofile.json` with your emotions, default colours, damage tiers (swelling and grimace), reaction recipes (`pain`, `shoot`, ...) and mesh material, loaded with `loadFaceProfile(url)`. Without one FaceR has only `neutral`, no damage and no reactions. |
| **Skin painter** | A function that paints the skin atlas for your heads, registered with `registerAtlasPainter(fn)`. Without one the skin is a flat colour. |
| **Rendering** | A `WebGLRenderingContext` to draw `face.mesh` with RoostR. It is optional: without WebGL, read the deformed vertex buffers and render them with any engine. |
| **Frame loop** | You call `face.update(dtSeconds)` once per frame. FaceR has no loop of its own. |

FaceR.js animates a rigged 3D head in real time. You give it emotions, a gaze target and the occasional impulse; it handles blinking, eye saccades,
head follow-through, muscle blending and damage. Everything runs on the CPU and writes into plain typed arrays, so it works with
[RoostR](https://www.npmjs.com/package/@1pizzateam/roostr) or any renderer.

## Quick start

```ts
import { FaceR, Vec3, loadBaseHead, loadFaceProfile } from '@1pizzateam/facer';

await loadFaceProfile('/face/my.facerprofile.json');
await loadBaseHead('my_head', '/heads');  // heads are separate files
const face = new FaceR(undefined, { gl });  // gl is optional; omit for headless use

face.setBaseHead('my_head');                // any loaded head
face.setHairStyle('buzz_fade');             // a loaded hair style (or 'bald')
face.setExclusiveEmotion('angry', 0.8);
face.lookAt(new Vec3(0.4, 0.1, 2));
face.triggerImpulse('pain', 1, new Vec3(1, 0, 0));
face.setHealth(35);

function frame(dtSeconds: number) {
  face.update(dtSeconds);
}
```

With `gl`, `face.mesh` is a RoostR `Mesh` ready for `scene.addMesh(face.mesh)`. Without it, read `face.deformedPositions`, `face.deformedNormals`,
`face.cartridge.uvs` and `face.cartridge.indices` and render them yourself; `face.refreshAtlasTexture()` returns the RGBA skin atlas.

## How it fits together

| Piece | Role |
| --- | --- |
| **Cartridge** | The face data: proportions, mesh, 31 FACS muscle morphs, emotions, personality, appearance. |
| **Compositor** | Blends emotion layers, impulses, blinks and overrides into muscle weights. |
| **Controllers** | `GazeController`, `BlinkController`, `ImpulseController` drive the autonomous motion. |
| **Deformer** | Applies muscles, damage and pivot rotations (neck, jaw, eyes) to the vertex buffers. |

`FaceR` wires them together; every piece is also exported for standalone use.

## Known limitations (0.1.0)

- Imported `.obj` cartridges don't round-trip through `serializeCartridge`.
- Damage swelling and the wound texture assume the canonical head layout.
- There is no `dispose()` yet.
