import { expect, test } from '@playwright/test';

const SITE = 'https://ktone.severnbli.dev';

test('the head carries title, description, canonical and link preview tags', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/^kTone – .*тюнер для голоса/);
  const title = await page.title();
  expect(title.length).toBeLessThanOrEqual(65);

  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description?.length).toBeGreaterThan(120);
  expect(description?.length).toBeLessThanOrEqual(160);

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}/`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${SITE}/`);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    `${SITE}/og-image.png`,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(jsonLd ?? '');
  expect(data['@type']).toBe('WebApplication');
  expect(data.url).toBe(`${SITE}/`);
  expect(data.offers.price).toBe('0');

  // The preview image is served as a real PNG.
  const image = await page.request.get('/og-image.png');
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toBe('image/png');
});

test('the static fallback is in the HTML and replaced by the app', async ({ page }) => {
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('class="seo-fallback"');
  expect(html).toContain('<h1>kTone – тюнер для голоса</h1>');

  await page.goto('/');
  await expect(page.getByTestId('start-stop')).toBeVisible();
  await expect(page.locator('.seo-fallback')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('kTone');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the fallback describes the app and asks for JavaScript', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('kTone – тюнер для голоса');
    await expect(page.locator('.seo-fallback li').first()).toBeVisible();
    await expect(page.getByText('Для работы kTone нужен JavaScript')).toBeVisible();
  });
});

test('robots.txt and sitemap.xml point at the site', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  const sitemap = await request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain(`<loc>${SITE}/</loc>`);
});
