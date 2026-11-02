export type ApiEndpoint = {
  method: string;
  path: string;
  source: "form" | "fetch" | "xhr" | "script" | "link";
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

export type CloneResult = {
  url: string;
  title: string;
  status: number;
  contentType: string;
  meta: Record<string, string>;
  pages: ClonedPage[];
  textFiles: TextFile[];
  remoteFiles: RemoteFile[];
  forms: CloneForm[];
  apiEndpoints: ApiEndpoint[];
  proxyMap: Record<string, string>;
  warnings: string[];
  error?: string;
  stats: {
    pages: number;
    stylesheets: number;
    scripts: number;
    images: number;
    fonts: number;
    media: number;
    other: number;
    textBytes: number;
  };
};

export type CloneOptions = {
  maxPages?: number;
  maxFiles?: number;
  stripScripts?: boolean;
};
