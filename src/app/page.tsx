"use client";

import { useState } from "react";
import type { CloneResult } from "@/lib/types";
import { buildCloneZip, downloadBlob, slugify, type ZipProgress } from "@/lib/build-zip";
import { CloneForm, type CloneFormValues } from "@/components/clone-form";
import { PreviewPanel } from "@/components/preview-panel";
import { FilesPanel } from "@/components/files-panel";
import { BackendPanel } from "@/components/backend-panel";

const TABS = ["preview", "source", "files", "backend"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [form, setForm] = useState<CloneFormValues>({ url: "", maxPages: 1, stripScripts: false });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [pageIndex, setPageIndex] = useState(0);
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);
  const [zipNote, setZipNote] = useState<string | null>(null);

  const runClone = async () => {
    const url = form.url.trim();
    if (!url) return setError("Paste a URL first.");
    setLoading(true);
    setError(null);
    setResult(null);
    setZipNote(null);
    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxPages: form.maxPages, stripScripts: form.stripScripts }),
      });
      const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      if (!res.ok) return setError(data.error || `Request failed (${res.status})`);
      setResult(data);
      setPageIndex(0);
      setTab("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const downloadZip = async () => {
    if (!result) return;
    setZipNote(null);
    try {
      const { blob, failed } = await buildCloneZip(result, setZipProgress);
      downloadBlob(blob, `${slugify(result.title)}.zip`);
      setZipNote(failed.length ? `${failed.length} file(s) failed — listed in manifest.json` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setZipProgress(null);
    }
  };

  const page = result?.pages[pageIndex];
  const offlineSource = page ? result?.textFiles.find((f) => f.path === page.path)?.content : undefined;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-800 px-4 py-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Site Cloner</h1>
            <p className="text-xs text-muted mt-0.5">
              full frontend capture · CSS, fonts, images, scripts · multi-page
            </p>
          </div>
          <span className="hidden sm:inline text-[10px] uppercase tracking-widest text-muted font-mono">
            deep clone
          </span>
        </div>
      </header>

      <CloneForm values={form} onChange={setForm} onSubmit={runClone} loading={loading} error={error} />

      {loading && (
        <p className="px-4 py-10 text-center text-xs font-mono text-muted" aria-live="polite">
          Fetching pages, stylesheets, and nested assets…
        </p>
      )}

      {result && page && (
        <section className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-neutral-800 px-4 py-3 sm:px-6 bg-neutral-950/50">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono text-muted">
              <span className="text-paper truncate max-w-[36ch]" title={result.title}>
                {result.title}
              </span>
              <span>{result.stats.pages} pages</span>
              <span>{result.stats.stylesheets} css</span>
              <span>{result.stats.scripts} js</span>
              <span>{result.stats.images} images</span>
              <span>{result.stats.fonts} fonts</span>
              <div className="ml-auto flex items-center gap-3">
                {zipNote && <span className="text-amber-400">{zipNote}</span>}
                <button
                  type="button"
                  onClick={downloadZip}
                  disabled={!!zipProgress}
                  className="px-3 py-1.5 rounded-md bg-accent text-ink font-medium hover:bg-green-400 disabled:opacity-60"
                >
                  {zipProgress ? `Downloading ${zipProgress.done}/${zipProgress.total}` : "Download ZIP"}
                </button>
              </div>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <details className="border-b border-neutral-800 px-4 py-2 sm:px-6 text-xs font-mono">
              <summary className="max-w-6xl mx-auto cursor-pointer text-amber-400">
                {result.warnings.length} note{result.warnings.length > 1 ? "s" : ""}
              </summary>
              <ul className="max-w-6xl mx-auto mt-2 space-y-1 text-muted">
                {result.warnings.slice(0, 30).map((w, i) => (
                  <li key={i} className="break-all">
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="border-b border-neutral-800 px-4 sm:px-6">
            <div className="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-paper"
                  }`}
                >
                  {t}
                </button>
              ))}
              {result.pages.length > 1 && (tab === "preview" || tab === "source") && (
                <>
                  <label htmlFor="page-select" className="sr-only">
                    Page
                  </label>
                  <select
                    id="page-select"
                    value={pageIndex}
                    onChange={(e) => setPageIndex(Number(e.target.value))}
                    className="ml-auto my-1.5 max-w-[50vw] bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-paper"
                  >
                    {result.pages.map((p, i) => (
                      <option key={p.path} value={i}>
                        {p.path}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 max-w-6xl w-full mx-auto">
            {tab === "preview" && <PreviewPanel page={page} />}
            {tab === "source" && (
              <pre className="preview-scroll h-[70vh] overflow-auto p-4 text-[11px] leading-relaxed font-mono text-neutral-300 bg-neutral-950">
                {offlineSource ?? "Source unavailable."}
              </pre>
            )}
            {tab === "files" && <FilesPanel result={result} />}
            {tab === "backend" && <BackendPanel result={result} />}
          </div>
        </section>
      )}

      {!result && !loading && (
        <section className="flex-1 flex items-center justify-center px-4 py-20">
          <div className="text-center max-w-lg">
            <p className="text-muted text-sm leading-relaxed">
              Paste a public URL. The cloner captures each page plus every stylesheet (including nested{" "}
              <code>@import</code>s), fonts and background images inside CSS, responsive <code>srcset</code> images,
              lazy-loaded media, icons, and scripts, then rewrites everything to local paths.
            </p>
            <p className="text-muted/60 text-xs mt-4 font-mono">
              Crawl up to 10 linked pages. Internal links are rewired so the ZIP works as a browsable offline site.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
