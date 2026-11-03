/**
 * The /admin interface in a real browser (headless Chromium) against the
 * built starter: sign in, visual mode (click on the page, edit with live
 * preview, publish), per-index gallery, image upload, forms mode with
 * languages side by side, history with undo, and the same on a phone.
 *
 * Set MOSTO_CMS_SCREENSHOTS=<dir> to save screenshots of every screen.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EDITOR, eventually, startStarter, type StarterServer } from './server';

let srv: StarterServer;
let browser: Browser;
const shots = process.env.MOSTO_CMS_SCREENSHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

/** A small real PNG (a wine-to-sand gradient), like a photo from a phone. */
function photo(width = 96, height = 48): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let x = 0xffffffff;
    for (const v of b) x = (table[(x ^ v) & 0xff] as number) ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = 143 + Math.round((x / width) * 80);
      raw[o + 1] = 36 + Math.round((x / width) * 150);
      raw[o + 2] = 55 + Math.round((y / height) * 90);
    }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function home(path = '/'): Promise<string> {
  return (await fetch(`${srv.base}${path}`)).text();
}

async function readJson(file: string) {
  return JSON.parse(await readFile(join(srv.contentRoot, file), 'utf8'));
}

async function signIn(page: Page, prefix: string): Promise<FrameLocator> {
  await page.goto(`${srv.base}/admin`);
  await page.getByLabel('Email').fill(EDITOR.email);
  await page.getByLabel('Password', { exact: true }).fill(EDITOR.password);
  await shot(page, `${prefix}-1-login`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('tab', { name: 'On the page' }).waitFor();
  const frame = page.frameLocator('iframe.mc-frame');
  // The overlay answered the handshake.
  await page.locator('iframe.mc-frame[data-status="ready"]').waitFor({ timeout: 15_000 });
  await expect.poll(() => frame.locator('h1[tabindex="0"]').count()).toBe(1);
  return frame;
}

/** Publish, then wait until the preview has reloaded and the overlay is connected again. */
async function publish(page: Page): Promise<void> {
  const frame = page.locator('iframe.mc-frame');
  const visual = (await frame.count()) > 0;
  const before = visual ? await frame.getAttribute('src') : null;
  await page.getByTestId('mc-publish').click();
  await page.locator('.mc-toast', { hasText: 'Published' }).waitFor();
  if (!visual) return;
  await expect.poll(() => frame.getAttribute('src'), { timeout: 10_000 }).not.toBe(before);
  await page.locator('iframe.mc-frame[data-status="ready"]').waitFor({ timeout: 10_000 });
}

beforeAll(async () => {
  srv = await startStarter();
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await srv?.stop();
});

describe('/admin on desktop', () => {
  let ctx: BrowserContext;
  let page: Page;
  let frame: FrameLocator;
  const errors: string[] = [];

  beforeAll(async () => {
    ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, locale: 'en-GB' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
  });
  afterAll(async () => ctx?.close());

  it('refuses a wrong password, then signs in', async () => {
    await page.goto(`${srv.base}/admin`);
    await page.getByLabel('Email').fill(EDITOR.email);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => page.locator('.mc-notice[role=alert]').textContent()).toBe('Wrong email or password.');
    frame = await signIn(page, 'desktop');
  });

  it('visual mode: click a text, see it change on the page while typing, publish', async () => {
    await shot(page, 'desktop-2-visual');
    await frame.locator('h1').click();
    await page.getByRole('heading', { name: 'Headline' }).waitFor();
    const input = page.locator('.mc-panel input').first();
    await expect.poll(() => input.inputValue()).toBe('Fresh pasta, made every morning');
    // The Italian version sits next to it.
    expect(await page.locator('.mc-panel input').nth(1).inputValue()).toBe('Pasta fresca, fatta ogni mattina');
    await input.fill('Pasta, rolled by hand');
    await expect.poll(() => frame.locator('h1').textContent()).toBe('Pasta, rolled by hand');
    await shot(page, 'desktop-3-visual-selected');
    await publish(page);
    expect((await readJson('content/home.json')).en.hero.title).toBe('Pasta, rolled by hand');
    await eventually(async () => (await home()).includes('Pasta, rolled by hand'));
    // The preview reloaded with the published page.
    expect(await frame.locator('h1').textContent()).toBe('Pasta, rolled by hand');
  });

  it('Edit mode: hover names the field, typing on the page goes to the draft, Esc cancels', async () => {
    const name = frame.locator('h3').first();
    const original = (await name.textContent()) ?? '';
    await name.hover();
    await expect.poll(() => frame.locator('#mosto-cms-chip').textContent()).toBe('Name');
    await frame.locator('h2').hover(); // "Menu" is not a field
    await expect.poll(() => frame.locator('#mosto-cms-chip').textContent()).toBe('Not editable');

    await name.click();
    await expect.poll(() => name.getAttribute('contenteditable')).not.toBeNull();
    await page.getByRole('heading', { name: 'Name' }).waitFor();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Ravioli, by hand');
    await shot(page, 'desktop-3b-inline-editing');
    await page.keyboard.press('Enter');
    await expect.poll(() => name.getAttribute('contenteditable')).toBeNull();
    expect(await name.textContent()).toBe('Ravioli, by hand');
    await page.locator('.mc-pending', { hasText: '1 unpublished change' }).waitFor();
    await expect.poll(() => page.locator('.mc-panel input').first().inputValue()).toBe('Ravioli, by hand');

    await name.click();
    await page.keyboard.type(' oops');
    await page.keyboard.press('Escape');
    expect(await name.textContent()).toBe('Ravioli, by hand');

    // Links do not navigate in Edit mode.
    await frame.getByRole('link', { name: 'Italiano' }).click();
    expect(await frame.locator('main').getAttribute('lang')).toBe('en');

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect.poll(() => frame.locator('h3').first().textContent()).toBe(original);
  });

  it('Browse mode: links work and the editor follows; E switches back to Edit', async () => {
    await page.getByTestId('mc-mode-browse').click();
    const htmlClass = async () => (await frame.locator('html').getAttribute('class')) ?? '';
    await expect.poll(htmlClass).not.toContain('mosto-cms-edit');
    await shot(page, 'desktop-3c-browse');
    await frame.getByRole('link', { name: 'Italiano' }).click();
    await expect.poll(() => frame.locator('main').getAttribute('lang'), { timeout: 15_000 }).toBe('it');
    await page.locator('iframe.mc-frame[data-status="ready"]').waitFor({ timeout: 15_000 });
    await expect.poll(() => page.locator('.mc-toolbar select').inputValue()).toBe('/it');
    expect(await htmlClass()).not.toContain('mosto-cms-edit');
    await frame.getByRole('link', { name: 'English' }).click();
    await expect.poll(() => frame.locator('main').getAttribute('lang'), { timeout: 15_000 }).toBe('en');
    await page.locator('.mc-brand').click();
    await page.keyboard.press('e');
    await expect.poll(() => page.getByTestId('mc-mode-edit').getAttribute('aria-pressed')).toBe('true');
    await expect.poll(htmlClass).toContain('mosto-cms-edit');
  });

  it('gallery: the click selects the visible photo (per-index address)', async () => {
    await frame.getByTestId('gallery-next').click();
    // Frames are stacked; wait for the fade, then click where they all are.
    await expect.poll(() => frame.getByTestId('gallery-1').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await frame.getByTestId('gallery-1').click({ force: true });
    await page.getByRole('heading', { name: 'Gallery · Photo 2' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
  });

  it('uploads a photo for the hero image and publishes it', async () => {
    await frame.locator('img').first().click();
    await page.getByRole('heading', { name: 'Hero photo' }).waitFor();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Replace photo' }).click()]);
    await chooser.setFiles({ name: 'Terrace.png', mimeType: 'image/png', buffer: photo() });
    await page.locator('.mc-panel .mc-dirty').waitFor();
    const src = await page.locator('.mc-panel img.mc-thumb').getAttribute('src');
    expect(src).toMatch(/^\/media\/terrace-[a-z0-9]+\.png$/);
    await expect.poll(() => frame.locator('img').first().getAttribute('src')).toBe(src);
    await shot(page, 'desktop-4-upload');
    await publish(page);
    expect((await readJson('content/home.json')).hero.image).toBe(src);
    const served = await fetch(`${srv.base}${src}`);
    expect(served.headers.get('content-type')).toBe('image/png');
    await eventually(async () => (await home()).includes(src as string));
  });

  it('forms mode: languages side by side, edit, publish', async () => {
    await page.getByRole('tab', { name: 'All content' }).click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Ricotta ravioli' }).click();
    await page.getByRole('heading', { name: 'Ricotta ravioli' }).waitFor();
    const fields = page.locator('.mc-content input');
    await expect.poll(() => fields.count()).toBe(5);
    expect(await page.locator('.mc-content .mc-locale').allTextContents()).toEqual(['EN', 'IT', 'EN', 'IT']);
    await fields.nth(2).fill('Butter, sage and lemon zest.');
    await shot(page, 'desktop-5-forms');
    await publish(page);
    await eventually(async () => (await home()).includes('Butter, sage and lemon zest.'));
  });

  it('history: lists the changes and undoes the last one', async () => {
    await page.getByRole('tab', { name: 'History' }).click();
    await page.locator('.mc-event').first().waitFor();
    expect(await page.locator('.mc-event-title').allTextContents()).toEqual(['Description (EN)', 'Hero photo', 'Headline (EN)', 'Initial content']);
    await shot(page, 'desktop-6-history');
    await page.locator('.mc-event').first().getByRole('button', { name: 'Undo' }).click();
    await shot(page, 'desktop-7-history-undo');
    await page.getByRole('button', { name: 'Yes, undo' }).click();
    await page.locator('.mc-toast', { hasText: 'Undone' }).waitFor();
    await eventually(async () => (await home()).includes('Butter, sage and parmesan.'));
    await expect.poll(() => page.locator('.mc-event-title').first().textContent()).toBe('Revert "Description (EN)"');
    expect(errors).toEqual([]);
  });
});

describe('/admin on a phone', () => {
  let ctx: BrowserContext;
  let page: Page;
  let frame: FrameLocator;

  beforeAll(async () => {
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB' });
    page = await ctx.newPage();
  });
  afterAll(async () => ctx?.close());

  it('signs in and edits a text in the bottom sheet', async () => {
    frame = await signIn(page, 'mobile');
    await shot(page, 'mobile-2-visual');
    await frame.locator('p').first().tap();
    await page.getByRole('heading', { name: 'Subtitle' }).waitFor();
    const sheet = page.locator('.mc-panel.mc-panel-open');
    await sheet.waitFor();
    const box = await sheet.boundingBox();
    expect(box && box.y > 200).toBe(true); // a sheet from the bottom, not a side panel
    await sheet.locator('textarea').first().fill('A small kitchen by the harbour.\nOpen every day.');
    await expect.poll(() => frame.locator('p').first().textContent()).toContain('by the harbour');
    await shot(page, 'mobile-3-visual-selected');
    await publish(page);
    await eventually(async () => (await home()).includes('A small kitchen by the harbour.'));
  });

  it('uploads a photo into the gallery from the phone', async () => {
    await page.getByRole('button', { name: 'Done' }).click();
    await frame.getByTestId('gallery-0').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await frame.getByTestId('gallery-0').tap({ force: true });
    await page.getByRole('heading', { name: 'Gallery · Photo 1' }).waitFor();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Replace photo' }).click()]);
    await chooser.setFiles({ name: 'Kitchen.png', mimeType: 'image/png', buffer: photo(64, 64) });
    await page.locator('.mc-panel .mc-dirty').waitFor();
    await shot(page, 'mobile-4-upload');
    await publish(page);
    const gallery = (await readJson('content/home.json')).gallery as string[];
    expect(gallery[0]).toMatch(/^\/media\/kitchen-[a-z0-9]+\.png$/);
    expect(gallery.slice(1)).toEqual(['/gallery/table.svg', '/gallery/wine.svg']);
  });

  it('forms and history work on a small screen', async () => {
    await page.getByRole('tab', { name: 'All content' }).click();
    await page.getByRole('button', { name: 'Home page' }).click();
    await page.getByRole('heading', { name: 'Home page' }).waitFor();
    await shot(page, 'mobile-5-forms');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Menu' }).waitFor();
    await page.getByRole('tab', { name: 'History' }).click();
    await page.locator('.mc-event').first().waitFor();
    await shot(page, 'mobile-6-history');
    expect(await page.locator('.mc-event-title').first().textContent()).toBe('Gallery');
  });
});
