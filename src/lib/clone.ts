import axios, { AxiosResponse } from "axios";
import * as cheerio from "cheerio";

export type AssetRecord = {
  type: string;
  url: string;
  localPath?: string;
  size?: number;
  contentType?: string;
  status?: number;
  error?: string;
};

export type ApiEndpoint = {
  method: string;
  path: string;
  source: "form" | "fetch" | "xhr" | "script" | "link";
  sampleUrl?: string;
};

export type CloneResult = {
  url: string;
  title: string;
  html: string;
  offlineHtml: string;
  assets: AssetRecord[];
  scripts: string[];
  styles: string[];
  meta: Record<string, string>;
  forms: { method: string; action: string; inputs: string[] }[];
  apiEndpoints: ApiEndpoint[];
  proxyMap: Record<string, string>;
  status: number;
  contentType: string;
  error?: string;
  stats: {
    assetsFound: number;
    assetsFetched: number;
    assetsFailed: number;
    totalBytes: number;
  };
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const commonHeaders = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function extractMeta($: cheerio.CheerioAPI): Record<string, string> {
  const meta: Record<string, string> = {};
  $("meta").each((_, el) => {
    const name = $(el).attr("name") || $(el).attr("property") || $(el).attr("http-equiv");
    const content = $(el).attr("content");
    if (name && content) meta[name] = content;
  });
  return meta;
}

function safePathFromUrl(assetUrl: string, index: number): string {
  try {
    const u = new URL(assetUrl);
    let path = u.pathname.replace(/^\//, "") || "index";
    path = path.replace(/[^a-zA-Z0-9._\-\/]/g, "_");
    if (path.endsWith("/")) path += "index";
    // keep extension if present
    const hasExt = /\.[a-z0-9]{1,8}$/i.test(path);
    if (!hasExt) {
      // guess from common patterns
      if (path.includes("css") || assetUrl.includes(".css")) path += ".css";
      else if (path.includes("js") || assetUrl.includes(".js")) path += ".js";
      else path += ".bin";
    }
    return `assets/${index}_${path.split("/").pop() || "file"}`;
  } catch {
    return `assets/${index}_file.bin`;
  }
}

function extractApiEndpoints(html: string, baseUrl: string, $: cheerio.CheerioAPI): ApiEndpoint[] {
  const found = new Map<string, ApiEndpoint>();

  // Forms
  $("form").each((_, el) => {
    const method = (($(el).attr("method") || "GET").toUpperCase());
    const action = $(el).attr("action") || "";
    const abs = resolveUrl(baseUrl, action || baseUrl);
    try {
      const u = new URL(abs);
      const key = `${method} ${u.pathname}`;
      if (!found.has(key)) {
        found.set(key, {
          method,
          path: u.pathname + u.search,
          source: "form",
          sampleUrl: abs,
        });
      }
    } catch {
      /* skip */
    }
  });

  // fetch / axios / xhr patterns in inline scripts
  const scriptBodies: string[] = [];
  $("script").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) {
      const body = $(el).html() || "";
      if (body.trim()) scriptBodies.push(body);
    }
  });

  const patterns = [
    /fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /axios\.[a-z]+\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /\.open\s*\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi,
    /['"`](\/(?:api|v\d+|graphql|rest|auth|login|users|data)[^'"`\s]*)['"`]/gi,
  ];

  for (const body of scriptBodies) {
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(body)) !== null) {
        let method = "GET";
        let pathOrUrl = m[1];
        if (m.length >= 3 && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(m[1])) {
          method = m[1].toUpperCase();
          pathOrUrl = m[2];
        }
        if (!pathOrUrl || pathOrUrl.startsWith("data:") || pathOrUrl.startsWith("blob:")) continue;
        try {
          const abs = resolveUrl(baseUrl, pathOrUrl);
          const u = new URL(abs);
          // only same-origin or relative API-looking paths
          const key = `${method} ${u.pathname}`;
          if (!found.has(key)) {
            found.set(key, {
              method,
              path: u.pathname + u.search,
              source: "script",
              sampleUrl: abs,
            });
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  return Array.from(found.values()).slice(0, 80);
}

async function fetchAsset(
  assetUrl: string,
  index: number,
  timeoutMs = 12000
): Promise<AssetRecord> {
  const rec: AssetRecord = { type: "asset", url: assetUrl };
  try {
    const res: AxiosResponse<ArrayBuffer> = await axios.get(assetUrl, {
      timeout: timeoutMs,
      responseType: "arraybuffer",
      maxRedirects: 3,
      headers: { "User-Agent": UA, Accept: "*/*" },
      validateStatus: () => true,
    });
    rec.status = res.status;
    rec.contentType = String(res.headers["content-type"] || "");
    if (res.status >= 400) {
      rec.error = `HTTP ${res.status}`;
      return rec;
    }
    const buf = Buffer.from(res.data);
    rec.size = buf.length;
    rec.localPath = safePathFromUrl(assetUrl, index);
    // store base64 so the client can rebuild offline zip without a second round-trip
    (rec as AssetRecord & { dataBase64?: string }).dataBase64 = buf.toString("base64");
    return rec;
  } catch (err: unknown) {
    rec.error = err instanceof Error ? err.message : String(err);
    return rec;
  }
}

/**
 * Deep clone:
 * 1. Fetch HTML
 * 2. Rewrite all resource URLs absolute
 * 3. Discover forms + script-level API endpoints
 * 4. Optionally download assets (capped) and produce offlineHtml with local paths
 * 5. Build proxyMap: original absolute → /api/proxy?u=...
 *
 * True server source cannot be reconstructed without the origin's code.
 * What we ship: frontend mirror + asset pack + endpoint map + optional proxy
 * so the clone can still talk to the live backend under the same origin.
 */
export async function clonePage(
  targetUrl: string,
  opts: { fetchAssets?: boolean; maxAssets?: number } = {}
): Promise<CloneResult> {
  const fetchAssets = opts.fetchAssets !== false;
  const maxAssets = Math.min(opts.maxAssets ?? 40, 60);

  const result: CloneResult = {
    url: targetUrl,
    title: "",
    html: "",
    offlineHtml: "",
    assets: [],
    scripts: [],
    styles: [],
    meta: {},
    forms: [],
    apiEndpoints: [],
    proxyMap: {},
    status: 0,
    contentType: "",
    stats: { assetsFound: 0, assetsFetched: 0, assetsFailed: 0, totalBytes: 0 },
  };

  try {
    const response = await axios.get(targetUrl, {
      timeout: 20000,
      maxRedirects: 5,
      headers: commonHeaders,
      responseType: "text",
      validateStatus: () => true,
    });

    result.status = response.status;
    result.contentType = String(response.headers["content-type"] || "");

    if (response.status >= 400) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const rawHtml = typeof response.data === "string" ? response.data : String(response.data);
    const $ = cheerio.load(rawHtml, { xml: false });

    const baseHref = $("base").attr("href") || targetUrl;
    if (!$("base").length) {
      $("head").prepend(`<base href="${resolveUrl(targetUrl, baseHref)}">`);
    } else {
      $("base").attr("href", resolveUrl(targetUrl, baseHref));
    }

    // Collect + rewrite resource URLs
    const assetUrls: { type: string; url: string; attr: string; el: cheerio.Element }[] = [];

    $("link[href], script[src], img[src], source[src], video[src], audio[src], iframe[src], embed[src], object[data]").each(
      (_, el) => {
        const $el = $(el);
        const attr =
          $el.attr("href") !== undefined ? "href" : $el.attr("src") !== undefined ? "src" : "data";
        const val = $el.attr(attr);
        if (!val || val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("javascript:"))
          return;
        const abs = resolveUrl(targetUrl, val);
        $el.attr(attr, abs);
        const tag = (el as unknown as { tagName?: string }).tagName?.toLowerCase() || "asset";
        assetUrls.push({ type: tag, url: abs, attr, el });
      }
    );

    // Forms absolute
    $("form").each((_, el) => {
      const $el = $(el);
      const action = $el.attr("action") || "";
      const abs = resolveUrl(targetUrl, action || targetUrl);
      $el.attr("action", abs);
      const method = ($el.attr("method") || "GET").toUpperCase();
      const inputs: string[] = [];
      $el.find("input[name], select[name], textarea[name]").each((__, inp) => {
        const n = $(inp).attr("name");
        if (n) inputs.push(n);
      });
      result.forms.push({ method, action: abs, inputs });
    });

    $("script").each((_, el) => {
      const src = $(el).attr("src");
      if (src) result.scripts.push(src);
      else if (($(el).html() || "").trim()) result.scripts.push("[inline]");
    });
    $("link[rel='stylesheet'], style").each((_, el) => {
      const href = $(el).attr("href");
      if (href) result.styles.push(href);
      else result.styles.push("[inline]");
    });

    result.title = $("title").first().text().trim() || new URL(targetUrl).hostname;
    result.meta = extractMeta($);
    result.html = $.html();
    result.apiEndpoints = extractApiEndpoints(result.html, targetUrl, $);

    // Proxy map: every unique asset + form action → /api/proxy?u=
    const allTargets = new Set<string>();
    assetUrls.forEach((a) => allTargets.add(a.url));
    result.forms.forEach((f) => allTargets.add(f.action));
    result.apiEndpoints.forEach((e) => {
      if (e.sampleUrl) allTargets.add(e.sampleUrl);
    });
    for (const t of allTargets) {
      result.proxyMap[t] = `/api/proxy?u=${encodeURIComponent(t)}`;
    }

    // Deduplicate asset URLs for download
    const unique = Array.from(new Map(assetUrls.map((a) => [a.url, a])).values());
    result.stats.assetsFound = unique.length;

    if (fetchAssets && unique.length > 0) {
      const slice = unique.slice(0, maxAssets);
      const settled = await Promise.all(
        slice.map((a, i) =>
          fetchAsset(a.url, i).then((rec) => {
            rec.type = a.type;
            return rec;
          })
        )
      );
      result.assets = settled;
      for (const a of settled) {
        if (a.error || !a.localPath) result.stats.assetsFailed++;
        else {
          result.stats.assetsFetched++;
          result.stats.totalBytes += a.size || 0;
        }
      }

      // offlineHtml: rewrite successful assets to local paths
      const $off = cheerio.load(result.html, { xml: false });
      const byUrl = new Map(settled.filter((a) => a.localPath && !a.error).map((a) => [a.url, a.localPath!]));
      $off("link[href], script[src], img[src], source[src], video[src], audio[src]").each((_, el) => {
        const $el = $off(el);
        const attr = $el.attr("href") !== undefined ? "href" : "src";
        const val = $el.attr(attr);
        if (val && byUrl.has(val)) $el.attr(attr, byUrl.get(val)!);
      });
      // strip base so offline relative paths work when served from zip root
      $off("base").remove();
      result.offlineHtml = $off.html() || result.html;
    } else {
      result.offlineHtml = result.html;
      result.assets = unique.map((a) => ({ type: a.type, url: a.url }));
    }

    return result;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}
