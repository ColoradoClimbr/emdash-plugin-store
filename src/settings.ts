import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS, type PluginSettings } from "./types.js";

export const MASK = "••••••••";
export const SECRET_KEYS: (keyof PluginSettings)[] = ["printfulApiKey", "stripeSecretKey"];

export async function getSettings(ctx: PluginContext): Promise<PluginSettings> {
  const settings = { ...DEFAULT_SETTINGS };
  await Promise.all(
    (Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]).map(async (key) => {
      const val = await ctx.kv.get<unknown>(`settings:${key}`);
      if (val !== null && val !== undefined) (settings as Record<string, unknown>)[key] = val;
    }),
  );
  return settings;
}
