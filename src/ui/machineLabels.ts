import type { MachineTypeId } from "../sim/phase0_interfaces";

const MACHINE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  hook: "Hook pump",
  elbow: "Elbow press",
  return: "Return coil",
  wave: "Wave reactor",
  zigzag: "Zigzag still",
  loop: "Loop vat",
  straight: "Straight drive",
  crane: "Crane arm",
});

export function machineName(typeId: MachineTypeId): string {
  const name = MACHINE_NAMES[typeId];
  if (name === undefined) {
    throw new Error(`Machine "${typeId}" needs a player-facing name`);
  }
  return name;
}
