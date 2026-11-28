import { AppState } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  installAppUpdateChecks,
  isAppUpdateCheckAvailable,
  runAppUpdateCheck,
  type AppUpdateClient,
} from "./app-updates";

vi.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

function makeUpdateClient(): AppUpdateClient {
  return {
    isEnabled: true,
    checkForUpdateAsync: vi.fn(async () => ({
      isAvailable: false,
      isRollBackToEmbedded: false,
    })),
    fetchUpdateAsync: vi.fn(async () => ({
      isNew: true,
      isRollBackToEmbedded: false,
    })),
    reloadAsync: vi.fn(async () => {}),
  };
}

describe("app-updates (auto updates disabled)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports app update checks as unavailable even when expo-updates reports enabled", () => {
    const client = makeUpdateClient();
    expect(isAppUpdateCheckAvailable(client)).toBe(false);
    expect(isAppUpdateCheckAvailable()).toBe(false);
  });

  it("does not contact Expo Updates on manual or background checks", async () => {
    const client = makeUpdateClient();
    await runAppUpdateCheck({ client, applyMode: "immediate" });
    await runAppUpdateCheck({ client });

    expect(client.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(client.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(client.reloadAsync).not.toHaveBeenCalled();
  });

  it("does not register foreground listeners when installing update checks", () => {
    const client = makeUpdateClient();
    const cleanup = installAppUpdateChecks(client);
    cleanup();

    expect(AppState.addEventListener).not.toHaveBeenCalled();
    expect(client.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});
