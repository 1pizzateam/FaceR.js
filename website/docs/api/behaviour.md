# Behaviour

The pieces `FaceR` composes. Each can be used on its own.

## ExpressionCompositor

Blends emotion layers, impulse muscles, blinks and overrides into 31 muscle weights using the saturating product `1 - Π(1 - wᵢ)`, with
antagonist clamping (blink vs wide, smile vs frown, brow down vs up) and Perlin left/right micro-asymmetry.

```ts
new ExpressionCompositor(emotions, seed?)
setEmotion(name, weight, immediate?) · setExclusiveEmotion(name, weight?, immediate?)
setMuscleOverride(muscle, weight | null) · clearMuscleOverrides()
update(dt, personality, impulseMuscles?, impulseHeadEuler?, blinkLeft?, blinkRight?, eyelidPitchFollow?)
```

Read `currentMuscles` and `currentHeadEuler` after `update`.

## GazeController

Step-and-hold saccades from Perlin noise, an explicit target, impulse glance offsets, and a head that follows part of the gaze.

```ts
setGazeAngles(angles: Vec2) · lookAt(target: Vec3, headOrigin?: Vec3)
update(dt, personality, extraHeadEuler?, impulseGazeOffset?)
```

Outputs `neckQuat`, `eyeLeftQuat`, `eyeRightQuat`, `currentEyeAngles`, `lastGazeShiftMagnitude`.

## BlinkController

Asymmetric blinks (fast close, slow open) on a stochastic timer, reflex blinks on large gaze shifts, and eyelid follow of eye pitch.

```ts
triggerBlink(duration?) · update(dt, personality, eyePitchRadians?, gazeShiftMagnitude?)
```

Outputs `blinkLeft`, `blinkRight`, `eyelidPitchFollow`.

## ImpulseController

Transient reactions: `pain`, `shoot`, `surprise`, `glance`, `evilGrin`, plus a held shooting snarl.

```ts
triggerImpulse(type, intensity?, direction?, duration?) · setShooting(on) · isShooting() · update(dt)
```

Outputs `outputMuscles`, `outputHeadEuler`, `outputGazeOffset`. Up to 32 impulses are active at once.

## Perlin1D

Seeded 1D gradient noise: `sample(x, channel?)`, `fbm(x, octaves?, channel?)`, `sampleVec2(...)`, `sampleVec3(...)`, `reseed(seed)`.

## Personality

`IPersonalityProfile` tunes all of the above: `blinkIntervalRange`, `blinkDuration`, `saccadeFrequency`, `saccadeAmplitude`, `headFollowRatio`,
`headDamping`, `eyeDamping`, `asymmetryAmount`, `microJitterAmount`. Edit `face.cartridge.personality` live.
