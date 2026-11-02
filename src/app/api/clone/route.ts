import { NextRequest, NextResponse } from "next/server";
import { clonePage } from "@/lib/clone";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const fetchAssets = body?.fetchAssets !== false;
    const maxAssets = typeof body?.maxAssets === "number" ? body.maxAssets : 40;

    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "Only http/https URLs allowed" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (isPrivateHost(parsed.hostname)) {
      return NextResponse.json({ error: "Local/private hosts are blocked" }, { status: 400 });
    }

    const result = await clonePage(url, { fetchAssets, maxAssets });

    if (result.error && !result.html) {
      return NextResponse.json({ error: result.error, status: result.status }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Clone failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
