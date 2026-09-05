import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import { MachineIcon } from "./MachineIcon";

function render(typeId: string, title?: string): string {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId)!;
  return renderToStaticMarkup(
    <MachineIcon typeId={entry.typeId} path={entry.path} title={title} size={32} />,
  );
}

describe("MachineIcon", () => {
  it("projects all six hex directions without invalid SVG coordinates", () => {
    const markup = renderToStaticMarkup(
      <MachineIcon typeId="six-directions" path={[0, 1, 2, 3, 4, 5]} />,
    );
    expect(markup).not.toContain("NaN");
    expect(markup).toContain('data-icon-shape="path"');
  });

  it("renders every authored path as geometry without letter abbreviations", () => {
    for (const entry of DEFAULT_CATALOG) {
      const markup = render(entry.typeId);
      expect(markup).toContain(`data-machine-icon="${entry.typeId}"`);
      expect(markup).toContain('data-icon-shape="path"');
      expect(markup).not.toContain("<text");
      expect(markup).not.toContain("data-stroke");
    }
  });

  it("renders only the complete fixed path without a partial-path layer", () => {
    const markup = render("push2");
    expect(markup.match(/<polyline/g)).toHaveLength(1);
    expect(markup).not.toContain('opacity="0.25"');
    expect(markup).not.toContain("rotate(");
    expect(markup).not.toContain("scale(-1");
  });

  it("uses the canonical physical cells and ports for Factory tools", () => {
    for (const entry of DEFAULT_CATALOG) {
      const shape = DEFAULT_SHAPES[entry.typeId]!;
      const markup = renderToStaticMarkup(<MachineIcon typeId={entry.typeId} path={entry.path} footprint />);
      expect(markup.match(/<polygon/g)).toHaveLength(shape.cells.length);
      expect(markup.match(/<rect/g)).toHaveLength(shape.inPorts.length);
      expect(markup.match(/<circle/g)).toHaveLength(shape.outPorts.length);
      expect(markup).not.toContain("NaN");
    }
  });

  it("uses accessible names only when titled", () => {
    expect(render("push")).toContain('aria-hidden="true"');
    const labelled = render("push", "Hook pump path");
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Hook pump path"');
    expect(labelled).toContain("<title>Hook pump path</title>");
  });
});
