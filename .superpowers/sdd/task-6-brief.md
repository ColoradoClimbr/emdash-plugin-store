### Task 6: Orders admin page (list, filter, manual reconcile)

**Context:** Task 5 built the storefront routes. `checkout/confirm` is the
primary fulfillment path (client calls it right after the Stripe redirect).
`src/lib/stripe.ts`'s `listRecentPaidSessions` exists as a backstop for the
documented edge case in `emdash-plugin-petition/src/routes/donate.ts`'s
comment: "if a browser dies between payment and redirect, the [order] could
go unrecorded even though Stripe charged the card." This task exposes that
backstop as a manual admin action, plus a page to see recorded orders.
`index.ts` and `sandbox-entry.ts` already declare the `/orders` admin page
and the `orders` storage collection (indexes: `status`, `createdAt`,
`email`) from Task 1 — this task is the first to actually use them.

**Files:**
- Modify: `src/routes/store.ts` — extract a shared function (see below)
- Create: `src/routes/orders.ts`
- Create: `src/components/Orders.tsx`
- Modify: `src/admin.tsx` — add `"/orders": Orders`
- Modify: `src/sandbox-entry.ts` — spread `ordersRoutes` into `routes:`
- Modify: `tests/helpers.ts` — `collection()`'s mock `query()` currently
  ignores `cursor` and always returns `hasMore: false` (see
  `tests/helpers.ts:13-22`). Extend it to support cursor-based pagination
  (cursor = index offset into the in-memory array is fine) so
  `orders/list`'s pagination is actually testable. Match the real API shape
  documented in `emdash/skills/creating-plugins/references/storage.md`:
  `query()` returns `{ items, cursor, hasMore }`.
- Test: `tests/orders.test.ts`

**Step 1 — refactor `src/routes/store.ts` (do this first, it's a
prerequisite for `orders/reconcile`):**

Extract `checkout/confirm`'s body (everything from the idempotency check
through `ctx.storage.orders.put`, i.e. `src/routes/store.ts` current lines
~186-254) into an exported function:

```ts
export async function fulfillCheckoutSession(
  ctx: RouteContext, settings: Awaited<ReturnType<typeof getSettings>>, sessionId: string,
): Promise<{ status: "already" | OrderStatus; order: OrderRecord }> {
  // idempotency check (ctx.storage.orders.get), getCheckoutSession + paid
  // check, metadata parsing, resolveCartProducts + createPrintfulOrder in
  // its existing try/catch, OrderRecord construction, ctx.storage.orders.put
  // — same logic as today's checkout/confirm handler, unchanged behavior.
}
```

`checkout/confirm`'s handler becomes a thin wrapper: validate `sessionId`
from `ctx.input`, load settings, check `printfulApiKey`/`stripeSecretKey`
configured, call `fulfillCheckoutSession`, return its result. This is a
refactor — the existing `checkout/confirm` tests in `tests/store.test.ts`
must keep passing unchanged (same route, same behavior, same response
shape); if any fail, the extraction changed behavior and that's a bug in
the refactor, not a test to update.

**Step 2 — `src/routes/orders.ts` (export `ordersRoutes`, no `public: true`
flag — admin-only, matching `src/routes/settings.ts`'s convention of
omitting `public` entirely):**

1. `"orders/list"` — Input `{ status?: OrderStatus; cursor?: string; limit?: number }`.
   Validate `status` if present is one of `"paid_unfulfilled" | "fulfilled" | "failed"`
   (`PluginRouteError.badRequest` otherwise). Clamp `limit` to a sane range
   (default 20, max 100). Call:
   ```ts
   await ctx.storage.orders.query({
     where: status ? { status } : undefined,
     orderBy: { createdAt: "desc" },
     limit,
     cursor,
   })
   ```
   Return `{ items: result.items, cursor: result.cursor, hasMore: result.hasMore }`.

2. `"orders/reconcile"` — Input `{ sinceHours?: number }` (default 24, clamp
   to a sane max like 24*30 = 720 — this is a manual backstop button, not a
   scheduled job, so a generous but bounded window is fine).
   - Load settings; if unconfigured, `PluginRouteError.badRequest("Store isn't configured yet.")`.
   - `createdAfterUnix = Math.floor(Date.now() / 1000) - sinceHours * 3600`.
   - `sessions = await listRecentPaidSessions(ctx, settings, createdAfterUnix)`.
   - **Filter to this plugin's own sessions before touching anything else:**
     `sessions.filter(s => s.metadata.source === "ebt-store")` — the Stripe
     account may be shared with other plugins (e.g. `emdash-plugin-petition`'s
     donations use the same Stripe API); `listRecentPaidSessions` has no
     built-in filtering, so an unfiltered pass would try to Printful-fulfill
     someone else's donation. This is not a hypothetical — it's the same
     Stripe account pattern already established in this codebase.
   - For each remaining session, call `fulfillCheckoutSession(ctx, settings, session.id)`.
     A single session's failure must not abort the batch — wrap each call so
     one bad session doesn't stop reconciliation of the rest (this mirrors
     `fulfillCheckoutSession`'s own internal contract of never throwing past
     a paid session, but here the concern is one call from throwing something
     unexpected and killing the loop — a defensive `try/catch` per iteration
     that records the session as errored and continues is appropriate).
   - Return `{ checked: sessions.length, results: Array<{ sessionId, status }> }`
     — include every checked session's outcome (`"already"` for ones
     `checkout/confirm` already handled, `"fulfilled"`/`"failed"` for ones
     this reconcile pass just processed), so the admin can see what happened.

**Step 3 — `src/components/Orders.tsx`:** follow `src/components/Settings.tsx`'s
conventions exactly — same `apiFetch`/`parseApiResponse` from
`"emdash/plugin-utils"`, same `API` base constant
(`/_emdash/api/plugins/ebt-store`), same inline-style approach (no new
styling system). No test file for this component — this repo has no React
testing library configured (`package.json` has no `@testing-library/*`) and
no existing component has a test; `Settings.tsx` sets that precedent.

Build:
- A status filter (`<select>`: All / Paid Unfulfilled / Fulfilled / Failed)
  that re-fetches `orders/list` with the chosen `status`.
- A table: created date, email, amount (format `amountCents`/`currency` as
  e.g. `$29.99`), status, Printful order id (or `—`), and `lastError` shown
  only for failed rows.
- A "Load more" button using the returned `cursor`/`hasMore` to fetch the
  next page and append rows (don't refetch from scratch).
- A "Reconcile now" button that calls `orders/reconcile` (with a fixed
  `sinceHours: 24` — no need for a UI control for this in v1), shows a
  result summary (e.g. "Checked 3, 1 newly fulfilled"), and refreshes the
  current list afterward.

**Step 4 — tests (`tests/orders.test.ts`):**
- `orders/list`: returns items filtered by `status`; rejects an invalid
  `status` value; pagination — seed more than one page worth of orders into
  the mock `collection()`, fetch with a small `limit`, assert a `cursor` is
  returned and a second call with that cursor returns the remaining items
  (this is what makes the `tests/helpers.ts` extension necessary).
- `orders/reconcile`: mocks `listRecentPaidSessions`'s underlying Stripe
  `checkout/sessions` GET (via `mockFetch`'s `stripe` handler, same style as
  `tests/stripe.test.ts`) returning a mix of sessions — one with
  `metadata.source: "ebt-store"` not yet in storage (asserts
  `createPrintfulOrder` gets called for it and it ends up `"fulfilled"` in
  the response), one already present via `ctx.storage.orders.put` beforehand
  (asserts it comes back `"already"` and `createPrintfulOrder` is NOT called
  again for it), and one with a different `metadata.source` (e.g. `"donate"`)
  (asserts it's excluded entirely — not in the response, not touched).

- [ ] **Step 5: Run tests to verify they fail**, then implement, then verify
  they pass:

  Run: `pnpm test -- orders`

- [ ] **Step 6: Run full suite** — `pnpm test` — confirm no regressions,
  especially in `tests/store.test.ts`'s existing `checkout/confirm` tests
  (the refactor in Step 1 must not change their outcome).

- [ ] **Step 7: Typecheck** — `pnpm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/routes/store.ts src/routes/orders.ts src/components/Orders.tsx src/admin.tsx src/sandbox-entry.ts tests/helpers.ts tests/orders.test.ts
git commit -m "feat(store): add orders admin page with list, filter, and manual reconcile"
```
