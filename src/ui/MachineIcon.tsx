import { DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import type { PathStamp } from "../sim/phase0_interfaces";
import { HEX_DQ, HEX_DR } from "../sim/hex";
import { hexPolygon, hexToPixel } from "../render/hexProjection";

export interface MachineIconProps {
  readonly typeId: string;
  readonly path: PathStamp;
  readonly title?: string;
  readonly size?: number;
  readonly footprint?: boolean;
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
  footprint = false,
}: MachineIconProps) {
  const labelled = title !== undefined;
  const shape = footprint ? DEFAULT_SHAPES[typeId] : undefined;
  if (footprint && shape === undefined) throw new Error(`Missing footprint for ${typeId}`);
  const centers = shape?.cells.map((cell) => hexToPixel(cell.q, cell.r, 8)) ?? [];
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
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      aria-label={title}
      data-machine-icon={typeId}
    >
      {labelled && <title>{title}</title>}
      {shape !== undefined ? <g data-icon-shape="footprint" strokeWidth="1" transform={`translate(24 24) scale(${footprintScale}) translate(-24 -24)`}>
        {centers.map((p, index) => <polygon key={index} points={pointList(hexPolygon(24 + p.x - centerX, 24 + p.y - centerY, 7.7))} fill="currentColor" fillOpacity=".18" />)}
        {shape.inPorts.map((port, index) => {
          const p = hexToPixel(port.cell.q, port.cell.r, 8);
          const offset = hexToPixel(HEX_DQ[port.side]!, HEX_DR[port.side]!, 4);
          return <rect key={index} x={22 + p.x - centerX + offset.x} y={22 + p.y - centerY + offset.y} width="4" height="4" fill="currentColor" />;
        })}
        {shape.outPorts.map((port, index) => {
          const p = hexToPixel(port.cell.q, port.cell.r, 8);
          const offset = hexToPixel(HEX_DQ[port.side]!, HEX_DR[port.side]!, 4);
          return <circle key={index} cx={24 + p.x - centerX + offset.x} cy={24 + p.y - centerY + offset.y} r="2" />;
        })}
      </g> : <g>
      <polyline points={pointList(points)} data-icon-shape="path" />
      <circle cx={points[0]!.x} cy={points[0]!.y} r="3" fill="currentColor" />
      <circle cx={endpoint.x} cy={endpoint.y} r="4" fill="none" data-icon-endpoint="true" />
      </g>}
    </svg>
  );
}
