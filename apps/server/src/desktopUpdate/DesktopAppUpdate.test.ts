import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopAppUpdate from "./DesktopAppUpdate.ts";

it.effect("keeps desktop app updates disabled", () =>
  Effect.gen(function* () {
    const service = yield* DesktopAppUpdate.make();
    expect(service.available).toBe(false);
    expect((yield* service.run(() => Effect.void).pipe(Effect.flip)).reason).toBe(
      "Automatic updates are disabled in this build.",
    );
    expect((yield* service.commit("req-1").pipe(Effect.flip)).reason).toBe(
      "Automatic updates are disabled in this build.",
    );
  }),
);
