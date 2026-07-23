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
