import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS } from "./types.js";
import { settingsRoutes } from "./routes/settings.js";
import { storeRoutes } from "./routes/store.js";
import { ordersRoutes } from "./routes/orders.js";

export function createPlugin() {
  return definePlugin({
    id: "ebt-store",
    version: "0.1.0",
    capabilities: ["network:request", "email:send"],
    allowedHosts: ["api.printful.com", "api.stripe.com"],
    storage: {
      orders: {
        indexes: ["status", "createdAt", "email"],
      },
    },
    admin: {
      entry: "emdash-plugin-store/admin",
      pages: [
        { path: "/settings", label: "Store Settings", icon: "gear" },
        { path: "/orders", label: "Store Orders", icon: "cart" },
      ],
      widgets: [],
    },
    hooks: {
      "plugin:install": {
        handler: async (_event: unknown, ctx: PluginContext) => {
          for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if ((await ctx.kv.get(`settings:${key}`)) === null) {
              await ctx.kv.set(`settings:${key}`, value);
            }
          }
        },
      },
    },
    routes: {
      ...settingsRoutes,
      ...storeRoutes,
      ...ordersRoutes,
    },
  });
}

export default createPlugin;
