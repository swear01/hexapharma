import type { GameState } from "../sim/phase0_interfaces";
import { asJsonRecord } from "../json-guards";
import {
  SAVE_VERSION,
  deserializeSnapshot,
  prepareSnapshot,
  rewind,
} from "../sim/save";

const CHECKPOINT_VERSION = 2;
export const SLOT_HISTORY_LIMIT = 20;
export const SLOT_CHECKPOINT_CHARACTER_LIMIT = 1_250_000;

export interface SlotRecovery {
  readonly head: GameState;
  readonly history: readonly GameState[];
}

export interface SlotRead {
  readonly head: GameState | null;
  readonly history: readonly GameState[] | null;
  readonly error: string | null;
  readonly notice: string | null;
  readonly recovery: SlotRecovery | null;
  readonly canRecover: boolean;
}

export interface SlotWrite {
  readonly head: GameState;
  readonly history: readonly GameState[];
  readonly pruned: number;
  readonly replacedTimeline: boolean;
}

function checkpointKey(slot: number): string {
  return `hexapharma.save.v${SAVE_VERSION}.checkpoint.${slot}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameMap(a: GameState, b: GameState): boolean {
  return JSON.stringify(a.genOptions) === JSON.stringify(b.genOptions);
}

function fitCheckpoint(history: readonly GameState[]): {
  readonly raw: string;
  readonly result: SlotWrite;
} {
  const head = history[history.length - 1];
  if (head === undefined) throw new Error("checkpoint history must contain its head");
  const preparedHead = prepareSnapshot(head);
  const retained = [preparedHead];
  const encode = (): string => JSON.stringify({
    version: CHECKPOINT_VERSION,
    head: preparedHead.serialized,
    history: retained.slice(0, -1).map((entry) => entry.serialized),
  });
  let raw = encode();
  if (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) {
    throw new Error(`checkpoint head exceeds the ${SLOT_CHECKPOINT_CHARACTER_LIMIT}-character slot budget`);
  }
  for (let index = history.length - 2; index >= 0 && retained.length < SLOT_HISTORY_LIMIT; index--) {
    const state = history[index]!;
    if (!sameMap(state, head)) break;
    retained.unshift(prepareSnapshot(state));
    const candidate = encode();
    if (candidate.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) {
      retained.shift();
      break;
    }
    raw = candidate;
  }
  return {
    raw,
    result: {
      head: preparedHead.game,
      history: retained.map((entry) => entry.game),
      pruned: history.length - retained.length,
      replacedTimeline: false,
    },
  };
}

function checkpointEntries(raw: string): string[] {
  if (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) {
    throw new Error(`checkpoint exceeds the ${SLOT_CHECKPOINT_CHARACTER_LIMIT}-character slot budget`);
  }
  const envelope = asJsonRecord(JSON.parse(raw), "checkpoint");
  if (envelope.version !== CHECKPOINT_VERSION) throw new Error("checkpoint: incompatible version");
  if (Object.keys(envelope).length !== 3 || !("head" in envelope) || !("history" in envelope)) {
    throw new Error("checkpoint: unknown or missing fields");
  }
  if (!Array.isArray(envelope.history) || envelope.history.length >= SLOT_HISTORY_LIMIT) {
    throw new Error(`checkpoint history must contain fewer than ${SLOT_HISTORY_LIMIT} entries`);
  }
  return [...envelope.history, envelope.head].map((entry) => {
    if (typeof entry !== "string") throw new Error("checkpoint entry must be a string");
    return entry;
  });
}

function recoverEntries(entries: readonly string[]): SlotRecovery | null {
  const history: GameState[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    let state: GameState;
    try {
      state = deserializeSnapshot(entries[index]!);
    } catch {
      if (history.length > 0) break;
      continue;
    }
    if (history.length > 0 && !sameMap(state, history[0]!)) break;
    history.unshift(state);
  }
  const head = history[history.length - 1];
  return head === undefined ? null : { head, history };
}

export function readSlot(storage: Storage, slot: number): SlotRead {
  let entries: string[] | null = null;
  let canRecover = true;
  try {
    let raw: string | null;
    try {
      raw = storage.getItem(checkpointKey(slot));
    } catch (error) {
      canRecover = false;
      throw error;
    }
    if (raw === null) {
      return { head: null, history: [], error: null, notice: null,
        recovery: null, canRecover: true };
    }
    entries = checkpointEntries(raw);
    const history = entries.map(deserializeSnapshot);
    const head = history[history.length - 1]!;
    if (history.some((state) => !sameMap(state, head))) {
      throw new Error("checkpoint history contains different maps");
    }
    return { head, history, error: null, notice: null,
      recovery: { head, history }, canRecover: true };
  } catch (error) {
    return {
      head: null,
      history: null,
      error: `Slot ${slot + 1} checkpoint is invalid: ${message(error)}`,
      notice: null,
      recovery: entries === null ? null : recoverEntries(entries),
      canRecover,
    };
  }
}

export function saveSlot(
  storage: Storage,
  slot: number,
  history: readonly GameState[],
  game: GameState,
): SlotWrite {
  const latest = history[history.length - 1];
  const replacedTimeline = latest !== undefined && !sameMap(latest, game);
  const fitted = fitCheckpoint(replacedTimeline ? [game] : [...history, game]);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return {
    ...fitted.result,
    replacedTimeline,
    pruned: fitted.result.pruned + (replacedTimeline ? history.length : 0),
  };
}

export function rewindSlot(storage: Storage, slot: number, history: readonly GameState[]): SlotWrite {
  const recalled = rewind(history, 1);
  const fitted = fitCheckpoint(recalled.history);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return fitted.result;
}

export function recoverSlot(
  storage: Storage,
  slot: number,
  current: GameState,
  recovery: SlotRecovery | null,
): SlotWrite {
  const fitted = fitCheckpoint(recovery === null ? [current] : recovery.history);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return fitted.result;
}
