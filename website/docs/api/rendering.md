# Rendering

## Deformer

```ts
evaluateFaceDeformation(cartridge, pose, outPositions, outNormals): void
invalidateDeformCache(cartridge): void
rotateVec3ByQuat(v: Vec3, q: Quat): Vec3
```

Applies, in order: sparse FACS morphs, damage swelling for `pose.damageTier`, then eye, jaw and neck rotations about their pivots using Spock's
`Mat4x3.transformPoints` / `transformDirections`. Per-rig lookup tables are cached on the cartridge, so a frame allocates nothing. Call
`invalidateDeformCache` if you edit the rest pose by hand; `rebuildCartridgeRig` does it for you.

## Texture atlas

```ts
registerAtlasPainter(painter | null)                                // the game's painter: (appearance, damageTier, size) => Uint8Array
generateFaceAtlasPixels(appearance, damageTier?, size?): Uint8Array   // RGBA, size * size * 4
// with no painter registered the atlas is a flat appearance.skinColor
```

FaceR draws no skin itself: the game provides the painter (skin, eyes, teeth, brows, hair, wounds per damage tier; it knows the heads' UV layout) and registers it once. `appearance.customTierOverrides` is for the painter to apply over a tier.

## RoostR integration

```ts
createRoostrFaceMesh(gl, cartridge, damageTier?, atlasSize?): { customMesh, mesh, atlasPixels }
syncRoostrMeshBuffers(mesh, positions, normals): void
```

`FaceR` calls both for you when it has a `gl`. Use them directly to manage your own mesh. The head is about 20 units tall and faces `+z`.
