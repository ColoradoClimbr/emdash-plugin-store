import { describe, it, expect, afterEach } from "vitest";
import { createStripeCustomer, createCheckoutSession, getCheckoutSession, listRecentPaidSessions } from "../src/lib/stripe.js";
import { makeCtx, mockFetch } from "./helpers.js";

const settings = { printfulApiKey: "", printfulStoreId: "", stripeSecretKey: "sk_test", siteOrigin: "https://x.test" };
const recipient = { name: "Jo", email: "jo@x.test", address1: "1 Main", city: "Austin", stateCode: "TX", countryCode: "US", zip: "78701" };

describe("stripe client", () => {
  afterEach(() => { /* vi.restoreAllMocks() handled globally below */ });

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

  it("sends Authorization header with secret key", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch({
      stripe: (_url, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "cus_1" }), { status: 200 });
      },
    });
    const ctx = makeCtx();
    await createStripeCustomer(ctx as never, settings, recipient);
    const sentHeaders = capturedInit?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe("Bearer sk_test");
  });
});
