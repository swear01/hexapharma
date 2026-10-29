import { DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import type { PathStamp } from "../sim/phase0_interfaces";
import { HEX_DQ, HEX_DR, rotateHexCoord, type HexRotation } from "../sim/hex";
import { hexPolygon, hexToPixel } from "../render/hexProjection";

export interface MachineIconProps {
  readonly typeId: string;
  readonly path: PathStamp;
  readonly title?: string;
  readonly size?: number;
  /** path: the Atlas stamp; footprint: the factory cells and ports; token: both, one identity. */
  readonly variant?: "path" | "footprint" | "token";
  /** Sixth-turns applied to the footprint (Research turns tokens to the heading with their path). */
  readonly rotation?: HexRotation;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function iconPoints(path: PathStamp): readonly Point[] {
  const raw: Point[] = [{ x: 0, y: 0 }];
  let q = 0;
  let r = 0;
  for (const direction of path) {
    q += HEX_DQ[direction] ?? 0;
    r += HEX_DR[direction] ?? 0;
    raw.push(hexToPixel(q, r, 1));
  }
  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(1, maxX - minX, maxY - minY);
  const scale = 30 / span;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return raw.map((point) => ({
    x: 24 + (point.x - centerX) * scale,
    y: 24 + (point.y - centerY) * scale,
  }));
}

function pointList(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function MachineIcon({
  typeId,
  path,
  title,
  size = 24,
  variant = "path",
  rotation = 0,
}: MachineIconProps) {
  const labelled = title !== undefined;
  const shape = variant === "path" ? undefined : DEFAULT_SHAPES[typeId];
  if (variant !== "path" && shape === undefined) throw new Error(`Missing footprint for ${typeId}`);
  const cellPixel = (cell: { readonly q: number; readonly r: number }) => {
    const turned = rotateHexCoord(cell, rotation);
    return hexToPixel(turned.q, turned.r, 8);
  };
  const portOffset = (side: number) => {
    const turned = (side + rotation) % 6;
    return hexToPixel(HEX_DQ[turned]!, HEX_DR[turned]!, 4);
  };
  // Same language as the floor: an arrowhead on the edge, pointing in for input, out for output.
  const portArrow = (port: { readonly cell: { readonly q: number; readonly r: number }; readonly side: number }, role: "input" | "output") => {
    const p = cellPixel(port.cell);
    const offset = portOffset(port.side);
    const length = Math.hypot(offset.x, offset.y);
    const sign = role === "output" ? 1 : -1;
    const ux = sign * offset.x / length;
    const uy = sign * offset.y / length;
    const cx = 24 + p.x - centerX + offset.x;
    const cy = 24 + p.y - centerY + offset.y;
    return pointList([
      { x: cx + ux * 2.5, y: cy + uy * 2.5 },
      { x: cx - ux * 1.25 - uy * 2.2, y: cy - uy * 1.25 + ux * 2.2 },
      { x: cx - ux * 1.25 + uy * 2.2, y: cy - uy * 1.25 - ux * 2.2 },
    ]);
  };
  const centers = shape?.cells.map(cellPixel) ?? [];
  const centerX = centers.length === 0 ? 0 : (Math.min(...centers.map((p) => p.x)) + Math.max(...centers.map((p) => p.x))) / 2;
  const centerY = centers.length === 0 ? 0 : (Math.min(...centers.map((p) => p.y)) + Math.max(...centers.map((p) => p.y))) / 2;
  const footprintScale = centers.length === 0 ? 1 : 40 / Math.max(
    Math.max(...centers.map((p) => p.x)) - Math.min(...centers.map((p) => p.x)) + 16,
    Math.max(...centers.map((p) => p.y)) - Math.min(...centers.map((p) => p.y)) + 16,
  );
  const points = iconPoints(path);
  const endpoint = points.at(-1) ?? points[0]!;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      aria-label={title}
      data-machine-icon={typeId}
    >
      {labelled && <title>{title}</title>}
      {shape !== undefined && <g data-icon-shape="footprint" className="machine-icon-footprint" strokeWidth="1" transform={`translate(24 24) scale(${footprintScale}) translate(-24 -24)`}>
        {centers.map((p, index) => <polygon key={index} points={pointList(hexPolygon(24 + p.x - centerX, 24 + p.y - centerY, 7.7))} fill="currentColor" fillOpacity=".12" />)}
        {shape.inPorts.map((port, index) => <polygon key={`in${index}`} points={portArrow(port, "input")} fill="currentColor" data-port="input" />)}
        {shape.outPorts.map((port, index) => <polygon key={`out${index}`} points={portArrow(port, "output")} fill="currentColor" data-port="output" />)}
      </g>}
      {variant !== "footprint" && <g className="machine-icon-path" transform={variant === "token" ? "translate(24 24) scale(.62) translate(-24 -24)" : undefined}>
      <polyline points={pointList(points)} data-icon-shape="path" />
      <circle cx={points[0]!.x} cy={points[0]!.y} r="3" fill="currentColor" />
      <circle cx={endpoint.x} cy={endpoint.y} r="4" fill="none" data-icon-endpoint="true" />
      </g>}
    </svg>
  );
}
