"use client";

import { useState, useCallback } from "react";

type AssetRecord = {
  type: string;
  url: string;
  localPath?: string;
  size?: number;
  contentType?: string;
  status?: number;
  error?: string;
  dataBase64?: string;
};

type ApiEndpoint = {
  method: string;
  path: string;
  source: string;
  sampleUrl?: string;
};

type CloneResult = {
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

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "html" | "assets" | "backend" | "proxy">("preview");
  const [zipping, setZipping] = useState(false);

  const runClone = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a URL first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, fetchAssets: true, maxAssets: 40 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setResult(data);
      setTab("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  const downloadHtml = (offline = false) => {
    if (!result) return;
    const content = offline ? result.offlineHtml : result.html;
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(result.title || "clone").replace(/[^\w.-]+/g, "_").slice(0, 60)}${offline ? "-offline" : ""}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Build a zip in-browser: offline HTML + fetched assets + manifest of API endpoints */
  const downloadZip = async () => {
    if (!result) return;
    setZipping(true);
    try {
      // dynamic import jszip via CDN to avoid extra dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const JSZip = (await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default as any;
      const zip = new JSZip();
      zip.file("index.html", result.offlineHtml || result.html);
      zip.file(
        "manifest.json",
        JSON.stringify(
          {
            source: result.url,
            title: result.title,
            clonedAt: new Date().toISOString(),
            forms: result.forms,
            apiEndpoints: result.apiEndpoints,
            stats: result.stats,
            note: "Assets that failed to download still point at the original origin. Use /api/proxy?u= on a deployed cloner to keep talking to the live backend.",
          },
          null,
          2
        )
      );
      if (result.apiEndpoints.length) {
        zip.file(
          "backend-map.md",
          [
            `# Backend map — ${result.title}`,
            ``,
            `Source: ${result.url}`,
            ``,
            `## Forms`,
            ...result.forms.map((f) => `- \`${f.method}\` ${f.action}  inputs: ${f.inputs.join(", ") || "(none)"}`),
            ``,
            `## Discovered endpoints (from scripts + forms)`,
            ...result.apiEndpoints.map((e) => `- \`${e.method}\` ${e.path}  (${e.source})`),
            ``,
            `## Proxy`,
            `When this clone is served from the Site Cloner app, rewrite calls to:`,
            `\`/api/proxy?u=<original absolute url>\``,
            ``,
          ].join("\n")
        );
      }
      const assetsFolder = zip.folder("assets");
      for (const a of result.assets) {
        if (a.localPath && a.dataBase64) {
          const name = a.localPath.replace(/^assets\//, "");
          assetsFolder?.file(name, a.dataBase64, { base64: true });
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(result.title || "clone").replace(/[^\w.-]+/g, "_").slice(0, 50)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zip failed");
    } finally {
      setZipping(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-800 px-4 py-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Site Cloner</h1>
            <p className="text-xs text-muted mt-0.5">
              frontend + asset pack + backend map + live proxy · vercel ready
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted font-mono">deep clone</span>
        </div>
      </header>

      <section className="border-b border-neutral-800 px-4 py-6 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && runClone()}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-sm font-mono placeholder:text-neutral-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            disabled={loading}
          />
          <button
            onClick={runClone}
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-accent text-ink font-medium text-sm hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Cloning…" : "Clone"}
          </button>
        </div>
        {error && <p className="max-w-6xl mx-auto mt-3 text-sm text-red-400 font-mono">{error}</p>}
      </section>

      {result && (
        <section className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-neutral-800 px-4 py-3 sm:px-6 bg-neutral-950/50">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono text-muted">
              <span className="text-paper truncate max-w-[36ch]" title={result.title}>
                {result.title}
              </span>
              <span>HTTP {result.status}</span>
              <span>
                {result.stats.assetsFetched}/{result.stats.assetsFound} assets
              </span>
              <span>{formatBytes(result.stats.totalBytes)}</span>
              <span>{result.forms.length} forms</span>
              <span>{result.apiEndpoints.length} endpoints</span>
              <div className="ml-auto flex gap-3">
                <button onClick={() => downloadHtml(false)} className="text-accent hover:underline">
                  HTML
                </button>
                <button onClick={() => downloadHtml(true)} className="text-accent hover:underline">
                  Offline HTML
                </button>
                <button
                  onClick={downloadZip}
                  disabled={zipping}
                  className="text-accent hover:underline disabled:opacity-50"
                >
                  {zipping ? "Zipping…" : "Download ZIP"}
                </button>
              </div>
            </div>
          </div>

          <div className="border-b border-neutral-800 px-4 sm:px-6">
            <div className="max-w-6xl mx-auto flex gap-1 overflow-x-auto">
              {(["preview", "html", "assets", "backend", "proxy"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    tab === t
                      ? "border-accent text-accent"
                      : "border-transparent text-muted hover:text-paper"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-[60vh] max-w-6xl w-full mx-auto">
            {tab === "preview" && (
              <iframe
                title="clone-preview"
                srcDoc={result.html}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                className="w-full h-[70vh] border-0 bg-white"
              />
            )}
            {tab === "html" && (
              <pre className="preview-scroll h-[70vh] overflow-auto p-4 text-[11px] leading-relaxed font-mono text-neutral-300 bg-neutral-950">
                {result.html}
              </pre>
            )}
            {tab === "assets" && (
              <div className="preview-scroll h-[70vh] overflow-auto p-4">
                <ul className="space-y-1.5 font-mono text-xs">
                  {result.assets.length === 0 && <li className="text-muted">No assets recorded.</li>}
                  {result.assets.map((a, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="text-accent w-14 shrink-0">{a.type}</span>
                      <span className="text-neutral-500 w-16 shrink-0">
                        {a.size != null ? formatBytes(a.size) : a.error ? "fail" : "—"}
                      </span>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neutral-400 hover:text-paper truncate"
                      >
                        {a.localPath || a.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tab === "backend" && (
              <div className="preview-scroll h-[70vh] overflow-auto p-4 space-y-6 font-mono text-xs">
                <div>
                  <h3 className="text-accent uppercase tracking-wider mb-2">Forms</h3>
                  {result.forms.length === 0 && <p className="text-muted">None found.</p>}
                  <ul className="space-y-2">
                    {result.forms.map((f, i) => (
                      <li key={i} className="border border-neutral-800 rounded p-2">
                        <div>
                          <span className="text-accent">{f.method}</span>{" "}
                          <span className="text-neutral-300 break-all">{f.action}</span>
                        </div>
                        <div className="text-muted mt-1">
                          inputs: {f.inputs.length ? f.inputs.join(", ") : "(none)"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-accent uppercase tracking-wider mb-2">Discovered endpoints</h3>
                  {result.apiEndpoints.length === 0 && (
                    <p className="text-muted">No API-looking paths extracted from scripts.</p>
                  )}
                  <ul className="space-y-1">
                    {result.apiEndpoints.map((e, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="text-accent w-14">{e.method}</span>
                        <span className="text-neutral-300">{e.path}</span>
                        <span className="text-muted">({e.source})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {tab === "proxy" && (
              <div className="preview-scroll h-[70vh] overflow-auto p-4 font-mono text-xs space-y-3">
                <p className="text-muted leading-relaxed">
                  Deploy this app, then rewrite fetch/XHR/form targets to{" "}
                  <code className="text-accent">/api/proxy?u=&lt;original absolute url&gt;</code>. The
                  proxy forwards method, body, and selected headers to the live origin so the clone
                  keeps talking to the real backend under same-origin rules.
                </p>
                <ul className="space-y-1">
                  {Object.entries(result.proxyMap)
                    .slice(0, 50)
                    .map(([orig, proxied]) => (
                      <li key={orig} className="break-all">
                        <span className="text-neutral-500">{orig}</span>
                        <br />
                        <span className="text-accent">→ {proxied}</span>
                      </li>
                    ))}
                </ul>
                {Object.keys(result.proxyMap).length > 50 && (
                  <p className="text-muted">…and {Object.keys(result.proxyMap).length - 50} more</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {!result && !loading && (
        <section className="flex-1 flex items-center justify-center px-4 py-20">
          <div className="text-center max-w-lg">
            <p className="text-muted text-sm leading-relaxed">
              Paste a public URL. The clone pulls HTML, rewrites assets absolute, downloads up to 40
              assets into a pack, maps forms + script-level API paths, and exposes a live proxy so the
              mirror can still hit the original backend.
            </p>
            <p className="text-muted/60 text-xs mt-4 font-mono">
              Server source code cannot be reconstructed without the origin. What ships: frontend +
              asset pack + backend map + proxy. Download ZIP for offline HTML + assets +
              backend-map.md.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
