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

import { buildSettingsSchema } from "../src/secrets.js";
import { SECRET_KEYS as STORE_SECRET_KEYS } from "../src/settings.js";
import { DEFAULT_SETTINGS as STORE_DEFAULTS } from "../src/types.js";

describe("secrets schema", () => {
  it("marks exactly the secret keys as secret and covers every setting", () => {
    const schema = buildSettingsSchema(STORE_DEFAULTS, STORE_SECRET_KEYS);
    expect(Object.keys(schema).sort()).toEqual(Object.keys(STORE_DEFAULTS).sort());
    expect(Object.entries(schema).filter(([, f]) => f.type === "secret").map(([k]) => k).sort()).toEqual([...STORE_SECRET_KEYS].sort());
  });
});
