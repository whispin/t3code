import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

export const make = (): Effect.Effect<NpmRelease["Service"]> =>
  Effect.succeed(
    NpmRelease.of({
      get: Effect.fn("NpmRelease.get")(function* (input) {
        yield* decodeInput(input).pipe(
          Effect.mapError(
            () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
          ),
        );
        return null;
      }),
    }),
  );

export const layer = Layer.effect(NpmRelease, make());
