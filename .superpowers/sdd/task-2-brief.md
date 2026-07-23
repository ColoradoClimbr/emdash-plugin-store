### Task 2: Settings module + admin settings page

**Files:**
- Create: `emdash-plugin-store/src/settings.ts`
- Create: `emdash-plugin-store/src/routes/settings.ts`
- Create: `emdash-plugin-store/src/components/Settings.tsx`
- Modify: `emdash-plugin-store/src/sandbox-entry.ts` (wire `settingsRoutes` into `routes`)
- Modify: `emdash-plugin-store/src/admin.tsx` (create; pages map)
- Test: `emdash-plugin-store/tests/settings.test.ts`

**Interfaces:**
- Consumes: `PluginSettings`, `DEFAULT_SETTINGS` (Task 1).
- Produces: `getSettings(ctx): Promise<PluginSettings>` — used by every route task from here on.

- [ ] **Step 1: Write failing test for getSettings**

```ts
import { describe, it, expect } from "vitest";
import { getSettings } from "../src/settings.js";
import { makeCtx } from "./helpers.js";

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const ctx = makeCtx();
    const settings = await getSettings(ctx as never);
    expect(settings.printfulApiKey).toBe("");
    expect(settings.siteOrigin).toBe("https://everybittexas.com");
  });

  it("overrides defaults with stored values", async () => {
    const ctx = makeCtx({ settings: { printfulApiKey: "pf_abc123" } });
    const settings = await getSettings(ctx as never);
    expect(settings.printfulApiKey).toBe("pf_abc123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- settings`
Expected: FAIL with "Cannot find module '../src/settings.js'"

- [ ] **Step 3: Implement src/settings.ts**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- settings`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement src/routes/settings.ts**

```ts
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
```

- [ ] **Step 6: Wire settingsRoutes into sandbox-entry.ts**

Modify `emdash-plugin-store/src/sandbox-entry.ts`:

```ts
import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS } from "./types.js";
import { settingsRoutes } from "./routes/settings.js";

export function createPlugin() {
  return definePlugin({
    // ... (unchanged fields from Task 1) ...
    routes: {
      ...settingsRoutes,
    },
  });
}

export default createPlugin;
```

- [ ] **Step 7: Create src/components/Settings.tsx**

```tsx
import React from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

const API = "/_emdash/api/plugins/ebt-store";

const FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "printfulApiKey", label: "Printful Private API Token", type: "password" },
  { key: "printfulStoreId", label: "Printful Store ID (only if using an account-level token)" },
  { key: "stripeSecretKey", label: "Stripe Secret Key", type: "password" },
  { key: "siteOrigin", label: "Site Origin (e.g. https://everybittexas.com)" },
];

export default function Settings() {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    apiFetch(`${API}/settings/get`)
      .then((res) => parseApiResponse<{ settings: Record<string, string> }>(res, "Failed to load settings"))
      .then((data) => setValues(data.settings));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Saving...");
    try {
      const res = await apiFetch(`${API}/settings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      await parseApiResponse(res, "Failed to save settings");
      setStatus("Saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}>
      {FIELDS.map((f) => (
        <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {f.label}
          <input
            type={f.type ?? "text"}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            style={{ padding: 8, border: "1px solid var(--kumo-border, #e5e7eb)" }}
          />
        </label>
      ))}
      <button type="submit">Save</button>
      <p role="status">{status}</p>
    </form>
  );
}
```

- [ ] **Step 8: Create src/admin.tsx**

```tsx
import type { PluginAdminExports } from "emdash";
import Settings from "./components/Settings.js";

export const pages: PluginAdminExports["pages"] = { "/settings": Settings };
export const widgets: PluginAdminExports["widgets"] = {};
```

(Orders.tsx and its `/orders` page entry are added in Task 10.)

- [ ] **Step 9: Run full test suite**

Run: `pnpm test`
Expected: PASS (4 tests total)

- [ ] **Step 10: Commit**

```bash
git add emdash-plugin-store/src/settings.ts emdash-plugin-store/src/routes/settings.ts emdash-plugin-store/src/components/Settings.tsx emdash-plugin-store/src/admin.tsx emdash-plugin-store/src/sandbox-entry.ts emdash-plugin-store/tests/settings.test.ts
git commit -m "feat(store): add settings storage, routes, and admin settings page"
```

---

