export interface CartItem {
  syncProductId: number;
  syncVariantId: number;
  quantity: number;
}

export interface ShippingRateOption {
  id: string;
  name: string;
  rate: string; // decimal-string dollars, as Printful returns it
  currency: string;
  minDeliveryDays: number;
  maxDeliveryDays: number;
}

export interface RecipientAddress {
  name: string;
  email: string;
  address1: string;
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
}

export type OrderStatus = "paid_unfulfilled" | "fulfilled" | "failed";

export interface OrderRecord {
  sessionId: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  email: string;
  cart: CartItem[];
  shippingRateId: string;
  recipient: RecipientAddress;
  printfulOrderId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PluginSettings {
  printfulApiKey: string; // secret
  printfulStoreId: string;
  stripeSecretKey: string; // secret
  stripeWebhookSecret: string; // secret; whsec_... of the Stripe webhook endpoint
  siteOrigin: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  printfulApiKey: "",
  printfulStoreId: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  siteOrigin: "https://example.com",
};
