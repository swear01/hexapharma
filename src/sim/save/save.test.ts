import { describe, it, expect } from "vitest";
import type { GameState, GenOptions, FactoryLayout } from "../phase0_interfaces";
import { DEFAULT_CATALOG, IDENTITY, SHAPE_1x1, SHAPE_2x1 } from "../phase0_interfaces";
import {
  serializeGame,
  deserializeGame,
  serializeSlots,
  deserializeSlots,
  pushSnapshot,
  rewind,
  SaveError,
  SAVE_VERSION,
} from "./index";

function genOptions(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 8,
    height: 8,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 3,
    difficulty: { min: 1, max: 5 },
  };
}

function factory(): FactoryLayout {
  // 3x1 line: source -> [1x1 machine @ (1,0)] -> sink
  return {
    width: 3,
    height: 1,
    tiles: [{ kind: "source", dir: 0, period: 4 }, { kind: "empty" }, { kind: "sink" }],
    machines: [
      {
        id: 0,
        def: {
          typeId: "push",
          transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" },
          orientation: IDENTITY,
          cost: 1,
          speed: 2,
        },
        anchor: { x: 1, y: 0 },
        footRot: 0,
        shape: SHAPE_1x1,
      },
    ],
  };
}

function baseGame(): GameState {
  return {
    genOptions: genOptions(123),
    economy: { cash: 1000, sold: [{ disease: 0, count: 5 }, { disease: 2, count: 1 }] },
    patents: { unlocked: ["root", "expand1"] },
    factory: factory(),
    rng: { s: 42 },
  };
}

describe("serializeGame / deserializeGame round-trip", () => {
  const cases: Array<[string, GameState]> = [
    ["base", baseGame()],
    [
      "empty economy + patents",
      { ...baseGame(), economy: { cash: 0, sold: [] }, patents: { unlocked: [] } },
    ],
    [
      "different genOptions",
      { ...baseGame(), genOptions: { ...genOptions(999), nMaps: 4, width: 12, height: 10, diseaseCount: 7 } },
    ],
    [
      "negative cash + different rng",
      { ...baseGame(), economy: { cash: -250, sold: [{ disease: 9, count: 100 }] }, rng: { s: 0 } },
    ],
    [
      "factory with splitter/merger + a scale machine (footRot, 2x1)",
      {
        ...baseGame(),
        factory: {
          width: 2,
          height: 2,
          tiles: [
            { kind: "source", dir: 1, period: 3 },
            { kind: "splitter", inDir: 2, outDirs: [0, 1] },
            { kind: "merger", inDirs: [2, 3], outDir: 0 },
            { kind: "sink" },
          ],
          machines: [
            {
              id: 0,
              def: {
                typeId: "dilute",
                transform: { kind: "scale", num: 1, den: 2 },
                orientation: { rot: 2, flip: true },
                cost: 3,
                speed: 5,
              },
              anchor: { x: 0, y: 1 },
              footRot: 2,
              shape: SHAPE_2x1,
            },
          ],
        },
      },
    ],
    [
      "factory all-empty (no machines)",
      { ...baseGame(), factory: { width: 1, height: 1, tiles: [{ kind: "empty" }], machines: [] } },
    ],
  ];

  for (const [name, g] of cases) {
    it(`round-trips: ${name}`, () => {
      expect(deserializeGame(serializeGame(g))).toEqual(g);
    });
  }
});

describe("determinism", () => {
  it("serializeGame twice produces identical strings", () => {
    const g = baseGame();
    expect(serializeGame(g)).toBe(serializeGame(g));
  });

  it("key order does not affect output (stable keys)", () => {
    const g = baseGame();
    // Build a structurally-equal state with a different literal key order.
    const reordered: GameState = {
      rng: { s: g.rng.s },
      factory: g.factory,
      patents: g.patents,
      economy: g.economy,
      genOptions: g.genOptions,
    };
    expect(serializeGame(reordered)).toBe(serializeGame(g));
  });

  it("blob carries the version tag", () => {
    const blob = serializeGame(baseGame());
    expect(JSON.parse(blob).version).toBe(SAVE_VERSION);
  });
});

describe("deserializeGame validation (no silent defaults)", () => {
  it("throws on malformed JSON", () => {
    expect(() => deserializeGame("{not json")).toThrow(SaveError);
  });

  it("throws on missing version", () => {
    const blob = JSON.stringify({ game: baseGame() });
    expect(() => deserializeGame(blob)).toThrow(/missing version/);
  });

  it("throws on incompatible version", () => {
    const blob = JSON.stringify({ version: SAVE_VERSION + 1, game: baseGame() });
    expect(() => deserializeGame(blob)).toThrow(/incompatible version/);
  });

  it("throws on missing game payload", () => {
    const blob = JSON.stringify({ version: SAVE_VERSION });
    expect(() => deserializeGame(blob)).toThrow(/missing game/);
  });

  it("throws on a missing nested field", () => {
    const g = baseGame() as unknown as Record<string, unknown>;
    const broken = { ...g, economy: { sold: [] } }; // cash missing
    const blob = JSON.stringify({ version: SAVE_VERSION, game: broken });
    expect(() => deserializeGame(blob)).toThrow(/economy\.cash/);
  });

  it("throws on wrong field type", () => {
    const g = baseGame() as unknown as Record<string, unknown>;
    const broken = { ...g, rng: { s: "nope" } };
    const blob = JSON.stringify({ version: SAVE_VERSION, game: broken });
    expect(() => deserializeGame(blob)).toThrow(/rng\.s/);
  });

  it("throws on unknown tile kind", () => {
    const blob = JSON.stringify({
      version: SAVE_VERSION,
      game: { ...baseGame(), factory: { width: 1, height: 1, tiles: [{ kind: "wormhole" }] } },
    });
    expect(() => deserializeGame(blob)).toThrow(/unknown FactoryTile kind/);
  });

  it("throws on tiles length mismatch", () => {
    const blob = JSON.stringify({
      version: SAVE_VERSION,
      game: { ...baseGame(), factory: { width: 4, height: 4, tiles: [{ kind: "empty" }] } },
    });
    expect(() => deserializeGame(blob)).toThrow(/factory\.tiles/);
  });
});

describe("multi-save slots", () => {
  it("round-trips a list of states", () => {
    const states = [baseGame(), { ...baseGame(), economy: { cash: 5, sold: [] } }, { ...baseGame(), rng: { s: 7 } }];
    expect(deserializeSlots(serializeSlots(states))).toEqual(states);
  });

  it("is deterministic", () => {
    const states = [baseGame(), { ...baseGame(), rng: { s: 7 } }];
    expect(serializeSlots(states)).toBe(serializeSlots(states));
  });

  it("throws on malformed slots blob", () => {
    expect(() => deserializeSlots("[oops")).toThrow(SaveError);
  });

  it("throws on incompatible version", () => {
    const blob = JSON.stringify({ version: SAVE_VERSION + 1, slots: [] });
    expect(() => deserializeSlots(blob)).toThrow(/incompatible version/);
  });
});

describe("rewind history", () => {
  it("pushSnapshot appends without mutating", () => {
    const h0: GameState[] = [];
    const a = baseGame();
    const h1 = pushSnapshot(h0, a);
    expect(h0).toEqual([]);
    expect(h1).toEqual([a]);
  });

  it("rewind returns a prior state and truncated history", () => {
    const a = baseGame();
    const b = { ...baseGame(), rng: { s: 2 } };
    const c = { ...baseGame(), rng: { s: 3 } };
    const h = pushSnapshot(pushSnapshot(pushSnapshot([], a), b), c);
    const r = rewind(h, 1);
    expect(r.state).toEqual(b);
    expect(r.history).toEqual([a, b]);
  });

  it("rewind default is one step back", () => {
    const a = baseGame();
    const b = { ...baseGame(), rng: { s: 2 } };
    const r = rewind([a, b]);
    expect(r.state).toEqual(a);
  });

  it("rewound state survives a serialize round-trip", () => {
    const a = baseGame();
    const b = { ...baseGame(), rng: { s: 2 } };
    const r = rewind([a, b]);
    expect(deserializeGame(serializeGame(r.state))).toEqual(a);
  });

  it("throws when rewinding past the start", () => {
    expect(() => rewind([baseGame()], 5)).toThrow(SaveError);
  });
});
