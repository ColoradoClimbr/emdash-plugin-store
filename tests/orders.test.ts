import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { ordersRoutes } from "../src/routes/orders.js";
import { makeCtx } from "./helpers.js";
import type { OrderRecord } from "../src/types.js";

const configuredSettings = {
  printfulApiKey: "pf_test",
  printfulStoreId: "",
  stripeSecretKey: "sk_test",
  siteOrigin: "https://everybittexas.com",
};

const recipient = {
  name: "Jo", email: "jo@x.test", address1: "1 Main", city: "Austin",
  stateCode: "TX", countryCode: "US", zip: "78701",
};

const cart = [{ syncProductId: 13, syncVariantId: 10, quantity: 2 }];

function makeOrder(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    sessionId: "cs_x",
    status: "fulfilled",
    amountCents: 6498,
    currency: "usd",
    email: "jo@x.test",
    cart,
    shippingRateId: "STANDARD",
    recipient,
    printfulOrderId: 555,
    lastError: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orders/list", () => {
  it("returns items filtered by status", async () => {
    const ctx = makeCtx({ settings: configuredSettings });
    await ctx.storage.orders.put("cs_paid", makeOrder({ sessionId: "cs_paid", status: "fulfilled", createdAt: "2026-07-01T00:00:00.000Z" }));
    await ctx.storage.orders.put("cs_failed", makeOrder({ sessionId: "cs_failed", status: "failed", createdAt: "2026-07-02T00:00:00.000Z" }));

    const result = (await ordersRoutes["orders/list"].handler({ ...ctx, input: { status: "failed" } } as never)) as { items: Array<{ id: string; data: OrderRecord }> };
    expect(result.items).toHaveLength(1);
    expect(result.items[0].data.sessionId).toBe("cs_failed");
  });

  it("rejects an invalid status value", async () => {
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      ordersRoutes["orders/list"].handler({ ...ctx, input: { status: "bogus" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("paginates via cursor — a small limit returns a cursor, and re-querying with it returns the rest", async () => {
    const ctx = makeCtx({ settings: configuredSettings });
    for (let i = 0; i < 5; i++) {
      await ctx.storage.orders.put(`cs_${i}`, makeOrder({ sessionId: `cs_${i}`, createdAt: `2026-07-0${i + 1}T00:00:00.000Z` }));
    }

    const first = (await ordersRoutes["orders/list"].handler({ ...ctx, input: { limit: 2 } } as never)) as {
      items: Array<{ id: string; data: OrderRecord }>; cursor?: string; hasMore: boolean;
    };
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();

    const second = (await ordersRoutes["orders/list"].handler({ ...ctx, input: { limit: 2, cursor: first.cursor } } as never)) as {
      items: Array<{ id: string; data: OrderRecord }>; cursor?: string; hasMore: boolean;
    };
    expect(second.items).toHaveLength(2);

    const third = (await ordersRoutes["orders/list"].handler({ ...ctx, input: { limit: 2, cursor: second.cursor } } as never)) as {
      items: Array<{ id: string; data: OrderRecord }>; cursor?: string; hasMore: boolean;
    };
    expect(third.items).toHaveLength(1);
    expect(third.hasMore).toBe(false);

    const allIds = [...first.items, ...second.items, ...third.items].map((i) => i.id).sort();
    expect(allIds).toEqual(["cs_0", "cs_1", "cs_2", "cs_3", "cs_4"]);
  });
});

describe("orders/reconcile", () => {
  function printfulProductResponse() {
    return JSON.stringify({
      code: 200,
      result: {
        sync_product: { id: 13, name: "T-shirt" },
        sync_variants: [{
          id: 10, name: "Red / M", retail_price: "29.99", currency: "USD",
          size: "M", color: "Red", availability_status: "active",
          product: { image: "https://x/v.png" },
        }],
      },
    });
  }

  function mockGlobal(opts: { orderCallCounter: { count: number } }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("api.printful.com")) {
        if (u.includes("/store/products/")) return Promise.resolve(new Response(printfulProductResponse(), { status: 200 }));
        if (u.includes("/orders")) {
          opts.orderCallCounter.count += 1;
          return Promise.resolve(new Response(JSON.stringify({ code: 200, result: { id: 555, status: "confirmed" } }), { status: 200 }));
        }
      }
      if (u.includes("api.stripe.com")) {
        if (u.includes("/checkout/sessions/cs_new")) {
          return Promise.resolve(new Response(JSON.stringify({
            id: "cs_new", payment_status: "paid", amount_total: 6498, currency: "usd",
            metadata: { source: "ebt-store", cart: JSON.stringify(cart), shippingRateId: "STANDARD", recipient: JSON.stringify(recipient) },
            customer_details: { email: "jo@x.test" },
          }), { status: 200 }));
        }
        if (u.includes("/checkout/sessions?")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "cs_new", payment_status: "paid", metadata: { source: "ebt-store" } },
              { id: "cs_existing", payment_status: "paid", metadata: { source: "ebt-store" } },
              { id: "cs_donate", payment_status: "paid", metadata: { source: "donate" } },
            ],
            has_more: false,
          }), { status: 200 }));
        }
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "unmocked url: " + u }), { status: 500 }));
    });
  }

  it("fulfills a new own-source session, skips an already-recorded one without re-hitting Printful, and excludes sessions from other plugins entirely", async () => {
    const orderCallCounter = { count: 0 };
    mockGlobal({ orderCallCounter });
    const ctx = makeCtx({ settings: configuredSettings });
    await ctx.storage.orders.put("cs_existing", makeOrder({ sessionId: "cs_existing", status: "fulfilled" }));

    const result = (await ordersRoutes["orders/reconcile"].handler({ ...ctx, input: {} } as never)) as {
      checked: number; results: Array<{ sessionId: string; status: string }>;
    };

    // Only the two "ebt-store" sessions were checked — the "donate" one from
    // another plugin sharing this Stripe account was filtered out entirely.
    expect(result.checked).toBe(2);
    expect(result.results.find((r) => r.sessionId === "cs_donate")).toBeUndefined();

    const newResult = result.results.find((r) => r.sessionId === "cs_new");
    expect(newResult?.status).toBe("fulfilled");
    expect(orderCallCounter.count).toBe(1); // Printful order created exactly once, for cs_new

    const existingResult = result.results.find((r) => r.sessionId === "cs_existing");
    expect(existingResult?.status).toBe("already");
  });

  it("rejects when the store isn't configured", async () => {
    const ctx = makeCtx({ settings: { printfulApiKey: "", stripeSecretKey: "", siteOrigin: "https://everybittexas.com" } });
    await expect(
      ordersRoutes["orders/reconcile"].handler({ ...ctx, input: {} } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
