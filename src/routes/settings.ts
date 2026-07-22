import type { RouteContext } from "emdash";
import { DEFAULT_SETTINGS, type PluginSettings } from "../types.js";
import { getSettings, MASK, SECRET_KEYS } from "../settings.js";

export const settingsRoutes = {
  "settings/get": {
    handler: async (ctx: RouteContext) => {
      const settings = await getSettings(ctx);
      const masked = { ...settings } as Record<string, unknown>;
      for (const k of SECRET_KEYS) if (settings[k]) masked[k] = MASK;
      return { settings: masked };
    },
  },
  "settings/update": {
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as Partial<Record<keyof PluginSettings, unknown>>;
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]) {
        if (!(key in body)) continue;
        const value = body[key];
        if (SECRET_KEYS.includes(key) && value === MASK) continue;
        await ctx.kv.set(`settings:${key}`, value);
      }
      return { ok: true };
    },
  },
};
