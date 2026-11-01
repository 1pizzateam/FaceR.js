# FaceR.js (`@1pizzateam/facer`)

**FaceR.js** is the 1PizzaTeam real-time anatomical facial animation and Ken Perlin behavioral engine library, built 100% vector-first on `@1pizzateam/spock` and `@1pizzateam/roostr`.

## Key Features

- **100% Vector-First (`@1pizzateam/spock`)**:
  - `Vec3` for all 3D positions, sculpt offsets, FACS muscle deltas, surface normals, anatomical pivots (`neck`, `jaw`, `eyeLeft`, `eyeRight`), Euler angles, and normalized RGB colors.
  - `Vec2` for 2D gaze angles `(yaw, pitch)`, UV coordinates, and stochastic timing intervals `[min, max]`.
  - `Quat`, `Mat3`, `Mat4`, and `Mat4x3` for affine neck, jaw, and eyeball pivot transformations.
  - `Ray2`, `Ray3`, `Plane`, `Frustum`, `Sphere`, `Box`, `Utils`, `Trigo`, `Bezier`, `Rand`, `Time`, and `Accumulator` for deterministic procedural geometry, raycasting, and smoothstep damping.
- **High-Polygon Anatomical Base Head (`src/anatomy/baseHead.ts`)**:
  - Generates a symmetrical `3,333`-vertex, `6,216`-triangle head mesh (`createBaseHeadTopology`, `getCanonicalBaseHead`, `computeSmoothNormals`) with `6` anatomical submeshes (`FACE_REGIONS`, `FACE_REGION_IDS`: `skin`, `eye_left`, `eye_right`, `upper_teeth`, `lower_teeth`, `inner_mouth`).
- **Automatic FACS Rig Transfer (`src/anatomy/muscleTransfer.ts`)**:
  - Applies macro skull/face proportions (`applyMacroProportions`) and projects 26 FACS Action Unit muscle zones (`computeFacsMuscles`, `FACS_MUSCLE_NAMES`) onto any custom sculpted head geometry.
- **Cartridge Schema & `.facer` Serialization (`src/schema.ts`)**:
  - Factory helpers and round-trip JSON hydration (`createDefaultProportions`, `createDefaultEmotions`, `createDefaultPersonality`, `createDefaultAppearance`, `createDefaultCartridge`, `rebuildCartridgeRig`, `serializeCartridge`, `hydrateCartridge`).
- **Ken Perlin Responsive Face Behavioral Engine (`FaceR`)**:
  - `FaceR` (`src/facer.ts`): High-level runtime controller combining layered emotions, autonomous eye/neck gaze, blinking, combat impulses, progressive damage tiers, and WebGL mesh sync.
  - `Perlin1D` (`src/noise/perlin1d.ts`): Coherent 1D Perlin noise (`fbm`, `sampleVec2`, `sampleVec3`).
  - `ExpressionCompositor` (`src/compositor/expression.ts`): Saturating one-minus-product (`1 - Π(1 - w_i)`) muscle blender with antagonistic clamping.
  - `GazeController` (`src/controllers/gaze.ts`): Ballistic eye saccades, target tracking, and head-turn lag (`Vec2` / `Quat`).
  - `BlinkController` (`src/controllers/blink.ts`): Asymmetric fast-close / slow-open natural blinking with gaze-shift triggered blinks and eyelid-follow-gaze.
  - `ImpulseController` (`src/controllers/impulse.ts`): Directional combat pain flinches (`pain`, `shoot`, `surprise`, `glance`, `evilGrin`).
- **5-Tier Progressive Damage Atlas & RoostR Mesh Deformer (`src/deformer/facerMesh.ts`)**:
  - Evaluates sparse FACS morph deltas + quaternion pivot rotations (`rotateVec3ByQuat`, `evaluateFaceDeformation`), generates procedural 5-tier damage textures (`generateFaceAtlasPixels`), and syncs directly to `@1pizzateam/roostr` `Mesh` WebGL buffers (`createRoostrFaceMesh`, `syncRoostrMeshBuffers`).

## Commands

```bash
npm run build    # Compile TypeScript, bundle dist/facer.js & dist/facer.d.ts, and run Jest coverage suite
npm test         # Run Jest test suite
```
