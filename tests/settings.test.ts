import { describe, it, expect } from "vitest";
import { getSettings } from "../src/settings.js";
import { makeCtx } from "./helpers.js";

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const ctx = makeCtx();
    const settings = await getSettings(ctx as never);
    expect(settings.printfulApiKey).toBe("");
    expect(settings.siteOrigin).toBe("https://everybittexas.com");
  });

  it("overrides defaults with stored values", async () => {
    const ctx = makeCtx({ settings: { printfulApiKey: "pf_abc123" } });
    const settings = await getSettings(ctx as never);
    expect(settings.printfulApiKey).toBe("pf_abc123");
  });
});
