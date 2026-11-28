import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as DesktopAppUpdate from "../desktopUpdate/DesktopAppUpdate.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServiceLauncherClient from "./serviceLauncherClient.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";
import * as ServerSelfUpdate from "./selfUpdate.ts";

it("disables server self-update capability in all modes", () => {
  expect(
    ServerSelfUpdate.resolveServerSelfUpdateCapability({
      desktopManaged: true,
      launcherManaged: false,
    }),
  ).toBeNull();
  expect(
    ServerSelfUpdate.resolveServerSelfUpdateCapability({
      desktopManaged: false,
      launcherManaged: true,
    }),
  ).toBeNull();
});

it.layer(NodeServices.layer)("server self-update service (disabled)", (it) => {
  const makeTestSelfUpdate = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-self-update-disabled-" });
    const config = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    );
    const launcher = ServiceLauncherClient.ServiceLauncherClient.of({
      managed: true,
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      requestUpdate: () => Effect.die("launcher requestUpdate should not be called"),
      prepareTrial: () => Effect.undefined,
    });
    const desktopAppUpdate = DesktopAppUpdate.DesktopAppUpdate.of({
      available: false,
      run: () => Effect.die("desktop update run should not be called"),
      commit: () => Effect.die("desktop update commit should not be called"),
    });
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response("unexpected", { status: 500 })),
      ),
    );
    const processRunner = ProcessRunner.ProcessRunner.of({
      run: () => Effect.die("process runner should not be called"),
    });
    return yield* ServerSelfUpdate.make().pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      Effect.provideService(ServiceLauncherClient.ServiceLauncherClient, launcher),
      Effect.provideService(DesktopAppUpdate.DesktopAppUpdate, desktopAppUpdate),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Architecture, "x64"),
      Effect.provide(
        Layer.merge(ServerConfig.layer({ ...config, mode: "web" }), ManagedPolicy.layerTest()),
      ),
    );
  });

  it.effect("rejects update requests without downloading or contacting the launcher", () =>
    Effect.gen(function* () {
      const selfUpdate = yield* makeTestSelfUpdate;
      const error = yield* selfUpdate.update({ targetVersion: "1.2.0" }).pipe(Effect.flip);
      expect(error.reason).toBe("Automatic updates are disabled in this build.");
    }),
  );

  it.effect("rejects commitDesktopUpdate requests", () =>
    Effect.gen(function* () {
      const selfUpdate = yield* makeTestSelfUpdate;
      const error = yield* selfUpdate.commitDesktopUpdate("1.2.0").pipe(Effect.flip);
      expect(error.reason).toBe("Automatic updates are disabled in this build.");
    }),
  );
});

it.layer(NodeServices.layer)("pruning runtimes on start", (it) => {
  const staleVersion = "0.0.1";
  const otherProcesses = ProcessRunner.ProcessRunner.of({
    run: () =>
      Effect.succeed({
        stdout: "p42\nftxt\nn/bin/sh\n",
        stderr: "",
        code: ChildProcessSpawner.ExitCode(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  });

  const pruneOnStart = Effect.fn("test.prune_on_start")(function* (input: {
    readonly executable: "own runtime" | "elsewhere";
    readonly managed?: boolean;
    readonly symlinkedHome?: boolean;
    readonly servicePlistStarts?: string;
    readonly servicePlistThroughLink?: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-prune-on-start-" });
    const realHome = path.join(tempDir, "home");
    const baseDir = input.symlinkedHome ? path.join(tempDir, "linked-home") : realHome;
    const versionsDir = path.join(baseDir, "runtime", "versions");
    yield* TestClock.setTime(24 * 60 * 60 * 1000);
    for (const version of [staleVersion, packageJson.version]) {
      const directory = path.join(realHome, "runtime", "versions", version);
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(path.join(directory, "t3"), "");
      const sentinel = path.join(directory, ".install-complete");
      yield* fs.writeFileString(sentinel, `${version}\n`);
      yield* fs.utimes(sentinel, 0, 0);
    }
    if (input.symlinkedHome) yield* fs.symlink(realHome, baseDir);
    const userHome = path.join(tempDir, "user");
    if (input.servicePlistStarts !== undefined) {
      const agentsDir = path.join(userHome, "Library", "LaunchAgents");
      yield* fs.makeDirectory(agentsDir, { recursive: true });
      const programHome = input.servicePlistThroughLink
        ? path.join(tempDir, "alias-home")
        : baseDir;
      if (input.servicePlistThroughLink) yield* fs.symlink(realHome, programHome);
      const program = path.join(programHome, "runtime", "versions", input.servicePlistStarts, "t3");
      yield* fs.writeFileString(
        path.join(agentsDir, "com.t3tools.t3code.service.plist"),
        `<plist><dict>\n<key>ProgramArguments</key>\n<array>\n<string>${program}</string>\n<string>__service-launcher</string>\n</array>\n</dict></plist>\n`,
      );
    }
    // Like `process.execPath`, the running runtime is reported by its real path.
    const executablePath =
      input.executable === "own runtime"
        ? yield* fs.realPath(path.join(versionsDir, packageJson.version, "t3"))
        : "/usr/local/bin/node";
    const removed = yield* ServerSelfUpdate.pruneRuntimesOnStart({
      baseDir,
      managed: input.managed ?? false,
    }).pipe(
      Effect.provideService(HostProcess.ExecutablePath, executablePath),
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provideService(HostProcess.Environment, {}),
      Effect.provideService(HostProcess.HomeDirectory, userHome),
      Effect.provideService(ProcessRunner.ProcessRunner, otherProcesses),
    );
    return { removed, remaining: (yield* fs.readDirectory(versionsDir)).toSorted() };
  });

  // The SSH launcher runs `t3 serve` straight from the pinned runtime, with no boot service.
  it.effect("prunes for a server started from its home's pinned runtime", () =>
    Effect.gen(function* () {
      const { removed, remaining } = yield* pruneOnStart({ executable: "own runtime" });
      expect(removed).toEqual([staleVersion]);
      expect(remaining).toEqual([packageJson.version]);
    }),
  );

  it.effect("recognizes its runtime through a symlinked T3 home", () =>
    Effect.gen(function* () {
      const { removed } = yield* pruneOnStart({ executable: "own runtime", symlinkedHome: true });
      expect(removed).toEqual([staleVersion]);
    }),
  );

  it.effect("prunes for a boot-service server wherever it runs from", () =>
    Effect.gen(function* () {
      const { removed } = yield* pruneOnStart({ executable: "elsewhere", managed: true });
      expect(removed).toEqual([staleVersion]);
    }),
  );

  // In-place updates move the active version but leave the launch agent on the launcher's runtime.
  it.effect.each([
    { name: "", throughLink: false },
    { name: " through a symlinked T3 home", throughLink: true },
  ])("keeps the runtime a stopped service's launch agent starts$name", ({ throughLink }) =>
    Effect.gen(function* () {
      const { removed, remaining } = yield* pruneOnStart({
        executable: "own runtime",
        servicePlistStarts: staleVersion,
        servicePlistThroughLink: throughLink,
      });
      expect(removed).toEqual([]);
      expect(remaining).toEqual([staleVersion, packageJson.version].toSorted());
    }),
  );

  it.effect("leaves runtimes alone for an unmanaged server started elsewhere", () =>
    Effect.gen(function* () {
      const { removed, remaining } = yield* pruneOnStart({ executable: "elsewhere" });
      expect(removed).toEqual([]);
      expect(remaining).toEqual([staleVersion, packageJson.version].toSorted());
    }),
  );
});

it("a host crosses tracks only to a release that knows its whole database", () => {
  const cross = (
    serverVersion: string,
    targetVersion: string,
    targetDatabaseMigration: number | undefined,
    databaseMigration = 72,
  ) =>
    ServerSelfUpdate.trackSwitchBlockReason({
      serverVersion,
      targetVersion,
      targetDatabaseMigration,
      databaseMigration: () => databaseMigration,
    });
  const nightly = "0.1.4-nightly.20261027.3796";

  expect(cross(nightly, "0.1.4", 72)).toBeNull();
  // Another client moved this host to a newer Nightly after the switch was planned.
  expect(cross(nightly, "0.1.4", 72, 73)).toContain("does not support yet");
  expect(cross(nightly, "0.1.4", undefined)).toContain("Cannot confirm");
  // A Stable tag can carry a migration the latest Nightly lacks.
  expect(cross("0.1.4", nightly, 72, 73)).toContain("does not support yet");
  expect(cross("0.1.3", "0.1.4", undefined)).toBeNull();
  // A database that exists but cannot be read proves nothing.
  expect(
    ServerSelfUpdate.trackSwitchBlockReason({
      serverVersion: nightly,
      targetVersion: "0.1.4",
      targetDatabaseMigration: 72,
      databaseMigration: () => undefined,
    }),
  ).toContain("Cannot confirm");
});
