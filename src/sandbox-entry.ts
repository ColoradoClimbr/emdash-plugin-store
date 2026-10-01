import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS } from "./types.js";
import { SECRET_KEYS } from "./settings.js";
import { buildSettingsSchema } from "./secrets.js";
import { settingsRoutes } from "./routes/settings.js";
import { storeRoutes } from "./routes/store.js";
import { ordersRoutes } from "./routes/orders.js";

export function createPlugin() {
  return definePlugin({
    id: "ebt-store",
    version: "0.2.0",
    capabilities: ["network:request"],
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
      // Generated from DEFAULT_SETTINGS (no drift from Settings.tsx); marks secrets for
      // at-rest encryption. Settings.tsx stays the only UI.
      settingsSchema: buildSettingsSchema(DEFAULT_SETTINGS, SECRET_KEYS),
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
