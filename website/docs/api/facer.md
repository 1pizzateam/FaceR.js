# FaceR

High-level runtime controller. Owns a cartridge, the compositor and controllers, the deformed buffers and, optionally, a RoostR mesh.

```ts
new FaceR(cartridge?: IFaceCartridge | Record<string, unknown>, options?: IFaceROptions)
```

`options`: `seed` (1337), `gl`, `atlasSize` (256, clamped to 16–4096), `autonomous` (true). Without a cartridge it builds the default head; a plain
object is passed through `hydrateCartridge`.

## Properties

| Name | Type | Notes |
| --- | --- | --- |
| `cartridge` | `IFaceCartridge` | The loaded face data. |
| `compositor`, `gaze`, `blink`, `impulse` | controllers | See [Behaviour](./behaviour). |
| `deformedPositions`, `deformedNormals` | `Float32Array` | Updated by `update()`. |
| `pose` | `IFacePoseState` | Muscle weights, pivot quaternions, damage tier. |
| `mesh`, `customMesh` | `Mesh \| null` | Set when a `gl` is bound. |
| `autonomous` | `boolean` | Toggle saccades, blinking and wounds. |

## Methods

All setters return `this`.

### Frame

- **`update(dt)`**: advance by `dt` seconds (clamped to 0.25 s; NaN or negative is treated as 0) and refresh the buffers and bound mesh. Returns the pose.

### Expression

- **`setEmotion(name, weight, immediate?)`**: target weight `0..1` of an emotion layer. The layers come from the registered face profile (only `neutral` exists without one).
- **`setExclusiveEmotion(name, weight?, immediate?)`**: activate one, fade the rest.
- **`setMuscle(muscle, weight | null)`**: override one FACS muscle; `null` releases it.
- **`clearMuscleOverrides()`**

### Gaze and reactions

- **`setGazeAngles(angles: Vec2)`**: yaw/pitch in radians.
- **`lookAt(target: Vec3, headOrigin?: Vec3)`**
- **`triggerBlink(duration?)`**
- **`triggerImpulse(type, intensity?, direction?, duration?)`**: `'pain' | 'shoot' | 'surprise' | 'glance' | 'evilGrin'`.
- **`setShooting(on)`**: hold the shooting snarl while a weapon keeps firing.

### Health and damage

- **`setHealth(percent)`** / **`getHealth()`**: `0..100` drives the damage tier (below 95, 80, 60 and 40 percent); `0` plays `dead`.
- **`setDamageTier(0..4)`**

### Heads and data

- **`setBaseHead(id)`**: switch to a head registered with `loadBaseHead` / `registerBaseHead` , keeping proportions and colours.
- **`setHairStyle(style)`**
- **`loadCartridge(cartridgeOrJson)`**
- **`rebuildRig(recomputeMuscles?)`**: after editing proportions, hair or sculpt offsets.
- **`bindWebGL(gl)`** returns the RoostR `Mesh`; **`refreshAtlasTexture()`** returns the RGBA atlas pixels.
