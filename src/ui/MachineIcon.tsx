import type { PathStamp } from "../sim/phase0_interfaces";
import { HEX_DQ, HEX_DR } from "../sim/hex";
import { hexToPixel } from "../render/hexProjection";

export interface MachineIconProps {
  readonly typeId: string;
  readonly path: PathStamp;
  readonly title?: string;
  readonly size?: number;
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
}: MachineIconProps) {
  const labelled = title !== undefined;
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
      <polyline points={pointList(points)} data-icon-shape="path" />
      <circle cx={points[0]!.x} cy={points[0]!.y} r="3" fill="currentColor" />
      <circle cx={endpoint.x} cy={endpoint.y} r="4" fill="none" data-icon-endpoint="true" />
    </svg>
  );
}
