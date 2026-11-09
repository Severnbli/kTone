// Site origin and the crawler files that depend on it.
//
// The public origin (`VITE_SITE_URL`, default https://ktone.severnbli.dev) is
// resolved once at build time. The plugin below exposes it as
// `import.meta.env.VITE_SITE_URL`, so index.html can use `%VITE_SITE_URL%` for
// the canonical link, Open Graph and JSON-LD, and emits `robots.txt` and
// `sitemap.xml` that point at the same origin. Self-hosters override it with
// the `VITE_SITE_URL` environment variable (or a `.env` file).

import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

export const DEFAULT_SITE_URL = 'https://ktone.severnbli.dev';
export const ROBOTS_FILE = 'robots.txt';
export const SITEMAP_FILE = 'sitemap.xml';

/**
 * Normalizes a site origin: trims whitespace and trailing slashes; empty means
 * the default. Throws on anything that is not an absolute http(s) URL, so a
 * typo fails the build instead of shipping broken canonical links.
 */
export function resolveSiteUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_SITE_URL must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_SITE_URL must use http or https, got "${raw}"`);
  }
  if (url.search || url.hash) {
    throw new Error(`VITE_SITE_URL must not have a query or fragment, got "${raw}"`);
  }
  return value;
}

export function robotsTxt(siteUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/${SITEMAP_FILE}\n`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sitemapXml(siteUrl: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${escapeXml(siteUrl)}/</loc>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

/** Vite plugin: defines `VITE_SITE_URL` and emits robots.txt and sitemap.xml. */
export function siteFiles(): Plugin {
  let siteUrl = DEFAULT_SITE_URL;
  const files = (): Record<string, { type: string; body: string }> => ({
    [ROBOTS_FILE]: { type: 'text/plain; charset=utf-8', body: robotsTxt(siteUrl) },
    [SITEMAP_FILE]: { type: 'application/xml; charset=utf-8', body: sitemapXml(siteUrl) },
  });
  return {
    name: 'ktone:site-files',
    config(config, { mode }) {
      const env = loadEnv(mode, config.envDir ?? config.root ?? process.cwd(), 'VITE_');
      siteUrl = resolveSiteUrl(env.VITE_SITE_URL);
      return { define: { 'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl) } };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files()[(req.url ?? '').split('?')[0].replace(/^\//, '')];
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body);
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(files())) {
        this.emitFile({ type: 'asset', fileName, source: file.body });
      }
    },
  };
}
