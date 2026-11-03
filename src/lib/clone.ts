import axios from "axios";
import * as cheerio from "cheerio";
import type {
  ApiEndpoint,
  ClonedPage,
  CloneForm,
  CloneOptions,
  CloneResult,
  FileKind,
  RemoteFile,
  TextFile,
} from "./types";

export type { CloneResult } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const MAX_STYLESHEETS = 80;
const RESPONSE_BUDGET = 3_800_000;

const NON_PAGE_EXT =
  /\.(pdf|zip|rar|gz|tar|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|xml|json|txt|css|js|mjs|woff2?|ttf|otf|eot|dmg|exe)$/i;

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative.trim(), base).href;
  } catch {
    return relative;
  }
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isSkippableRef(value: string): boolean {
  return /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(value.trim());
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++)
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function sanitizeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* keep raw */
  }
  return (
    decoded.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 100) ||
    "_"
  );
}

function relPath(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

function kindFromUrl(url: string, fallback: FileKind): FileKind {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* use raw */
  }
  if (/\.(woff2?|ttf|otf|eot)$/i.test(pathname)) return "font";
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(pathname))
    return "img";
  if (/\.(mp4|webm|mov|mp3|ogg|wav|m4a)$/i.test(pathname))
    return "media";
  if (/\.(m?js)$/i.test(pathname)) return "js";
  if (/\.css$/i.test(pathname)) return "css";
  return fallback;
}

function pageKey(url: string): string {
  const u = new URL(url);
  return u.origin + (u.pathname.replace(/\/+$/, "") || "/");
}

function mapSrcset(value: string, fn: (url: string) => string): string {
  return value
    .split(/,(?=\s)|(?<=\d[wx]),/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [u, ...descriptors] = part.split(/\s+/);
      if (isSkippableRef(u)) return part;
      return [fn(u), ...descriptors].join(" ");
    })
    .join(", ");
}

async function fetchText(url: string, accept = "*/*", timeout = 12000) {
  try {
    const res = await axios.get<string>(url, {
      timeout,
      maxRedirects: 5,
      maxContentLength: 8 * 1024 * 1024,
      responseType: "text",
      transformResponse: (d) => d,
      headers: {
        "User-Agent": UA,
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
      },
      validateStatus: () => true,
    });

    const finalUrl =
      (res.request as { res?: { responseUrl?: string } } | undefined)?.res
        ?.responseUrl || url;

    return {
      status: res.status,
      contentType: String(res.headers["content-type"] || ""),
      text: typeof res.data === "string" ? res.data : String(res.data ?? ""),
      finalUrl,
    };
  } catch {
    return null;
  }
}

class CloneContext {
  remote = new Map<string, RemoteFile>();
  text = new Map<string, TextFile>();
  private cssPaths = new Map<string, string>();
  private usedPaths = new Set<string>();
  private pending: Promise<void>[] = [];
  warnings: string[] = [];
  skippedFiles = 0;

  constructor(private maxFiles: number) {}

  reservePath(desired: string): string {
    if (!this.usedPaths.has(desired)) {
      this.usedPaths.add(desired);
      return desired;
    }

    const dot = desired.lastIndexOf(".");
    const base =
      dot > desired.lastIndexOf("/") ? desired.slice(0, dot) : desired;
    const ext =
      dot > desired.lastIndexOf("/") ? desired.slice(dot) : "";

    let n = 2;
    while (this.usedPaths.has(`${base}_${n}${ext}`)) n++;

    const p = `${base}_${n}${ext}`;
    this.usedPaths.add(p);
    return p;
  }

  private assetPath(url: string, kind: FileKind): string {
    const u = new URL(url);
    const segments = u.pathname
      .split("/")
      .filter(Boolean)
      .map(sanitizeSegment);

    if (!segments.length || u.pathname.endsWith("/"))
      segments.push("index");

    const file = segments.pop() as string;
    const match = file.match(/^(.*?)(\.[a-z0-9]{1,8})?$/i);

    let name = match?.[1] || "file";
    let ext = match?.[2] || "";

    if (!ext)
      ext = kind === "css" ? ".css" : kind === "js" ? ".js" : ".bin";

    if (kind === "css" && ext !== ".css") ext += ".css";
    if (u.search) name += `_${hash(u.search)}`;

    return this.reservePath(
      ["assets", sanitizeSegment(u.hostname), ...segments, name + ext].join("/")
    );
  }

  registerRemote(url: string, kind: FileKind): string | null {
    if (!isHttp(url)) return null;

    const cleanUrl = url.split("#")[0];
    const existing = this.remote.get(cleanUrl);

    if (existing) return existing.path;

    if (this.remote.size >= this.maxFiles) {
      this.skippedFiles++;
      return null;
    }

    try {
      const path = this.assetPath(cleanUrl, kind);
      this.remote.set(cleanUrl, { url: cleanUrl, path, kind });
      return path;
    } catch {
      return null;
    }
  }

  ensureStylesheet(url: string, depth: number): string | null {
    if (!isHttp(url)) return null;

    const cleanUrl = url.split("#")[0];
    const known = this.cssPaths.get(cleanUrl);

    if (known) return known;
    if (this.cssPaths.size >= MAX_STYLESHEETS || depth > 5) return null;

    let path: string;

    try {
      path = this.assetPath(cleanUrl, "css");
    } catch {
      return null;
    }

    this.cssPaths.set(cleanUrl, path);

    this.pending.push(
      (async () => {
        const res = await fetchText(cleanUrl, "text/css,*/*;q=0.1");

        if (!res || res.status >= 400) {
          this.warnings.push(
            `Stylesheet failed (${res?.status ?? "network"}): ${cleanUrl}`
          );
          this.text.set(path, {
            path,
            kind: "css",
            content: `@import url("${cleanUrl}");\n`,
          });
          return;
        }

        const content = this.rewriteCss(
          res.text,
          res.finalUrl,
          path,
          depth
        );

        this.text.set(path, { path, kind: "css", content });
      })()
    );

    return path;
  }

  rewriteCss(
    css: string,
    baseUrl: string,
    fromPath: string,
    depth: number
  ): string {
    const imports: string[] = [];

    let out = css.replace(
      /@import\s+(?:url\(\s*['"]?([^'")]+?)['"]?\s*\)|['"]([^'"]+)['"])([^;]*);/gi,
      (_m, u1: string | undefined, u2: string | undefined, rest: string) => {
        const abs = resolveUrl(baseUrl, (u1 || u2 || "").trim());
        const local = this.ensureStylesheet(abs, depth + 1);
        imports.push(local ? relPath(fromPath, local) : abs);

        return `@import url("__V0_IMPORT_${imports.length - 1}__")${rest};`;
      }
    );

    out = this.rewriteCssUrls(out, baseUrl, fromPath);

    return out.replace(
      /__V0_IMPORT_(\d+)__/g,
      (_m, i: string) => imports[Number(i)]
    );
  }

  rewriteCssUrls(
    css: string,
    baseUrl: string,
    fromPath: string
  ): string {
    return css.replace(
      /url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi,
      (match, _q: string, raw: string) => {
        const value = raw.trim();

        if (
          !value ||
          isSkippableRef(value) ||
          value.startsWith("__V0_IMPORT_") ||
          value.startsWith("%23")
        )
          return match;

        const abs = resolveUrl(baseUrl, value);
        const local = this.registerRemote(abs, kindFromUrl(abs, "img"));

        return `url("${local ? relPath(fromPath, local) : abs}")`;
      }
    );
  }

  async drain() {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
  }
}

type ParsedPage = {
  url: string;
  baseUrl: string;
  title: string;
  previewHtml: string;
  meta: Record<string, string>;
  forms: CloneForm[];
  endpoints: ApiEndpoint[];
  links: string[];
  looksClientRendered: boolean;
};

const URL_ATTRS: [string, string][] = [
  ["link", "href"],
  ["script", "src"],
  ["img", "src"],
  ["source", "src"],
  ["video", "src"],
  ["video", "poster"],
  ["audio", "src"],
  ["track", "src"],
  ["iframe", "src"],
  ["embed", "src"],
  ["object", "data"],
  ["input", "src"],
  ["a", "href"],
  ["area", "href"],
  ["form", "action"],
];

function extractApiEndpoints(
  $: cheerio.CheerioAPI,
  baseUrl: string
): ApiEndpoint[] {
  const found = new Map<string, ApiEndpoint>();

  const add = (
    method: string,
    raw: string,
    source: ApiEndpoint["source"]
  ) => {
    if (!raw || isSkippableRef(raw)) return;

    try {
      const abs = resolveUrl(baseUrl, raw);
      const u = new URL(abs);
      const key = `${method} ${u.pathname}`;

      if (!found.has(key))
        found.set(key, {
          method,
          path: u.pathname + u.search,
          source,
          sampleUrl: abs,
        });
    } catch {
      /* skip */
    }
  };

  $("form").each((_, el) => {
    add(
      ($(el).attr("method") || "GET").toUpperCase(),
      $(el).attr("action") || baseUrl,
      "form"
    );
  });

  const patterns: [RegExp, ApiEndpoint["source"]][] = [
    [/fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi, "fetch"],
    [/axios\.[a-z]+\s*\(\s*['"`]([^'"`]+)['"`]/gi, "script"],
    [
      /\.open\s*\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi,
      "xhr",
    ],
    [
      /['"`](\/(?:api|v\d+|graphql|rest|auth|login|users|data)[^'"`\s]*)['"`]/gi,
      "script",
    ],
  ];

  $("script:not([src])").each((_, el) => {
    const body = $(el).html() || "";
    if (!body.trim()) return;

    for (const [re, source] of patterns) {
      re.lastIndex = 0;

      let m: RegExpExecArray | null;

      while ((m = re.exec(body)) !== null) {
        if (m[2] && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(m[1]))
          add(m[1].toUpperCase(), m[2], source);
        else add("GET", m[1], source);
      }
    }
  });

  return Array.from(found.values());
}

function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const baseUrl = resolveUrl(pageUrl, $("base").attr("href") || pageUrl);

  $("img, source, iframe").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");

    const lazySrc =
      $el.attr("data-src") ||
      $el.attr("data-lazy-src") ||
      $el.attr("data-original");

    if (lazySrc && (!src || src.startsWith("data:")))
      $el.attr("src", lazySrc);

    const lazySrcset =
      $el.attr("data-srcset") || $el.attr("data-lazy-srcset");

    if (lazySrcset && !$el.attr("srcset"))
      $el.attr("srcset", lazySrcset);
  });

  for (const [tag, attr] of URL_ATTRS) {
    $(`${tag}[${attr}]`).each((_, el) => {
      const $el = $(el);
      const value = $el.attr(attr);

      if (!value || isSkippableRef(value)) return;

      $el.attr(attr, resolveUrl(baseUrl, value));
    });
  }

  $("img[srcset], source[srcset]").each((_, el) => {
    const $el = $(el);
    $el.attr(
      "srcset",
      mapSrcset($el.attr("srcset") || "", (u) => resolveUrl(baseUrl, u))
    );
  });

  const forms: CloneForm[] = [];

  $("form").each((_, el) => {
    const $el = $(el);
    const action = $el.attr("action") || baseUrl;

    $el.attr("action", action);

    const inputs: string[] = [];

    $el.find("input[name], select[name], textarea[name]").each((__, inp) => {
      const n = $(inp).attr("name");
      if (n) inputs.push(n);
    });

    forms.push({
      method: ($el.attr("method") || "GET").toUpperCase(),
      action,
      inputs,
    });
  });

  const meta: Record<string, string> = {};

  $("meta").each((_, el) => {
    const name =
      $(el).attr("name") ||
      $(el).attr("property") ||
      $(el).attr("http-equiv");

    const content = $(el).attr("content");

    if (name && content) meta[name] = content;
  });

  const origin = new URL(pageUrl).origin;
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!isHttp(href)) return;

    try {
      const u = new URL(href);

      if (u.origin !== origin || NON_PAGE_EXT.test(u.pathname)) return;

      links.add(pageKey(u.href));
    } catch {
      /* skip */
    }
  });

  const endpoints = extractApiEndpoints($, baseUrl);

  const bodyText = $("body")
    .clone()
    .find("script, style, noscript")
    .remove()
    .end()
    .text()
    .trim();

  const looksClientRendered = bodyText.length < 200 && $("script").length > 0;

  if ($("base").length) $("base").attr("href", baseUrl);
  else $("head").prepend(`<base href="${baseUrl}">`);

  return {
    url: pageUrl,
    baseUrl,
    title: $("title").first().text().trim(),
    previewHtml: $.html(),
    meta,
    forms,
    endpoints,
    links: Array.from(links),
    looksClientRendered,
  };
}

function buildOfflineHtml(
  page: ParsedPage,
  pagePath: string,
  ctx: CloneContext,
  pageMap: Map<string, string>,
  stripScripts: boolean
): string {
  const $ = cheerio.load(page.previewHtml);
  const rel = (p: string) => relPath(pagePath, p);

  const remote = (abs: string, kind: FileKind) => {
    const p = ctx.registerRemote(abs, kind);
    return p ? rel(p) : abs;
  };

  $("base").remove();
  $("[integrity]").removeAttr("integrity");

  $("link[crossorigin], script[crossorigin], img[crossorigin]").removeAttr(
    "crossorigin"
  );

  $('meta[http-equiv="Content-Security-Policy" i]').remove();

  $("link[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";

    if (!isHttp(href)) return;

    const relAttr = ($el.attr("rel") || "").toLowerCase();
    const as = ($el.attr("as") || "").toLowerCase();

    if (
      relAttr.includes("stylesheet") ||
      (relAttr.includes("preload") && as === "style")
    ) {
      const p = ctx.ensureStylesheet(href, 0);
      if (p) $el.attr("href", rel(p));
    } else if (/icon|apple-touch|manifest/.test(relAttr)) {
      $el.attr("href", remote(href, "icon"));
    } else if (
      relAttr.includes("modulepreload") ||
      (relAttr.includes("preload") && as === "script")
    ) {
      if (stripScripts) $el.remove();
      else $el.attr("href", remote(href, "js"));
    } else if (relAttr.includes("preload")) {
      const kind: FileKind =
        as === "font"
          ? "font"
          : as === "image"
            ? "img"
            : kindFromUrl(href, "other");

      $el.attr("href", remote(href, kind));
    }
  });

  if (stripScripts) {
    $("script").each((_, el) => {
      const type = ($(el).attr("type") || "").toLowerCase();

      if (type !== "application/ld+json") $(el).remove();
    });

    $("*").each((_, el) => {
      const attribs =
        (el as { attribs?: Record<string, string> }).attribs || {};

      for (const name of Object.keys(attribs)) {
        if (name.startsWith("on")) $(el).removeAttr(name);
      }
    });
  } else {
    $("script[src]").each((_, el) => {
      const $el = $(el);
      $el.attr("src", remote($el.attr("src") || "", "js"));
    });
  }

  $("img[src], input[src], embed[src]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") || "";

    if (isHttp(src)) $el.attr("src", remote(src, kindFromUrl(src, "img")));
  });

  $("source[src], video[src], audio[src], track[src]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") || "";
    const inPicture = $el.parent().is("picture");

    if (isHttp(src))
      $el.attr(
        "src",
        remote(src, kindFromUrl(src, inPicture ? "img" : "media"))
      );
  });

  $("img[srcset], source[srcset]").each((_, el) => {
    const $el = $(el);

    $el.attr(
      "srcset",
      mapSrcset($el.attr("srcset") || "", (u) =>
        isHttp(u) ? remote(u, kindFromUrl(u, "img")) : u
      )
    );
  });

  $("video[poster]").each((_, el) => {
    const $el = $(el);
    const poster = $el.attr("poster") || "";

    if (isHttp(poster))
      $el.attr("poster", remote(poster, "img"));
  });

  $("image").each((_, el) => {
    const $el = $(el);

    for (const attr of ["href", "xlink:href"]) {
      const v = $el.attr(attr);

      if (v && !isSkippableRef(v)) {
        const abs = resolveUrl(page.baseUrl, v);
        $el.attr(attr, remote(abs, "img"));
      }
    }
  });

  $("[style]").each((_, el) => {
    const $el = $(el);

    $el.attr(
      "style",
      ctx.rewriteCssUrls($el.attr("style") || "", page.baseUrl, pagePath)
    );
  });

  $("style").each((_, el) => {
    const $el = $(el);

    $el.text(
      ctx.rewriteCss($el.text(), page.baseUrl, pagePath, 0)
    );
  });

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";

    if (!isHttp(href)) return;

    try {
      const u = new URL(href);
      const local = pageMap.get(pageKey(u.href));

      if (local) $el.attr("href", rel(local) + u.hash);
    } catch {
      /* keep absolute */
    }
  });

  return $.html();
}

function pageFileName(
  url: string,
  isRoot: boolean,
  ctx: CloneContext
): string {
  if (isRoot) return ctx.reservePath("index.html");

  const segments = new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment);

  const name =
    segments.join("-").replace(/\.html?$/i, "").slice(0, 120) || "page";

  return ctx.reservePath(`${name}.html`);
}

export async function clonePage(
  targetUrl: string,
  opts: CloneOptions = {}
): Promise<CloneResult> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 1, 10));
  const maxFiles = Math.max(10, Math.min(opts.maxFiles ?? 400, 800));
  const stripScripts = opts.stripScripts === true;

  const result: CloneResult = {
    url: targetUrl,
    title: "",
    status: 0,
    contentType: "",
    meta: {},
    pages: [],
    textFiles: [],
    remoteFiles: [],
    forms: [],
    apiEndpoints: [],
    proxyMap: {},
    warnings: [],
    stats: {
      pages: 0,
      stylesheets: 0,
      scripts: 0,
      images: 0,
      fonts: 0,
      media: 0,
      other: 0,
      textBytes: 0,
    },
  };

  const first = await fetchText(targetUrl, HTML_ACCEPT, 20000);

  if (!first) {
    result.error = "Could not reach the site";
    return result;
  }

  result.status = first.status;
  result.contentType = first.contentType;

  if (first.status >= 400) {
    result.error = `HTTP ${first.status}`;
    return result;
  }

  const ctx = new CloneContext(maxFiles);
  const parsed: ParsedPage[] = [parsePage(first.text, first.finalUrl)];

  if (maxPages > 1) {
    const rootKey = pageKey(first.finalUrl);

    const candidates = parsed[0].links
      .filter((l) => l !== rootKey)
      .slice(0, maxPages - 1);

    const fetched = await Promise.all(
      candidates.map((u) => fetchText(u, HTML_ACCEPT, 15000))
    );

    const seen = new Set([rootKey]);

    fetched.forEach((res, i) => {
      if (!res || res.status >= 400 || !/html/i.test(res.contentType)) {
        result.warnings.push(
          `Skipped page ${candidates[i]} (${res?.status ?? "network error"})`
        );
        return;
      }

      const key = pageKey(res.finalUrl);

      if (seen.has(key)) return;

      seen.add(key);
      parsed.push(parsePage(res.text, res.finalUrl));
    });
  }

  const pageMap = new Map<string, string>();

  const pagePaths = parsed.map((p, i) => {
    const path = pageFileName(p.url, i === 0, ctx);
    pageMap.set(pageKey(p.url), path);
    return path;
  });

  const offline = parsed.map((p, i) =>
    buildOfflineHtml(p, pagePaths[i], ctx, pageMap, stripScripts)
  );

  await ctx.drain();

  const pages: ClonedPage[] = parsed.map((p, i) => ({
    url: p.url,
    path: pagePaths[i],
    title: p.title || new URL(p.url).pathname,
    previewHtml: p.previewHtml,
  }));

  const htmlFiles: TextFile[] = offline.map((content, i) => ({
    path: pagePaths[i],
    content,
    kind: "html",
  }));

  const cssFiles = Array.from(ctx.text.values());

  result.textFiles = [...htmlFiles, ...cssFiles];
  result.remoteFiles = Array.from(ctx.remote.values());
  result.pages = pages;
  result.title = parsed[0].title || new URL(first.finalUrl).hostname;
  result.url = first.finalUrl;
  result.meta = parsed[0].meta;

  const endpointMap = new Map<string, ApiEndpoint>();

  for (const p of parsed) {
    result.forms.push(...p.forms);

    for (const e of p.endpoints) {
      endpointMap.set(`${e.method} ${e.path}`, e);
    }
  }

  result.apiEndpoints = Array.from(endpointMap.values()).slice(0, 120);

  // FIX: Ensure proxyMap exists before assigning routes.
  const proxyMap = (result.proxyMap ??= {});

  for (const f of result.forms) {
    if (f.action) {
      proxyMap[f.action] =
        `/api/proxy?u=${encodeURIComponent(f.action)}`;
    }
  }

  for (const e of result.apiEndpoints) {
    if (e.sampleUrl) {
      proxyMap[e.sampleUrl] =
        `/api/proxy?u=${encodeURIComponent(e.sampleUrl)}`;
    }
  }

  for (const f of result.remoteFiles) {
    if (f.kind === "js") result.stats.scripts++;
    else if (f.kind === "img" || f.kind === "icon")
      result.stats.images++;
    else if (f.kind === "font") result.stats.fonts++;
    else if (f.kind === "media") result.stats.media++;
    else result.stats.other++;
  }

  result.stats.pages = pages.length;
  result.stats.stylesheets = cssFiles.length;

  result.stats.textBytes = result.textFiles.reduce(
    (n, f) => n + Buffer.byteLength(f.content),
    0
  );

  if (parsed.some((p) => p.looksClientRendered)) {
    result.warnings.unshift(
      "Some pages render mostly in the browser with JavaScript. The clone captures the server HTML; keep scripts enabled for the offline copy to rebuild the UI."
    );
  }

  if (ctx.skippedFiles) {
    result.warnings.push(
      `${ctx.skippedFiles} extra files exceeded the file limit and still load from the original site.`
    );
  }

  result.warnings.push(...ctx.warnings);

  // Drop preview copies until the response fits.
  let size =
    result.stats.textBytes +
    pages.reduce((n, p) => n + (p.previewHtml?.length ?? 0), 0);

  for (let i = pages.length - 1; i >= 0 && size > RESPONSE_BUDGET; i--) {
    size -= pages[i].previewHtml?.length ?? 0;
    pages[i].previewHtml = undefined;
  }

  if (size > RESPONSE_BUDGET) {
    result.error = "Site is too large to clone in one request. Try fewer pages.";
    result.textFiles = [];
    result.pages = pages.map((p) => ({
      ...p,
      previewHtml: undefined,
    }));
  } else if (pages.some((p) => !p.previewHtml)) {
    result.warnings.push(
      "Live preview was omitted for some pages to stay within response limits. They are still in the ZIP."
    );
  }

  return result;
}
