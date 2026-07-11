import type { Orientation, Transform } from "../sim/phase0_interfaces";
import { IDENTITY } from "../sim/phase0_interfaces";

export interface MachineIconProps {
  readonly typeId: string;
  readonly transform: Transform;
  readonly orientation?: Orientation;
  readonly title?: string;
  readonly size?: number;
}

type TranslateShape = "arrow" | "double-arrow" | "reverse-arrow" | "right-angle" | "diagonal";

function translateShape(typeId: string, transform: Extract<Transform, { kind: "translate" }>): TranslateShape {
  if (typeId === "push2") return "double-arrow";
  if (transform.relation === "reverse" || typeId === "pull") return "reverse-arrow";
  if (transform.relation === "perpendicular" || typeId === "shear") return "right-angle";
  if (transform.relation === "offset" || typeId === "skew") return "diagonal";
  return "arrow";
}

function TranslateDrawing({ shape }: { readonly shape: TranslateShape }) {
  if (shape === "double-arrow") {
    return (
      <g data-icon-shape="double-arrow">
        <path d="M-14-6H9" />
        <path d="m3-12 7 6-7 6" />
        <path d="M-14 6H9" />
        <path d="m3 0 7 6-7 6" />
      </g>
    );
  }
  if (shape === "reverse-arrow") {
    return (
      <g data-icon-shape="reverse-arrow">
        <path d="M14 0H-10" />
        <path d="m-4-7-7 7 7 7" />
      </g>
    );
  }
  if (shape === "right-angle") {
    return (
      <g data-icon-shape="right-angle">
        <path d="M-14-8H0V10" />
        <path d="m-6 4 6 7 6-7" />
      </g>
    );
  }
  if (shape === "diagonal") {
    return (
      <g data-icon-shape="diagonal">
        <path d="m-11-11 20 20" />
        <path d="M9 1v8H1" />
      </g>
    );
  }
  return (
    <g data-icon-shape="arrow">
      <path d="M-14 0H10" />
      <path d="m4-7 7 7-7 7" />
    </g>
  );
}

function InwardRing() {
  return (
    <g data-icon-shape="inward-ring">
      <circle r="15" />
      <circle r="5" />
      <path d="M0-14v7m-4-4 4 4 4-4" />
      <path d="M14 0H7m4-4-4 4 4 4" />
      <path d="M0 14V7m4 4-4-4-4 4" />
      <path d="M-14 0h7m-4 4 4-4-4-4" />
    </g>
  );
}

function PhaseSwap() {
  return (
    <g data-icon-shape="phase-swap">
      <circle cx="-9" cy="-7" r="5" />
      <circle cx="9" cy="7" r="5" />
      <path d="M-13 6C-8 13 2 14 9 8" />
      <path d="m4 7 6 1-1 6" />
      <path d="M13-6C8-13-2-14-9-8" />
      <path d="m-4-7-6-1 1-6" />
    </g>
  );
}

export function MachineIcon({
  typeId,
  transform,
  orientation = IDENTITY,
  title,
  size = 24,
}: MachineIconProps) {
  const labelled = title !== undefined;
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
      {transform.kind === "translate" ? (
        <g transform={`translate(24 24) scale(${orientation.flip ? -1 : 1} 1) rotate(${orientation.rot * 90})`}>
          <TranslateDrawing shape={translateShape(typeId, transform)} />
        </g>
      ) : (
        <g transform="translate(24 24)">
          {transform.kind === "scale" ? <InwardRing /> : <PhaseSwap />}
        </g>
      )}
    </svg>
  );
}
