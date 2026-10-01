# emdash-plugin-store

A Printful print-on-demand storefront plugin for [Emdash CMS](https://emdashcms.com), with Stripe Checkout for payment.

## What it does

- Lists Printful sync products and variants, and quotes live shipping rates for a cart
- Creates a Stripe Checkout Session with prices computed **server-side from Printful's own data** — never from client-supplied amounts
- Confirms payment and creates the matching Printful order once Stripe redirects back (see [Payment confirmation](#payment-confirmation-no-webhook) below)
- Orders admin page: list/filter recorded orders by status, and a manual "Reconcile now" backstop for the rare case a browser dies mid-redirect
- Failed order fulfillment (e.g. Printful was down) is retried automatically the next time its session is confirmed or reconciled
- All API keys and settings stored in Cloudflare KV — nothing hardcoded

## Installation

```sh
pnpm add emdash-plugin-store
```

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import emdash from "emdash";
import { storePlugin } from "emdash-plugin-store";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [storePlugin()],
    }),
  ],
});
```

## Configuration

Configure via the **Store Settings** page in the Emdash admin panel. All values are stored in Cloudflare KV.

| Setting | Description |
|---|---|
| Printful Private API Token | From your Printful account's API settings |
| Printful Store ID | Only needed if using an account-level API token |
| Stripe Secret Key | Live or test secret key |
| Site Origin | e.g. `https://example.com` — used for checkout success/cancel URLs and origin validation |

## Admin routes

| Route | Description |
|---|---|
| `GET /settings/get` / `POST /settings/update` | Read and update plugin settings |
| `GET /orders/list` | List orders, filterable by status, paginated |
| `POST /orders/reconcile` | Manual backstop: checks Stripe for recently paid sessions this plugin created and fulfills any that were missed |

## Public routes

| Route | Description |
|---|---|
| `GET /products/list` | List synced Printful products |
| `GET /products/get` | Get one product with its variants |
| `POST /cart/shipping-rates` | Quote shipping rates for a cart + address |
| `POST /checkout/create-session` | Create a Stripe Checkout Session |
| `POST /checkout/confirm` | Verify payment and create the Printful order |

## Payment confirmation

Two paths record a paid order, both idempotent by Checkout Session id and both claiming the order with a compare-and-set before calling Printful, so concurrent calls create exactly one Printful order:

- `checkout/confirm` is called by the client right after the Stripe success redirect.
- `checkout/webhook` is the backstop for a browser that dies between payment and redirect. Add a Stripe webhook endpoint at `/_emdash/api/plugins/ebt-store/checkout/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then paste its `whsec_...` signing secret into the store settings. The signature (HMAC-SHA256 over the raw body, 5 minute tolerance) is verified, only the session id is read from the event, and the session is re-fetched from Stripe. Events for sessions without `metadata.source = ebt-store` are ignored.

`orders/reconcile` remains as a manual backstop.

## Stripe Tax

Checkout Sessions are created with `automatic_tax` enabled. Stripe will only actually collect tax in jurisdictions where you've filed a tax registration — check **Stripe Dashboard → Tax → Registrations**.

## Requirements

- Emdash `>=0.39.0`
- A Printful account with a store connected
- A Stripe account with a secret key

## About

Coded by [Claude Code](https://claude.ai/code) for [Example Site](https://example.com).

Built for [EmDash CMS](https://github.com/emdash-cms/emdash) — star the repo to support open-source CMS development.

## License

MIT
