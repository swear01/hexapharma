import {
  MAX_REWIND_HISTORY_REPLAY_TICKS,
  MAX_REWIND_HISTORY_REPLAY_WORK,
  MAX_REWIND_HISTORY_TRACE_ENTRIES,
  type GameIntent,
  type GameState,
} from "../sim/phase0_interfaces";
import {
  deserializeGame,
  deserializeGameAuthority,
  deserializeSlots,
  inspectGameAuthority,
  prepareGameAuthority,
  rewind,
  serializeGameAuthority,
} from "../sim/save";

const CHECKPOINT_VERSION = 2;
export const SLOT_HISTORY_LIMIT = 20;
export const SLOT_CHECKPOINT_CHARACTER_LIMIT = 1_250_000;
export const SLOT_HISTORY_REPLAY_TICK_LIMIT = MAX_REWIND_HISTORY_REPLAY_TICKS;
export const SLOT_HISTORY_TRACE_ENTRY_LIMIT = MAX_REWIND_HISTORY_TRACE_ENTRIES;
export const SLOT_HISTORY_REPLAY_WORK_LIMIT = MAX_REWIND_HISTORY_REPLAY_WORK;

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
  readonly migration: string | null;
}

export interface SlotWrite {
  readonly head: GameState;
  readonly history: readonly GameState[];
  readonly pruned: number;
  readonly replacedTimeline: boolean;
}

function checkpointKey(slot: number): string {
  return `hexapharma.save.checkpoint.${slot}`;
}

function legacyHeadKey(slot: number): string {
  return `hexapharma.save.slot.${slot}`;
}

function legacyHistoryKey(slot: number): string {
  return `hexapharma.save.history.${slot}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slotLabel(slot: number): string {
  return `Slot ${slot + 1}`;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
  return value as Record<string, unknown>;
}

function sameState(a: GameState, b: GameState): boolean {
  return a === b || serializeGameAuthority(a) === serializeGameAuthority(b);
}

function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sale(intent: GameIntent): { readonly disease: number; readonly ids: readonly number[] } | null {
  if (intent.kind === "sellProduct") {
    return { disease: intent.disease, ids: [intent.productId] };
  }
  if (intent.kind === "sellProducts") {
    return { disease: intent.disease, ids: intent.productIds };
  }
  return null;
}

function normalizedIntentExtends(earlier: GameIntent, later: GameIntent): boolean {
  if (earlier.kind === "productionTicks" && later.kind === "productionTicks") {
    return later.ticks >= earlier.ticks;
  }
  if (
    (earlier.kind === "setResearchProgram" ||
      earlier.kind === "setPilotLayout") &&
    later.kind === earlier.kind
  ) {
    return true;
  }
  const earlierSale = sale(earlier);
  const laterSale = sale(later);
  if (
    earlierSale === null ||
    laterSale === null ||
    earlierSale.disease !== laterSale.disease ||
    earlierSale.ids.length > laterSale.ids.length
  ) {
    return false;
  }
  return earlierSale.ids.every((id, index) => laterSale.ids[index] === id);
}

function canFollowTimeline(earlier: GameState, later: GameState): boolean {
  if (!sameData(earlier.origin, later.origin)) return false;
  if (earlier.intentTrace.length > later.intentTrace.length) return false;
  if (earlier.intentTrace.length === 0) return true;
  const normalizedIndex = earlier.intentTrace.length - 1;
  for (let index = 0; index < normalizedIndex; index++) {
    if (!sameData(earlier.intentTrace[index], later.intentTrace[index])) return false;
  }
  const earlierLast = earlier.intentTrace[normalizedIndex]!;
  const laterAtIndex = later.intentTrace[normalizedIndex]!;
  return sameData(earlierLast, laterAtIndex) || normalizedIntentExtends(earlierLast, laterAtIndex);
}

function bounded(history: readonly GameState[]): GameState[] {
  return history.length <= SLOT_HISTORY_LIMIT
    ? history.slice()
    : history.slice(history.length - SLOT_HISTORY_LIMIT);
}

function verifyTimeline(history: readonly GameState[]): void {
  if (history.length === 0) throw new Error("history must contain its head snapshot");
  if (history.length > SLOT_HISTORY_LIMIT) {
    throw new Error(`history exceeds the ${SLOT_HISTORY_LIMIT}-snapshot limit`);
  }
  for (let index = 1; index < history.length; index++) {
    if (!canFollowTimeline(history[index - 1]!, history[index]!)) {
      throw new Error("history snapshots must share one origin and form a trace-prefix timeline");
    }
  }
}

function encodeCheckpoint(head: string, earlierHistory: readonly string[]): string {
  return JSON.stringify({
    version: CHECKPOINT_VERSION,
    head,
    history: earlierHistory,
  });
}

function preflightAuthorityWork(head: string, earlierHistory: readonly string[]): void {
  const headWork = inspectGameAuthority(head);
  let replayTicks = headWork.replayTicks;
  let intentCount = headWork.intentCount;
  let replayWork = headWork.replayWork;
  for (let index = 0; index < earlierHistory.length; index++) {
    const work = inspectGameAuthority(earlierHistory[index]!);
    if (
      replayTicks > Number.MAX_SAFE_INTEGER - work.replayTicks ||
      intentCount > Number.MAX_SAFE_INTEGER - work.intentCount ||
      replayWork > Number.MAX_SAFE_INTEGER - work.replayWork
    ) {
      throw new Error("checkpoint replay work exceeds safe-integer range");
    }
    replayTicks += work.replayTicks;
    intentCount += work.intentCount;
    replayWork += work.replayWork;
  }
  if (earlierHistory.length > 0 && replayTicks > SLOT_HISTORY_REPLAY_TICK_LIMIT) {
    throw new Error(
      `checkpoint replay tick work exceeds the ${SLOT_HISTORY_REPLAY_TICK_LIMIT}-tick history budget`,
    );
  }
  if (earlierHistory.length > 0 && intentCount > SLOT_HISTORY_TRACE_ENTRY_LIMIT) {
    throw new Error(
      `checkpoint trace work exceeds the ${SLOT_HISTORY_TRACE_ENTRY_LIMIT}-entry history budget`,
    );
  }
  if (earlierHistory.length > 0 && replayWork > SLOT_HISTORY_REPLAY_WORK_LIMIT) {
    throw new Error(
      `checkpoint weighted replay work exceeds the ` +
        `${SLOT_HISTORY_REPLAY_WORK_LIMIT}-unit history budget`,
    );
  }
}

function fitCheckpoint(history: readonly GameState[]): {
  readonly raw: string;
  readonly head: GameState;
  readonly history: GameState[];
  readonly pruned: number;
} {
  verifyTimeline(history);
  const counted = bounded(history);
  const head = counted[counted.length - 1];
  if (head === undefined) throw new Error("checkpoint history unexpectedly has no head");
  const preparedHead = prepareGameAuthority(head);
  const preparedHeadWork = inspectGameAuthority(preparedHead.serialized);
  const headSize = preparedHead.serialized.length;
  const targetPayload = Math.floor(SLOT_CHECKPOINT_CHARACTER_LIMIT * 0.75);
  let estimated = headSize;
  let replayWork = preparedHead.game.replayTicks;
  let traceWork = preparedHead.game.intentTrace.length;
  let weightedWork = preparedHeadWork.replayWork;
  let retained = [preparedHead];
  for (let index = counted.length - 2; index >= 0; index--) {
    const state = counted[index];
    if (state === undefined) continue;
    const prepared = prepareGameAuthority(state);
    const preparedWork = inspectGameAuthority(prepared.serialized);
    if (
      replayWork > SLOT_HISTORY_REPLAY_TICK_LIMIT - preparedWork.replayTicks ||
      traceWork > SLOT_HISTORY_TRACE_ENTRY_LIMIT - preparedWork.intentCount ||
      weightedWork > SLOT_HISTORY_REPLAY_WORK_LIMIT - preparedWork.replayWork
    ) {
      break;
    }
    const size = prepared.serialized.length;
    if (estimated + size > targetPayload) break;
    estimated += size;
    replayWork += prepared.game.replayTicks;
    traceWork += prepared.game.intentTrace.length;
    weightedWork += preparedWork.replayWork;
    retained = [prepared, ...retained];
  }
  let raw = encodeCheckpoint(
    preparedHead.serialized,
    retained.slice(0, -1).map((entry) => entry.serialized),
  );
  while (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT && retained.length > 1) {
    retained = retained.slice(1);
    raw = encodeCheckpoint(
      preparedHead.serialized,
      retained.slice(0, -1).map((entry) => entry.serialized),
    );
  }
  if (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) {
    throw new Error(
      `checkpoint head requires ${raw.length} characters, exceeding the ` +
        `${SLOT_CHECKPOINT_CHARACTER_LIMIT}-character slot budget`,
    );
  }
  const retainedGames = retained.map((entry) => entry.game);
  return {
    raw,
    head: preparedHead.game,
    history: retainedGames,
    pruned: history.length - retainedGames.length,
  };
}

function decodeCheckpoint(raw: string): SlotWrite {
  if (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) {
    throw new Error(`checkpoint exceeds the ${SLOT_CHECKPOINT_CHARACTER_LIMIT}-character slot budget`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`malformed checkpoint JSON (${message(error)})`, { cause: error });
  }
  const envelope = asRecord(parsed, "checkpoint");
  if (envelope.version !== CHECKPOINT_VERSION) {
    throw new Error(`checkpoint version ${String(envelope.version)} is not supported`);
  }
  if (typeof envelope.head !== "string") throw new Error("checkpoint.head: expected string");
  if (!Array.isArray(envelope.history)) throw new Error("checkpoint.history: expected array");
  if (envelope.history.length >= SLOT_HISTORY_LIMIT) {
    throw new Error(`checkpoint.history exceeds ${SLOT_HISTORY_LIMIT - 1} earlier snapshots`);
  }
  const earlierHistory = envelope.history.map((entry, index) => {
    if (typeof entry !== "string") throw new Error(`checkpoint.history[${index}]: expected string`);
    return entry;
  });
  preflightAuthorityWork(envelope.head, earlierHistory);
  const head = deserializeGameAuthority(envelope.head);
  const history = earlierHistory.map((entry) => deserializeGameAuthority(entry));
  history.push(head);
  verifyTimeline(history);
  return { head, history, pruned: 0, replacedTimeline: false };
}

function recoverableHistorySegment(rawHistory: readonly string[]): string[] {
  for (let end = rawHistory.length - 1; end >= 0; end--) {
    const recoveredHead = rawHistory[end]!;
    try {
      preflightAuthorityWork(recoveredHead, []);
    } catch {
      continue;
    }
    let start = end;
    for (let index = end - 1; index >= 0; index--) {
      try {
        preflightAuthorityWork(recoveredHead, rawHistory.slice(index, end));
        start = index;
      } catch {
        break;
      }
    }
    return rawHistory.slice(start, end + 1);
  }
  return [];
}

function salvageCheckpoint(raw: string): SlotRecovery | null {
  if (raw.length > SLOT_CHECKPOINT_CHARACTER_LIMIT) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== CHECKPOINT_VERSION) return null;
  const headRaw = typeof envelope.head === "string" ? envelope.head : null;
  let rawHistory: string[] | null = null;
  if (Array.isArray(envelope.history) && envelope.history.length < SLOT_HISTORY_LIMIT) {
    try {
      rawHistory = envelope.history.map((entry, index) => {
        if (typeof entry !== "string") {
          throw new Error(`checkpoint.history[${index}]: expected string`);
        }
        return entry;
      });
    } catch {
      rawHistory = null;
    }
  }

  const historyCandidate = rawHistory === null ? [] : recoverableHistorySegment(rawHistory);
  let replayHead = false;
  let replayHistoryWithHead = false;
  if (headRaw !== null) {
    try {
      preflightAuthorityWork(headRaw, []);
      replayHead = true;
      if (historyCandidate.length > 0) {
        try {
          preflightAuthorityWork(headRaw, historyCandidate);
          replayHistoryWithHead = true;
        } catch {
          replayHistoryWithHead = false;
        }
      }
    } catch {
      replayHead = false;
    }
  }

  let head: GameState | null = null;
  let history: GameState[] | null = null;
  if (replayHead && headRaw !== null) {
    try {
      head = deserializeGameAuthority(headRaw);
    } catch {
      head = null;
    }
  }
  if ((head === null || replayHistoryWithHead) && historyCandidate.length > 0) {
    const validSuffix: GameState[] = [];
    for (let index = historyCandidate.length - 1; index >= 0; index--) {
      try {
        validSuffix.unshift(deserializeGameAuthority(historyCandidate[index]!));
      } catch {
        if (validSuffix.length > 0) break;
      }
    }
    history = validSuffix.length > 0 ? validSuffix : null;
  }
  return recoverTimeline(head, history);
}

function recoverTimeline(
  head: GameState | null,
  history: readonly GameState[] | null,
): SlotRecovery | null {
  let recoveredHistory: GameState[] = [];
  if (history !== null && history.length > 0) {
    recoveredHistory = [history[history.length - 1]!];
    for (let index = history.length - 2; index >= 0; index--) {
      const candidate = history[index]!;
      if (!canFollowTimeline(candidate, recoveredHistory[0]!)) break;
      recoveredHistory.unshift(candidate);
    }
  }
  if (head !== null) {
    const latest = recoveredHistory[recoveredHistory.length - 1];
    if (latest === undefined) {
      recoveredHistory = [head];
    } else if (sameState(head, latest)) {
      recoveredHistory[recoveredHistory.length - 1] = head;
    } else if (canFollowTimeline(latest, head)) {
      recoveredHistory.push(head);
    } else {
      recoveredHistory = [head];
    }
  }
  const recoveredHead = recoveredHistory[recoveredHistory.length - 1] ?? null;
  if (recoveredHead === null) return null;
  return { head: recoveredHead, history: bounded(recoveredHistory) };
}

function invalidRead(
  slot: number,
  detail: string,
  recovery: SlotRecovery | null,
  canRecover = true,
): SlotRead {
  return {
    head: null,
    history: null,
    error: `${slotLabel(slot)} ${detail}`,
    notice: null,
    recovery,
    canRecover,
    migration: null,
  };
}

export function readSlot(storage: Storage, slot: number): SlotRead {
  let canonicalRaw: string | null;
  let legacyHeadRaw: string | null;
  let legacyHistoryRaw: string | null;
  try {
    canonicalRaw = storage.getItem(checkpointKey(slot));
    legacyHeadRaw = storage.getItem(legacyHeadKey(slot));
    legacyHistoryRaw = storage.getItem(legacyHistoryKey(slot));
  } catch (error) {
    return invalidRead(slot, `storage cannot be read: ${message(error)}`, null, false);
  }

  if (canonicalRaw !== null) {
    try {
      const decoded = decodeCheckpoint(canonicalRaw);
      return {
        ...decoded,
        error: null,
        notice: null,
        recovery: decoded,
        canRecover: true,
        migration: null,
      };
    } catch (error) {
      return invalidRead(
        slot,
        `checkpoint is invalid: ${message(error)}`,
        salvageCheckpoint(canonicalRaw),
      );
    }
  }

  if (legacyHeadRaw === null && legacyHistoryRaw === null) {
    return {
      head: null,
      history: [],
      error: null,
      notice: null,
      recovery: null,
      canRecover: true,
      migration: null,
    };
  }

  let head: GameState | null = null;
  let history: GameState[] | null = null;
  let headError: string | null = null;
  let historyError: string | null = null;
  if (legacyHistoryRaw !== null) {
    try {
      history = deserializeSlots(legacyHistoryRaw);
    } catch (error) {
      historyError = message(error);
    }
  }
  if (legacyHeadRaw !== null) {
    try {
      head = deserializeGame(legacyHeadRaw);
    } catch (error) {
      headError = message(error);
    }
  }

  const recovery = recoverTimeline(head, history);
  if (headError !== null) {
    return invalidRead(slot, `has an invalid save: ${headError}`, recovery);
  }
  if (historyError !== null) {
    return invalidRead(slot, `history is invalid: ${historyError}`, recovery);
  }

  const migratedHead = head ?? history?.[history.length - 1] ?? null;
  if (migratedHead === null) {
    return {
      head: null,
      history: [],
      error: null,
      notice: `${slotLabel(slot)} has an empty legacy history; the next save will create its checkpoint.`,
      recovery: null,
      canRecover: true,
      migration: null,
    };
  }
  let migratedHistory = history ?? [];
  const latest = migratedHistory[migratedHistory.length - 1];
  if (head !== null && latest !== undefined && !sameState(head, latest)) {
    return invalidRead(
      slot,
      "legacy save and history disagree after an interrupted write; choose Recover to adopt the validated head.",
      recovery,
    );
  }
  if (migratedHistory.length > 0) {
    try {
      verifyTimeline(migratedHistory);
    } catch (error) {
      return invalidRead(
        slot,
        `legacy history has an invalid timeline: ${message(error)}`,
        recovery,
      );
    }
  }
  if (latest === undefined || !sameState(migratedHead, latest)) {
    migratedHistory = [...migratedHistory, migratedHead];
  }
  migratedHistory = bounded(migratedHistory);
  let fitted: ReturnType<typeof fitCheckpoint>;
  try {
    fitted = fitCheckpoint(migratedHistory);
  } catch (error) {
    return invalidRead(
      slot,
      `legacy history cannot be migrated: ${message(error)}`,
      recovery,
    );
  }
  return {
    head: fitted.head,
    history: fitted.history,
    error: null,
    notice:
      `${slotLabel(slot)} legacy storage is validated and ready to migrate.` +
      (fitted.pruned > 0
        ? ` ${fitted.pruned} oldest snapshot(s) will be dropped to fit the slot budget.`
        : ""),
    recovery: { head: fitted.head, history: fitted.history },
    canRecover: true,
    migration: fitted.raw,
  };
}

export function finishMigration(storage: Storage, slot: number, read: SlotRead): SlotRead {
  if (read.migration === null) return read;
  try {
    storage.setItem(checkpointKey(slot), read.migration);
  } catch (error) {
    return invalidRead(
      slot,
      `legacy storage was valid but migration failed: ${message(error)}`,
      read.recovery,
    );
  }
  return {
    ...read,
    notice: `Migrated ${slotLabel(slot).toLowerCase()} from validated legacy storage.`,
    migration: null,
  };
}

export function saveSlot(
  storage: Storage,
  slot: number,
  history: readonly GameState[],
  game: GameState,
): SlotWrite {
  if (history.length > 0) verifyTimeline(history);
  const latest = history[history.length - 1];
  const replacedTimeline = latest !== undefined && !canFollowTimeline(latest, game);
  const appended = replacedTimeline ? [game] : [...history, game];
  const nextHistory = bounded(appended);
  const fitted = fitCheckpoint(nextHistory);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return {
    head: fitted.head,
    history: fitted.history,
    pruned:
      (replacedTimeline ? history.length : appended.length - nextHistory.length) + fitted.pruned,
    replacedTimeline,
  };
}

export function rewindSlot(
  storage: Storage,
  slot: number,
  history: readonly GameState[],
): SlotWrite {
  const recalled = rewind(history, 1);
  const fitted = fitCheckpoint(recalled.history);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return {
    head: fitted.head,
    history: fitted.history,
    pruned: fitted.pruned,
    replacedTimeline: false,
  };
}

export function recoverSlot(
  storage: Storage,
  slot: number,
  current: GameState,
  recovery: SlotRecovery | null,
): SlotWrite {
  const sourceHead = recovery?.head ?? current;
  let sourceHistory = recovery?.history ?? [];
  const latest = sourceHistory[sourceHistory.length - 1];
  if (latest === undefined || !sameState(sourceHead, latest)) {
    sourceHistory = [...sourceHistory, sourceHead];
  }
  const history = bounded(sourceHistory);
  const fitted = fitCheckpoint(history);
  storage.setItem(checkpointKey(slot), fitted.raw);
  return {
    head: fitted.head,
    history: fitted.history,
    pruned: sourceHistory.length - history.length + fitted.pruned,
    replacedTimeline: false,
  };
}
