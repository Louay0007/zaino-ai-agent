import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ name: string; args: unknown }> = [];

vi.mock("@/lib/ipc", () => ({
  ipc: {
    upsertProvider: (engine: string, id: string, json: unknown) => {
      calls.push({ name: "upsertProvider", args: { engine, id, json } });
      return Promise.resolve();
    },
    setCurrentProvider: (engine: string, id: string) => {
      calls.push({ name: "setCurrentProvider", args: { engine, id } });
      return Promise.resolve();
    },
    getAppSettings: () =>
      Promise.resolve({ defaultModels: { claude: "opus" }, defaultEfforts: {} }),
    updateAppSettings: (settings: { defaultModels: Record<string, string> }) => {
      calls.push({ name: "updateAppSettings", args: settings });
      return Promise.resolve();
    },
  },
}));

import { setupClaudeChannel } from "./setup";

describe("gateway channel setup", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("registers the zaino channel with NO apiKey field and defaults to first alias", async () => {
    const { defaultModel } = await setupClaudeChannel(["smart", "fast"]);
    expect(defaultModel).toBe("fast");

    const upsert = calls.find((c) => c.name === "upsertProvider");
    expect(upsert?.args).toMatchObject({ engine: "claude", id: "zaino" });
    const json = (upsert?.args as { json: Record<string, unknown> }).json;
    expect(json.gateway).toBe("zaino-v1");
    // The whole point: no secret material in the stored channel.
    expect(json).not.toHaveProperty("apiKey");
    expect(JSON.stringify(json)).not.toMatch(/zn-/);

    expect(calls.find((c) => c.name === "setCurrentProvider")?.args).toMatchObject({
      engine: "claude",
      id: "zaino",
    });
    const update = calls.find((c) => c.name === "updateAppSettings");
    expect((update?.args as { defaultModels: Record<string, string> }).defaultModels.claude).toBe(
      "fast",
    );
  });

  it("refuses an empty model list", async () => {
    await expect(setupClaudeChannel([])).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
