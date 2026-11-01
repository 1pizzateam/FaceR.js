Version 0.1.0 (November 1st 2026)
-----------------------------
 * Initial release of `@1pizzateam/facer` (`FaceR.js`):
    * High-polygon anatomical base head topology (`createBaseHeadTopology`, `getCanonicalBaseHead`, `computeSmoothNormals`) with `3,333` vertices, `6,216` triangles, and `6` anatomical submeshes (`FACE_REGIONS`, `FACE_REGION_IDS`).
    * Automatic FACS Action Unit rig transfer (`applyMacroProportions`, `computeFacsMuscles`, `FACS_MUSCLE_NAMES`) projecting `26` anatomical muscle zones onto custom sculpted head geometry.
    * Cartridge schema, defaults, and `.facer` serialization (`createDefaultProportions`, `createDefaultEmotions`, `createDefaultPersonality`, `createDefaultAppearance`, `createDefaultCartridge`, `rebuildCartridgeRig`, `serializeCartridge`, `hydrateCartridge`).
    * Ken Perlin Responsive Face behavioral engine (`FaceR`, `Perlin1D`, `ExpressionCompositor`, `GazeController`, `BlinkController`, `ImpulseController`) with saturating muscle blending, ballistic eye saccades, coupled head/neck follow-through, stochastic blinking, and directional combat impulses.
    * Sparse CPU morph deformer, 5-tier progressive damage texture atlas generator, and `@1pizzateam/roostr` WebGL mesh integration (`rotateVec3ByQuat`, `evaluateFaceDeformation`, `generateFaceAtlasPixels`, `createRoostrFaceMesh`, `syncRoostrMeshBuffers`).
