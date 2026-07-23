### Task 5: Storefront routes (products, shipping rates, checkout, confirm)

**Context — plan was reconstructed, not preserved.** Tasks 1-4 scaffolded types
(`src/types.ts`), settings (`src/settings.ts`, `src/routes/settings.ts`), a
Printful client (`src/lib/printful.ts`), and a Stripe client
(`src/lib/stripe.ts`). Nothing wires them together yet — no route calls either
client. This task is that wiring.

**Precedent to mirror, not reinvent:** `C:\ebt-emdash\emdash-plugin-petition\src\routes\donate.ts`
in the sibling `emdash-plugin-petition` repo. Read it before writing code. It
establishes two hard platform facts that this task must also respect:

1. Emdash's plugin-route pipeline JSON-parses and destructively consumes the
   request body before any handler runs. There is no way to get raw bytes for
   a real Stripe webhook signature check. **Do not build a webhook handler.**
   Orders are confirmed by the client hitting a confirm route right after the
   Stripe success redirect, verified server-side by fetching the Checkout
   Session directly from Stripe (`getCheckoutSession`) — same pattern as
   `donate/confirm`.
2. Confirmation must be idempotent, keyed by Stripe Checkout Session id,
   using `ctx.storage.orders.get(sessionId)` / `.put(sessionId, record)` —
   exactly like `donate.ts`'s `ctx.storage.donations`. `tests/helpers.ts`
   already provisions `storage: { orders: collection<OrderRecord>() }` in
   `makeCtx` (see `tests/helpers.ts:31,34`) — this was scaffolded in Task 1
   anticipating this exact task.

**Files:**
- Create: `src/routes/store.ts`
- Test: `tests/store.test.ts`
- Modify: `src/sandbox-entry.ts` — spread `storeRoutes` into the `routes:` object alongside `settingsRoutes`, same as it currently spreads `settingsRoutes`
- Modify: `tests/helpers.ts` — `makeCtx` needs a minimal `request` on the returned context (`Request` with configurable `Origin` header and a URL) so origin validation is testable. Look at how `emdash-plugin-petition/src/routes/signSubmit.ts`'s `validateOrigin(request: Request)` reads `request.headers.get("Origin")` / `"Referer"` — the mock only needs to satisfy that shape, not a full `Request` polyfill if a plain object with `.headers.get()` is enough for TypeScript here (check `RouteContext`'s actual `request` type from the `emdash` package to see how strict this needs to be).

**Interfaces consumed** (already built, do not modify their signatures):
- `getSettings(ctx)` → `PluginSettings` (src/settings.ts)
- `listSyncProducts(ctx, settings)` → `Array<{id, name, thumbnailUrl}>`
- `getSyncProduct(ctx, settings, syncProductId)` → `{id, name, variants: Array<{id, name, retailPrice, currency, size, color, imageUrl, availabilityStatus}>}`
- `getShippingRates(ctx, settings, recipient, items)` → `ShippingRateOption[]`
- `createPrintfulOrder(ctx, settings, {externalId, recipient, items: Array<{syncVariantId, quantity, retailPrice}>, shippingRateId, confirm})` → `{id, status}`
- `createStripeCustomer(ctx, settings, recipient)` → `{id}`
- `createCheckoutSession(ctx, settings, {customerId, lineItems, shippingCents, shippingName, metadata})` → `{id, url}`
- `getCheckoutSession(ctx, settings, sessionId)` → `{id, payment_status, amount_total, currency, metadata, customer_details}`
- `OrderRecord`, `OrderStatus`, `CartItem`, `RecipientAddress` (src/types.ts) — already defined, use as-is

**Routes to add in `src/routes/store.ts` (export `storeRoutes`, same shape as `settingsRoutes`):**

1. `"products/list"` — `public: true`. No input. Calls `listSyncProducts`. Returns `{ products }`.

2. `"products/get"` — `public: true`. Input `{ syncProductId: number }`. Validate it's a positive integer (`PluginRouteError.badRequest` otherwise — import `PluginRouteError` from `"emdash"`, same as `donate.ts`). Calls `getSyncProduct`. Returns `{ product }`.

3. `"cart/shipping-rates"` — `public: true`. Input `{ recipient: RecipientAddress, items: CartItem[] }`. Validate `items` is a non-empty array (max 50 line items, each quantity a positive integer ≤ 20 — sanity bounds only, mirrors `donate.ts`'s `MIN_CENTS`/`MAX_CENTS` bounds-checking style, not arbitrary paranoia). Calls `getShippingRates`. Returns `{ rates }`.

4. `"checkout/create-session"` — `public: true`. Input `{ recipient: RecipientAddress, items: CartItem[], shippingRateId: string }`.
   - `validateOrigin(ctx.request)` first, like `donate.ts` — throw `PluginRouteError.forbidden("Invalid origin")` if it fails. Import/copy `validateOrigin` the way `donate.ts` does (it's exported from `signSubmit.ts` in that plugin; since this plugin has no equivalent file, write a local copy in `store.ts` — same body, same `hostAllowed`-against-`settings.siteOrigin` logic. Read `signSubmit.ts`'s full `validateOrigin` + its `hostAllowed` helper to copy correctly.)
   - Load settings; if `!settings.printfulApiKey || !settings.stripeSecretKey` throw `PluginRouteError.badRequest("Store isn't configured yet.")`.
   - Validate `items` same bounds as route 3.
   - **Server-side price computation — do not trust any price/amount from the request body.** For each unique `syncProductId` in `items`, call `getSyncProduct` once (cache in a `Map<number, ...>` keyed by `syncProductId` so items sharing a product don't refetch it), find the matching variant by `syncVariantId`. If the product or variant isn't found, or `variant.availabilityStatus` indicates it's unavailable (mirror whatever check makes sense — Printful's field is a string like `"active"` vs discontinued states; if uncertain what "unavailable" values look like from the API, treat only an exact known-good value as available and reject everything else with a clear error rather than guessing at every possible value), throw `PluginRouteError.badRequest`. Compute `unitAmountCents = Math.round(parseFloat(variant.retailPrice) * 100)`. Build a Stripe line item with `name: \`${product.name} - ${variant.name}\``.
   - Call `getShippingRates(recipient, items)` and find the rate matching `shippingRateId` from the request — **do not trust a client-provided shipping amount**. If no match, throw `PluginRouteError.badRequest("Invalid shipping option.")`. `shippingCents = Math.round(parseFloat(rate.rate) * 100)`, `shippingName = rate.name`.
   - `createStripeCustomer(ctx, settings, recipient)` → `customerId`.
   - `metadata`: `{ source: "ebt-store", cart: JSON.stringify(items), shippingRateId, recipient: JSON.stringify(recipient) }` — this is how `checkout/confirm` (route 5) recovers what to fulfill, since Stripe is the only place this data persists between session creation and payment. Stripe metadata values are capped at 500 characters each; a normal cart/recipient fits comfortably — do not add truncation/splitting logic for this, it's not a real scenario at this cart size.
   - Call `createCheckoutSession(ctx, settings, { customerId, lineItems, shippingCents, shippingName, metadata })`. Return `{ url: session.url }`.

5. `"checkout/confirm"` — `public: true`. Input `{ sessionId: string }` (via `ctx.input`, NOT a URL query param — this plugin's convention per `src/routes/settings.ts` is `ctx.input`, unlike `donate.ts`'s `confirm` route which reads a query string because it's hit directly by a GET redirect in that plugin's flow; ours is called by client JS after redirect, so a normal input body works and needs no `ctx.request.url` parsing).
   - `existing = await ctx.storage.orders.get(sessionId)`. If found, return `{ status: "already", order: existing }` — this is the idempotency check; a client retry or double-call must not double-charge Printful.
   - Load settings; same missing-config check as route 4.
   - `session = await getCheckoutSession(ctx, settings, sessionId)`. If `session.payment_status !== "paid"`, throw `PluginRouteError.badRequest("This payment hasn't completed.")`.
   - Parse `cart = JSON.parse(session.metadata.cart)`, `recipient = JSON.parse(session.metadata.recipient)`, `shippingRateId = session.metadata.shippingRateId`. If any is missing/unparseable, throw `PluginRouteError.badRequest("Unrecognized checkout session.")` (mirrors `donate.ts`'s "Unrecognized checkout session" handling for a session that isn't one of ours).
   - Re-derive Printful order line items: for each cart item, call `getSyncProduct` (same per-product caching as route 4) to get `retailPrice` for `createPrintfulOrder`'s `items` param.
   - Call `createPrintfulOrder(ctx, settings, { externalId: sessionId, recipient, items: <derived>, shippingRateId, confirm: true })` in a `try/catch`.
     - On success: build an `OrderRecord` with `status: "fulfilled"`, `printfulOrderId: result.id`, `lastError: null`.
     - On failure: build an `OrderRecord` with `status: "failed"`, `printfulOrderId: null`, `lastError: String(err)`. **Still store it and still return normally (don't throw)** — the customer already paid; a thrown 500 here would strand a paid order with no record at all, and the failure needs to be visible for manual retry (via the orders admin page in a later task), not surfaced as a route error to the person who just paid.
   - Fill remaining `OrderRecord` fields from the session: `amountCents: session.amount_total`, `currency: session.currency`, `email: session.customer_details?.email ?? ""`, `cart`, `shippingRateId`, `recipient`, `createdAt`/`updatedAt: new Date().toISOString()`.
   - `await ctx.storage.orders.put(sessionId, record)`.
   - Return `{ status: record.status, order: record }`.

**`OrderStatus` note:** the type has three values — `"paid_unfulfilled" | "fulfilled" | "failed"`. This task's `checkout/confirm` only ever produces `"fulfilled"` or `"failed"` (Printful order creation is synchronous with `confirm: true`, so there's no in-between state to persist). Do not invent a code path that uses `"paid_unfulfilled"` — it's unused by this task; leave it in the type as-is.

- [ ] **Step 1: Write failing tests** in `tests/store.test.ts`. Cover, at minimum:
  - `products/list` returns mapped products from a mocked Printful response
  - `products/get` returns a product with variants
  - `cart/shipping-rates` returns rates, and rejects empty `items`
  - `checkout/create-session`: rejects invalid origin; rejects when store unconfigured; computes `unit_amount` from the mocked product's `retail_price` (assert the captured Stripe request body, same style as `tests/stripe.test.ts`'s `captured` pattern) — NOT from any client-supplied price; rejects an unknown `shippingRateId`; returns `{ url }` on success
  - `checkout/confirm`: returns `{status:"already"}` on a second call for the same `sessionId` without re-hitting Printful (assert the mocked Printful order-creation fetch was called at most once across both calls); rejects an unpaid session; on a successful paid session, calls `createPrintfulOrder` and stores an `OrderRecord` with `status: "fulfilled"`; on a Printful failure, stores `status: "failed"` with `lastError` set and does NOT throw

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test -- store`
  Expected: FAIL with "Cannot find module '../src/routes/store.js'"

- [ ] **Step 3: Implement `src/routes/store.ts`** per the route specs above, reusing `pfFetch`/`stripeFetch`-backed client functions from `src/lib/printful.ts` and `src/lib/stripe.ts` as-is — do not duplicate their HTTP logic in the route file.

- [ ] **Step 4: Wire into `src/sandbox-entry.ts`** — import `storeRoutes` from `./routes/store.js`, spread it into `routes: { ...settingsRoutes, ...storeRoutes }`.

- [ ] **Step 5: Run tests to verify they pass**

  Run: `pnpm test -- store`
  Expected: PASS

- [ ] **Step 6: Run full suite**

  Run: `pnpm test`
  Expected: all existing tests still pass (no regressions in settings/printful/stripe tests)

- [ ] **Step 7: Commit**

```bash
git add src/routes/store.ts tests/store.test.ts src/sandbox-entry.ts tests/helpers.ts
git commit -m "feat(store): add storefront routes (products, shipping, checkout, confirm)"
```
