import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, IDENTITY } from "../sim/phase0_interfaces";
import { MachineIcon } from "./MachineIcon";

function catalogEntry(typeId: string) {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`missing catalog fixture ${typeId}`);
  return entry;
}

function render(typeId: string, title?: string, rot: 0 | 1 | 2 | 3 = 0, flip = false) {
  const entry = catalogEntry(typeId);
  return renderToStaticMarkup(
    <MachineIcon
      typeId={entry.typeId}
      transform={entry.transform}
      orientation={{ rot, flip }}
      title={title}
      size={32}
    />,
  );
}

describe("MachineIcon", () => {
  it("renders every catalog transform as a semantic drawing rather than letter abbreviations", () => {
    for (const typeId of ["push", "push2", "pull", "shear", "skew", "dilute", "swap01"]) {
      const markup = render(typeId);
      expect(markup).toContain("<svg");
      expect(markup).not.toContain("<text");
      expect(markup).not.toMatch(/>\s*(PU|SH|SK)\s*</);
      expect(markup).toContain(`data-machine-icon="${typeId}"`);
    }
  });

  it("hides decorative icons but gives titled icons an accessible image name", () => {
    const decorative = render("push");
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role="img"');

    const labelled = render("push", "Forward mixer");
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Forward mixer"');
    expect(labelled).toContain("<title>Forward mixer</title>");
    expect(labelled).not.toContain('aria-hidden="true"');
  });

  it("rotates and mirrors directional transform drawings around their center", () => {
    expect(render("push", undefined, 1)).toContain('transform="translate(24 24) scale(1 1) rotate(90)"');
    expect(render("push", undefined, 3, true)).toContain('transform="translate(24 24) scale(-1 1) rotate(270)"');
  });

  it("uses distinct geometry for the translate relations and special transforms", () => {
    expect(render("push2")).toContain('data-icon-shape="double-arrow"');
    expect(render("pull")).toContain('data-icon-shape="reverse-arrow"');
    expect(render("shear")).toContain('data-icon-shape="right-angle"');
    expect(render("skew")).toContain('data-icon-shape="diagonal"');
    expect(render("dilute")).toContain('data-icon-shape="inward-ring"');
    expect(render("swap01")).toContain('data-icon-shape="phase-swap"');
  });

  it("defaults translate orientation to identity", () => {
    const entry = catalogEntry("push");
    const markup = renderToStaticMarkup(
      <MachineIcon typeId={entry.typeId} transform={entry.transform} />,
    );
    expect(markup).toContain("scale(1 1)");
    expect(markup).toContain(`rotate(${IDENTITY.rot * 90})`);
  });
});
