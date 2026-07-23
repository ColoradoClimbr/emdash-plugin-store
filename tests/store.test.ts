import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { storeRoutes } from "../src/routes/store.js";
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

function printfulProductResponse(overrides?: Partial<{ retailPrice: string; availabilityStatus: string }>) {
  return JSON.stringify({
    code: 200,
    result: {
      sync_product: { id: 13, name: "T-shirt" },
      sync_variants: [{
        id: 10, name: "Red / M", retail_price: overrides?.retailPrice ?? "29.99", currency: "USD",
        size: "M", color: "Red", availability_status: overrides?.availabilityStatus ?? "active",
        product: { image: "https://x/v.png" },
      }],
    },
  });
}

function printfulRatesResponse() {
  return JSON.stringify({
    code: 200,
    result: { rates: [{ id: "STANDARD", name: "Standard", rate: "5.00", currency: "USD", minDeliveryDays: 5, maxDeliveryDays: 7 }] },
  });
}

// Dispatches Printful mock responses by URL/method, and lets a test count or
// capture the /orders POST specifically (that's the fulfillment call whose
// idempotency and failure handling this file cares about most).
function printfulDispatcher(opts: {
  productOverrides?: Partial<{ retailPrice: string; availabilityStatus: string }>;
  onOrderCreate?: (init?: RequestInit) => Response;
  orderCallCounter?: { count: number };
}) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes("/store/products/")) return new Response(printfulProductResponse(opts.productOverrides), { status: 200 });
    if (url.includes("/store/products")) return new Response(JSON.stringify({ code: 200, result: [{ id: 13, name: "T-shirt", thumbnail_url: "https://x/t.png" }] }), { status: 200 });
    if (url.includes("/shipping/rates")) return new Response(printfulRatesResponse(), { status: 200 });
    if (url.includes("/orders")) {
      if (opts.orderCallCounter) opts.orderCallCounter.count += 1;
      if (opts.onOrderCreate) return opts.onOrderCreate(init);
      return new Response(JSON.stringify({ code: 200, result: { id: 555, status: "confirmed" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unmocked printful url: " + url }), { status: 500 });
  };
}

function stripeDispatcher(opts: {
  session?: Record<string, unknown>;
  onCheckoutSessionCreate?: (init?: RequestInit) => Response;
}) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes("/customers")) return new Response(JSON.stringify({ id: "cus_1" }), { status: 200 });
    if (url.includes("/checkout/sessions/")) {
      return new Response(JSON.stringify(opts.session ?? {
        id: "cs_1", payment_status: "paid", amount_total: 3499, currency: "usd",
        metadata: {}, customer_details: { email: "jo@x.test" },
      }), { status: 200 });
    }
    if (url.includes("/checkout/sessions")) {
      if (opts.onCheckoutSessionCreate) return opts.onCheckoutSessionCreate(init);
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unmocked stripe url: " + url }), { status: 500 });
  };
}

function mockGlobalFetch(printful: ReturnType<typeof printfulDispatcher>, stripe: ReturnType<typeof stripeDispatcher>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    if (u.includes("api.printful.com")) return Promise.resolve(printful(u, init as RequestInit));
    if (u.includes("api.stripe.com")) return Promise.resolve(stripe(u, init as RequestInit));
    return Promise.resolve(new Response(JSON.stringify({ error: "unmocked url: " + u }), { status: 500 }));
  });
}

const cart = [{ syncProductId: 13, syncVariantId: 10, quantity: 2 }];

describe("products/list", () => {
  it("returns mapped products from a mocked Printful response", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: configuredSettings });
    const result = (await storeRoutes["products/list"].handler(ctx as never)) as { products: unknown };
    expect(result.products).toEqual([{ id: 13, name: "T-shirt", thumbnailUrl: "https://x/t.png" }]);
  });
});

describe("products/get", () => {
  it("returns a product with variants", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: configuredSettings });
    const result = (await storeRoutes["products/get"].handler({ ...ctx, input: { syncProductId: 13 } } as never)) as { product: { variants: unknown[] } };
    expect(result.product.variants).toHaveLength(1);
    expect(result.product.variants[0]).toMatchObject({ id: 10, retailPrice: "29.99" });
  });

  it("rejects a non-positive-integer syncProductId", async () => {
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["products/get"].handler({ ...ctx, input: { syncProductId: -1 } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("cart/shipping-rates", () => {
  it("returns rates for a valid cart", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: configuredSettings });
    const result = (await storeRoutes["cart/shipping-rates"].handler({ ...ctx, input: { recipient, items: cart } } as never)) as { rates: unknown[] };
    expect(result.rates).toEqual([{ id: "STANDARD", name: "Standard", rate: "5.00", currency: "USD", minDeliveryDays: 5, maxDeliveryDays: 7 }]);
  });

  it("rejects an empty items array", async () => {
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["cart/shipping-rates"].handler({ ...ctx, input: { recipient, items: [] } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("checkout/create-session", () => {
  it("rejects an invalid origin", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: configuredSettings, origin: "https://evil.test" });
    await expect(
      storeRoutes["checkout/create-session"].handler({ ...ctx, input: { recipient, items: cart, shippingRateId: "STANDARD" } } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects when the store isn't configured", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: { printfulApiKey: "", stripeSecretKey: "", siteOrigin: "https://everybittexas.com" } });
    await expect(
      storeRoutes["checkout/create-session"].handler({ ...ctx, input: { recipient, items: cart, shippingRateId: "STANDARD" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an unknown shippingRateId", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({}));
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["checkout/create-session"].handler({ ...ctx, input: { recipient, items: cart, shippingRateId: "NOPE" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns a clean 400 (not a raw PrintfulApiError) for an unknown/deleted syncProductId", async () => {
    mockGlobalFetch(
      (url) => {
        if (url.includes("/store/products/")) return new Response(JSON.stringify({ code: 404, error: { message: "Not found" } }), { status: 404 });
        return new Response(JSON.stringify({ error: "unmocked printful url: " + url }), { status: 500 });
      },
      stripeDispatcher({}),
    );
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["checkout/create-session"].handler({ ...ctx, input: { recipient, items: cart, shippingRateId: "STANDARD" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("computes unit_amount server-side from Printful's retail_price, ignoring any client price, and returns { url }", async () => {
    let captured = "";
    mockGlobalFetch(
      printfulDispatcher({ productOverrides: { retailPrice: "29.99" } }),
      stripeDispatcher({ onCheckoutSessionCreate: (init) => { captured = String(init?.body); return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 }); } }),
    );
    const ctx = makeCtx({ settings: configuredSettings });
    // Client-supplied price/amount fields, if any were sent, must be ignored.
    const maliciousItems = [{ syncProductId: 13, syncVariantId: 10, quantity: 2, retailPrice: "0.01" }];
    const result = (await storeRoutes["checkout/create-session"].handler(
      { ...ctx, input: { recipient, items: maliciousItems, shippingRateId: "STANDARD" } } as never,
    )) as { url: string };
    expect(result.url).toBe("https://checkout.stripe.com/cs_1");
    // 29.99 * 100 = 2999, quantity from cart is on the line item, not baked into unit_amount.
    expect(captured).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2999");
    expect(captured).toContain("line_items%5B0%5D%5Bquantity%5D=2");
    // Shipping line item amount comes from the matched Printful rate (5.00 -> 500), not the client.
    expect(captured).toContain("line_items%5B1%5D%5Bprice_data%5D%5Bunit_amount%5D=500");
  });
});

describe("checkout/confirm", () => {
  it("rejects an unpaid session", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({ session: { id: "cs_unpaid", payment_status: "unpaid", amount_total: 3499, currency: "usd", metadata: {}, customer_details: null } }));
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["checkout/confirm"].handler({ ...ctx, input: { sessionId: "cs_unpaid" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("on a paid session, calls createPrintfulOrder and stores a fulfilled OrderRecord; a second call is idempotent and does not re-hit Printful order creation", async () => {
    const orderCallCounter = { count: 0 };
    const metadata = { source: "ebt-store", cart: JSON.stringify(cart), shippingRateId: "STANDARD", recipient: JSON.stringify(recipient) };
    mockGlobalFetch(
      printfulDispatcher({ orderCallCounter }),
      stripeDispatcher({ session: { id: "cs_paid", payment_status: "paid", amount_total: 6498, currency: "usd", metadata, customer_details: { email: "jo@x.test" } } }),
    );
    const ctx = makeCtx({ settings: configuredSettings });

    const first = (await storeRoutes["checkout/confirm"].handler({ ...ctx, input: { sessionId: "cs_paid" } } as never)) as { status: string; order: OrderRecord };
    expect(first.status).toBe("fulfilled");
    expect(first.order.printfulOrderId).toBe(555);
    expect(first.order.lastError).toBeNull();
    expect(orderCallCounter.count).toBe(1);

    const second = (await storeRoutes["checkout/confirm"].handler({ ...ctx, input: { sessionId: "cs_paid" } } as never)) as { status: string; order: OrderRecord };
    expect(second.status).toBe("already");
    expect(orderCallCounter.count).toBe(1); // no re-hit of Printful order creation
  });

  it("on a Printful failure, stores a failed OrderRecord with lastError set and does not throw", async () => {
    const metadata = { source: "ebt-store", cart: JSON.stringify(cart), shippingRateId: "STANDARD", recipient: JSON.stringify(recipient) };
    mockGlobalFetch(
      printfulDispatcher({ onOrderCreate: () => new Response(JSON.stringify({ error: "Out of stock" }), { status: 400 }) }),
      stripeDispatcher({ session: { id: "cs_fail", payment_status: "paid", amount_total: 6498, currency: "usd", metadata, customer_details: { email: "jo@x.test" } } }),
    );
    const ctx = makeCtx({ settings: configuredSettings });

    const result = (await storeRoutes["checkout/confirm"].handler({ ...ctx, input: { sessionId: "cs_fail" } } as never)) as { status: string; order: OrderRecord };
    expect(result.status).toBe("failed");
    expect(result.order.printfulOrderId).toBeNull();
    expect(result.order.lastError).toBeTruthy();
  });

  it("rejects an unrecognized session (missing/unparseable metadata)", async () => {
    mockGlobalFetch(printfulDispatcher({}), stripeDispatcher({ session: { id: "cs_bad", payment_status: "paid", amount_total: 100, currency: "usd", metadata: {}, customer_details: null } }));
    const ctx = makeCtx({ settings: configuredSettings });
    await expect(
      storeRoutes["checkout/confirm"].handler({ ...ctx, input: { sessionId: "cs_bad" } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
