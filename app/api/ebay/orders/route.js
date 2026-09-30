import { NextResponse } from "next/server";

const ORDERS_URL = "https://api.ebay.com/sell/fulfillment/v1/order";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const days = parseInt(searchParams.get("days") || "90");

  if (!token) {
    return NextResponse.json({ error: "No token" }, { status: 401 });
  }

  const since = new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, ".000Z");
  const params = new URLSearchParams({ filter: `creationdate:[${since}..]`, limit: "50" });

  const orders = [];
  let url = `${ORDERS_URL}?${params}`;

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `eBay API ${resp.status}` }, { status: resp.status });
    }
    const data = await resp.json();
    orders.push(...(data.orders || []));
    url = data.next || null;
  }

  const rows = [];
  for (const o of orders) {
    for (const item of o.lineItems || []) {
      rows.push({
        orderId: o.orderId,
        date: o.creationDate,
        buyer: o.buyer?.username || "",
        item: item.title || "",
        qty: item.quantity || 0,
        price: parseFloat(item.total?.value || "0"),
        currency: item.total?.currency || "USD",
      });
    }
  }

  return NextResponse.json(rows);
}
