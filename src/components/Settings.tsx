import React from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

const API = "/_emdash/api/plugins/ebt-store";

const FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "printfulApiKey", label: "Printful Private API Token", type: "password" },
  { key: "printfulStoreId", label: "Printful Store ID (only if using an account-level token)" },
  { key: "stripeSecretKey", label: "Stripe Secret Key", type: "password" },
  { key: "stripeWebhookSecret", label: "Stripe Webhook Signing Secret (whsec_...) — endpoint /_emdash/api/plugins/ebt-store/checkout/webhook, events checkout.session.completed + checkout.session.async_payment_succeeded", type: "password" },
  { key: "siteOrigin", label: "Site Origin (e.g. https://example.com)" },
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
