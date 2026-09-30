"use client";
import { useState } from "react";

const AUTH_BASE = "https://auth.ebay.com/oauth2/authorize";
const SCOPES = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

export default function EbayPage() {
  const [token, setToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [code, setCode] = useState("");
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(90);

  async function exchangeCode() {
    if (!code.trim()) return;
    setError(null);
    try {
      const resp = await fetch("/api/ebay/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Auth failed");
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setCode("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function refreshAccessToken() {
    if (!refreshToken) return;
    try {
      const resp = await fetch("/api/ebay/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Refresh failed");
      setToken(data.access_token);
      return data.access_token;
    } catch {
      setToken(null);
      setRefreshToken(null);
      setError("Session expired. Re-authorize.");
      return null;
    }
  }

  async function fetchOrders() {
    setLoading(true);
    setError(null);
    try {
      let t = token;
      let resp = await fetch(`/api/ebay/orders?token=${encodeURIComponent(t)}&days=${days}`);
      if (resp.status === 401) {
        t = await refreshAccessToken();
        if (!t) return;
        resp = await fetch(`/api/ebay/orders?token=${encodeURIComponent(t)}&days=${days}`);
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Fetch failed");
      setOrders(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadCSV() {
    if (!orders?.length) return;
    const headers = ["Order ID", "Date", "Buyer", "Item", "Qty", "Price", "Currency"];
    const rows = orders.map((o) => [o.orderId, o.date, o.buyer, o.item, o.qty, o.price, o.currency]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ebay_orders.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const totalSales = orders ? orders.reduce((s, o) => s + o.price, 0) : 0;
  const totalQty = orders ? orders.reduce((s, o) => s + o.qty, 0) : 0;
  const uniqueBuyers = orders ? new Set(orders.map((o) => o.buyer)).size : 0;

  if (!token) {
    return (
      <div>
        <h1 className="page-title">eBay Sales</h1>
        <p className="alert alert-info">Complete one-time eBay authorization to view your sales.</p>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          1. Click the link below to authorize on eBay<br />
          2. After approving, paste the <code>code=</code> value from the redirect URL
        </p>
        <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
          <em>Note: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RU_NAME must be set as env vars on the server.</em>
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste auth code" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={exchangeCode}>Submit</button>
        </div>
        {error && <p className="alert alert-error" style={{ marginTop: "0.5rem" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">eBay Sales</h1>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <button className="btn btn-primary" onClick={fetchOrders} disabled={loading}>
          {loading ? "Loading..." : "Fetch Orders"}
        </button>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      {orders && (
        <>
          {orders.length === 0 ? (
            <p className="alert alert-info">No orders found for this period.</p>
          ) : (
            <>
              <div className="metrics-row" style={{ marginBottom: "1rem" }}>
                <div className="metric"><div className="metric-label">Total Sales</div><div className="metric-value">${totalSales.toFixed(2)}</div></div>
                <div className="metric"><div className="metric-label">Items Sold</div><div className="metric-value">{totalQty}</div></div>
                <div className="metric"><div className="metric-label">Unique Buyers</div><div className="metric-value">{uniqueBuyers}</div></div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>
                    <th>Date</th><th>Item</th><th>Buyer</th><th>Qty</th><th>Price</th>
                  </tr></thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={i}>
                        <td>{new Date(o.date).toLocaleDateString()}</td>
                        <td>{o.item}</td>
                        <td>{o.buyer}</td>
                        <td>{o.qty}</td>
                        <td>${o.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn" onClick={downloadCSV} style={{ marginTop: "0.5rem" }}>Download CSV</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
