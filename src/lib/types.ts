export type ApiEndpoint = {
  method: string;
  path: string;
  source: "form" | "fetch" | "xhr" | "script" | "bundle" | "link";
  sampleUrl?: string;
};

export type FileKind = "html" | "css" | "js" | "img" | "font" | "media" | "icon" | "other";

export type ClonedPage = {
  url: string;
  path: string;
  title: string;
  previewHtml?: string;
};

export type TextFile = {
  path: string;
  content: string;
  kind: "html" | "css";
};

export type RemoteFile = {
  url: string;
  path: string;
  kind: FileKind;
};

export type CloneForm = { method: string; action: string; inputs: string[] };

export type ServiceCategory =
  | "database"
  | "auth"
  | "payments"
  | "analytics"
  | "cms"
  | "search"
  | "monitoring"
  | "framework"
  | "hosting"
  | "other";

export type DetectedService = {
  id: string;
  name: string;
  category: ServiceCategory;
  evidence: string;
  /** true when guessed from framework conventions rather than seen directly */
  inferred?: boolean;
};

export type EnvVar = {
  key: string;
  /** only set for values already shipped publicly in the site's frontend */
  value?: string;
  placeholder?: string;
  /** exposed to the browser (publishable) vs. server-only secret */
  public: boolean;
  group: string;
  note?: string;
};

export type CapturedResponse = {
  kind: "api" | "ssr";
  method: string;
  url: string;
  path: string;
  status: number;
  contentType: string;
  body: string;
};

export type BackendCapture = {
  services: DetectedService[];
  envVars: EnvVar[];
  endpoints: ApiEndpoint[];
  responses: CapturedResponse[];
  cookies: string[];
  headers: Record<string, string>;
};

/** One page cloned by a single /api/clone request. */
export type PageCloneResult = {
  url: string;
  rootUrl: string;
  title: string;
  status: number;
  meta: Record<string, string>;
  page: ClonedPage;
  textFiles: TextFile[];
  remoteFiles: RemoteFile[];
  forms: CloneForm[];
  links: string[];
  sitemapUrls: string[];
  scanned: string[];
  backend: BackendCapture;
  looksClientRendered: boolean;
  warnings: string[];
};

export type CloneStats = {
  pages: number;
  stylesheets: number;
  scripts: number;
  images: number;
  fonts: number;
  media: number;
  other: number;
  textBytes: number;
};

/** Whole-site result aggregated on the client from many page clones. */
export type CloneResult = {
  url: string;
  title: string;
  status: number;
  meta: Record<string, string>;
  pages: ClonedPage[];
  textFiles: TextFile[];
  remoteFiles: RemoteFile[];
  forms: CloneForm[];
  apiEndpoints: ApiEndpoint[];
  backend: BackendCapture;
  uncrawled: { url: string; path: string }[];
  warnings: string[];
  stats: CloneStats;
};

export type PageCloneOptions = {
  rootUrl?: string;
  discover?: boolean;
  stripScripts?: boolean;
  known?: string[];
};
