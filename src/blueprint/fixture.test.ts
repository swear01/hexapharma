import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { deriveLinearRoute } from "../sim/recipe";
import { decodeBlueprint, materializeBlueprint } from "./format";

describe("manual playtest blueprint fixture", () => {
  it("stays compatible with the current strict content fingerprint and Research topology", async () => {
    const source = await readFile("docs/examples/seed14-research.hexapharma.json", "utf8");
    const blueprint = await decodeBlueprint(source);
    const route = deriveLinearRoute(materializeBlueprint(blueprint));

    expect(blueprint.kind).toBe("research-route");
    expect(route.template.steps).toHaveLength(8);
  });
});
