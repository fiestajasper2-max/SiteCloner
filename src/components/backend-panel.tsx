import type { CloneResult } from "@/lib/types";

export function BackendPanel({ result }: { result: CloneResult }) {
  const proxyEntries = Object.entries(result.proxyMap);

  return (
    <div className="preview-scroll h-[70vh] overflow-auto p-4 space-y-8 font-mono text-xs">
      <section>
        <h3 className="text-accent uppercase tracking-wider mb-2">Forms</h3>
        {result.forms.length === 0 && <p className="text-muted">None found.</p>}
        <ul className="space-y-2">
          {result.forms.map((f, i) => (
            <li key={i} className="border border-neutral-800 rounded p-2">
              <span className="text-accent">{f.method}</span>{" "}
              <span className="text-neutral-300 break-all">{f.action}</span>
              <div className="text-muted mt-1">inputs: {f.inputs.length ? f.inputs.join(", ") : "(none)"}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-accent uppercase tracking-wider mb-2">Discovered endpoints</h3>
        {result.apiEndpoints.length === 0 && <p className="text-muted">No API-looking paths found in inline scripts.</p>}
        <ul className="space-y-1">
          {result.apiEndpoints.map((e, i) => (
            <li key={i} className="flex gap-3 min-w-0">
              <span className="text-accent w-14 shrink-0">{e.method}</span>
              <span className="text-neutral-300 break-all">{e.path}</span>
              <span className="text-muted shrink-0">({e.source})</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-accent uppercase tracking-wider mb-2">Live proxy</h3>
        <p className="text-muted leading-relaxed mb-3">
          Point fetch/XHR/form calls at{" "}
          <code className="text-accent">{"/api/proxy?u=<original absolute url>"}</code> on your deployed cloner to keep
          talking to the real backend.
        </p>
        <ul className="space-y-2">
          {proxyEntries.slice(0, 50).map(([orig, proxied]) => (
            <li key={orig} className="break-all">
              <span className="text-neutral-500">{orig}</span>
              <br />
              <span className="text-accent">{"→ "}{proxied}</span>
            </li>
          ))}
        </ul>
        {proxyEntries.length > 50 && <p className="text-muted mt-2">…and {proxyEntries.length - 50} more</p>}
      </section>
    </div>
  );
}
