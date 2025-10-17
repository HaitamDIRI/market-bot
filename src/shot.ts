import puppeteer from 'puppeteer';

export async function renderMarketPngFromUrl(url: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1350, height: 768, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  const el = await page.$('#card');
  const buf = (await el!.screenshot({ type: 'png' })) as Buffer;
  await browser.close();
  return buf;
}
