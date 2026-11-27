import type { ProviderDriverKind } from "@t3tools/contracts";

import type {
  HttpTransferMeasurement,
  WebSocketTransferTotals,
} from "./NetworkTransferMeasurement.integration.ts";

export interface WebSocketCatchUpMeasurement extends WebSocketTransferTotals {
  readonly mode: "replay" | "snapshot";
}

export interface TimelineHttpMeasurement {
  readonly http: HttpTransferMeasurement;
  readonly rows: number;
}

const STALE_TODO_RECORD_KINDS = [
  "nodes",
  "subagents",
  "plans",
  "providerTurns",
  "checkpoints",
] as const;
type StaleTodoRecordCounts = Readonly<Record<(typeof STALE_TODO_RECORD_KINDS)[number], number>>;

/** One new socket, read from the subscribe call until the subscription caught up. */
export interface SocketOpenMeasurement {
  readonly totals: WebSocketTransferTotals;
}

export interface TransferBudgetRun {
  readonly provider: ProviderDriverKind;
  readonly threadSnapshot: HttpTransferMeasurement;
  readonly measuredTurnWebSocket: WebSocketTransferTotals;
  readonly shellSnapshot: HttpTransferMeasurement;
  readonly measuredTurnShellWebSocket: WebSocketTransferTotals;
  readonly measuredTurnSecondClientWebSocket: WebSocketTransferTotals;
  readonly reconnectThread: WebSocketCatchUpMeasurement;
  readonly reconnectShell: WebSocketCatchUpMeasurement;
  readonly measuredTurnSqlStatements: number;
  readonly reconnectSqlStatements: number;
  /** A thread resumed from the cursor it held before one ordinary turn. */
  readonly shortTurnResume: SocketOpenMeasurement;
  /** The long-turn thread while its last turn runs: the bounded snapshot, then one older page. */
  readonly longTurnRunningColdOpen: TimelineHttpMeasurement;
  readonly longTurnRunningHistoryPage: TimelineHttpMeasurement;
  /** The same reads as an older client that only sends `compactTurnItems`, to show the savings. */
  readonly longTurnRunningColdOpenLegacy: TimelineHttpMeasurement;
  readonly longTurnRunningHistoryPageLegacy: TimelineHttpMeasurement;
  /** The same thread once the turn finished, over HTTP (web) and over the socket alone (mobile). */
  readonly longTurnColdOpen: TimelineHttpMeasurement;
  readonly longTurnSocketColdOpen: SocketOpenMeasurement & { readonly rows: number };
  /** The first page of the finished turn's deferred work, loaded when its group is expanded. */
  readonly longTurnWorkPage: TimelineHttpMeasurement;
  /** A thread resumed from the cursor of its own last event. */
  readonly idleThreadResume: SocketOpenMeasurement;
  /** The cold-connect shell snapshot after the settled-thread fleet is written. */
  readonly fleetShell: TimelineHttpMeasurement;
  readonly fleetShellLegacy: TimelineHttpMeasurement;
  /** The shell subscription a cold connect opens from that snapshot's cursor. */
  readonly fleetShellSubscribe: SocketOpenMeasurement;
  /** A client that holds that snapshot's rows asks the HTTP route whether they still resume. */
  readonly fleetShellResume: TimelineHttpMeasurement;
  /** The same question from a cursor too old to replay: the route answers with the snapshot. */
  readonly staleShellReload: TimelineHttpMeasurement;
  /** A shell resumed over the socket from that old cursor, by a client that reloads over HTTP. */
  readonly staleShellResume: SocketOpenMeasurement;
  /**
   * The compact bounded snapshot of the long thread whose finished runs left todo lists open,
   * with the count of each record kind that rides along with its rows.
   */
  readonly staleTodoColdOpen: TimelineHttpMeasurement & {
    readonly records: StaleTodoRecordCounts;
  };
}

interface ProviderTransferBudget {
  readonly totalWireBytes: number;
  readonly threadSnapshotWireBytes: number;
  readonly measuredTurnWebSocketWireBytes: number;
  readonly measuredTurnWebSocketDecodedBytes: number;
  readonly measuredTurnWebSocketMessages: number;
}

// The measured turn decodes to about 22 KB; without live body dedupe its repeated answer makes it 26 KB.
const TRANSFER_BUDGET = {
  totalWireBytes: 7_000,
  threadSnapshotWireBytes: 5_000,
  measuredTurnWebSocketWireBytes: 2_000,
  measuredTurnWebSocketDecodedBytes: 25_000,
  measuredTurnWebSocketMessages: 8,
} satisfies ProviderTransferBudget;

const TRANSFER_BUDGETS: Readonly<Record<string, ProviderTransferBudget>> = {
  codex: TRANSFER_BUDGET,
  claudeAgent: TRANSFER_BUDGET,
};

// Decoded bytes, not wire bytes: phones parse and keep the decoded JSON. About 15% above the
// observed 95 KB history page, so a page without the ID table (130 KB) or row budgets fails.
// Kept apart from TRANSFER_BUDGET because the scenario checks use their own ceilings.
const LONG_TURN_PAGE_BUDGET = {
  decodedBytes: 110_000,
  rows: 75,
};

// About 7% above the observed 290 KB. The window holds 75 rows, but every message of a running
// turn rides along with it: 196 KB here. Without body dedupe or the ID table it is 354 KB.
const LONG_TURN_RUNNING_BUDGET = {
  decodedBytes: 310_000,
  rows: 75,
};

// About 7% above the observed 393 KB. A finished turn defers its 770 work rows and stays whole:
// 151 rows of messages, checkpoints and subagents, on both transports.
const LONG_TURN_FINISHED_BUDGET = {
  decodedBytes: 420_000,
  rows: 151,
};

// About 6% above the observed 193 KB: one older page of work, twice the cold-open row budget.
const LONG_TURN_WORK_PAGE_BUDGET = {
  decodedBytes: 205_000,
  rows: 150,
};

const SOCKET_BUDGETS = {
  // One ordinary turn replays in 11 KB. With its tool bodies it is over 900 KB.
  shortTurnResume: { decodedBytes: 13_000, messages: 2 },
  longTurnColdOpen: { decodedBytes: LONG_TURN_FINISHED_BUDGET.decodedBytes, messages: 2 },
  // These three send no rows. A snapshot in their place is 393 KB for the thread, 42 KB for the shell.
  idleThreadResume: { decodedBytes: 200, messages: 1 },
  // A subscribe that does not name the snapshot's project identities gets the project again: 851 B.
  fleetShellSubscribe: { decodedBytes: 200, messages: 1 },
  staleShellResume: { decodedBytes: 400, messages: 2 },
};

// About 30% above the observed 42 KB. Without the shell opt-ins it carries all 142 rows (217 KB).
const FLEET_SHELL_BUDGET = {
  decodedBytes: 55_000,
  rows: 27,
};

// The answer is `{"resumable":true}`. A snapshot in its place is 42 KB.
const FLEET_SHELL_RESUME_BUDGET = {
  decodedBytes: 100,
  rows: 0,
};

// About 14% above the observed 75 KB. The window holds the working run only: 2 nodes, 2 subagents,
// 1 plan, 1 provider turn and the last finished turn's checkpoint. When finished runs ride along
// it holds 82 nodes, 82 subagents, 41 plans, 41 provider turns, 40 checkpoints and 740 KB.
// The working run's ready handoff ships without its 256 KB history; with it the open is 339 KB.
const STALE_TODO_BUDGET = {
  decodedBytes: 85_000,
  rows: 75,
  records: {
    nodes: 4,
    subagents: 4,
    plans: 2,
    providerTurns: 2,
    checkpoints: 2,
  } satisfies StaleTodoRecordCounts,
};

function totalWireBytes(run: TransferBudgetRun): number {
  return run.threadSnapshot.wireBytes + run.measuredTurnWebSocket.wireBytes;
}

interface ScenarioRow {
  readonly phase: string;
  readonly metric: string;
  readonly unit: "bytes" | "count";
  readonly observed: number;
  /** Absent on figures that only inform: wire bytes, and what an older client receives. */
  readonly maximum: number | undefined;
}

function httpRows(
  phase: string,
  measured: TimelineHttpMeasurement,
  budget?: { readonly decodedBytes: number; readonly rows: number },
): ScenarioRow[] {
  return [
    {
      phase,
      metric: "HTTP wire",
      unit: "bytes",
      observed: measured.http.wireBytes,
      maximum: undefined,
    },
    {
      phase,
      metric: "HTTP decoded",
      unit: "bytes",
      observed: measured.http.decodedBodyBytes,
      maximum: budget?.decodedBytes,
    },
    { phase, metric: "rows", unit: "count", observed: measured.rows, maximum: budget?.rows },
  ];
}

function socketRows(
  phase: string,
  { totals }: SocketOpenMeasurement,
  budget: { readonly decodedBytes: number; readonly messages: number },
): ScenarioRow[] {
  return [
    {
      phase,
      metric: "WebSocket wire",
      unit: "bytes",
      observed: totals.wireBytes,
      maximum: undefined,
    },
    {
      phase,
      metric: "WebSocket decoded",
      unit: "bytes",
      observed: totals.decodedBytes,
      maximum: budget.decodedBytes,
    },
    {
      phase,
      metric: "WebSocket messages",
      unit: "count",
      observed: totals.messages,
      maximum: budget.messages,
    },
  ];
}

function scenarioRows(run: TransferBudgetRun): ScenarioRow[] {
  return [
    ...socketRows("short turn resume", run.shortTurnResume, SOCKET_BUDGETS.shortTurnResume),
    ...httpRows(
      "long turn running, cold open",
      run.longTurnRunningColdOpen,
      LONG_TURN_RUNNING_BUDGET,
    ),
    ...httpRows("long turn running, cold open, older client", run.longTurnRunningColdOpenLegacy),
    ...httpRows(
      "long turn running, history page",
      run.longTurnRunningHistoryPage,
      LONG_TURN_PAGE_BUDGET,
    ),
    ...httpRows(
      "long turn running, history page, older client",
      run.longTurnRunningHistoryPageLegacy,
    ),
    ...httpRows("long turn finished, cold open", run.longTurnColdOpen, LONG_TURN_FINISHED_BUDGET),
    ...socketRows(
      "long turn finished, socket cold open",
      run.longTurnSocketColdOpen,
      SOCKET_BUDGETS.longTurnColdOpen,
    ),
    {
      phase: "long turn finished, socket cold open",
      metric: "rows",
      unit: "count",
      observed: run.longTurnSocketColdOpen.rows,
      maximum: LONG_TURN_FINISHED_BUDGET.rows,
    },
    ...httpRows("long turn finished, work page", run.longTurnWorkPage, LONG_TURN_WORK_PAGE_BUDGET),
    ...socketRows("idle thread resume", run.idleThreadResume, SOCKET_BUDGETS.idleThreadResume),
    ...httpRows("fleet shell snapshot", run.fleetShell, FLEET_SHELL_BUDGET),
    ...httpRows("fleet shell snapshot, older client", run.fleetShellLegacy),
    ...socketRows(
      "fleet shell subscribe",
      run.fleetShellSubscribe,
      SOCKET_BUDGETS.fleetShellSubscribe,
    ),
    ...httpRows("fleet shell resume check", run.fleetShellResume, FLEET_SHELL_RESUME_BUDGET),
    ...httpRows("stale shell reload", run.staleShellReload, FLEET_SHELL_BUDGET),
    ...socketRows("stale shell resume", run.staleShellResume, SOCKET_BUDGETS.staleShellResume),
    ...httpRows("stale todo list cold open", run.staleTodoColdOpen, STALE_TODO_BUDGET),
    ...STALE_TODO_RECORD_KINDS.map((kind): ScenarioRow => ({
      phase: "stale todo list cold open",
      metric: kind,
      unit: "count",
      observed: run.staleTodoColdOpen.records[kind],
      maximum: STALE_TODO_BUDGET.records[kind],
    })),
  ];
}

export function transferBudgetViolations(runs: ReadonlyArray<TransferBudgetRun>): string[] {
  const violations: string[] = [];
  for (const run of runs) {
    const budget = TRANSFER_BUDGETS[run.provider];
    if (!budget) {
      violations.push(`${run.provider}: no transfer budget is configured`);
      continue;
    }
    const checks = [
      ["total thread wire bytes", totalWireBytes(run), budget.totalWireBytes],
      ["thread snapshot wire bytes", run.threadSnapshot.wireBytes, budget.threadSnapshotWireBytes],
      [
        "measured-turn WebSocket wire bytes",
        run.measuredTurnWebSocket.wireBytes,
        budget.measuredTurnWebSocketWireBytes,
      ],
      [
        "measured-turn WebSocket decoded bytes",
        run.measuredTurnWebSocket.decodedBytes,
        budget.measuredTurnWebSocketDecodedBytes,
      ],
      [
        "measured-turn WebSocket messages",
        run.measuredTurnWebSocket.messages,
        budget.measuredTurnWebSocketMessages,
      ],
      ...scenarioRows(run).flatMap(({ phase, metric, observed, maximum }) =>
        maximum === undefined ? [] : [[`${phase} ${metric}`, observed, maximum] as const],
      ),
    ] as const;
    for (const [metric, observed, maximum] of checks) {
      if (observed > maximum) {
        violations.push(`${run.provider}: ${metric} was ${observed}, maximum ${maximum}`);
      }
    }
  }
  return violations;
}
