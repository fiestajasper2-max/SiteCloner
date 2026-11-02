"use client";

export type CloneFormValues = {
  url: string;
  maxPages: number;
  stripScripts: boolean;
};

const PAGE_OPTIONS = [1, 3, 5, 10];

export function CloneForm({
  values,
  onChange,
  onSubmit,
  loading,
  error,
}: {
  values: CloneFormValues;
  onChange: (v: CloneFormValues) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="border-b border-neutral-800 px-4 py-6 sm:px-6">
      <form
        className="max-w-6xl mx-auto flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading) onSubmit();
        }}
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="clone-url" className="sr-only">
            Website URL
          </label>
          <input
            id="clone-url"
            type="url"
            required
            placeholder="https://example.com"
            value={values.url}
            onChange={(e) => onChange({ ...values, url: e.target.value })}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-sm font-mono placeholder:text-neutral-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-accent text-ink font-medium text-sm hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Cloning…" : "Clone"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-mono text-muted">
          <fieldset className="flex items-center gap-2" disabled={loading}>
            <legend className="sr-only">Pages to clone</legend>
            <span aria-hidden="true">pages</span>
            <div className="flex rounded-md border border-neutral-700 overflow-hidden">
              {PAGE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={values.maxPages === n}
                  onClick={() => onChange({ ...values, maxPages: n })}
                  className={`px-3 py-1.5 transition-colors ${
                    values.maxPages === n ? "bg-accent text-ink" : "hover:text-paper"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={values.stripScripts}
              disabled={loading}
              onChange={(e) => onChange({ ...values, stripScripts: e.target.checked })}
              className="accent-accent size-3.5"
            />
            static snapshot (remove JavaScript)
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400 font-mono">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
