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
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new PrintfulApiError("Printful request failed.", res.status);
  }
  if (!res.ok) {
    let message: string | undefined;
    if (typeof data.result === "string") {
      message = data.result;
    } else if (data.result && typeof (data.result as { message?: unknown }).message === "string") {
      message = (data.result as { message: string }).message;
    } else if (typeof data.error === "string") {
      message = data.error;
    } else if (data.error && typeof (data.error as { message?: unknown }).message === "string") {
      message = (data.error as { message: string }).message;
    }
    throw new PrintfulApiError(message ?? "Printful request failed.", res.status);
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
