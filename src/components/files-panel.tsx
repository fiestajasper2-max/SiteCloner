"use client";

import { useMemo, useState } from "react";
import type { CloneResult, FileKind } from "@/lib/types";

type Row = { path: string; url?: string; kind: FileKind; size?: number };

const FILTERS: { id: "all" | FileKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "js", label: "JS" },
  { id: "img", label: "Images" },
  { id: "font", label: "Fonts" },
  { id: "media", label: "Media" },
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function FilesPanel({ result }: { result: CloneResult }) {
  const [filter, setFilter] = useState<"all" | FileKind>("all");

  const rows = useMemo<Row[]>(() => {
    const textUrls = new Map(result.pages.map((p) => [p.path, p.url]));
    return [
      ...result.textFiles.map((f) => ({
        path: f.path,
        url: textUrls.get(f.path),
        kind: f.kind as FileKind,
        size: f.content.length,
      })),
      ...result.remoteFiles.map((f) => ({ path: f.path, url: f.url, kind: f.kind })),
    ];
  }, [result]);

  const visible = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "img") return r.kind === "img" || r.kind === "icon";
    if (filter === "media") return r.kind === "media" || r.kind === "other";
    return r.kind === filter;
  });

  return (
    <div className="h-[70vh] flex flex-col">
      <div className="flex gap-1 overflow-x-auto px-4 py-2 border-b border-neutral-800 text-[11px] font-mono">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded whitespace-nowrap transition-colors ${
              filter === f.id ? "bg-neutral-800 text-paper" : "text-muted hover:text-paper"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-muted whitespace-nowrap">{visible.length} files</span>
      </div>
      <ul className="preview-scroll flex-1 overflow-auto p-4 space-y-1.5 font-mono text-xs">
        {visible.length === 0 && <li className="text-muted">No files in this category.</li>}
        {visible.map((r) => (
          <li key={r.path} className="flex gap-3 items-baseline min-w-0">
            <span className="text-accent w-12 shrink-0 uppercase">{r.kind}</span>
            <span className="text-neutral-500 w-16 shrink-0">{r.size != null ? formatBytes(r.size) : "remote"}</span>
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                title={r.url}
                className="text-neutral-300 hover:text-paper truncate"
              >
                {r.path}
              </a>
            ) : (
              <span className="text-neutral-300 truncate">{r.path}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
