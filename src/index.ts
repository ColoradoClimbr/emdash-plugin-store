import type { PluginDescriptor } from "emdash";

export { createPlugin } from "./sandbox-entry.js";

export function storePlugin(): PluginDescriptor {
  return {
    id: "ebt-store",
    version: "0.2.0",
    entrypoint: "emdash-plugin-store",
    options: {},
    capabilities: ["network:request"],
    allowedHosts: ["api.printful.com", "api.stripe.com"],
    storage: {
      orders: {
        // Keyed by Stripe Checkout Session id (see donate.ts precedent).
        indexes: ["status", "createdAt", "email"],
      },
    } as unknown as PluginDescriptor["storage"],
    adminEntry: "emdash-plugin-store/admin",
    adminPages: [
      { path: "/settings", label: "Store Settings", icon: "gear" },
      { path: "/orders", label: "Store Orders", icon: "cart" },
    ],
    adminWidgets: [],
  };
}
