import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as NpmRelease from "./npmRelease.ts";

const makeService = () => NpmRelease.make();

it.effect.each(["0.1.5-nightly.20261030.1", "nightly", "latest"] as const)(
  "returns null without contacting npm for %s when updates are disabled",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* makeService();
      expect(yield* service.get({ spec })).toBeNull();
    }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "still rejects invalid release specs: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* makeService();
      const result = yield* service.get({ spec }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ServerNpmReleaseError);
      }
    }),
);
