import {
  ServerSelfUpdateError,
  type ServerSelfUpdateCapability,
  type ServerSelfUpdateInput,
  type ServerSelfUpdateProgressEvent,
  type ServerSelfUpdateProgressStage,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { crossesReleaseTrack } from "@t3tools/shared/cliRelease";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import { pinnedRuntimePaths, prunePinnedRuntimes } from "./pinnedRuntime.ts";
import { bootServiceProgramOf, bootServiceUnitPath } from "./bootService.ts";
import * as ServiceLauncherClient from "./serviceLauncherClient.ts";
import { decodeServiceUnit } from "./serviceProtocol.ts";

export function resolveServerSelfUpdateCapability(_input: {
  readonly desktopManaged: boolean;
  readonly launcherManaged: boolean;
}): ServerSelfUpdateCapability | null {
  return null;
}

export class ServerSelfUpdate extends Context.Service<
  ServerSelfUpdate,
  {
    readonly update: (
      input: ServerSelfUpdateInput,
      reportProgress?: (
        stage: ServerSelfUpdateProgressStage,
      ) => Effect.Effect<void, ServerSelfUpdateError>,
      onHandoffAccepted?: () => Effect.Effect<void>,
    ) => Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>;
    readonly commitDesktopUpdate: (
      requestId: string,
      onHandoffAccepted?: () => Effect.Effect<void>,
    ) => Effect.Effect<never, ServerSelfUpdateError>;
  }
>()("t3/cloud/selfUpdate/ServerSelfUpdate") {}

/**
 * A server starting from the runtime its launcher settled on means runtimes left by earlier
 * updates can go. The boot service says so through its IPC context. The SSH launcher and the
 * install script's `t3` start this home's pinned runtime directly, without one.
 */
export const pruneRuntimesOnStart = Effect.fn("cloud.server_self_update.prune_on_start")(
  function* (input: { readonly baseDir: string; readonly managed: boolean }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcess.Platform;
    const executablePath = yield* HostProcess.ExecutablePath;
    const { entryPath } = pinnedRuntimePaths(path, input.baseDir, packageJson.version, platform);
    // The executable path is resolved, so it names the real path of a symlinked T3 home.
    const realEntryPath = yield* fs.realPath(entryPath).pipe(Effect.orElseSucceed(() => entryPath));
    if (!input.managed && executablePath !== entryPath && executablePath !== realEntryPath) {
      return [];
    }
    const unitPath = yield* bootServiceUnitPath();
    // A stopped service's unit still names the launcher runtime it will start.
    const unit =
      unitPath === undefined
        ? Option.none<string>()
        : yield* fs.readFile(unitPath).pipe(Effect.map(decodeServiceUnit), Effect.option);
    const program = Option.flatMapNullishOr(unit, bootServiceProgramOf);
    // The unit may name it through another spelling of a symlinked T3 home.
    const references = Option.isNone(program)
      ? []
      : [
          program.value,
          yield* fs.realPath(program.value).pipe(Effect.orElseSucceed(() => program.value)),
        ];
    const removed = yield* prunePinnedRuntimes({
      baseDir: input.baseDir,
      keep: [packageJson.version],
      references,
    });
    if (removed.length > 0) {
      yield* Effect.logInfo("Removed unused t3 runtimes.", { versions: removed });
    }
    return removed;
  },
);

/** The client checks this when planning; the host checks again because its database may have
 * moved on since (another client updated it). Stable and Nightly each build their own commits,
 * so crossing tracks needs the target release to know every migration this database holds. */
export function trackSwitchBlockReason(input: {
  readonly serverVersion: string;
  readonly targetVersion: string;
  readonly targetDatabaseMigration: number | undefined;
  /** Read only for a crossing; undefined when the database cannot be read. */
  readonly databaseMigration: () => number | undefined;
}): string | null {
  if (!crossesReleaseTrack(input.serverVersion, input.targetVersion)) return null;
  const databaseMigration = input.databaseMigration();
  if (input.targetDatabaseMigration === undefined || databaseMigration === undefined) {
    return `Cannot confirm this database works with t3@${input.targetVersion}. Switch tracks from Settings → About → Update track, which checks it first.`;
  }
  return input.targetDatabaseMigration < databaseMigration
    ? `This database has changes t3@${input.targetVersion} does not support yet; it stays on this release.`
    : null;
}

export const make = Effect.fn("cloud.server_self_update.make")(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;

  yield* pruneRuntimesOnStart({ baseDir: serverConfig.baseDir, managed: launcher.managed }).pipe(
    Effect.forkScoped,
  );

  const failWith = (reason: string, cause?: unknown) =>
    cause === undefined
      ? new ServerSelfUpdateError({ reason })
      : new ServerSelfUpdateError({ reason, cause });

  const update: ServerSelfUpdate["Service"]["update"] = Effect.fn(
    "cloud.server_self_update.update",
  )(function* (
    _input,
    _reportProgress = () => Effect.void,
    _onHandoffAccepted = () => Effect.void,
  ) {
    return yield* failWith("Automatic updates are disabled in this build.");
  });

  return ServerSelfUpdate.of({
    update,
    commitDesktopUpdate: Effect.fn("ServerSelfUpdate.commitDesktopUpdate")(
      function (_requestId, _onHandoffAccepted) {
        return failWith("Automatic updates are disabled in this build.");
      },
    ),
  });
});

export const layer = Layer.effect(ServerSelfUpdate, make());

// The update outlives client sockets; progress offers to a closed queue are ignored.
export const updateProgressStream = (
  selfUpdate: ServerSelfUpdate["Service"],
  input: ServerSelfUpdateInput,
) =>
  Stream.callback<ServerSelfUpdateProgressEvent, ServerSelfUpdateError>((queue) => {
    const offer = (event: ServerSelfUpdateProgressEvent) =>
      Queue.offer(queue, event).pipe(Effect.ignore);

    return selfUpdate
      .update(input, (stage) => offer({ type: "progress", stage }))
      .pipe(
        Effect.flatMap((result) => offer({ type: "complete", result })),
        Effect.catchTags({
          ServerSelfUpdateError: (error) => Queue.fail(queue, error).pipe(Effect.ignore),
        }),
        Effect.andThen(Queue.end(queue).pipe(Effect.ignore)),
        Effect.forkDetach,
      );
  });
