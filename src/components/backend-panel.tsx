import type { CloneResult } from "@/lib/types";

export function BackendPanel({ result }: { result: CloneResult }) {
  const proxyEntries = Object.entries(result.proxyMap ?? {});
  const backend = result.backend;

  return (
    <div className="preview-scroll h-[70vh] overflow-auto p-4 space-y-8 font-mono text-xs">
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Backend Analysis</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Detected Services</p>
            <p className="text-xl font-bold">
              {backend?.services?.length ?? 0}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Environment Variables</p>
            <p className="text-xl font-bold">
              {backend?.envVars?.length ?? 0}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">API Endpoints</p>
            <p className="text-xl font-bold">
              {result.apiEndpoints?.length ?? 0}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Proxy Routes</p>
            <p className="text-xl font-bold">
              {proxyEntries.length}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Detected Services</h3>

        {backend?.services?.length ? (
          backend.services.map((service) => (
            <div
              key={service.id}
              className="rounded-lg border p-3 space-y-1"
            >
              <div className="font-bold">{service.name}</div>
              <div className="text-muted-foreground">
                Category: {service.category}
              </div>
              <div>{service.evidence}</div>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No services detected.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Environment Variables</h3>

        {backend?.envVars?.length ? (
          backend.envVars.map((env) => (
            <div
              key={env.key}
              className="rounded-lg border p-3 space-y-1"
            >
              <div className="font-bold">{env.key}</div>
              <div className="text-muted-foreground">
                Group: {env.group}
              </div>
              <div>
                Visibility: {env.public ? "Public" : "Private"}
              </div>
              <div>
                Value: {env.placeholder ?? "Not available"}
              </div>
              {env.note && <div>{env.note}</div>}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No environment variables detected.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">API Endpoints</h3>

        {result.apiEndpoints?.length ? (
          result.apiEndpoints.map((endpoint, index) => (
            <div
              key={`${endpoint.method}-${endpoint.path}-${index}`}
              className="rounded-lg border p-3"
            >
              <span className="font-bold">{endpoint.method}</span>{" "}
              {endpoint.path}
              <div className="text-muted-foreground">
                Source: {endpoint.source}
              </div>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No API endpoints detected.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Proxy Routes</h3>

        {proxyEntries.length ? (
          proxyEntries.map(([path, target]) => (
            <div
              key={path}
              className="rounded-lg border p-3 break-all"
            >
              <div className="font-bold">{path}</div>
              <div className="text-muted-foreground">{target}</div>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No proxy routes available.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Captured Responses</h3>

        {backend?.responses?.length ? (
          backend.responses.map((response, index) => (
            <div
              key={`${response.url}-${index}`}
              className="rounded-lg border p-3 space-y-1"
            >
              <div className="font-bold">
                {response.method} {response.path}
              </div>
              <div>Status: {response.status}</div>
              <div>Type: {response.contentType}</div>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No captured responses.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-sm">Warnings</h3>

        {result.warnings?.length ? (
          result.warnings.map((warning, index) => (
            <div
              key={index}
              className="rounded-lg border p-3"
            >
              {warning}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            No warnings.
          </p>
        )}
      </section>
    </div>
  );
}
