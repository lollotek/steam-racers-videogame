/**
 * Print check of the editor tileset (doc 05 §9): renders the sheets of a standard track with small
 * tiles (?tilepx=200) and saves the PDF the browser would print, plus a full-page PNG.
 * Needs the dev server on :5173.  node tools/print/tileset-pdf.mjs out.pdf [a4|a3] [track-id]
 */
import { chromium } from '@playwright/test';
const [out, paper = 'a4', track = 'foundry-01'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173/mapeditor/?tilepx=200');
await page.getByTestId('standard').selectOption(track);
await page.getByTestId('tileset-open').click();
if (paper === 'a3') await page.getByRole('button', { name: 'A3 × 2' }).click();
await page.getByTestId('tileset-render').click();
await page.getByTestId('tileset-print').waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.querySelector('[data-testid=tileset-progress]') && document.querySelectorAll('.thumbs img').length > 0, null, { timeout: 600000 });
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
await page.screenshot({ path: out.replace('.pdf', '.png'), fullPage: true });
await browser.close();
console.log('ok');
