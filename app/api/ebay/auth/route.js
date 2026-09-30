import { NextResponse } from "next/server";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SCOPES = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

function basicAuth() {
  return Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
}

export async function POST(request) {
  const { code, refresh_token } = await request.json();

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return NextResponse.json({ error: "eBay credentials not configured" }, { status: 500 });
  }

  const body = refresh_token
    ? `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh_token)}&scope=${encodeURIComponent(SCOPES)}`
    : `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(process.env.EBAY_RU_NAME)}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json({ error: text }, { status: resp.status });
  }

  const tokens = await resp.json();
  return NextResponse.json(tokens);
}
