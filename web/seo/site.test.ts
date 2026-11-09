// @vitest-environment node
// Imports Vite (for loadEnv), whose esbuild breaks under jsdom.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, resolveSiteUrl, robotsTxt, siteFiles, sitemapXml } from './site';

describe('resolveSiteUrl', () => {
  it('defaults to the public site', () => {
    expect(resolveSiteUrl(undefined)).toBe('https://ktone.severnbli.dev');
    expect(resolveSiteUrl('  ')).toBe(DEFAULT_SITE_URL);
  });

  it('trims whitespace and trailing slashes, keeps a path prefix', () => {
    expect(resolveSiteUrl(' https://example.com/ ')).toBe('https://example.com');
    expect(resolveSiteUrl('http://localhost:8080//')).toBe('http://localhost:8080');
    expect(resolveSiteUrl('https://example.com/tuner/')).toBe('https://example.com/tuner');
  });

  it('rejects relative, non-http and query URLs', () => {
    expect(() => resolveSiteUrl('example.com')).toThrow(/absolute URL/);
    expect(() => resolveSiteUrl('ftp://example.com')).toThrow(/http or https/);
    expect(() => resolveSiteUrl('https://example.com/?a=1')).toThrow(/query/);
  });
});

describe('crawler files', () => {
  it('robots.txt allows everything and points at the sitemap', () => {
    expect(robotsTxt('https://example.com')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });

  it('sitemap.xml lists the single page', () => {
    const xml = sitemapXml('https://example.com');
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset /);
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });
});

describe('siteFiles plugin', () => {
  let dir: string;
  const saved = process.env.VITE_SITE_URL;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ktone-site-'));
    delete process.env.VITE_SITE_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VITE_SITE_URL;
    else process.env.VITE_SITE_URL = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  type ConfigHook = (config: object, env: { mode: string; command: string }) => unknown;
  type BundleHook = (this: { emitFile: (file: unknown) => void }) => void;

  function run(): { define: unknown; emitted: Array<{ fileName: string; source: string }> } {
    const plugin = siteFiles();
    const result = (plugin.config as ConfigHook)(
      { root: dir },
      { mode: 'production', command: 'build' },
    );
    const emitted: Array<{ fileName: string; source: string }> = [];
    (plugin.generateBundle as BundleHook).call({
      emitFile: (file) => emitted.push(file as { fileName: string; source: string }),
    });
    return { define: (result as { define: unknown }).define, emitted };
  }

  it('defines the default origin and emits robots.txt and sitemap.xml', () => {
    const { define, emitted } = run();
    expect(define).toEqual({ 'import.meta.env.VITE_SITE_URL': '"https://ktone.severnbli.dev"' });
    expect(emitted.map((f) => f.fileName).sort()).toEqual(['robots.txt', 'sitemap.xml']);
    expect(emitted.find((f) => f.fileName === 'robots.txt')?.source).toBe(
      robotsTxt(DEFAULT_SITE_URL),
    );
  });

  it('takes the origin from a .env file', () => {
    writeFileSync(join(dir, '.env.production'), 'VITE_SITE_URL=https://tuner.example.org/\n');
    const { define, emitted } = run();
    expect(define).toEqual({ 'import.meta.env.VITE_SITE_URL': '"https://tuner.example.org"' });
    expect(emitted.find((f) => f.fileName === 'sitemap.xml')?.source).toContain(
      '<loc>https://tuner.example.org/</loc>',
    );
  });

  it('lets the environment variable win over .env files', () => {
    writeFileSync(join(dir, '.env'), 'VITE_SITE_URL=https://from-file.example\n');
    process.env.VITE_SITE_URL = 'https://from-env.example';
    expect(run().define).toEqual({ 'import.meta.env.VITE_SITE_URL': '"https://from-env.example"' });
  });
});
