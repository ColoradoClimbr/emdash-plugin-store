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
    async query(opts?: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; limit?: number; cursor?: string }) {
      let items = Array.from(store.entries()).map(([id, data]) => ({ id, data }));
      if (opts?.where) {
        for (const [k, v] of Object.entries(opts.where)) {
          items = items.filter((i) => (i.data as Record<string, unknown>)[k] === v);
        }
      }
      const orderEntry = opts?.orderBy && Object.entries(opts.orderBy)[0];
      if (orderEntry) {
        const [field, dir] = orderEntry;
        items = items.slice().sort((a, b) => {
          const av = (a.data as Record<string, unknown>)[field];
          const bv = (b.data as Record<string, unknown>)[field];
          const cmp = av === bv ? 0 : (av as string) > (bv as string) ? 1 : -1;
          return dir === "desc" ? -cmp : cmp;
        });
      }
      // crewcut: cursor = index offset into the (already filtered/sorted)
      // in-memory array — the brief calls this out as sufficient for tests.
      const offset = opts?.cursor ? Number(opts.cursor) : 0;
      const limit = opts?.limit ?? items.length;
      const page = items.slice(offset, offset + limit);
      const hasMore = offset + page.length < items.length;
      return { items: page, cursor: hasMore ? String(offset + page.length) : undefined, hasMore };
    },
  };
}

export function makeCtx(overrides: { settings?: Record<string, unknown>; origin?: string | null } = {}) {
  const kv = new Map<string, unknown>();
  for (const [k, v] of Object.entries(overrides.settings ?? {})) {
    kv.set(`settings:${k}`, v);
  }
  const orders = collection<OrderRecord>();
  // Defaults to the plugin's own DEFAULT_SETTINGS.siteOrigin so tests that
  // don't care about origin validation don't have to think about it.
  const origin = overrides.origin === undefined ? "https://example.com" : overrides.origin;
  const requestHeaders = new Headers();
  if (origin) requestHeaders.set("Origin", origin);
  const request = new Request("https://example.com/_emdash/plugins/ebt-store/route", { headers: requestHeaders });
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
    site: { origin: "https://example.com" },
    url: (path: string) => path,
    request,
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
