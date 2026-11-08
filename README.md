# FaceR.js

[![npm](https://img.shields.io/npm/v/@1pizzateam/facer)](https://www.npmjs.com/package/@1pizzateam/facer)
[![license](https://img.shields.io/npm/l/@1pizzateam/facer)](LICENSE)
![Jest:coverage](https://img.shields.io/badge/Jest:coverage-89%25-brightgreen.svg)

Real-time anatomical facial animation for the web. FaceR.js gives you a rigged 3D head, a FACS muscle system, layered emotions, and
Ken Perlin–style autonomous behaviour (eye saccades, head follow-through, blinking, micro-asymmetry) with transient combat impulses and
health-driven damage. It runs entirely on the CPU, allocates nothing per frame (about 0.1 ms per update for the default head on a recent laptop), and can sync straight to a WebGL mesh through
[`@1pizzateam/roostr`](https://www.npmjs.com/package/@1pizzateam/roostr). Math is built on [`@1pizzateam/spock`](https://www.npmjs.com/package/@1pizzateam/spock).

> Status: **0.1.0, initial release.** The API may change before 1.0.

## Install

```bash
npm install @1pizzateam/facer
```

ESM only. Requires a browser or Node.js 22+. `@1pizzateam/spock` (4.6.0 or later) and `@1pizzateam/roostr` are installed as dependencies.

## Head assets

The library contains **no meshes and no shaders of its own**. This repository holds no head files either: each app keeps its own `*.facerhead.json` files with its other assets (the documentation website serves one as an example). Serve yours from a static folder and load them with `loadBaseHead(id, folderUrl)` (and hair styles with `loadHairStyle`) before creating a `FaceR`. In Node, decode with `registerBaseHead(id, deserializeBaseHead(json))`. Lighting uses RoostR's `PhongShader`. `new FaceR()` uses the profile's `defaultBaseHead`; load another head and pass it with `createDefaultCartridge(name, id, headId)` or `face.setBaseHead(headId)`.

### Face profile

How a face looks and reacts is content, so FaceR ships none of it: emotions, default colours and personality, damage tiers (swelling zones and the wounded grimace), impulse recipes and the mesh material come from a `.facerprofile.json` your game loads once with `loadFaceProfile(url)` (or `registerFaceProfile(deserializeFaceProfile(json))`). Without a profile there is only the `neutral` emotion, no damage and no reactions; `createDefaultCartridge` also needs the profile's `defaultBaseHead` or a head id.

## Quick start

```ts
import { FaceR, Vec2, Vec3, loadBaseHead, loadHairStyle, loadFaceProfile, registerAtlasPainter } from '@1pizzateam/facer';

// FaceR bundles no content: load your face assets (from your own static folder) once, before creating a face
await loadFaceProfile('/face/my.facerprofile.json');   // emotions, damage, reactions, defaults, material
await loadBaseHead('my_head', '/heads');                // names it in the profile's defaultBaseHead
await loadHairStyle('buzz_fade', '/hair');
registerAtlasPainter(paintMySkin);                      // optional; flat skin colour without one

const face = new FaceR(undefined, { gl });   // `gl` is optional; omit it for headless use

face.setBaseHead('my_head');                 // any head you have loaded
face.setHairStyle('buzz_fade');              // a hair style you have loaded ('bald' is built in)

face.setExclusiveEmotion('angry', 0.8);      // layered, smoothly damped
face.lookAt(new Vec3(0.4, 0.1, 2));          // eyes lead, neck follows
face.triggerImpulse('pain', 1, new Vec3(1, 0, 0));
face.setHealth(35);                          // damage tier (from your face profile) + texture

function frame(dtSeconds: number) {
  face.update(dtSeconds);                    // deforms buffers, syncs the Mesh if bound
  // render `face.mesh` with RoostR, or read face.deformedPositions / face.deformedNormals
}
```

Without WebGL, use `face.deformedPositions`, `face.deformedNormals`, `face.cartridge.uvs` and `face.cartridge.indices` with any renderer, and
`face.refreshAtlasTexture()` to get the RGBA skin atlas pixels. FaceR paints no skin of its own: register your painter with `registerAtlasPainter(fn)` (flat `skinColor` otherwise).

### Options

`new FaceR(cartridge?, { seed, gl, atlasSize, autonomous })`

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `1337` | Seeds all Perlin streams, so behaviour is deterministic. |
| `gl` | none | `WebGLRenderingContext`; creates `face.mesh` and uploads the atlas texture. |
| `atlasSize` | `256` | Skin atlas size in pixels (clamped to 16–4096). |
| `autonomous` | `true` | Enables saccades, head follow, blinking and wound animation. |

## Features

- **Base head**: FaceR includes no heads. It rigs the head you load (a `.facerhead.json` asset or an `.obj`), adds a hair cap you can reshape with hair styles. Styles are assets too (`.facerhair.json`, loaded with `loadHairStyle`); only `'bald'` is built in.
- **FACS rig transfer**: 31 sparse muscle morph targets (`FACS_MUSCLE_NAMES`) are computed for any head, including your own `.obj` via `parseObjToCartridge`.
- **Cartridges**: `serializeCartridge` / `hydrateCartridge` read and write a portable `.facer` JSON format (proportions, sparse sculpt, muscles,
  emotions, personality, appearance). Untrusted JSON is validated and falls back to recomputing the rig.
- **Behaviour**: `ExpressionCompositor` (saturating `1 − Π(1 − wᵢ)` blending with antagonist clamping), `GazeController`, `BlinkController`,
  `ImpulseController` (`pain`, `shoot`, `surprise`, `glance`, `evilGrin`, plus a held `setShooting` snarl), `Perlin1D`.
- **Damage**: 5 progressive tiers, driven by `setHealth` or `setDamageTier`, with 3D swelling and a procedural wound texture.
- **Spock-based**: public data is `Vec2` / `Vec3` / `Quat`; deformation uses Spock's bulk `Mat4x3.transformPoints` / `transformDirections` over typed arrays. Head-building code (anatomy, FACS transfer, hair cap) still uses plain scalar math in places.
- **Modular**: every building block is exported, so you can use the compositor, controllers or deformer on their own.

## Custom heads

```ts
import { FaceR, parseObjToCartridge, serializeCartridge } from '@1pizzateam/facer';

const face = new FaceR(parseObjToCartridge(objText, 'My Head', 'my_head'));
const json = serializeCartridge(face.cartridge);   // JSON-safe
```

## Known limitations (0.1.0)

- Imported `.obj` heads are auto-rigged and normalised to FaceR's head frame, but `serializeCartridge` stores only parametric data
  (proportions, sparse sculpt, muscles), so an `.obj` cartridge does not round-trip. Keep the source mesh.
- The damage swelling and the wound atlas assume the canonical head layout, so on imported meshes they land approximately.
- The optional `gl` path targets WebGL 1 through RoostR; there is no explicit `dispose()` yet.

## Documentation

Guides and API reference live in `website/` (VitePress): `cd website && npm install && npm run dev`.

## Development

```bash
npm install
npm run build   # tsc + rollup bundle to dist/, then the Jest suite
npm test
```

## Credits and licence

MIT, see [LICENSE](LICENSE). The library contains no head geometry. Head assets derived from third-party work (including a CC BY 3.0 scan by
Lee Perry-Smith, Infinite-Realities) are described in [NOTICE.md](NOTICE.md); keep that attribution when you redistribute them.
