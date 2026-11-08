# Cartridge

An `IFaceCartridge` is all the data for one face.

| Field | Meaning |
| --- | --- |
| `proportions` | Nine `Vec3` macro sliders (cranium, jaw, chin, cheekbones, brow, eye sockets, nose, mouth, ears). |
| `sculptOffsets` | Per-vertex freeform offsets (`Float32Array`). |
| `positions`, `normals`, `uvs`, `indices` | Rest-pose mesh buffers. |
| `submeshes`, `vertexRegionMap`, `jawWeights` | Regions (skin, eyes, teeth, inner mouth) and jaw blend weights. |
| `pivots` | `neck`, `jaw`, `eyeLeft`, `eyeRight` as `Vec3`. |
| `muscles` | 31 sparse morph targets: `indices`, `dPos`, `dNorm` per muscle. |
| `emotions` | Named layers of muscle weights plus a head-Euler offset. |
| `personality` | Blink and saccade timing, head follow and damping, asymmetry, jitter. |
| `appearance` | Base head, colours, hair style, damage seed. |

## Functions

```ts
createDefaultCartridge(name?, id?): IFaceCartridge
createDefaultProportions() / createDefaultEmotions() / createDefaultPersonality() / createDefaultAppearance()
rebuildCartridgeRig(cartridge, recomputeMuscles?): IFaceCartridge
serializeCartridge(cartridge): Record<string, unknown>
hydrateCartridge(raw: unknown): IFaceCartridge
parseObjToCartridge(objText, name?, id?): IFaceCartridge
parseObjToTopology(objText): IBaseHeadGeometry
```

- `serializeCartridge` produces JSON-safe, rounded data (`.facer`).
- `hydrateCartridge` accepts partial or untrusted input, fills defaults, and recomputes muscles that fail validation.
- `parseObjToCartridge` auto-rigs a mesh; it throws if the `.obj` has no usable geometry.
- `rebuildCartridgeRig` also drops the deformer's cached tables; call it (or `invalidateDeformCache`) after editing the rest pose.

## Rig building blocks

`registerFaceProfile(profile)`, `loadFaceProfile(url)`, `deserializeFaceProfile(json)`, `getCanonicalBaseHead(id)`, `loadBaseHead(id, url)`, `registerBaseHead(id, geometry)`, `deserializeBaseHead(json)`, `hasBaseHead(id)`, `computeSmoothNormals()`, `applyHaircutStyleToPositions()`, `applyMacroProportions()`,
`computeFacsMuscles()`, `createDefaultCartridge(name, id, headId)` needs its head loaded first.
