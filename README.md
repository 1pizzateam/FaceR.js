# FaceR.js (`@1pizzateam/facer`)

**FaceR.js** is the 1PizzaTeam real-time anatomical facial animation and Ken Perlin behavioral engine library, built 100% vector-first on `@1pizzateam/spock` and `@1pizzateam/roostr`.

## Key Features

- **100% Vector-First (`@1pizzateam/spock`)**:
  - `Vec3` for all 3D positions, sculpt offsets, FACS muscle deltas, surface normals, anatomical pivots (`neck`, `jaw`, `eyeLeft`, `eyeRight`), Euler angles, and normalized RGB colors.
  - `Vec2` for 2D gaze angles `(yaw, pitch)`, UV coordinates, and stochastic timing intervals `[min, max]`.
  - `Quat` and `Mat4x3` for affine neck, jaw, and eyeball pivot transformations.
  - `Ray3`, `Sphere`, `Box`, `Utils`, `Trigo`, `Bezier`, and `Rand` for deterministic procedural geometry, raycasting, and smoothstep damping.
- **High-Polygon Anatomical Base Head (`src/anatomy/baseHead.ts`)**:
  - Generates a symmetrical `3,333`-vertex, `6,216`-triangle head mesh with `6` anatomical submeshes (`skin`, `eye_left`, `eye_right`, `upper_teeth`, `lower_teeth`, `inner_mouth`).
- **Automatic FACS Rig Transfer (`src/anatomy/muscleTransfer.ts`)**:
  - Projects 26 FACS Action Unit muscle zones (`browInnerUpL/R`, `browLowererL/R`, `browOuterUpL/R`, `eyeBlinkL/R`, `eyeWideL/R`, `eyeSquintL/R`, `cheekRaiserL/R`, `noseWrinklerL/R`, `upperLipRaiserL/R`, `lipCornerPullerL/R`, `lipFunneler`, `lipPucker`, `lipStretcherL/R`, `jawDrop`, `chinRaiser`) onto any custom sculpted head geometry.
- **Ken Perlin Responsive Face Behavioral Engine**:
  - `Perlin1D` (`src/noise/perlin1d.ts`): Coherent 1D Perlin noise (`fbm`, `sampleVec2`, `sampleVec3`).
  - `ExpressionCompositor` (`src/compositor/expression.ts`): Saturating one-minus-product (`1 - Π(1 - w_i)`) muscle blender with antagonistic clamping.
  - `GazeController` (`src/controllers/gaze.ts`): Ballistic eye saccades, target tracking, and head-turn lag (`Vec2` / `Quat`).
  - `BlinkController` (`src/controllers/blink.ts`): Asymmetric fast-close / slow-open natural blinking with gaze-shift triggered blinks and eyelid-follow-gaze.
  - `ImpulseController` (`src/controllers/impulse.ts`): Directional combat pain flinches (`pain_left`, `pain_right`, `ouch`) and weapon pickup grins (`evil_grin`).
- **5-Tier Progressive Damage Atlas & RoostR Mesh Deformer (`src/deformer/facerMesh.ts`)**:
  - Evaluates sparse FACS morph deltas + 4x3 affine pivot matrices in `<0.1ms` per frame and syncs directly to `@1pizzateam/roostr` `Mesh` WebGL buffers.

## Commands

```bash
npm run build    # Compile TypeScript, bundle dist/facer.js & dist/facer.d.ts, and run Jest coverage suite
npm test         # Run Jest test suite
```
