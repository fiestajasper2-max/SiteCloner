"use client";

import { useState } from "react";
import type { ClonedPage } from "@/lib/types";

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: "100%" },
  { id: "tablet", label: "Tablet", width: "768px" },
  { id: "mobile", label: "Mobile", width: "390px" },
] as const;

export function PreviewPanel({ page }: { page: ClonedPage }) {
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]["id"]>("desktop");
  const width = VIEWPORTS.find((v) => v.id === viewport)?.width ?? "100%";

  return (
    <div className="flex flex-col h-[70vh]">
      <div className="flex items-center justify-end gap-1 px-4 py-2 border-b border-neutral-800 text-[11px] font-mono">
        {VIEWPORTS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={viewport === v.id}
            onClick={() => setViewport(v.id)}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewport === v.id ? "bg-neutral-800 text-paper" : "text-muted hover:text-paper"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 flex justify-center bg-neutral-900 overflow-auto">
        {page.previewHtml ? (
          <iframe
            key={page.path}
            title={`Preview of ${page.title}`}
            srcDoc={page.previewHtml}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ width }}
            className="h-full max-w-full border-0 bg-white transition-[width] duration-200"
          />
        ) : (
          <p className="self-center text-muted text-xs font-mono px-6 text-center">
            Preview omitted for this page to stay within response limits. It is still included in the ZIP.
          </p>
        )}
      </div>
    </div>
  );
}
