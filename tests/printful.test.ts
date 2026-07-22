import { describe, it, expect, afterEach } from "vitest";
import { listSyncProducts, getSyncProduct, getShippingRates, createPrintfulOrder, getPrintfulOrder, PrintfulApiError } from "../src/lib/printful.js";
import { makeCtx, mockFetch } from "./helpers.js";

const settings = { printfulApiKey: "pf_test", printfulStoreId: "", stripeSecretKey: "", siteOrigin: "https://x.test" };

describe("printful client", () => {
  afterEach(() => { /* vi.restoreAllMocks() handled globally below */ });

  it("listSyncProducts returns mapped catalog", async () => {
    mockFetch({
      printful: () => new Response(JSON.stringify({
        code: 200,
        result: [{ id: 13, name: "T-shirt", thumbnail_url: "https://x/t.png" }],
      }), { status: 200 }),
    });
    const ctx = makeCtx();
    const products = await listSyncProducts(ctx as never, settings);
    expect(products).toEqual([{ id: 13, name: "T-shirt", thumbnailUrl: "https://x/t.png" }]);
  });

  it("getSyncProduct returns product + variants", async () => {
    mockFetch({
      printful: () => new Response(JSON.stringify({
        code: 200,
        result: {
          sync_product: { id: 13, name: "T-shirt" },
          sync_variants: [{
            id: 10, name: "Red T-Shirt", retail_price: "29.99", currency: "USD",
            size: "M", color: "Red", availability_status: "active",
            product: { image: "https://x/v.png" },
          }],
        },
      }), { status: 200 }),
    });
    const ctx = makeCtx();
    const product = await getSyncProduct(ctx as never, settings, 13);
    expect(product.variants[0]).toEqual({
      id: 10, name: "Red T-Shirt", retailPrice: "29.99", currency: "USD",
      size: "M", color: "Red", imageUrl: "https://x/v.png", availabilityStatus: "active",
    });
  });

  it("getShippingRates maps rate options", async () => {
    mockFetch({
      printful: () => new Response(JSON.stringify({
        code: 200,
        result: { rates: [{ id: "STANDARD", name: "Standard", rate: "5.00", currency: "USD", minDeliveryDays: 5, maxDeliveryDays: 7 }] },
      }), { status: 200 }),
    });
    const ctx = makeCtx();
    const rates = await getShippingRates(ctx as never, settings,
      { name: "Jo", email: "jo@x.test", address1: "1 Main", city: "Austin", stateCode: "TX", countryCode: "US", zip: "78701" },
      [{ syncProductId: 13, syncVariantId: 10, quantity: 1 }]);
    expect(rates).toEqual([{ id: "STANDARD", name: "Standard", rate: "5.00", currency: "USD", minDeliveryDays: 5, maxDeliveryDays: 7 }]);
  });

  it("createPrintfulOrder posts confirm=true and returns id/status", async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch({
      printful: (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ code: 200, result: { id: 555, status: "confirmed" } }), { status: 200 });
      },
    });
    const ctx = makeCtx();
    const order = await createPrintfulOrder(ctx as never, settings, {
      externalId: "sess_1",
      recipient: { name: "Jo", email: "jo@x.test", address1: "1 Main", city: "Austin", stateCode: "TX", countryCode: "US", zip: "78701" },
      items: [{ syncVariantId: 10, quantity: 1, retailPrice: "29.99" }],
      shippingRateId: "STANDARD",
      confirm: true,
    });
    expect(order).toEqual({ id: 555, status: "confirmed" });
    expect(capturedBody.confirm).toBe(true);
    expect(capturedBody.external_id).toBe("sess_1");
    expect(capturedBody.shipping).toBe("STANDARD");
  });

  it("getPrintfulOrder returns id/status", async () => {
    mockFetch({ printful: () => new Response(JSON.stringify({ code: 200, result: { id: 555, status: "fulfilled" } }), { status: 200 }) });
    const ctx = makeCtx();
    const order = await getPrintfulOrder(ctx as never, settings, 555);
    expect(order).toEqual({ id: 555, status: "fulfilled" });
  });

  it("listSyncProducts rejects with PrintfulApiError on non-2xx response", async () => {
    mockFetch({
      printful: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const ctx = makeCtx();
    await expect(listSyncProducts(ctx as never, settings)).rejects.toBeInstanceOf(PrintfulApiError);
    try {
      await listSyncProducts(ctx as never, settings);
      throw new Error("expected rejection");
    } catch (err) {
      expect((err as PrintfulApiError).status).toBe(401);
    }
  });

  it("sends Authorization header (no store id)", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch({
      printful: (_url, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ code: 200, result: [] }), { status: 200 });
      },
    });
    const ctx = makeCtx();
    await listSyncProducts(ctx as never, settings);
    const sentHeaders = capturedInit?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe("Bearer pf_test");
    expect(sentHeaders["X-PF-Store-Id"]).toBeUndefined();
  });

  it("sends X-PF-Store-Id header when settings.printfulStoreId is set", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch({
      printful: (_url, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ code: 200, result: [] }), { status: 200 });
      },
    });
    const ctx = makeCtx();
    const settingsWithStore = { ...settings, printfulStoreId: "store_123" };
    await listSyncProducts(ctx as never, settingsWithStore);
    const sentHeaders = capturedInit?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe("Bearer pf_test");
    expect(sentHeaders["X-PF-Store-Id"]).toBe("store_123");
  });
});
