# Third-party notices

FaceR.js is MIT licensed (see `LICENSE`). It does not contain any geometry. The head assets that apps load (kept in the apps, for example DoomR's `src/heads`) are derived from the following third-party assets, and the apps that ship them must keep this attribution.

## European scan head (`european_scan` base head)

Derived from the **Lee Perry-Smith "Infinite" head scan**, © Infinite-Realities
(<https://triplegangers.com>, <http://www.ir-ltd.net>), licensed under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

Changes: decimated, warped into FaceR's canonical head frame, eye openings cut over each eye, and
re-encoded as vertex arrays (see `scripts/build-european-scan.mjs`).

Anyone redistributing an application that ships this base head must keep this attribution.

## Sculpted head (`african_sculpt` and the archetypes derived from it)

Derived from the ZBrush head sculpt **`african_head.obj` by Vidar Rapp**, as distributed with the
[tinyrenderer](https://github.com/ssloy/tinyrenderer) tutorial. The mesh was symmetrized across X=0 and
re-topologized with lip-separation seams. The `boggie_sculpt`, `walt_classic`, `east_asian`,
`nordic_angular` and `gracile_feminine` archetypes are procedural variations of this geometry.
