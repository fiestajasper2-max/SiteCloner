import type { CloneResult, RemoteFile } from "./types";

const CONCURRENCY = 6;

export type ZipProgress = { done: number; total: number };

/**
 * Assets are pulled one by one through /api/proxy so no single serverless
 * response has to carry the whole site (Vercel caps responses at 4.5 MB).
 */
export async function buildCloneZip(
  result: CloneResult,
  onProgress: (p: ZipProgress) => void
): Promise<{ blob: Blob; failed: (RemoteFile & { error: string })[] }> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const file of result.textFiles) zip.file(file.path, file.content);

  const queue = [...result.remoteFiles];
  const total = queue.length;
  const failed: (RemoteFile & { error: string })[] = [];
  let done = 0;
  onProgress({ done, total });

  const worker = async () => {
    while (queue.length) {
      const file = queue.shift() as RemoteFile;
      try {
        const res = await fetch(`/api/proxy?u=${encodeURIComponent(file.url)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        zip.file(file.path, await res.arrayBuffer());
      } catch (e) {
        failed.push({ ...file, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      onProgress({ done, total });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        source: result.url,
        title: result.title,
        clonedAt: new Date().toISOString(),
        pages: result.pages.map(({ url, path, title }) => ({ url, path, title })),
        stats: result.stats,
        failedFiles: failed,
        warnings: result.warnings,
        forms: result.forms,
        apiEndpoints: result.apiEndpoints,
      },
      null,
      2
    )
  );

  zip.file(
    "README.md",
    [
      `# ${result.title}`,
      ``,
      `Cloned from ${result.url} on ${new Date().toUTCString()}.`,
      ``,
      `## Open it`,
      `- Quick look: open \`index.html\` in a browser.`,
      `- Best results: serve the folder over HTTP, e.g. \`npx serve .\`, then visit the printed URL.`,
      ``,
      `## Pages`,
      ...result.pages.map((p) => `- [${p.title}](${p.path}) — ${p.url}`),
      ``,
      `## Structure`,
      `- \`*.html\` — pages with every stylesheet, image, font, and script rewritten to local paths`,
      `- \`assets/<host>/...\` — downloaded files, mirroring the original URL structure`,
      `- \`manifest.json\` — pages, stats, failed files, forms, and discovered API endpoints`,
      ``,
      failed.length
        ? `${failed.length} file(s) could not be downloaded; see manifest.json → failedFiles.`
        : `All ${total} files downloaded.`,
      ``,
    ].join("\n")
  );

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, failed };
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function slugify(name: string, max = 50) {
  return name.replace(/[^\w.-]+/g, "_").slice(0, max) || "clone";
}
