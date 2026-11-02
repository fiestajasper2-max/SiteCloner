import type { ApiEndpoint, DetectedService, EnvVar, ServiceCategory } from "./types";

/**
 * Collects backend signals from HTML, inline scripts, JS bundles, response
 * headers and cookies. Server code and databases are never reachable from the
 * outside, so services are detected from what the frontend exposes, and the
 * matching server-side secrets are emitted as empty placeholders.
 */
export class BackendScanner {
  services = new Map<string, DetectedService>();
  envVars = new Map<string, EnvVar>();
  endpoints = new Map<string, ApiEndpoint>();

  constructor(private origin: string) {}

  addService(id: string, name: string, category: ServiceCategory, evidence: string, inferred = false) {
    if (!this.services.has(id)) this.services.set(id, { id, name, category, evidence, inferred });
  }

  addEnv(env: EnvVar) {
    const existing = this.envVars.get(env.key);
    if (!existing || (!existing.value && env.value)) this.envVars.set(env.key, env);
  }

  addEndpoint(method: string, raw: string, baseUrl: string, source: ApiEndpoint["source"]) {
    if (!raw || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(raw) || raw.length > 300) return;
    if (/\s/.test(raw.trim())) return;
    try {
      const u = new URL(raw.trim(), baseUrl);
      if (!/^https?:$/.test(u.protocol)) return;
      if (/\.(css|js|mjs|png|jpe?g|gif|svg|webp|woff2?|ico|map)$/i.test(u.pathname)) return;
      const path = u.origin === this.origin ? u.pathname + u.search : u.href;
      const key = `${method} ${u.origin}${u.pathname}`;
      if (this.endpoints.size < 400 && !this.endpoints.has(key))
        this.endpoints.set(key, { method, path, source, sampleUrl: u.href });
    } catch {
      /* not a URL */
    }
  }

  scanSource(text: string, baseUrl: string, source: ApiEndpoint["source"]) {
    this.scanEndpoints(text, baseUrl, source);
    this.scanEnvReferences(text);
    this.scanServiceSignatures(text);
  }

  private scanEndpoints(text: string, baseUrl: string, source: ApiEndpoint["source"]) {
    const run = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let n = 0;
      while ((m = re.exec(text)) !== null && n++ < 500) fn(m);
    };
    run(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi, (m) => this.addEndpoint("GET", m[1], baseUrl, source === "bundle" ? "bundle" : "fetch"));
    run(/axios\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi, (m) =>
      this.addEndpoint(m[1].toUpperCase(), m[2], baseUrl, source)
    );
    run(/\.open\s*\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi, (m) =>
      this.addEndpoint(m[1].toUpperCase(), m[2], baseUrl, source === "bundle" ? "bundle" : "xhr")
    );
    run(/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`][^}]{0,200}?['"`](\/(?:api|graphql|v\d+)\/?[^'"`\s]*)['"`]/gi, (m) =>
      this.addEndpoint(m[1].toUpperCase(), m[2], baseUrl, source)
    );
    run(/['"`](\/(?:api|graphql|rest|v\d+|wp-json|auth|oauth|trpc|rpc)(?:\/[^'"`\s<>]*)?)['"`]/gi, (m) =>
      this.addEndpoint("GET", m[1], baseUrl, source)
    );
    run(/['"`](https?:\/\/(?:api\.[^'"`\s/]+|[^'"`\s/]+\/(?:api|graphql|v\d+)\/?)[^'"`\s<>]*)['"`]/gi, (m) =>
      this.addEndpoint("GET", m[1], baseUrl, source)
    );
  }

  private scanEnvReferences(text: string) {
    const ignore = /^(NODE_ENV|NEXT_RUNTIME|NEXT_PHASE|__NEXT_[A-Z_]+|TURBOPACK|DEBUG|PORT|MODE|DEV|PROD|SSR|BASE_URL)$/;
    const add = (key: string) => {
      if (ignore.test(key) || this.envVars.has(key)) return;
      const isPublic = /^(NEXT_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|PUBLIC|GATSBY|EXPO_PUBLIC)_/.test(key);
      this.addEnv({ key, public: isPublic, group: "Referenced by the site's code", placeholder: "" });
    };
    for (const re of [
      /process\.env\.([A-Z_][A-Z0-9_]{2,60})/g,
      /import\.meta\.env\.([A-Z_][A-Z0-9_]{2,60})/g,
      /\b((?:NEXT_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|GATSBY|EXPO_PUBLIC)_[A-Z0-9_]{2,60})\b/g,
    ]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) add(m[1]);
    }
  }

  private scanServiceSignatures(text: string) {
    const first = (re: RegExp) => text.match(re);

    const supa = first(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
    if (supa) {
      this.addService("supabase", "Supabase (Postgres)", "database", supa[0]);
      this.addEnv({ key: "SUPABASE_URL", value: supa[0], public: true, group: "Supabase" });
      for (const jwt of text.match(/eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) {
        const role = jwtClaim(jwt, "role");
        if (role === "anon") this.addEnv({ key: "SUPABASE_ANON_KEY", value: jwt, public: true, group: "Supabase" });
      }
      this.addEnv({ key: "SUPABASE_ANON_KEY", public: true, group: "Supabase", placeholder: "" });
      this.addEnv({ key: "SUPABASE_SERVICE_ROLE_KEY", public: false, group: "Supabase", note: "server-only, not exposed by the site" });
      this.addEnv({
        key: "DATABASE_URL",
        public: false,
        group: "Database",
        placeholder: "postgresql://postgres:password@db.<project>.supabase.co:5432/postgres",
      });
    }

    const fbDomain = first(/([a-z0-9-]+)\.firebaseapp\.com/);
    const fbDb = first(/https:\/\/[a-z0-9-]+\.(?:firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)/);
    if (fbDomain || fbDb) {
      this.addService("firebase", "Firebase (Firestore / Realtime DB)", "database", (fbDomain || fbDb)![0]);
      const apiKey = first(/AIza[0-9A-Za-z_-]{35}/);
      if (apiKey) this.addEnv({ key: "FIREBASE_API_KEY", value: apiKey[0], public: true, group: "Firebase" });
      if (fbDomain) {
        this.addEnv({ key: "FIREBASE_AUTH_DOMAIN", value: fbDomain[0], public: true, group: "Firebase" });
        this.addEnv({ key: "FIREBASE_PROJECT_ID", value: fbDomain[1], public: true, group: "Firebase" });
      }
      if (fbDb) this.addEnv({ key: "FIREBASE_DATABASE_URL", value: fbDb[0], public: true, group: "Firebase" });
      const bucket = first(/[a-z0-9-]+\.(?:appspot\.com|firebasestorage\.app)/);
      if (bucket) this.addEnv({ key: "FIREBASE_STORAGE_BUCKET", value: bucket[0], public: true, group: "Firebase" });
      const appId = first(/1:\d{6,}:web:[a-f0-9]{6,}/);
      if (appId) this.addEnv({ key: "FIREBASE_APP_ID", value: appId[0], public: true, group: "Firebase" });
      this.addEnv({ key: "FIREBASE_SERVICE_ACCOUNT_KEY", public: false, group: "Firebase", note: "server-only admin credentials" });
    } else {
      const gKey = first(/AIza[0-9A-Za-z_-]{35}/);
      if (gKey) {
        this.addService("google-api", "Google APIs (Maps, etc.)", "other", "AIza… key in bundle");
        this.addEnv({ key: "GOOGLE_API_KEY", value: gKey[0], public: true, group: "Google" });
      }
    }

    for (const pk of new Set(text.match(/pk_(?:live|test)_[0-9A-Za-z$]{16,}/g) || [])) {
      if (isClerkKey(pk)) {
        this.addService("clerk", "Clerk", "auth", "Clerk publishable key");
        this.addEnv({ key: "CLERK_PUBLISHABLE_KEY", value: pk, public: true, group: "Clerk" });
        this.addEnv({ key: "CLERK_SECRET_KEY", public: false, group: "Clerk" });
      } else {
        this.addService("stripe", "Stripe", "payments", "Stripe publishable key");
        this.addEnv({ key: "STRIPE_PUBLISHABLE_KEY", value: pk, public: true, group: "Stripe" });
        this.addEnv({ key: "STRIPE_SECRET_KEY", public: false, group: "Stripe" });
        this.addEnv({ key: "STRIPE_WEBHOOK_SECRET", public: false, group: "Stripe" });
      }
    }
    if (/js\.stripe\.com/.test(text)) this.addService("stripe", "Stripe", "payments", "js.stripe.com");

    const sentry = first(/https:\/\/[a-f0-9]{32}@[a-z0-9.-]+\.ingest(?:\.[a-z]{2})?\.sentry\.io\/\d+/);
    if (sentry) {
      this.addService("sentry", "Sentry", "monitoring", "Sentry DSN");
      this.addEnv({ key: "SENTRY_DSN", value: sentry[0], public: true, group: "Sentry" });
      this.addEnv({ key: "SENTRY_AUTH_TOKEN", public: false, group: "Sentry" });
    }

    const mapbox = first(/pk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/);
    if (mapbox) {
      this.addService("mapbox", "Mapbox", "other", "Mapbox public token");
      this.addEnv({ key: "MAPBOX_ACCESS_TOKEN", value: mapbox[0], public: true, group: "Mapbox" });
    }

    const posthog = first(/phc_[A-Za-z0-9]{30,}/);
    if (posthog) {
      this.addService("posthog", "PostHog", "analytics", "PostHog project key");
      this.addEnv({ key: "POSTHOG_KEY", value: posthog[0], public: true, group: "PostHog" });
    }

    const algolia = first(/([A-Z0-9]{10})-dsn\.algolia\.net/);
    if (algolia) {
      this.addService("algolia", "Algolia", "search", algolia[0]);
      this.addEnv({ key: "ALGOLIA_APP_ID", value: algolia[1], public: true, group: "Algolia" });
      this.addEnv({ key: "ALGOLIA_SEARCH_KEY", public: true, group: "Algolia" });
      this.addEnv({ key: "ALGOLIA_ADMIN_KEY", public: false, group: "Algolia" });
    }

    const sanity = first(/([a-z0-9]{8})\.api(?:cdn)?\.sanity\.io/);
    if (sanity) {
      this.addService("sanity", "Sanity CMS", "cms", sanity[0]);
      this.addEnv({ key: "SANITY_PROJECT_ID", value: sanity[1], public: true, group: "Sanity" });
      this.addEnv({ key: "SANITY_DATASET", public: true, group: "Sanity", placeholder: "production" });
      this.addEnv({ key: "SANITY_API_TOKEN", public: false, group: "Sanity" });
    }

    if (/cdn\.contentful\.com|images\.ctfassets\.net/.test(text)) {
      this.addService("contentful", "Contentful CMS", "cms", "contentful CDN");
      const space = first(/(?:ctfassets\.net|spaces)\/([a-z0-9]{12})\//);
      this.addEnv({ key: "CONTENTFUL_SPACE_ID", value: space?.[1], public: true, group: "Contentful" });
      this.addEnv({ key: "CONTENTFUL_ACCESS_TOKEN", public: false, group: "Contentful" });
    }

    const shopify = first(/([a-z0-9-]+)\.myshopify\.com/);
    if (shopify) {
      this.addService("shopify", "Shopify", "payments", shopify[0]);
      this.addEnv({ key: "SHOPIFY_STORE_DOMAIN", value: shopify[0], public: true, group: "Shopify" });
      this.addEnv({ key: "SHOPIFY_STOREFRONT_ACCESS_TOKEN", public: true, group: "Shopify" });
      this.addEnv({ key: "SHOPIFY_ADMIN_ACCESS_TOKEN", public: false, group: "Shopify" });
    }

    const auth0 = first(/[a-z0-9-]+(?:\.[a-z]{2})?\.auth0\.com/);
    if (auth0) {
      this.addService("auth0", "Auth0", "auth", auth0[0]);
      this.addEnv({ key: "AUTH0_DOMAIN", value: auth0[0], public: true, group: "Auth0" });
      this.addEnv({ key: "AUTH0_CLIENT_ID", public: true, group: "Auth0" });
      this.addEnv({ key: "AUTH0_CLIENT_SECRET", public: false, group: "Auth0" });
    }

    const hasura = first(/https:\/\/[a-z0-9-]+\.hasura\.app\/v1\/graphql/);
    if (hasura) {
      this.addService("hasura", "Hasura GraphQL (Postgres)", "database", hasura[0]);
      this.addEnv({ key: "HASURA_GRAPHQL_URL", value: hasura[0], public: true, group: "Hasura" });
      this.addEnv({ key: "HASURA_ADMIN_SECRET", public: false, group: "Hasura" });
    }

    const appwrite = first(/https:\/\/[a-z0-9.-]*appwrite\.io\/v1/);
    if (appwrite) {
      this.addService("appwrite", "Appwrite", "database", appwrite[0]);
      this.addEnv({ key: "APPWRITE_ENDPOINT", value: appwrite[0], public: true, group: "Appwrite" });
      this.addEnv({ key: "APPWRITE_PROJECT_ID", public: true, group: "Appwrite" });
      this.addEnv({ key: "APPWRITE_API_KEY", public: false, group: "Appwrite" });
    }

    const pb = first(/https:\/\/[a-z0-9.-]+\.pockethost\.io/);
    if (pb) {
      this.addService("pocketbase", "PocketBase", "database", pb[0]);
      this.addEnv({ key: "POCKETBASE_URL", value: pb[0], public: true, group: "PocketBase" });
    }

    const gtm = first(/GTM-[A-Z0-9]{5,8}/);
    if (gtm) {
      this.addService("gtm", "Google Tag Manager", "analytics", gtm[0]);
      this.addEnv({ key: "GTM_ID", value: gtm[0], public: true, group: "Analytics" });
    }
    const ga = first(/googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]{6,12})/) || first(/gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]{6,12})['"]/);
    if (ga) {
      this.addService("ga4", "Google Analytics", "analytics", ga[1]);
      this.addEnv({ key: "GA_MEASUREMENT_ID", value: ga[1], public: true, group: "Analytics" });
    }

    const recaptcha = first(/recaptcha\/(?:api|enterprise)\.js\?render=([A-Za-z0-9_-]{30,})/) || first(/data-sitekey=["']([A-Za-z0-9_-]{30,})["']/);
    if (recaptcha) {
      this.addService("recaptcha", "Google reCAPTCHA", "other", "site key");
      this.addEnv({ key: "RECAPTCHA_SITE_KEY", value: recaptcha[1], public: true, group: "reCAPTCHA" });
      this.addEnv({ key: "RECAPTCHA_SECRET_KEY", public: false, group: "reCAPTCHA" });
    }

    if (/\/graphql\b/.test(text)) this.addService("graphql", "GraphQL API", "other", "/graphql endpoint");
  }

  /** Framework, CMS and hosting hints from the HTML document. */
  scanDocument(html: string) {
    if (/__NEXT_DATA__|\/_next\/static\//.test(html)) this.addService("nextjs", "Next.js", "framework", "/_next/ assets");
    if (/__NUXT__|\/_nuxt\//.test(html)) this.addService("nuxt", "Nuxt", "framework", "/_nuxt/ assets");
    if (/___gatsby/.test(html)) this.addService("gatsby", "Gatsby", "framework", "#___gatsby");
    if (/data-sveltekit|\/_app\/immutable\//.test(html)) this.addService("sveltekit", "SvelteKit", "framework", "/_app/immutable/");
    if (/\/build\/_assets\/|__remixContext/.test(html)) this.addService("remix", "Remix", "framework", "__remixContext");
    if (/ng-version=/.test(html)) this.addService("angular", "Angular", "framework", "ng-version");
    if (/data-wf-site/.test(html)) this.addService("webflow", "Webflow", "cms", "data-wf-site");
    if (/static\.wixstatic\.com/.test(html)) this.addService("wix", "Wix", "cms", "wixstatic");
    if (/squarespace/.test(html)) this.addService("squarespace", "Squarespace", "cms", "squarespace assets");
    if (/cdn\.shopify\.com/.test(html)) this.addService("shopify", "Shopify", "payments", "cdn.shopify.com");
    if (/wp-content\/|wp-includes\/|wp-json/.test(html)) {
      this.addService("wordpress", "WordPress (PHP)", "cms", "wp-content");
      this.addService("mysql", "MySQL / MariaDB", "database", "WordPress requires MySQL", true);
      for (const key of ["WORDPRESS_DB_HOST", "WORDPRESS_DB_NAME", "WORDPRESS_DB_USER", "WORDPRESS_DB_PASSWORD"])
        this.addEnv({ key, public: false, group: "WordPress database", placeholder: key.endsWith("HOST") ? "localhost:3306" : "" });
      for (const key of ["AUTH_KEY", "SECURE_AUTH_KEY", "LOGGED_IN_KEY", "NONCE_KEY"])
        this.addEnv({ key: `WORDPRESS_${key}`, public: false, group: "WordPress salts" });
    }
    if (/csrfmiddlewaretoken/.test(html)) this.markDjango("csrfmiddlewaretoken field");
    if (/name=["']csrf-param["'][^>]*authenticity_token/.test(html)) this.markRails("authenticity_token meta");
    if (/name=["']_token["']/.test(html) && /csrf-token/.test(html)) this.markLaravel("_token field");
  }

  scanHeaders(headers: Record<string, string | string[] | undefined>) {
    const get = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v.join(", ") : v || "";
    };
    const powered = get("x-powered-by");
    const server = get("server");
    if (/express/i.test(powered)) this.markNode("X-Powered-By: Express");
    if (/next\.js/i.test(powered)) this.addService("nextjs", "Next.js", "framework", "X-Powered-By");
    if (/php/i.test(powered)) this.addService("php", "PHP", "framework", powered);
    if (/asp\.net/i.test(powered) || get("x-aspnet-version")) this.markDotnet("X-Powered-By: ASP.NET");
    if (get("x-vercel-id") || /vercel/i.test(server)) this.addService("vercel", "Vercel", "hosting", "x-vercel-id");
    if (get("cf-ray")) this.addService("cloudflare", "Cloudflare", "hosting", "cf-ray");
    if (/netlify/i.test(server) || get("x-nf-request-id")) this.addService("netlify", "Netlify", "hosting", "server: Netlify");
    if (get("x-amz-cf-id")) this.addService("cloudfront", "AWS CloudFront", "hosting", "x-amz-cf-id");
    if (/nginx|apache|openresty|litespeed|caddy/i.test(server)) this.addService(`server-${server.split("/")[0].toLowerCase()}`, server, "hosting", "Server header");
  }

  scanCookies(names: string[]) {
    for (const name of names) {
      if (name === "PHPSESSID") this.addService("php", "PHP", "framework", "PHPSESSID cookie");
      if (/laravel_session|XSRF-TOKEN/.test(name)) this.markLaravel(`${name} cookie`);
      if (name === "csrftoken" || name === "sessionid") this.markDjango(`${name} cookie`);
      if (/^_[a-z0-9_]+_session$/.test(name)) this.markRails(`${name} cookie`);
      if (name === "connect.sid") this.markNode("connect.sid cookie");
      if (name === "JSESSIONID") this.markJava("JSESSIONID cookie");
      if (/ASP\.NET_SessionId|\.AspNetCore\./.test(name)) this.markDotnet(`${name} cookie`);
      if (/^sb-.*-auth-token/.test(name)) this.addService("supabase", "Supabase (Postgres)", "database", `${name} cookie`);
      if (/next-auth|authjs/.test(name)) {
        this.addService("authjs", "Auth.js / NextAuth", "auth", `${name} cookie`);
        this.addEnv({ key: "AUTH_SECRET", public: false, group: "Auth.js" });
      }
      if (/better-auth/.test(name)) {
        this.addService("better-auth", "Better Auth", "auth", `${name} cookie`);
        this.addEnv({ key: "BETTER_AUTH_SECRET", public: false, group: "Better Auth" });
      }
      if (/^__session$|^__client_uat/.test(name)) this.addService("clerk", "Clerk", "auth", `${name} cookie`);
    }
  }

  private markLaravel(evidence: string) {
    this.addService("laravel", "Laravel (PHP)", "framework", evidence);
    this.addService("mysql", "MySQL / MariaDB", "database", "Laravel default driver", true);
    this.addEnv({ key: "APP_KEY", public: false, group: "Laravel", placeholder: "base64:" });
    this.addEnv({ key: "DB_CONNECTION", public: false, group: "Laravel", placeholder: "mysql" });
    for (const key of ["DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USERNAME", "DB_PASSWORD"])
      this.addEnv({ key, public: false, group: "Laravel", placeholder: key === "DB_PORT" ? "3306" : key === "DB_HOST" ? "127.0.0.1" : "" });
  }
  private markDjango(evidence: string) {
    this.addService("django", "Django (Python)", "framework", evidence);
    this.addService("postgres", "PostgreSQL", "database", "common Django default", true);
    this.addEnv({ key: "DJANGO_SECRET_KEY", public: false, group: "Django" });
    this.addEnv({ key: "DATABASE_URL", public: false, group: "Database", placeholder: "postgresql://user:password@localhost:5432/app" });
  }
  private markRails(evidence: string) {
    this.addService("rails", "Ruby on Rails", "framework", evidence);
    this.addService("postgres", "PostgreSQL", "database", "common Rails default", true);
    this.addEnv({ key: "SECRET_KEY_BASE", public: false, group: "Rails" });
    this.addEnv({ key: "DATABASE_URL", public: false, group: "Database", placeholder: "postgresql://user:password@localhost:5432/app" });
  }
  private markNode(evidence: string) {
    this.addService("express", "Node.js / Express", "framework", evidence);
    this.addEnv({ key: "SESSION_SECRET", public: false, group: "Server" });
  }
  private markJava(evidence: string) {
    this.addService("java", "Java (Spring / Servlet)", "framework", evidence);
    for (const key of ["SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD"])
      this.addEnv({ key, public: false, group: "Spring datasource", placeholder: key.endsWith("URL") ? "jdbc:postgresql://localhost:5432/app" : "" });
  }
  private markDotnet(evidence: string) {
    this.addService("dotnet", "ASP.NET", "framework", evidence);
    this.addEnv({ key: "ConnectionStrings__DefaultConnection", public: false, group: "ASP.NET", placeholder: "Server=localhost;Database=app;User Id=sa;Password=;" });
  }
}

function jwtClaim(jwt: string, claim: string): unknown {
  try {
    const payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"))[claim];
  } catch {
    return undefined;
  }
}

function isClerkKey(pk: string): boolean {
  try {
    return /clerk/i.test(Buffer.from(pk.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8"));
  } catch {
    return false;
  }
}
