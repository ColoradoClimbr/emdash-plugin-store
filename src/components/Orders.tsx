import React from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import type { OrderRecord, OrderStatus } from "../types.js";

const API = "/_emdash/api/plugins/ebt-store";

const STATUS_OPTIONS: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "paid_unfulfilled", label: "Paid Unfulfilled" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "failed", label: "Failed" },
];

type OrderRow = { id: string; data: OrderRecord };

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amountCents / 100);
}

export default function Orders() {
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  const [items, setItems] = React.useState<OrderRow[]>([]);
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [reconciling, setReconciling] = React.useState(false);

  async function load(opts: { status: OrderStatus | ""; append?: boolean; cursor?: string }) {
    const res = await apiFetch(`${API}/orders/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: opts.status || undefined, cursor: opts.cursor }),
    });
    const data = await parseApiResponse<{ items: OrderRow[]; cursor?: string; hasMore: boolean }>(res, "Failed to load orders");
    setItems((prev) => (opts.append ? [...prev, ...data.items] : data.items));
    setCursor(data.cursor);
    setHasMore(data.hasMore);
  }

  React.useEffect(() => {
    load({ status }).catch((err) => setMessage(err instanceof Error ? err.message : "Failed to load orders"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function onLoadMore() {
    try {
      await load({ status, append: true, cursor });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load more orders");
    }
  }

  async function onReconcile() {
    setReconciling(true);
    setMessage("Reconciling...");
    try {
      const res = await apiFetch(`${API}/orders/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceHours: 24 }),
      });
      const data = await parseApiResponse<{ checked: number; results: Array<{ sessionId: string; status: string }> }>(res, "Failed to reconcile orders");
      const newlyFulfilled = data.results.filter((r) => r.status === "fulfilled").length;
      setMessage(`Checked ${data.checked}, ${newlyFulfilled} newly fulfilled.`);
      await load({ status });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to reconcile orders");
    } finally {
      setReconciling(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")} style={{ padding: 8, border: "1px solid var(--kumo-border, #e5e7eb)" }}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onReconcile} disabled={reconciling} style={{ alignSelf: "flex-end" }}>
          {reconciling ? "Reconciling..." : "Reconcile now"}
        </button>
      </div>
      <p role="status">{message}</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--kumo-border, #e5e7eb)", padding: 8 }}>Created</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--kumo-border, #e5e7eb)", padding: 8 }}>Email</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--kumo-border, #e5e7eb)", padding: 8 }}>Amount</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--kumo-border, #e5e7eb)", padding: 8 }}>Status</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--kumo-border, #e5e7eb)", padding: 8 }}>Printful Order</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <React.Fragment key={row.id}>
              <tr>
                <td style={{ padding: 8 }}>{new Date(row.data.createdAt).toLocaleString()}</td>
                <td style={{ padding: 8 }}>{row.data.email}</td>
                <td style={{ padding: 8 }}>{formatAmount(row.data.amountCents, row.data.currency)}</td>
                <td style={{ padding: 8 }}>{row.data.status}</td>
                <td style={{ padding: 8 }}>{row.data.printfulOrderId ?? "—"}</td>
              </tr>
              {row.data.status === "failed" && row.data.lastError && (
                <tr>
                  <td colSpan={5} style={{ padding: "0 8px 8px", color: "var(--kumo-danger, #b91c1c)" }}>{row.data.lastError}</td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <button type="button" onClick={onLoadMore}>Load more</button>
      )}
    </div>
  );
}
