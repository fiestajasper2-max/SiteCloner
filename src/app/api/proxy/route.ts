import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

/**
 * Transparent proxy so the cloned frontend can call the original backend
 * under same-origin rules. GET/POST/PUT/PATCH/DELETE supported.
 * Body + most headers forwarded; hop-by-hop headers stripped.
 */
export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
export async function PUT(req: NextRequest) {
  return handle(req);
}
export async function PATCH(req: NextRequest) {
  return handle(req);
}
export async function DELETE(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) {
    return NextResponse.json({ error: "missing u" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(u);
    if (!["http:", "https:"].includes(target.protocol)) {
      return NextResponse.json({ error: "bad protocol" }, { status: 400 });
    }
    if (isPrivateHost(target.hostname)) {
      return NextResponse.json({ error: "private host blocked" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  try {
    const method = req.method.toUpperCase();
    const headers: Record<string, string> = {
      "User-Agent": UA,
    };
    // forward selected client headers
    const forward = ["accept", "accept-language", "content-type", "authorization", "cookie", "x-requested-with"];
    for (const name of forward) {
      const v = req.headers.get(name);
      if (v) headers[name] = v;
    }

    let data: ArrayBuffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      data = await req.arrayBuffer();
    }

    const res = await axios({
      url: target.href,
      method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      headers,
      data,
      responseType: "arraybuffer",
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    const outHeaders = new Headers();
    const ct = res.headers["content-type"];
    if (ct) outHeaders.set("content-type", String(ct));
    // CORS for the cloner origin
    outHeaders.set("access-control-allow-origin", "*");
    outHeaders.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    outHeaders.set("access-control-allow-headers", "*");

    return new NextResponse(Buffer.from(res.data), {
      status: res.status,
      headers: outHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "proxy failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}
