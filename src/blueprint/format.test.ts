import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_TEMPLATE_STEPS,
  type FactoryLayout,
  type FactoryTile,
  type MachineCatalogEntry,
  type Template,
} from "../sim/phase0_interfaces";
import {
  BLUEPRINT_CONTENT_FINGERPRINT,
  BLUEPRINT_FORMAT,
  BLUEPRINT_RULESET,
  BLUEPRINT_VERSION,
  blueprintFromFactoryLayout,
  blueprintFromProgram,
  decodeBlueprint,
  encodeBlueprint,
  materializeFactoryLayout,
  materializeResearchProgram,
  type PortableBlueprint,
  type PortableFactoryBlueprint,
  type PortableResearchBlueprint,
} from "./format";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  }
});

function catalog(typeId: string): MachineCatalogEntry {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`missing test catalog entry ${typeId}`);
  return entry;
}

function machine(typeId: string) {
  const entry = catalog(typeId);
  return { typeId, path: entry.path.map((delta) => ({ ...delta })) };
}

const program: Template = {
  steps: [machine("push"), machine("pull")],
};

function emptyTiles(width: number, height: number): FactoryTile[] {
  return Array.from({ length: width * height }, () => ({ kind: "empty" }));
}

function factoryLayout(): FactoryLayout {
  const width = 8;
  const height = 4;
  const tiles = emptyTiles(width, height);
  tiles[8] = { kind: "source", dir: 0, period: 2 };
  tiles[11] = { kind: "belt", dir: 0 };
  tiles[12] = { kind: "sink" };
  const entry = catalog("push");
  return {
    width,
    height,
    tiles,
    machines: [{
      id: 7,
      def: {
        typeId: entry.typeId,
        path: entry.path,
        cost: entry.cost,
        speed: entry.speed,
      },
      anchor: { x: 1, y: 1 },
      footRot: 0,
      shape: DEFAULT_SHAPES.push!,
    }],
  };
}

function researchBlueprint(): PortableResearchBlueprint {
  return blueprintFromProgram("Atlas route", program);
}

function factoryBlueprint(): PortableFactoryBlueprint {
  return blueprintFromFactoryLayout("Factory line", factoryLayout());
}

function unsignedDocument(blueprint: unknown, version: unknown = BLUEPRINT_VERSION): string {
  return JSON.stringify({
    format: BLUEPRINT_FORMAT,
    version,
    checksum: `sha256:${"0".repeat(64)}`,
    blueprint,
  });
}

describe("blueprint format v3", () => {
  it("freezes the breaking wire and ruleset at v3", () => {
    expect(BLUEPRINT_VERSION).toBe(3);
    expect(BLUEPRINT_RULESET).toBe(3);
  });

  it("encodes a strict human-readable ResearchProgram without paths or private world state", async () => {
    const encoded = await encodeBlueprint(researchBlueprint());
    const document = JSON.parse(encoded) as Record<string, unknown>;

    expect(document).toMatchObject({
      format: "hexapharma-blueprint",
      version: 3,
      checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      blueprint: {
        kind: "research-program",
        name: "Atlas route",
        ruleset: 3,
        content: BLUEPRINT_CONTENT_FINGERPRINT,
        program: {
          steps: [
            { typeId: "push" },
            { typeId: "pull" },
          ],
        },
      },
    });
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded).not.toMatch(/"(?:path|stroke|layout|seed|fog|outcome|cash|economy|cost|speed|shape)"\s*:/u);
  });

  it("encodes a strict Factory layout with routing and no chemical orientation or path duplication", async () => {
    const portable = factoryBlueprint();
    const encoded = await encodeBlueprint(portable);

    expect(portable.layout.machines).toEqual([{
      id: 7,
      typeId: "push",
      anchor: { x: 1, y: 1 },
      footRot: 0,
    }]);
    expect(encoded).not.toMatch(/"(?:orientation|path|stroke|seed|fog|outcome|cost|speed|shape)"\s*:/u);
    expect(encoded).toContain('"kind": "factory-layout"');
    expect(encoded).toContain('"kind": "source"');
  });

  it("round-trips both kinds canonically and detects checksum tampering", async () => {
    for (const blueprint of [researchBlueprint(), factoryBlueprint()]) {
      const encoded = await encodeBlueprint(blueprint);
      const decoded = await decodeBlueprint(encoded);
      expect(await encodeBlueprint(decoded)).toBe(encoded);
      await expect(decodeBlueprint(encoded.replace(blueprint.name, `${blueprint.name}!`)))
        .rejects.toThrow(/checksum mismatch/i);
    }
  });

  it("materializes a Research Template by resolving fixed paths from the local catalog", () => {
    const materialized = materializeResearchProgram(researchBlueprint());

    expect(materialized).toEqual(program);
    expect(materialized.steps[0]!.path).not.toBe(catalog("push").path);
  });

  it("materializes a location-neutral FactoryLayout from local catalog and shape authority", () => {
    const layout = materializeFactoryLayout(factoryBlueprint());
    const entry = catalog("push");

    expect(layout.tiles).toHaveLength(32);
    expect(layout.tiles[0]).toEqual({ kind: "empty" });
    expect(layout.tiles[8]).toEqual({ kind: "source", dir: 0, period: 2 });
    expect(layout.machines[0]).toEqual({
      id: 7,
      def: {
        typeId: "push",
        path: entry.path.map((delta) => ({ ...delta })),
        cost: entry.cost,
        speed: entry.speed,
      },
      anchor: { x: 1, y: 1 },
      footRot: 0,
      shape: DEFAULT_SHAPES.push,
    });
  });

  it.each([1, 2])("rejects legacy v%s explicitly before interpreting its payload", async (version) => {
    await expect(decodeBlueprint(unsignedDocument({ kind: "research-route" }, version)))
      .rejects.toThrow(new RegExp(`legacy blueprint version ${version}|unsupported version ${version}`, "i"));
  });

  it("rejects unknown versions, malformed checksums, and wrong rulesets", async () => {
    await expect(decodeBlueprint(unsignedDocument(researchBlueprint(), 4)))
      .rejects.toThrow(/unsupported version 4/i);
    await expect(decodeBlueprint(JSON.stringify({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      checksum: "fnv:1234",
      blueprint: researchBlueprint(),
    }))).rejects.toThrow(/checksum/i);
    await expect(encodeBlueprint({
      ...researchBlueprint(),
      ruleset: 1,
    } as unknown as PortableBlueprint)).rejects.toThrow(/ruleset 1/i);
  });

  it.each([
    ["root field", () => decodeBlueprint(JSON.stringify({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      checksum: `sha256:${"0".repeat(64)}`,
      blueprint: researchBlueprint(),
      extra: true,
    }))],
    ["Research field", () => encodeBlueprint({ ...researchBlueprint(), seed: 14 } as unknown as PortableBlueprint)],
    ["Research cross-kind layout", () => encodeBlueprint({
      ...researchBlueprint(),
      layout: factoryBlueprint().layout,
    } as unknown as PortableBlueprint)],
    ["Research path duplication", () => encodeBlueprint({
      ...researchBlueprint(),
      program: { steps: [{ typeId: "push", path: [{ x: 1, y: 0 }] }] },
    } as unknown as PortableBlueprint)],
    ["Factory cross-kind program", () => encodeBlueprint({
      ...factoryBlueprint(),
      program: researchBlueprint().program,
    } as unknown as PortableBlueprint)],
    ["Factory chemical orientation", () => encodeBlueprint({
      ...factoryBlueprint(),
      layout: {
        ...factoryBlueprint().layout,
        machines: [{ ...factoryBlueprint().layout.machines[0]!, orientation: { rot: 1, flip: true } }],
      },
    } as unknown as PortableBlueprint)],
    ["missing Research payload", () => {
      const { program: _program, ...missing } = researchBlueprint();
      return encodeBlueprint(missing as unknown as PortableBlueprint);
    }],
    ["missing Factory machine type", () => {
      const { typeId: _typeId, ...machineWithoutType } = factoryBlueprint().layout.machines[0]!;
      return encodeBlueprint({
        ...factoryBlueprint(),
        layout: { ...factoryBlueprint().layout, machines: [machineWithoutType] },
      } as unknown as PortableBlueprint);
    }],
  ])("strictly rejects unknown, missing, and cross-kind %s", async (_label, operation) => {
    await expect(operation()).rejects.toThrow(/unknown field|missing field|fields/i);
  });

  it("rejects bad content fingerprints and obsolete prefix calibration fields", async () => {
    await expect(encodeBlueprint({
      ...researchBlueprint(),
      content: "fnv1a32:00000000",
    })).rejects.toThrow(/content|fingerprint/i);

    await expect(encodeBlueprint({
      ...researchBlueprint(),
      program: { steps: [{ typeId: "push", stroke: 1 }] },
    } as unknown as PortableResearchBlueprint)).rejects.toThrow(/unknown field.*stroke/i);
    await expect(encodeBlueprint({
      ...factoryBlueprint(),
      layout: {
        ...factoryBlueprint().layout,
        machines: [{ ...factoryBlueprint().layout.machines[0]!, stroke: 1 }],
      },
    } as unknown as PortableFactoryBlueprint)).rejects.toThrow(/unknown field.*stroke/i);
  });

  it("rejects unknown local machine types in both payload kinds", async () => {
    await expect(encodeBlueprint({
      ...researchBlueprint(),
      program: { steps: [{ typeId: "hacked" }] },
    })).rejects.toThrow(/unknown machine type/i);
    await expect(encodeBlueprint({
      ...factoryBlueprint(),
      layout: {
        ...factoryBlueprint().layout,
        machines: [{ ...factoryBlueprint().layout.machines[0]!, typeId: "hacked" }],
      },
    })).rejects.toThrow(/unknown machine type/i);
  });

  it("rejects unknown machine types and source authorities that disagree with the catalog", () => {
    expect(() => blueprintFromProgram("Forged", {
      steps: [{ typeId: "push", path: [{ x: -1, y: 0 }] }],
    })).toThrow(/path|catalog/i);

    const layout = factoryLayout();
    expect(() => blueprintFromFactoryLayout("Forged", {
      ...layout,
      machines: [{
        ...layout.machines[0]!,
        def: { ...layout.machines[0]!.def, cost: layout.machines[0]!.def.cost + 1 },
      }],
    })).toThrow(/catalog|cost/i);

    expect(() => blueprintFromFactoryLayout("Forged", {
      ...layout,
      machines: [{ ...layout.machines[0]!, shape: DEFAULT_SHAPES.pull! }],
    })).toThrow(/catalog|shape/i);
  });

  it("rejects duplicates, collisions, out-of-bounds geometry, and caps", async () => {
    const pilot = factoryBlueprint();
    await expect(encodeBlueprint({
      ...pilot,
      layout: { ...pilot.layout, tiles: [pilot.layout.tiles[0]!, pilot.layout.tiles[0]!] },
    })).rejects.toThrow(/duplicate tile/i);
    await expect(encodeBlueprint({
      ...pilot,
      layout: { ...pilot.layout, machines: [pilot.layout.machines[0]!, pilot.layout.machines[0]!] },
    })).rejects.toThrow(/duplicate machine id/i);
    await expect(encodeBlueprint({
      ...pilot,
      layout: {
        ...pilot.layout,
        machines: [pilot.layout.machines[0]!, { ...pilot.layout.machines[0]!, id: 8 }],
      },
    })).rejects.toThrow(/overlap/i);
    await expect(encodeBlueprint({
      ...pilot,
      layout: { ...pilot.layout, tiles: [{ x: 1, y: 1, kind: "belt", dir: 0 }] },
    })).rejects.toThrow(/overlap/i);
    await expect(encodeBlueprint({
      ...pilot,
      layout: {
        ...pilot.layout,
        machines: [{ ...pilot.layout.machines[0]!, anchor: { x: 7, y: 3 } }],
      },
    })).rejects.toThrow(/out of bounds/i);
    await expect(encodeBlueprint({
      ...pilot,
      layout: { ...pilot.layout, width: 257 },
    })).rejects.toThrow(/dimension|integer|cells/i);
    await expect(encodeBlueprint({
      ...researchBlueprint(),
      program: {
        steps: Array.from({ length: MAX_TEMPLATE_STEPS + 1 }, () => ({ typeId: "push" })),
      },
    })).rejects.toThrow(/steps|at most|bounded/i);
  });

  it("canonicalizes only unordered sparse layout collections and preserves program order", async () => {
    const original = factoryBlueprint();
    const withSecondTile: PortableFactoryBlueprint = {
      ...original,
      layout: {
        ...original.layout,
        tiles: [...original.layout.tiles, { x: 7, y: 0, kind: "sink" }],
      },
    };
    const reordered: PortableFactoryBlueprint = {
      ...withSecondTile,
      layout: { ...withSecondTile.layout, tiles: [...withSecondTile.layout.tiles].reverse() },
    };
    expect(await encodeBlueprint(reordered)).toBe(await encodeBlueprint(withSecondTile));

    const reversedProgram: PortableResearchBlueprint = {
      ...researchBlueprint(),
      program: { steps: [...researchBlueprint().program.steps].reverse() },
    };
    expect(await encodeBlueprint(reversedProgram)).not.toBe(await encodeBlueprint(researchBlueprint()));
  });

  it("rejects cross-kind materialization", () => {
    expect(() => materializeResearchProgram(factoryBlueprint())).toThrow(/Factory.*ResearchProgram/i);
    expect(() => materializeFactoryLayout(researchBlueprint())).toThrow(/Research.*Factory/i);
  });

  it("refuses oversized source text before parsing", async () => {
    await expect(decodeBlueprint(" ".repeat(1_048_577))).rejects.toThrow(/size|bytes/i);
  });
});
