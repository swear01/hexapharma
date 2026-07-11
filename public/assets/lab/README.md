# HexaPharma Microscope Lab Art

This directory contains the first original production asset set for the Lab's
**microscopic biochemical atlas**. It deliberately avoids parchment, medieval
alchemy, Potion Craft imagery, and the visual trade dress of any reference
game.

## Visual language

- Deep teal cellular substrate provides scale without exposing a visible tile grid.
- Cyan protein crystals communicate impassable walls.
- Amber-red enzymes communicate corrosive hazards.
- Violet colonies communicate side effects.
- Gold/cyan receptors communicate therapeutic destinations.
- The capsule and cyan halo keep the player's current position legible; the runtime draws route history separately.
- Defocused navy particulate fog hides unrevealed terrain rather than merely tinting it.

`manifest.json` is the runtime integration contract. Texture URLs are resolved
from `/assets/lab/`. The substrate and fog repeat exactly at their outer pixel
edges. All six world sprites are normalized to transparent 512×512 PNGs.

The substrate must only be drawn for revealed terrain. Unrevealed terrain must
be covered by an opaque fog or solid mask before any wall, hazard, side-effect,
or cure sprite is rendered; otherwise the artwork would leak map information.

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
