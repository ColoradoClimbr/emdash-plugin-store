### Task 3: Printful API client

**Files:**
- Create: `emdash-plugin-store/src/lib/printful.ts`
- Test: `emdash-plugin-store/tests/printful.test.ts`

**Interfaces:**
- Consumes: `PluginSettings` (Task 1), `RecipientAddress`, `CartItem`, `ShippingRateOption` (Task 1).
- Produces:
  - `listSyncProducts(ctx, settings): Promise<Array<{ id: number; name: string; thumbnailUrl: string }>>`
  - `getSyncProduct(ctx, settings, syncProductId): Promise<{ id: number; name: string; variants: Array<{ id: number; name: string; retailPrice: string; currency: string; size: string; color: string; imageUrl: string; availabilityStatus: string }> }>`
  - `getShippingRates(ctx, settings, recipient, items): Promise<ShippingRateOption[]>`
  - `createPrintfulOrder(ctx, settings, params: { externalId: string; recipient: RecipientAddress; items: Array<{ syncVariantId: number; quantity: number; retailPrice: string }>; shippingRateId: string; confirm: boolean }): Promise<{ id: number; status: string }>`
  - `getPrintfulOrder(ctx, settings, printfulOrderId): Promise<{ id: number; status: string }>`
  - `class PrintfulApiError extends Error`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { listSyncProducts, getSyncProduct, getShippingRates, createPrintfulOrder, getPrintfulOrder } from "../src/lib/printful.js";
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- printful`
Expected: FAIL with "Cannot find module '../src/lib/printful.js'"

- [ ] **Step 3: Implement src/lib/printful.ts**

```ts
import type { PluginContext } from "emdash";
import type { CartItem, PluginSettings, RecipientAddress, ShippingRateOption } from "../types.js";

export class PrintfulApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "PrintfulApiError";
  }
}

function headers(settings: PluginSettings): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${settings.printfulApiKey}`,
    "Content-Type": "application/json",
  };
  if (settings.printfulStoreId) h["X-PF-Store-Id"] = settings.printfulStoreId;
  return h;
}

async function pfFetch(ctx: PluginContext, settings: PluginSettings, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await ctx.http!.fetch(`https://api.printful.com${path}`, {
    ...init,
    headers: { ...headers(settings), ...(init?.headers as Record<string, string> | undefined) },
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.result as { message?: string } | undefined)?.message ?? data.error ?? "Printful request failed.";
    throw new PrintfulApiError(String(message), res.status);
  }
  return data;
}

export async function listSyncProducts(ctx: PluginContext, settings: PluginSettings) {
  const data = await pfFetch(ctx, settings, "/store/products?status=synced");
  const result = data.result as Array<{ id: number; name: string; thumbnail_url: string }>;
  return result.map((p) => ({ id: p.id, name: p.name, thumbnailUrl: p.thumbnail_url }));
}

export async function getSyncProduct(ctx: PluginContext, settings: PluginSettings, syncProductId: number) {
  const data = await pfFetch(ctx, settings, `/store/products/${syncProductId}`);
  const result = data.result as {
    sync_product: { id: number; name: string };
    sync_variants: Array<{
      id: number; name: string; retail_price: string; currency: string;
      size: string; color: string; availability_status: string;
      product: { image: string };
    }>;
  };
  return {
    id: result.sync_product.id,
    name: result.sync_product.name,
    variants: result.sync_variants.map((v) => ({
      id: v.id, name: v.name, retailPrice: v.retail_price, currency: v.currency,
      size: v.size, color: v.color, imageUrl: v.product.image, availabilityStatus: v.availability_status,
    })),
  };
}

export async function getShippingRates(
  ctx: PluginContext, settings: PluginSettings, recipient: RecipientAddress, items: CartItem[],
): Promise<ShippingRateOption[]> {
  const data = await pfFetch(ctx, settings, "/shipping/rates", {
    method: "POST",
    body: JSON.stringify({
      recipient: {
        address1: recipient.address1, city: recipient.city,
        state_code: recipient.stateCode, country_code: recipient.countryCode, zip: recipient.zip,
      },
      items: items.map((i) => ({ variant_id: i.syncVariantId, quantity: i.quantity })),
    }),
  });
  const result = data.result as { rates: Array<{ id: string; name: string; rate: string; currency: string; minDeliveryDays: number; maxDeliveryDays: number }> };
  return result.rates;
}

export async function createPrintfulOrder(
  ctx: PluginContext, settings: PluginSettings,
  params: { externalId: string; recipient: RecipientAddress; items: Array<{ syncVariantId: number; quantity: number; retailPrice: string }>; shippingRateId: string; confirm: boolean },
): Promise<{ id: number; status: string }> {
  const data = await pfFetch(ctx, settings, "/orders", {
    method: "POST",
    body: JSON.stringify({
      external_id: params.externalId,
      recipient: {
        name: params.recipient.name, email: params.recipient.email, address1: params.recipient.address1,
        city: params.recipient.city, state_code: params.recipient.stateCode,
        country_code: params.recipient.countryCode, zip: params.recipient.zip,
      },
      items: params.items.map((i) => ({ sync_variant_id: i.syncVariantId, quantity: i.quantity, retail_price: i.retailPrice })),
      shipping: params.shippingRateId,
      confirm: params.confirm,
    }),
  });
  const result = data.result as { id: number; status: string };
  return { id: result.id, status: result.status };
}

export async function getPrintfulOrder(ctx: PluginContext, settings: PluginSettings, printfulOrderId: number): Promise<{ id: number; status: string }> {
  const data = await pfFetch(ctx, settings, `/orders/${printfulOrderId}`);
  const result = data.result as { id: number; status: string };
  return { id: result.id, status: result.status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- printful`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add emdash-plugin-store/src/lib/printful.ts emdash-plugin-store/tests/printful.test.ts
git commit -m "feat(store): add Printful REST API client"
```

---

