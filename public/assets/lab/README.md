# HexaPharma Microscope Lab Art

This directory contains the first original production asset set for the Lab's
**microscopic biochemical atlas**. It deliberately avoids parchment, medieval
alchemy, Potion Craft imagery, and the visual trade dress of any reference
game.

## Visual language

- Deep teal cellular substrate provides scale beneath the runtime's always-visible grid.
- Solid high-contrast masonry plus protein-crystal detail communicates impassable walls.
- Abyss, swamp, and paired directional portals are drawn by deterministic runtime geometry,
  so their void rim, viscous drag marks, and portal destination markers remain unmistakable
  at every zoom without relying on interchangeable bitmap decoration.
- Violet colonies communicate side effects.
- Gold/cyan receptors communicate therapeutic destinations.
- The capsule and cyan halo keep the player's current position legible; the runtime draws route history separately.
- Defocused navy particulate fog marks unsurveyed space without erasing structural terrain.

`manifest.json` is the runtime integration contract. Texture URLs are resolved
from `/assets/lab/`. The substrate and fog repeat exactly at their outer pixel
edges. All five sprite overlays are normalized to transparent 512×512 PNGs.

The substrate, grid, wall, abyss, swamp, and both endpoints of a portal pair are
always visible. Fog is drawn as a survey boundary below those structural motifs.
Undiscovered side-effect and cure cells use the same render plan as empty substrate;
their motif and sprite are not drawn until the discovery mask is set.

## Source and rights

These images were generated specifically for HexaPharma with OpenAI's built-in
image generation tool, then locally cropped, keyed, normalized, and made
seamless. No third-party or competitor image was used as an input or copied
into this repository. The generated files are distributed under the repository
`LICENSE`.

Prompt direction: an original top-down scientific-microscope strategy-game
atlas with cultured-cell substrate, biochemical obstacles and nodes, a dark
teal/cyan/amber/violet palette, no text or UI, and explicit exclusion of
parchment, alchemy imagery, Potion Craft resemblance, and competitor trade
dress. Transparent sprites were generated on a flat magenta chroma key and
processed locally; the texture sources were generated as edge-to-edge squares.
