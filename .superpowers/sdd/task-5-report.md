# Task 5 report: Storefront routes (products, shipping rates, checkout, confirm)

## Summary

Implemented `src/routes/store.ts` exporting `storeRoutes` with five public
routes — `products/list`, `products/get`, `cart/shipping-rates`,
`checkout/create-session`, `checkout/confirm` — wired into
`src/sandbox-entry.ts` alongside `settingsRoutes`. All server-side price and
shipping computation is derived from Printful/Stripe responses, never from
client input. Confirmation is idempotent via `ctx.storage.orders`, keyed by
Stripe Checkout Session id, per the precedent in
`emdash-plugin-petition/src/routes/donate.ts`.

## Files touched

- Created: `C:\ebt-emdash\emdash-plugin-store\src\routes\store.ts`
- Created: `C:\ebt-emdash\emdash-plugin-store\tests\store.test.ts`
- Modified: `C:\ebt-emdash\emdash-plugin-store\src\sandbox-entry.ts` (import + spread `storeRoutes`)
- Modified: `C:\ebt-emdash\emdash-plugin-store\tests\helpers.ts` (`makeCtx` now returns a `request: Request` with a configurable `Origin` header, defaulting to `"https://everybittexas.com"` — the plugin's own `DEFAULT_SETTINGS.siteOrigin` — so existing tests that don't care about origin are unaffected)

## Precedent read and followed

- `emdash-plugin-petition/src/routes/donate.ts` — no-webhook / confirm-by-session-id pattern, `try/catch` around the post-payment fulfillment call so a fulfillment failure never throws a 500 to a customer who already paid.
- `emdash-plugin-petition/src/routes/signSubmit.ts` — `validateOrigin`/`hostAllowed` shape (checks `Origin` header, falls back to `Referer`, allows localhost for local dev).

## Deviations from the brief, with reasoning (flagging per crewcut, not silently deciding)

1. **`validateOrigin` signature takes `siteOrigin` as a second argument**, unlike petition's single-arg `validateOrigin(request)`. Petition's version checks against a hardcoded `ALLOWED_ORIGIN_HOSTS` set; this plugin has no such hardcoded set — the brief itself says the copy should be "hostAllowed-against-settings.siteOrigin," which is a per-install configurable value, not a constant. There's no way to thread that into a single-arg function without a module-level side channel, which would be worse. I resolved this by loading `settings` first in `checkout/create-session` and calling `validateOrigin(ctx.request, settings.siteOrigin)` as literally the first check afterward — before the missing-config check and all Printful/Stripe calls, so it's still "first" in the sense of "before any expensive work," even though the brief's bullet list showed "validateOrigin" and "load settings" as two separate top-level steps. Other reading: keep `validateOrigin(request)` single-arg and hardcode an `ALLOWED_ORIGIN_HOSTS`-equivalent constant in `store.ts`, mirroring petition even more literally — I judged this wrong for this plugin since `siteOrigin` is already a first-class configurable setting field (`PluginSettings.siteOrigin`) that exists specifically for this purpose.

2. **`checkout/confirm`'s try/catch scope is wider than literally described.** The brief scopes the try/catch narrowly around `createPrintfulOrder(...)` itself. I put the entire "re-derive Printful order items via `getSyncProduct`" step inside the same try/catch as the `createPrintfulOrder` call, sharing the loop/caching helper (`resolveCartProducts`) with `checkout/create-session`. Reasoning: if a product/variant was deleted from Printful between checkout and confirm, `getSyncProduct` or the variant-lookup would throw — and per the brief's own stated rationale ("the customer already paid; a thrown 500 here would strand a paid order with no record at all"), that failure needs the exact same `status: "failed"` / `lastError` treatment as a `createPrintfulOrder` failure, not an uncaught 500. Covered by the "Printful failure" test, though that test exercises failure via the `/orders` endpoint rejecting rather than a missing product — the code path for a missing-product failure is the same catch block, just not separately asserted.

3. **No `printfulApiKey`/`stripeSecretKey` configured-check on `products/list`, `products/get`, or `cart/shipping-rates`.** The brief only specifies this check for routes 4 and 5 ("same missing-config check as route 4"). If Printful isn't configured, `listSyncProducts`/`getSyncProduct`/`getShippingRates` will throw a raw `PrintfulApiError` (likely a 401) rather than a clean `PluginRouteError.badRequest("Store isn't configured yet.")`. I left this as-is rather than add an unrequested check, since the brief was specific about which routes get it — flagging in case that's an oversight in the brief rather than an intentional omission (an unconfigured store's catalog page would surface a less friendly error than the checkout routes do).

## TDD evidence

1. Wrote `tests/store.test.ts` importing `storeRoutes` from `../src/routes/store.js` (didn't exist yet) and ran:
   ```
   pnpm test -- store
   ```
   Result: failed as expected —
   ```
   Error: Cannot find module '../src/routes/store.js' imported from .../tests/store.test.ts
   Test Files  1 failed | 4 passed (5)
   ```
2. Implemented `src/routes/store.ts`, wired into `src/sandbox-entry.ts`.
3. Re-ran `pnpm test -- store`: `Test Files 5 passed (5)`, `Tests 31 passed (31)`.
4. Ran full suite `pnpm test`: `Test Files 5 passed (5)`, `Tests 31 passed (31)` — no regressions in scaffold/settings/printful/stripe tests.
5. Ran `pnpm typecheck` (`tsc --noEmit`): clean, no errors.

### Test cases in `tests/store.test.ts` (13 new tests)

- `products/list` returns mapped products from a mocked Printful response.
- `products/get` returns a product with variants; rejects a non-positive-integer `syncProductId`.
- `cart/shipping-rates` returns rates for a valid cart; rejects an empty `items` array.
- `checkout/create-session`: rejects an invalid origin (403); rejects when the store isn't configured (400); rejects an unknown `shippingRateId` (400); computes `unit_amount` from Printful's `retail_price` while a malicious client-supplied `retailPrice` field on the cart item is ignored, and asserts the captured Stripe request body's `unit_amount` for both the product line item (2999, from 29.99) and the shipping line item (500, from Printful's quoted 5.00 rate, not any client value); returns `{ url }` on success.
- `checkout/confirm`: rejects an unpaid session (400); on a paid session calls `createPrintfulOrder` and stores a `fulfilled` `OrderRecord`, then a second call with the same `sessionId` returns `{status:"already"}` without incrementing the Printful order-creation call counter (asserted at exactly 1 across both calls); on a Printful failure (mocked 400 from `/orders`) stores a `failed` `OrderRecord` with `lastError` set and the call does **not** throw; rejects a session whose metadata is missing/unparseable ("Unrecognized checkout session").

## Self-review

- Confirmed `RouteContext` from the installed `emdash@0.30.0` package (`node_modules/emdash/dist/types-BvB7gDOD.d.mts`) has `request: Request` as a required (non-optional) field, matching the brief's assumption — no discrepancy found there.
- Confirmed `PluginRouteError` (`node_modules/emdash/dist/index-wYnC6u4o.d.mts`) has a public `status: number` field with `badRequest`→400, `forbidden`→403, matching what the tests assert via `toMatchObject({ status: ... })`.
- Did not modify any signatures in `src/lib/printful.ts` or `src/lib/stripe.ts`.
- Did not touch `src/routes/settings.ts`, `src/settings.ts`, or any test file other than adding `tests/store.test.ts` and the minimal `tests/helpers.ts` diff described above.
- `resolveCartProducts` helper is shared between `checkout/create-session` and `checkout/confirm` specifically because both need identical "fetch each unique `syncProductId` once, find the variant" logic — avoided duplicating that loop.

## Commit

```
835d50c feat(store): add storefront routes (products, shipping, checkout, confirm)
```

## Fix: clean 400 for unknown product in `checkout/create-session` (review follow-up)

**Finding:** In `resolveCartProducts`, an unknown/deleted `syncProductId` let `getSyncProduct`'s raw `PrintfulApiError` (on a Printful 404) escape uncaught, surfacing as a generic 500 from `checkout/create-session` instead of `PluginRouteError.badRequest`. The variant-not-found half of the same function already wrapped correctly; only the product-fetch half was missing it.

**Fix:** Wrapped the `getSyncProduct(...)` call inside `resolveCartProducts`'s loop in a try/catch that rethrows `PluginRouteError.badRequest(\`Product ${item.syncProductId} not found.\`)`, mirroring the existing `Variant ${item.syncVariantId} not found.` convention right below it. Fixed in the shared function (root cause, one call site) rather than duplicating a guard at each caller — safe for `checkout/confirm` too, since `confirm` already wraps its entire `resolveCartProducts` call in a try/catch that catches any error type and records it as a `failed` `OrderRecord` (`status`/idempotency semantics unchanged; only the stored `lastError` message text now reads more cleanly).

**TDD evidence:**
- Added `checkout/create-session` › "returns a clean 400 (not a raw PrintfulApiError) for an unknown/deleted syncProductId" to `tests/store.test.ts`, mocking `/store/products/:id` as a 404.
- `pnpm exec vitest run tests/store.test.ts`: `Test Files 1 passed (1)`, `Tests 14 passed (14)` (13 → 14).
- `pnpm test` (full suite): `Test Files 5 passed (5)`, `Tests 32 passed (32)` (31 → 32, no regressions).
- `pnpm exec tsc --noEmit`: clean, no output.

Commit: `fix(store): return clean 400 for unknown product in checkout/create-session`
