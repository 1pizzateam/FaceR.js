# Custom heads

## From a Wavefront `.obj`

```ts
import { FaceR, parseObjToCartridge } from '@1pizzateam/facer';

const face = new FaceR(parseObjToCartridge(objText, 'My Head', 'my_head'));
```

The mesh is normalised into FaceR's head frame, given jaw and region weights and a hair cap, and auto-rigged with all 31 FACS muscles. Faces with
invalid vertex references are dropped; an `.obj` with no usable geometry throws.

## Saving and loading

```ts
import { serializeCartridge, hydrateCartridge } from '@1pizzateam/facer';

const json = serializeCartridge(face.cartridge);   // JSON-safe
face.loadCartridge(json);                          // or new FaceR(json)
```

`hydrateCartridge` validates untrusted input: malformed muscle data is discarded and the rig is recomputed. A cartridge stores parametric data
(proportions, sparse sculpt, muscles, emotions, personality, appearance) on top of one of the head assets, so an `.obj` cartridge does not
round-trip; keep the source mesh.

## Tuning a face

Edit `face.cartridge.proportions`, `appearance` or `sculptOffsets`, then call `face.rebuildRig()`. Switching archetype or haircut at runtime:
`face.setBaseHead(id)`, `face.setHairStyle(style)`.
