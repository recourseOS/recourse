import { mkdirSync } from 'fs';
import { test, expect } from '@playwright/test';

const pages = [
  '/',
  '/resource-coverage.html',
  '/golden-fixtures.html',
  '/live-aws-tests.html',
  '/schema-gaps.html',
  '/agent-interface.html',
  '/mcp-setup.html',
  '/console.html',
];

test.describe('public docs visual QA', () => {
  for (const path of pages) {
    test(`${path} renders cleanly`, async ({ page }, testInfo) => {
      const consoleErrors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
      }));
      await page.route('https://fonts.gstatic.com/**', route => route.fulfill({
        status: 200,
        contentType: 'font/woff2',
        body: '',
      }));

      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('h1').first()).toBeVisible();
      if (path === '/') {
        await expect(page.locator('.hero-simple')).toBeVisible();
        await expect(page.locator('.card').first()).toBeVisible();
      }
      if (path === '/console.html') {
        await page.locator('.source-tab[data-source="shell"]').click();
        await page.locator('#input').fill('aws s3 rm s3://prod-audit-logs --recursive');
        await page.locator('#evaluate').click();
        await expect(page.locator('#decision-banner')).toContainText(/escalate|block|warn/i, { timeout: 10000 });
      }

      const metrics = await page.evaluate(() => {
        const body = document.body;
        const primaryContent = document.querySelector('main, section, header');
        const contentText = body.innerText.trim();
        const overflowing = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.right > window.innerWidth + 1;
          })
          .map(element => element.tagName.toLowerCase())
          .slice(0, 5);

        return {
          textLength: contentText.length,
          bodyHeight: body.scrollHeight,
          viewportHeight: window.innerHeight,
          primaryContentVisible: primaryContent ? primaryContent.getBoundingClientRect().height > 0 : false,
          overflowing,
        };
      });

      expect(metrics.textLength).toBeGreaterThan(500);
      expect(metrics.bodyHeight).toBeGreaterThan(metrics.viewportHeight);
      expect(metrics.primaryContentVisible).toBe(true);
      expect(metrics.overflowing).toEqual([]);
      expect(consoleErrors).toEqual([]);

      mkdirSync('docs-visual-screenshots', { recursive: true });
      const name = path === '/' ? 'index' : path.replace(/^\//, '').replace(/\.html$/, '');
      await page.screenshot({
        fullPage: true,
        path: `docs-visual-screenshots/${testInfo.project.name}-${name}.png`,
      });
    });
  }
});
