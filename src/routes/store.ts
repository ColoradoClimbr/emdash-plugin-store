import { PluginRouteError } from "emdash";
import type { RouteContext } from "emdash";
import type { CartItem, OrderRecord, OrderStatus, RecipientAddress } from "../types.js";
import { getSettings } from "../settings.js";
import { createPrintfulOrder, getShippingRates, getSyncProduct, listSyncProducts } from "../lib/printful.js";
import { createCheckoutSession, createStripeCustomer, getCheckoutSession } from "../lib/stripe.js";

const MAX_ITEMS = 50;
const MAX_QTY = 20;
// Printful's known-good availability value seen in the API docs/fixtures.
// crewcut: allowlist of one rather than a denylist of every discontinued/out
// of stock string Printful might return — brief calls for rejecting anything
// that isn't exactly this, not guessing at the full enum.
const AVAILABLE_STATUS = "active";

type SyncProduct = Awaited<ReturnType<typeof getSyncProduct>>;

// Local copy of emdash-plugin-petition's signSubmit.ts validateOrigin/hostAllowed,
// adapted because this plugin has no hardcoded allowed-host set — the allowed
// host is this store's own configurable settings.siteOrigin instead.
function hostAllowed(value: string, siteOrigin: string): boolean {
  try {
    const host = new URL(value).host.toLowerCase();
    const allowedHost = new URL(siteOrigin).host.toLowerCase();
    return host === allowedHost || host === "localhost" || host.startsWith("localhost:") || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

function validateOrigin(request: Request, siteOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return hostAllowed(origin, siteOrigin);
  const referer = request.headers.get("Referer");
  return referer ? hostAllowed(referer, siteOrigin) : false;
}

// Sanity bounds only (mirrors donate.ts's MIN_CENTS/MAX_CENTS style), not
// exhaustive validation of cart contents.
function validateCartItems(items: unknown): CartItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw PluginRouteError.badRequest("At least one cart item is required.");
  }
  if (items.length > MAX_ITEMS) {
    throw PluginRouteError.badRequest(`Cart cannot have more than ${MAX_ITEMS} items.`);
  }
  return items.map((raw) => {
    const item = (raw ?? {}) as Partial<CartItem>;
    const syncProductId = Number(item.syncProductId);
    const syncVariantId = Number(item.syncVariantId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(syncProductId) || syncProductId <= 0) {
      throw PluginRouteError.badRequest("Invalid syncProductId.");
    }
    if (!Number.isInteger(syncVariantId) || syncVariantId <= 0) {
      throw PluginRouteError.badRequest("Invalid syncVariantId.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY) {
      throw PluginRouteError.badRequest(`Quantity must be between 1 and ${MAX_QTY}.`);
    }
    return { syncProductId, syncVariantId, quantity };
  });
}

// Fetches each unique syncProductId in `items` at most once via `cache`, and
// resolves the priced Stripe line items for them. Used by both
// checkout/create-session (pricing) and checkout/confirm (re-deriving
// Printful order items) so a cart spanning the same product isn't refetched.
async function resolveCartProducts(
  ctx: RouteContext, settings: Awaited<ReturnType<typeof getSettings>>, items: CartItem[], cache: Map<number, SyncProduct>,
): Promise<Array<{ product: SyncProduct; variant: SyncProduct["variants"][number]; item: CartItem }>> {
  const resolved: Array<{ product: SyncProduct; variant: SyncProduct["variants"][number]; item: CartItem }> = [];
  for (const item of items) {
    let product = cache.get(item.syncProductId);
    if (!product) {
      try {
        product = await getSyncProduct(ctx, settings, item.syncProductId);
      } catch {
        throw PluginRouteError.badRequest(`Product ${item.syncProductId} not found.`);
      }
      cache.set(item.syncProductId, product);
    }
    const variant = product.variants.find((v) => v.id === item.syncVariantId);
    if (!variant) throw PluginRouteError.badRequest(`Variant ${item.syncVariantId} not found.`);
    resolved.push({ product, variant, item });
  }
  return resolved;
}

// Shared by checkout/confirm (the primary fulfillment path, called right
// after the Stripe redirect) and orders/reconcile (the manual backstop for
// sessions whose browser died before that redirect happened). Assumes the
// caller has already validated settings are configured — callers that skip
// that check (like reconcile, which checks once before its whole batch)
// still get correct behavior since nothing here re-derives the check.
export async function fulfillCheckoutSession(
  ctx: RouteContext, settings: Awaited<ReturnType<typeof getSettings>>, sessionId: string,
): Promise<{ status: "already" | OrderStatus; order: OrderRecord }> {
  // Idempotency: a client retry, double-call, or a reconcile pass revisiting
  // an already-confirmed session must not double-charge Printful. A
  // previously *failed* record is the one exception — it falls through to
  // re-attempt fulfillment below, since nothing succeeded the first time.
  const existing = (await ctx.storage.orders.get(sessionId)) as OrderRecord | null;
  if (existing && existing.status !== "failed") return { status: "already", order: existing };

  const session = await getCheckoutSession(ctx, settings, sessionId);
  if (session.payment_status !== "paid") throw PluginRouteError.badRequest("This payment hasn't completed.");

  let cart: CartItem[];
  let recipient: RecipientAddress;
  let shippingRateId: string;
  try {
    cart = JSON.parse(session.metadata.cart);
    recipient = JSON.parse(session.metadata.recipient);
    shippingRateId = session.metadata.shippingRateId;
    if (!Array.isArray(cart) || cart.length === 0 || !recipient || !shippingRateId) throw new Error("missing metadata");
  } catch {
    throw PluginRouteError.badRequest("Unrecognized checkout session.");
  }

  // Printful order creation (and re-deriving its line items) is wrapped
  // together: the customer already paid, so any failure here — including
  // a product/variant that vanished from Printful since checkout — must
  // be stored as a failed order for manual retry, never thrown as a 500
  // that would strand a paid order with no record at all.
  let status: OrderStatus;
  let printfulOrderId: number | null = null;
  let lastError: string | null = null;
  try {
    const cache = new Map<number, SyncProduct>();
    const resolved = await resolveCartProducts(ctx, settings, cart, cache);
    const orderItems = resolved.map(({ variant, item }) => ({
      syncVariantId: item.syncVariantId, quantity: item.quantity, retailPrice: variant.retailPrice,
    }));
    const result = await createPrintfulOrder(ctx, settings, {
      externalId: sessionId,
      recipient,
      items: orderItems,
      shippingRateId,
      confirm: true,
    });
    status = "fulfilled";
    printfulOrderId = result.id;
  } catch (err) {
    status = "failed";
    lastError = String(err);
  }

  const now = new Date().toISOString();
  const record: OrderRecord = {
    sessionId,
    status,
    amountCents: session.amount_total,
    currency: session.currency,
    email: session.customer_details?.email ?? "",
    cart,
    shippingRateId,
    recipient,
    printfulOrderId,
    lastError,
    // A retry of a previously-failed order keeps its original createdAt;
    // updatedAt always reflects this attempt.
    createdAt: existing?.status === "failed" ? existing.createdAt : now,
    updatedAt: now,
  };
  await ctx.storage.orders.put(sessionId, record as unknown as Record<string, unknown>);
  return { status: record.status, order: record };
}

export const storeRoutes = {
  "products/list": {
    public: true,
    handler: async (ctx: RouteContext) => {
      const settings = await getSettings(ctx);
      const products = await listSyncProducts(ctx, settings);
      return { products };
    },
  },

  "products/get": {
    public: true,
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as { syncProductId?: number };
      const syncProductId = Number(body.syncProductId);
      if (!Number.isInteger(syncProductId) || syncProductId <= 0) {
        throw PluginRouteError.badRequest("syncProductId must be a positive integer.");
      }
      const settings = await getSettings(ctx);
      const product = await getSyncProduct(ctx, settings, syncProductId);
      return { product };
    },
  },

  "cart/shipping-rates": {
    public: true,
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as { recipient?: RecipientAddress; items?: unknown };
      const items = validateCartItems(body.items);
      const recipient = (body.recipient ?? {}) as RecipientAddress;
      const settings = await getSettings(ctx);
      const rates = await getShippingRates(ctx, settings, recipient, items);
      return { rates };
    },
  },

  "checkout/create-session": {
    public: true,
    handler: async (ctx: RouteContext) => {
      const settings = await getSettings(ctx);
      // Needs settings.siteOrigin, so settings load comes first; still runs
      // before any of the expensive Printful/Stripe work below.
      if (!validateOrigin(ctx.request, settings.siteOrigin)) throw PluginRouteError.forbidden("Invalid origin");
      if (!settings.printfulApiKey || !settings.stripeSecretKey) {
        throw PluginRouteError.badRequest("Store isn't configured yet.");
      }

      const body = (ctx.input ?? {}) as { recipient?: RecipientAddress; items?: unknown; shippingRateId?: string };
      const items = validateCartItems(body.items);
      const recipient = (body.recipient ?? {}) as RecipientAddress;
      const shippingRateId = String(body.shippingRateId ?? "");
      if (!shippingRateId) throw PluginRouteError.badRequest("shippingRateId is required.");

      // Server-side price computation — never trust price/amount from the request body.
      const cache = new Map<number, SyncProduct>();
      const resolved = await resolveCartProducts(ctx, settings, items, cache);
      const lineItems = resolved.map(({ product, variant, item }) => {
        if (variant.availabilityStatus !== AVAILABLE_STATUS) {
          throw PluginRouteError.badRequest(`${product.name} - ${variant.name} is no longer available.`);
        }
        const unitAmountCents = Math.round(parseFloat(variant.retailPrice) * 100);
        return { name: `${product.name} - ${variant.name}`, unitAmountCents, quantity: item.quantity };
      });

      // Never trust a client-provided shipping amount either — match the
      // client's chosen shippingRateId against Printful's own quoted rates.
      const rates = await getShippingRates(ctx, settings, recipient, items);
      const rate = rates.find((r) => r.id === shippingRateId);
      if (!rate) throw PluginRouteError.badRequest("Invalid shipping option.");
      const shippingCents = Math.round(parseFloat(rate.rate) * 100);

      const customer = await createStripeCustomer(ctx, settings, recipient);
      const metadata = {
        source: "ebt-store",
        cart: JSON.stringify(items),
        shippingRateId,
        recipient: JSON.stringify(recipient),
      };
      const session = await createCheckoutSession(ctx, settings, {
        customerId: customer.id,
        lineItems,
        shippingCents,
        shippingName: rate.name,
        metadata,
      });
      return { url: session.url };
    },
  },

  "checkout/confirm": {
    public: true,
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as { sessionId?: string };
      const sessionId = String(body.sessionId ?? "").trim();
      if (!sessionId) throw PluginRouteError.badRequest("sessionId is required.");

      const settings = await getSettings(ctx);
      if (!settings.printfulApiKey || !settings.stripeSecretKey) {
        throw PluginRouteError.badRequest("Store isn't configured yet.");
      }

      return fulfillCheckoutSession(ctx, settings, sessionId);
    },
  },
};
