# Installation

```bash
npm install @1pizzateam/facer
```

ESM only, for browsers or Node.js 22+. `@1pizzateam/spock` (4.6.0 or later) and `@1pizzateam/roostr` come in as dependencies, and the package
re-exports the Spock types you need (`Vec2`, `Vec3`, `Quat`, ...), so you can import everything from one place.

## Options

`new FaceR(cartridge?, options?)`

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `1337` | Seeds all Perlin streams for deterministic behaviour. |
| `gl` | none | `WebGLRenderingContext`; creates `face.mesh` and the skin texture. |
| `atlasSize` | `256` | Skin atlas size in pixels, clamped to 16–4096. |
| `autonomous` | `true` | Saccades, head follow, blinking and wound animation. |

## Rendering with RoostR

```ts
import { Scene, PerspectiveCamera, DirectionalLight, AmbientLight, Vec2 } from '@1pizzateam/roostr';

const scene = new Scene(gl);
const camera = new PerspectiveCamera(32, new Vec2(1, 200), gl);
camera.setPosition(new Vec3(0, 0.2, 46));      // the head is about 20 units tall
camera.lookAt(new Vec3(0, 0.2, 0));
scene.addLight(new DirectionalLight(new Vec3(-0.4, -0.5, -1)));
scene.addLight(new AmbientLight(new Vec3(0.5, 0.5, 0.55)));
scene.addMesh(face.mesh);
```
