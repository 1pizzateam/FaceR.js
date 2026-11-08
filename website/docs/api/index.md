# API overview

Everything is exported from `@1pizzateam/facer`, together with the Spock types it uses (`Vec2`, `Vec3`, `Quat`, `Mat4x3`, `Utils`, ...).

| Page | Covers |
| --- | --- |
| [FaceR](./facer) | The runtime controller: emotions, gaze, impulses, health, heads and hair. |
| [Cartridge](./cartridge) | Face data, defaults, serialization, `.obj` import. |
| [Behaviour](./behaviour) | `ExpressionCompositor`, `GazeController`, `BlinkController`, `ImpulseController`, `Perlin1D`. |
| [Rendering](./rendering) | The deformer, texture atlas and RoostR mesh helpers. |

Constants: `FACS_MUSCLE_NAMES` (31 muscles), `FACE_REGIONS` / `FACE_REGION_IDS`.

Invalid numeric input (NaN weights, angles, intensities, `dt`) is ignored rather than corrupting the mesh.
