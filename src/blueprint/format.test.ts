import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import {
  BLUEPRINT_FORMAT,
  BLUEPRINT_CONTENT_FINGERPRINT,
  BLUEPRINT_VERSION,
  blueprintFromLayout,
  decodeBlueprint,
  encodeBlueprint,
  materializeBlueprint,
  type PortableBlueprint,
} from "./format";

const blueprint: PortableBlueprint = {
  kind: "pilot-plant",
  name: "Push line",
  ruleset: 1,
  content: BLUEPRINT_CONTENT_FINGERPRINT,
  layout: {
    width: 8,
    height: 4,
    tiles: [
      { x: 0, y: 1, kind: "source", dir: 0, period: 2 },
      { x: 3, y: 1, kind: "belt", dir: 0 },
      { x: 4, y: 1, kind: "sink" },
    ],
    machines: [
      {
        id: 7,
        typeId: "push",
        orientation: { rot: 1, flip: true },
        anchor: { x: 1, y: 1 },
        footRot: 0,
      },
    ],
  },
};

function rawDocument(value: unknown): string {
  return JSON.stringify({
    format: BLUEPRINT_FORMAT,
    version: BLUEPRINT_VERSION,
    checksum: `sha256:${"0".repeat(64)}`,
    blueprint: value,
  });
}

describe("blueprint format v1", () => {
  it("encodes a human-readable canonical document with a SHA-256 checksum", async () => {
    const encoded = await encodeBlueprint(blueprint);

    expect(encoded).toBe(`{
  "format": "hexapharma-blueprint",
  "version": 1,
  "checksum": "sha256:daa93e85b0931b34aca1edb3de58028db823101275d4f650209642578d8bc0d9",
  "blueprint": {
    "kind": "pilot-plant",
    "name": "Push line",
    "ruleset": 1,
    "content": "fnv1a32:ffbd4184",
    "layout": {
      "width": 8,
      "height": 4,
      "tiles": [
        {
          "x": 0,
          "y": 1,
          "kind": "source",
          "dir": 0,
          "period": 2
        },
        {
          "x": 3,
          "y": 1,
          "kind": "belt",
          "dir": 0
        },
        {
          "x": 4,
          "y": 1,
          "kind": "sink"
        }
      ],
      "machines": [
        {
          "id": 7,
          "typeId": "push",
          "orientation": {
            "rot": 1,
            "flip": true
          },
          "anchor": {
            "x": 1,
            "y": 1
          },
          "footRot": 0
        }
      ]
    }
  }
}
`);
    expect(encoded).not.toMatch(/"(?:seed|fog|cash|research|economy|cost|speed|shape|transform)"\s*:/);
  });

  it("is stable across encode/decode/encode and rejects checksum tampering", async () => {
    const encoded = await encodeBlueprint(blueprint);
    const decoded = await decodeBlueprint(encoded);

    expect(await encodeBlueprint(decoded)).toBe(encoded);
    await expect(decodeBlueprint(encoded.replace("Push line", "Pull line"))).rejects.toThrow(/checksum/i);
  });

  it("rejects a bad checksum before materializing or validating route topology", async () => {
    const invalidResearch = {
      ...blueprint,
      kind: "research-route",
      layout: {
        ...blueprint.layout,
        tiles: [],
        machines: [],
      },
    };

    await expect(decodeBlueprint(rawDocument(invalidResearch))).rejects.toThrow(/checksum mismatch/i);
  });

  it("round-trips canonical portable layouts property-wise", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant("pilot-plant" as const),
        fc.array(
          fc.record({ rot: fc.integer({ min: 0, max: 3 }), flip: fc.boolean() }),
          { maxLength: 6 },
        ),
        async (kind, orientations) => {
          const candidate: PortableBlueprint = {
            kind,
            name: `Line ${orientations.length}`,
            ruleset: 1,
            content: BLUEPRINT_CONTENT_FINGERPRINT,
            layout: {
              width: 24,
              height: 12,
              tiles: [],
              machines: orientations.map((orientation, index) => ({
                id: index,
                typeId: "push",
                orientation: {
                  rot: orientation.rot as 0 | 1 | 2 | 3,
                  flip: orientation.flip,
                },
                anchor: { x: 1 + index * 3, y: 2 },
                footRot: 0,
              })),
            },
          };

          expect(await decodeBlueprint(await encodeBlueprint(candidate))).toEqual(candidate);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("materializes only local catalog definitions and expands sparse tiles", () => {
    const layout = materializeBlueprint(blueprint);
    const catalog = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;

    expect(layout.tiles).toHaveLength(32);
    expect(layout.tiles[0]).toEqual({ kind: "empty" });
    expect(layout.tiles[8]).toEqual({ kind: "source", dir: 0, period: 2 });
    expect(layout.tiles[11]).toEqual({ kind: "belt", dir: 0 });
    expect(layout.machines[0]).toEqual({
      id: 7,
      def: {
        typeId: catalog.typeId,
        transform: catalog.transform,
        orientation: { rot: 1, flip: true },
        cost: catalog.cost,
        speed: catalog.speed,
      },
      anchor: { x: 1, y: 1 },
      footRot: 0,
      shape: DEFAULT_SHAPES.push,
    });
  });

  it("extracts a private-data-free portable blueprint from a FactoryLayout", async () => {
    const layout = materializeBlueprint(blueprint);
    const portable = blueprintFromLayout("research-route", "Reusable route", layout);
    const encoded = await encodeBlueprint(portable);

    expect(portable.layout.tiles).toHaveLength(3);
    expect(portable.layout.machines[0]).toEqual({
      id: 7,
      typeId: "push",
      orientation: { rot: 1, flip: true },
      anchor: { x: 1, y: 1 },
      footRot: 0,
    });
    expect(encoded).not.toMatch(/"(?:seed|fog|cash|research|economy|cost|speed|shape|transform)"\s*:/);
  });

  it.each([
    ["root", { extra: true }],
    ["blueprint", { ...blueprint, seed: 14 }],
    ["layout", { ...blueprint, layout: { ...blueprint.layout, fog: [] } }],
    [
      "tile",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          tiles: [{ x: 0, y: 0, kind: "sink", cash: 10 }],
        },
      },
    ],
    [
      "machine",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          machines: [{ ...blueprint.layout.machines[0], speed: 1 }],
        },
      },
    ],
    [
      "orientation",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          machines: [
            {
              ...blueprint.layout.machines[0],
              orientation: { rot: 1, flip: true, economy: 1 },
            },
          ],
        },
      },
    ],
  ])("strictly rejects unknown %s fields", async (scope, value) => {
    const source = scope === "root"
      ? JSON.stringify({
          format: BLUEPRINT_FORMAT,
          version: BLUEPRINT_VERSION,
          checksum: `sha256:${"0".repeat(64)}`,
          blueprint,
          ...(value as object),
        })
      : rawDocument(value);
    await expect(decodeBlueprint(source)).rejects.toThrow(/unknown field/i);
  });

  it.each([
    ["unsupported format", { format: "other" }],
    ["unsupported version", { version: 2 }],
    ["invalid checksum", { checksum: "fnv:1234" }],
  ])("rejects %s", async (_label, replacement) => {
    const source = JSON.stringify({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      checksum: `sha256:${"0".repeat(64)}`,
      blueprint,
      ...replacement,
    });
    await expect(decodeBlueprint(source)).rejects.toThrow(/format|version|checksum/i);
  });

  it.each([
    ["kind", { ...blueprint, kind: "production" }],
    ["ruleset", { ...blueprint, ruleset: 2 }],
    ["dimension", { ...blueprint, layout: { ...blueprint.layout, width: 257 } }],
    [
      "duplicate tile",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          tiles: [blueprint.layout.tiles[0], blueprint.layout.tiles[0]],
        },
      },
    ],
    [
      "duplicate machine id",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          machines: [blueprint.layout.machines[0], blueprint.layout.machines[0]],
        },
      },
    ],
    [
      "unknown machine type",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          machines: [{ ...blueprint.layout.machines[0], typeId: "hacked" }],
        },
      },
    ],
    [
      "out-of-bounds tile",
      {
        ...blueprint,
        layout: {
          ...blueprint.layout,
          tiles: [{ x: 8, y: 0, kind: "sink" }],
        },
      },
    ],
  ])("rejects invalid %s", async (_label, value) => {
    await expect(decodeBlueprint(rawDocument(value))).rejects.toThrow();
  });

  it("rejects non-canonical machine semantics and invalid physical layouts", async () => {
    await expect(decodeBlueprint(rawDocument({
      ...blueprint,
      layout: {
        ...blueprint.layout,
        machines: [{
          ...blueprint.layout.machines[0],
          typeId: "dilute",
          orientation: { rot: 1, flip: false },
        }],
      },
    }))).rejects.toThrow(/orientation/i);

    expect(() => materializeBlueprint({
      ...blueprint,
      layout: {
        ...blueprint.layout,
        machines: [
          blueprint.layout.machines[0]!,
          { ...blueprint.layout.machines[0]!, id: 8 },
        ],
      },
    })).toThrow(/overlap/i);
  });

  it("refuses oversized source text before parsing", async () => {
    await expect(decodeBlueprint(" ".repeat(1_048_577))).rejects.toThrow(/size|bytes/i);
  });

  it("rejects layouts whose machine footprint covers a sparse tile", () => {
    expect(() => materializeBlueprint({
      ...blueprint,
      layout: {
        ...blueprint.layout,
        tiles: [{ x: 1, y: 1, kind: "belt", dir: 0 }],
      },
    })).toThrow(/machine.*tile|tile.*machine/i);
  });

  it("rejects a Research blueprint unless it is a unique connected linear route", async () => {
    const invalid: PortableBlueprint = {
      kind: "research-route",
      name: "Disconnected research",
      ruleset: 1,
      content: BLUEPRINT_CONTENT_FINGERPRINT,
      layout: {
        width: 8,
        height: 4,
        tiles: [],
        machines: [],
      },
    };

    await expect(encodeBlueprint(invalid)).rejects.toThrow(/Research route|source|sink|linear/i);
  });

  it("rejects a blueprint whose machine-content fingerprint is from another build", async () => {
    await expect(encodeBlueprint({
      ...blueprint,
      content: "fnv1a32:00000000",
    })).rejects.toThrow(/content|fingerprint/i);
  });

  it("canonicalizes array order without altering semantic content", async () => {
    const reordered: PortableBlueprint = {
      ...blueprint,
      layout: {
        ...blueprint.layout,
        tiles: [...blueprint.layout.tiles].reverse(),
      },
    };

    expect(await encodeBlueprint(reordered)).toBe(await encodeBlueprint(blueprint));
  });
});
