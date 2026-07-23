### Task 4: Stripe API client

**Files:**
- Create: `emdash-plugin-store/src/lib/stripe.ts`
- Test: `emdash-plugin-store/tests/stripe.test.ts`

**Interfaces:**
- Consumes: `PluginSettings`, `RecipientAddress`, `CartItem` (Task 1).
- Produces:
  - `createStripeCustomer(ctx, settings, recipient): Promise<{ id: string }>`
  - `createCheckoutSession(ctx, settings, params): Promise<{ id: string; url: string }>`
  - `getCheckoutSession(ctx, settings, sessionId): Promise<{ id: string; payment_status: string; amount_total: number; currency: string; metadata: Record<string,string>; customer_details: { email: string } | null }>`
  - `listRecentPaidSessions(ctx, settings, createdAfterUnix): Promise<Array<{ id: string; metadata: Record<string,string> }>>`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createStripeCustomer, createCheckoutSession, getCheckoutSession, listRecentPaidSessions } from "../src/lib/stripe.js";
import { makeCtx, mockFetch } from "./helpers.js";

const settings = { printfulApiKey: "", printfulStoreId: "", stripeSecretKey: "sk_test", siteOrigin: "https://x.test" };
const recipient = { name: "Jo", email: "jo@x.test", address1: "1 Main", city: "Austin", stateCode: "TX", countryCode: "US", zip: "78701" };

describe("stripe client", () => {
  it("createStripeCustomer posts address fields and returns id", async () => {
    let captured = "";
    mockFetch({ stripe: (_url, init) => { captured = String(init?.body); return new Response(JSON.stringify({ id: "cus_1" }), { status: 200 }); } });
    const ctx = makeCtx();
    const customer = await createStripeCustomer(ctx as never, settings, recipient);
    expect(customer).toEqual({ id: "cus_1" });
    expect(captured).toContain("address%5Bline1%5D=1+Main");
    expect(captured).toContain("email=jo%40x.test");
  });

  it("createCheckoutSession builds line items + shipping + tax + metadata", async () => {
    let captured = "";
    mockFetch({ stripe: (_url, init) => { captured = String(init?.body); return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 }); } });
    const ctx = makeCtx();
    const session = await createCheckoutSession(ctx as never, settings, {
      customerId: "cus_1",
      lineItems: [{ name: "Red T-Shirt", unitAmountCents: 2999, quantity: 1 }],
      shippingCents: 500,
      shippingName: "Standard",
      metadata: { source: "ebt-store", cart: JSON.stringify([{ syncProductId: 13, syncVariantId: 10, quantity: 1 }]), shippingRateId: "STANDARD" },
    });
    expect(session).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" });
    expect(captured).toContain("customer=cus_1");
    expect(captured).toContain("automatic_tax%5Benabled%5D=true");
    expect(captured).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2999");
    expect(captured).toContain("line_items%5B1%5D%5Bprice_data%5D%5Bunit_amount%5D=500");
    expect(captured).toContain("metadata%5Bsource%5D=ebt-store");
  });

  it("getCheckoutSession returns parsed session", async () => {
    mockFetch({ stripe: () => new Response(JSON.stringify({
      id: "cs_1", payment_status: "paid", amount_total: 3499, currency: "usd",
      metadata: { source: "ebt-store" }, customer_details: { email: "jo@x.test" },
    }), { status: 200 }) });
    const ctx = makeCtx();
    const session = await getCheckoutSession(ctx as never, settings, "cs_1");
    expect(session.payment_status).toBe("paid");
    expect(session.customer_details?.email).toBe("jo@x.test");
  });

  it("listRecentPaidSessions paginates and filters payment_status=paid", async () => {
    mockFetch({ stripe: () => new Response(JSON.stringify({
      data: [
        { id: "cs_1", payment_status: "paid", metadata: { source: "ebt-store" } },
        { id: "cs_2", payment_status: "unpaid", metadata: { source: "ebt-store" } },
      ],
      has_more: false,
    }), { status: 200 }) });
    const ctx = makeCtx();
    const sessions = await listRecentPaidSessions(ctx as never, settings, 1700000000);
    expect(sessions).toEqual([{ id: "cs_1", metadata: { source: "ebt-store" } }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- stripe`
Expected: FAIL with "Cannot find module '../src/lib/stripe.js'"

- [ ] **Step 3: Implement src/lib/stripe.ts**

```ts
import type { PluginContext } from "emdash";
import type { PluginSettings, RecipientAddress } from "../types.js";

export class StripeApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "StripeApiError";
  }
}

async function stripeFetch(ctx: PluginContext, settings: PluginSettings, path: string, body?: URLSearchParams, method?: string): Promise<Record<string, unknown>> {
  const res = await ctx.http!.fetch(`https://api.stripe.com/v1/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${settings.stripeSecretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message || "Stripe request failed.";
    throw new StripeApiError(message, res.status);
  }
  return data;
}

export async function createStripeCustomer(ctx: PluginContext, settings: PluginSettings, recipient: RecipientAddress): Promise<{ id: string }> {
  const params = new URLSearchParams();
  params.set("name", recipient.name);
  params.set("email", recipient.email);
  params.set("address[line1]", recipient.address1);
  params.set("address[city]", recipient.city);
  params.set("address[state]", recipient.stateCode);
  params.set("address[country]", recipient.countryCode);
  params.set("address[postal_code]", recipient.zip);
  const data = await stripeFetch(ctx, settings, "customers", params);
  return { id: String(data.id) };
}

export async function createCheckoutSession(
  ctx: PluginContext, settings: PluginSettings,
  params: {
    customerId: string;
    lineItems: Array<{ name: string; unitAmountCents: number; quantity: number }>;
    shippingCents: number;
    shippingName: string;
    metadata: Record<string, string>;
  },
): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("customer", params.customerId);
  body.set("automatic_tax[enabled]", "true");
  body.set("success_url", `${settings.siteOrigin}/store/success?session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${settings.siteOrigin}/store/cart?cancelled=1`);
  params.lineItems.forEach((item, i) => {
    body.set(`line_items[${i}][quantity]`, String(item.quantity));
    body.set(`line_items[${i}][price_data][currency]`, "usd");
    body.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmountCents));
    body.set(`line_items[${i}][price_data][product_data][name]`, item.name);
  });
  const shippingIndex = params.lineItems.length;
  body.set(`line_items[${shippingIndex}][quantity]`, "1");
  body.set(`line_items[${shippingIndex}][price_data][currency]`, "usd");
  body.set(`line_items[${shippingIndex}][price_data][unit_amount]`, String(params.shippingCents));
  body.set(`line_items[${shippingIndex}][price_data][product_data][name]`, `Shipping - ${params.shippingName}`);
  for (const [key, value] of Object.entries(params.metadata)) {
    body.set(`metadata[${key}]`, value);
  }
  const data = await stripeFetch(ctx, settings, "checkout/sessions", body);
  return { id: String(data.id), url: String(data.url) };
}

export async function getCheckoutSession(ctx: PluginContext, settings: PluginSettings, sessionId: string) {
  const data = await stripeFetch(ctx, settings, `checkout/sessions/${encodeURIComponent(sessionId)}`);
  return data as unknown as {
    id: string; payment_status: string; amount_total: number; currency: string;
    metadata: Record<string, string>; customer_details: { email: string } | null;
  };
}

export async function listRecentPaidSessions(ctx: PluginContext, settings: PluginSettings, createdAfterUnix: number): Promise<Array<{ id: string; metadata: Record<string, string> }>> {
  const params = new URLSearchParams();
  params.set("created[gte]", String(createdAfterUnix));
  params.set("limit", "100");
  const data = await stripeFetch(ctx, settings, `checkout/sessions?${params.toString()}`, undefined, "GET");
  const sessions = data.data as Array<{ id: string; payment_status: string; metadata: Record<string, string> }>;
  return sessions.filter((s) => s.payment_status === "paid").map((s) => ({ id: s.id, metadata: s.metadata }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- stripe`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add emdash-plugin-store/src/lib/stripe.ts emdash-plugin-store/tests/stripe.test.ts
git commit -m "feat(store): add Stripe Customers + Checkout Sessions client"
```

---

