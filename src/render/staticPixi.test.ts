import { describe, expect, it, vi } from "vitest";
import { STATIC_PIXI_OPTIONS, renderStaticFrame } from "./staticPixi";

describe("event-driven Pixi rendering", () => {
  it("disables the ticker and renders exactly one requested frame", () => {
    expect(STATIC_PIXI_OPTIONS.autoStart).toBe(false);
    const render = vi.fn();

    renderStaticFrame({ render });

    expect(render).toHaveBeenCalledTimes(1);
  });
});
