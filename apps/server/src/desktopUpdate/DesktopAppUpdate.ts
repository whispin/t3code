import {
  ServerSelfUpdateError,
  type ServerSelfUpdateProgressStage,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";

export class DesktopAppUpdate extends Context.Service<
  DesktopAppUpdate,
  {
    readonly available: boolean;
    readonly run: (
      reportProgress: (
        stage: ServerSelfUpdateProgressStage,
      ) => Effect.Effect<void, ServerSelfUpdateError>,
      trackSwitch?: DesktopTelemetryReceiver.DesktopTrackSwitch,
    ) => Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>;
    /** Success stops the server; returns only on installation failure or timeout. */
    readonly commit: (
      requestId: string,
      onHandoffAccepted?: () => Effect.Effect<void>,
    ) => Effect.Effect<never, ServerSelfUpdateError>;
  }
>()("t3/desktopUpdate/DesktopAppUpdate") {}

export const make = (): Effect.Effect<DesktopAppUpdate["Service"]> => {
  const failDisabled = () =>
    new ServerSelfUpdateError({ reason: "Automatic updates are disabled in this build." });

  const run: DesktopAppUpdate["Service"]["run"] = Effect.fn("desktopUpdate.desktopAppUpdate.run")(
    function* (_reportProgress, _trackSwitch) {
      return yield* failDisabled();
    },
  );

  const commit: DesktopAppUpdate["Service"]["commit"] = Effect.fn(
    "desktopUpdate.desktopAppUpdate.commit",
  )(function* (_requestId, _onHandoffAccepted = () => Effect.void) {
    return yield* failDisabled();
  });

  return Effect.succeed(DesktopAppUpdate.of({ available: false, run, commit }));
};

export const layer = Layer.effect(DesktopAppUpdate, make());
