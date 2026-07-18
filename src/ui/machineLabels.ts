import type { MachineTypeId } from "../sim/phase0_interfaces";

interface MachineLabel {
  readonly name: string;
  readonly shortName: string;
}

const MACHINE_LABELS: Readonly<Record<string, MachineLabel>> = Object.freeze({
  push: Object.freeze({ name: "Hook pump", shortName: "Pump" }),
  push2: Object.freeze({ name: "Wave reactor", shortName: "Wave" }),
  pull: Object.freeze({ name: "Return coil", shortName: "Coil" }),
  shear: Object.freeze({ name: "Elbow press", shortName: "Press" }),
  skew: Object.freeze({ name: "Zigzag still", shortName: "Zigzag" }),
  dilute: Object.freeze({ name: "Loop vat", shortName: "Loop" }),
  settle: Object.freeze({ name: "Settling spiral", shortName: "Settler" }),
});

function labelFor(typeId: MachineTypeId): MachineLabel {
  const label = MACHINE_LABELS[typeId];
  if (label === undefined) {
    throw new Error(`Machine "${typeId}" needs a player-facing name`);
  }
  return label;
}

export function machineName(typeId: MachineTypeId): string {
  return labelFor(typeId).name;
}

export function machineShortName(typeId: MachineTypeId): string {
  return labelFor(typeId).shortName;
}
