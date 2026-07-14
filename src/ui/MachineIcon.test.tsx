import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { MachineIcon } from "./MachineIcon";

function render(typeId: string, stroke?: number, title?: string): string {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId)!;
  return renderToStaticMarkup(
    <MachineIcon typeId={entry.typeId} path={entry.path} stroke={stroke} title={title} size={32} />,
  );
}

describe("MachineIcon", () => {
  it("renders every authored path as geometry without letter abbreviations", () => {
    for (const entry of DEFAULT_CATALOG) {
      const markup = render(entry.typeId);
      expect(markup).toContain(`data-machine-icon="${entry.typeId}"`);
      expect(markup).toContain('data-icon-shape="full-path"');
      expect(markup).toContain('data-icon-shape="active-path"');
      expect(markup).not.toContain("<text");
    }
  });

  it("shows calibration as an active prefix without rotating the fixed path", () => {
    const short = render("push2", 2);
    const full = render("push2");
    expect(short).toContain('data-stroke="2"');
    expect(full).toContain(`data-stroke="${DEFAULT_CATALOG[1]!.path.length}"`);
    expect(short).not.toContain("rotate(");
    expect(short).not.toContain("scale(-1");
  });

  it("uses accessible names only when titled", () => {
    expect(render("push")).toContain('aria-hidden="true"');
    const labelled = render("push", 2, "Hook pump path");
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Hook pump path"');
    expect(labelled).toContain("<title>Hook pump path</title>");
  });
});
