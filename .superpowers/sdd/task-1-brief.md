### Task 1: Scaffold plugin package + shared types

**Files:**
- Create: `emdash-plugin-store/package.json`
- Create: `emdash-plugin-store/pnpm-workspace.yaml`
- Create: `emdash-plugin-store/tsconfig.json`
- Create: `emdash-plugin-store/vitest.config.ts`
- Create: `emdash-plugin-store/src/types.ts`
- Create: `emdash-plugin-store/src/index.ts`
- Create: `emdash-plugin-store/src/sandbox-entry.ts`
- Create: `emdash-plugin-store/tests/helpers.ts`
- Test: `emdash-plugin-store/tests/scaffold.test.ts`

Note: the `emdash-plugin-store` git repo already exists (initialized empty) — this task's first commit is the repo's first commit.

**Interfaces:**
- Produces (used by every later task): `CartItem`, `ShippingRateOption`, `RecipientAddress`, `OrderRecord`, `PluginSettings`, `DEFAULT_SETTINGS` from `types.ts`; `makeCtx()`, `mockFetch()` test helpers from `tests/helpers.ts`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "emdash-plugin-store",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./sandbox": "./src/sandbox-entry.ts",
    "./admin": "./src/admin.tsx"
  },
  "peerDependencies": {
    "emdash": ">=0.16.0",
    "react": "^19.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "@types/react": "^19.0.0",
    "emdash": "latest",
    "typescript": "^5.0.0",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 1a: Create pnpm-workspace.yaml**

```yaml
allowBuilds:
  better-sqlite3: false
  esbuild: true
  sharp: false
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["react", "@cloudflare/workers-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create src/types.ts**

```ts
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
  siteOrigin: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  printfulApiKey: "",
  printfulStoreId: "",
  stripeSecretKey: "",
  siteOrigin: "https://everybittexas.com",
};
```

- [ ] **Step 5: Create src/index.ts**

```ts
import type { PluginDescriptor } from "emdash";

export { createPlugin } from "./sandbox-entry.js";

export function storePlugin(): PluginDescriptor {
  return {
    id: "ebt-store",
    version: "0.1.0",
    entrypoint: "emdash-plugin-store",
    options: {},
    capabilities: ["network:request", "email:send"],
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
```

- [ ] **Step 6: Create src/sandbox-entry.ts (route maps added in later tasks; empty routes object for now)**

```ts
import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS } from "./types.js";

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
    routes: {},
  });
}

export default createPlugin;
```

- [ ] **Step 7: Create tests/helpers.ts**

```ts
import { vi } from "vitest";
import type { OrderRecord } from "../src/types.js";

export function collection<T>() {
  const store = new Map<string, T>();
  return {
    async get(id: string) {
      return store.has(id) ? (store.get(id) as T) : null;
    },
    async put(id: string, data: T) {
      store.set(id, data);
    },
    async query(opts?: { where?: Record<string, unknown>; limit?: number }) {
      let items = Array.from(store.entries()).map(([id, data]) => ({ id, data }));
      if (opts?.where) {
        for (const [k, v] of Object.entries(opts.where)) {
          items = items.filter((i) => (i.data as Record<string, unknown>)[k] === v);
        }
      }
      if (opts?.limit) items = items.slice(0, opts.limit);
      return { items, hasMore: false };
    },
  };
}

export function makeCtx(overrides: { settings?: Record<string, unknown> } = {}) {
  const kv = new Map<string, unknown>();
  for (const [k, v] of Object.entries(overrides.settings ?? {})) {
    kv.set(`settings:${k}`, v);
  }
  const orders = collection<OrderRecord>();
  return {
    plugin: { id: "ebt-store", version: "0.1.0" },
    storage: { orders },
    kv: {
      async get<T>(key: string) {
        return kv.has(key) ? (kv.get(key) as T) : null;
      },
      async set(key: string, value: unknown) {
        kv.set(key, value);
      },
    },
    http: {
      async fetch(url: string, init?: RequestInit) {
        return globalThis.fetch(url, init);
      },
    },
    log: { info: () => {}, error: () => {}, warn: () => {} },
    site: { origin: "https://everybittexas.com" },
    url: (path: string) => path,
  };
}

export function mockFetch(handlers: { printful?: (url: string, init?: RequestInit) => Response; stripe?: (url: string, init?: RequestInit) => Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    if (u.includes("api.printful.com") && handlers.printful) return Promise.resolve(handlers.printful(u, init as RequestInit));
    if (u.includes("api.stripe.com") && handlers.stripe) return Promise.resolve(handlers.stripe(u, init as RequestInit));
    return Promise.resolve(new Response(JSON.stringify({ error: "unmocked url: " + u }), { status: 500 }));
  });
}
```

- [ ] **Step 8: Write scaffold test**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types.js";
import { makeCtx } from "./helpers.js";

describe("scaffold", () => {
  it("DEFAULT_SETTINGS has all required keys", () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      ["printfulApiKey", "printfulStoreId", "siteOrigin", "stripeSecretKey"].sort(),
    );
  });

  it("makeCtx() produces a working orders collection", async () => {
    const ctx = makeCtx();
    await ctx.storage.orders.put("sess_1", { sessionId: "sess_1" } as never);
    const got = await ctx.storage.orders.get("sess_1");
    expect(got).toEqual({ sessionId: "sess_1" });
  });
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd emdash-plugin-store && pnpm install && pnpm test`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add emdash-plugin-store/package.json emdash-plugin-store/tsconfig.json emdash-plugin-store/vitest.config.ts emdash-plugin-store/src/types.ts emdash-plugin-store/src/index.ts emdash-plugin-store/src/sandbox-entry.ts emdash-plugin-store/tests/helpers.ts emdash-plugin-store/tests/scaffold.test.ts
git commit -m "feat(store): scaffold emdash-plugin-store package and shared types"
```

---

