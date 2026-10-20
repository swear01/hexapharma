import type { MachineTypeId } from "../sim/phase0_interfaces";

const MACHINE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  push: "Hook pump",
  push2: "Wave reactor",
  pull: "Return coil",
  shear: "Elbow press",
  skew: "Zigzag still",
  dilute: "Loop vat",
  settle: "Settling spiral",
});

export function machineName(typeId: MachineTypeId): string {
  const name = MACHINE_NAMES[typeId];
  if (name === undefined) {
    throw new Error(`Machine "${typeId}" needs a player-facing name`);
  }
  return name;
}
