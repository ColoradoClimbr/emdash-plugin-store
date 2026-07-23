import { PluginRouteError } from "emdash";
import type { RouteContext } from "emdash";
import type { OrderStatus } from "../types.js";
import { getSettings } from "../settings.js";
import { listRecentPaidSessions } from "../lib/stripe.js";
import { fulfillCheckoutSession } from "./store.js";

const VALID_STATUSES: OrderStatus[] = ["paid_unfulfilled", "fulfilled", "failed"];
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_RECONCILE_HOURS = 24;
const MAX_RECONCILE_HOURS = 24 * 30;

export const ordersRoutes = {
  "orders/list": {
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as { status?: string; cursor?: string; limit?: number };
      let status: OrderStatus | undefined;
      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status as OrderStatus)) {
          throw PluginRouteError.badRequest("Invalid status.");
        }
        status = body.status as OrderStatus;
      }
      const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

      const result = await ctx.storage.orders.query({
        where: status ? { status } : undefined,
        orderBy: { createdAt: "desc" },
        limit,
        cursor: body.cursor,
      });
      return { items: result.items, cursor: result.cursor, hasMore: result.hasMore };
    },
  },

  "orders/reconcile": {
    handler: async (ctx: RouteContext) => {
      const body = (ctx.input ?? {}) as { sinceHours?: number };
      const sinceHours = Math.min(Math.max(Number(body.sinceHours) || DEFAULT_RECONCILE_HOURS, 1), MAX_RECONCILE_HOURS);

      const settings = await getSettings(ctx);
      if (!settings.printfulApiKey || !settings.stripeSecretKey) {
        throw PluginRouteError.badRequest("Store isn't configured yet.");
      }

      const createdAfterUnix = Math.floor(Date.now() / 1000) - sinceHours * 3600;
      const allSessions = await listRecentPaidSessions(ctx, settings, createdAfterUnix);
      // The Stripe account may be shared with other plugins (e.g.
      // emdash-plugin-petition's donations) — listRecentPaidSessions has no
      // built-in filtering, so this must happen before anything else touches
      // a session, or reconcile would try to Printful-fulfill someone else's
      // payment.
      const sessions = allSessions.filter((s) => s.metadata.source === "ebt-store");

      const results: Array<{ sessionId: string; status: string }> = [];
      for (const session of sessions) {
        try {
          const { status } = await fulfillCheckoutSession(ctx, settings, session.id);
          results.push({ sessionId: session.id, status });
        } catch {
          // One bad session must not abort the batch — record it and move on.
          results.push({ sessionId: session.id, status: "error" });
        }
      }
      return { checked: sessions.length, results };
    },
  },
};
