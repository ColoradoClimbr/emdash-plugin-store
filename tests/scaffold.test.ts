import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types.js";
import { makeCtx } from "./helpers.js";

describe("scaffold", () => {
  it("DEFAULT_SETTINGS has all required keys", () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      ["printfulApiKey", "printfulStoreId", "siteOrigin", "stripeSecretKey"].sort(),
    );
  });

  it("makeCtx() produces a working orders collection", async () => {
    const ctx = makeCtx();
    await ctx.storage.orders.put("sess_1", { sessionId: "sess_1" } as never);
    const got = await ctx.storage.orders.get("sess_1");
    expect(got).toEqual({ sessionId: "sess_1" });
  });
});
