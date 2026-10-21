# Map prototype (dev-only)

Hand-authored v5/v6 Atlas used to agree the v2 map direction with the user (2026-10-21). Not imported by the game; it is the reference for rewriting `src/sim/mapgen`.

```bash
node tools/map-prototype/render.mjs [outDir]   # full.png + fog.png (default outDir: map-prototype-out/)
node tools/map-prototype/solve.mjs             # narrow-pass solvability (BFS over machine stamps, ≤10 steps)
```

- `map.mjs`: relief (inner ring range, outer arcs, basins, lakes, edge rim), winding passes (noisy shortest path through a sideways waypoint, wide ends + long 1-cell core), sealed-pocket cleanup, tiered effect regions, void filling, failure (black) cells kept connected.
- `render.mjs`: draws the full reveal and the fog view; fog contours are the sign-free compressed relief plus low decoys, in one ink.
- `solve.mjs`: checks every narrow core with swamp half steps, once ignoring heading and once under the tentative heading-relative rules; the search state is (cell, half-step offset, heading). Only the pass corridor plus a 2-cell pocket at each end is walkable, so a solution must thread the core rather than bypass it.

It uses `Math.sin`/`Math.exp` for speed of iteration. The production generator must use integer hashing and polynomial noise so a seed reproduces bit-identically on every platform.
