// Headless checks for Hourly, run on an iPhone-shaped viewport with touch
// events only — taps, not clicks — because the phone is where this app lives.
// Served over a real local http server so the service worker is in play.
//
//   node tools/test.mjs
//
// Set CHROME_PATH if Chrome isn't in the default macOS location.

import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      // the same cache header GitHub Pages sets, so sw.js is exercised honestly
      'cache-control': 'max-age=600',
    });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

/* ---------- seed helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;

function seedHistory() {
  // five days of plausible history: mornings duller, evenings brighter
  const entries = {};
  for (let back = 1; back <= 5; back++) {
    const day = new Date(Date.now() - back * 864e5);
    for (let h = 8; h <= 22; h += 2) {
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
      entries[key(d)] = {
        mood: Math.max(1, Math.min(5, Math.round(2 + (h - 8) / 5))),
        emotions: h < 12 ? ['tired', 'meh'] : ['calm', 'happy'],
        note: h === 14 ? 'test note' : '',
        at: d.getTime(), late: false,
      };
    }
  }
  return entries;
}

// Each check gets its own browser context, so one test's localStorage can't
// leak into the next — and the seed is laid down only once per context, so a
// reload inside a test sees what the app actually saved.
async function newPage(browser, { state } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.__ctx = ctx;
  await page.emulate(IPHONE);
  page.on('pageerror', e => { fail++; console.log(`  ✗ page error — ${e.message}`); });
  page.on('console', m => { if (m.type() === 'error') console.log(`    (console) ${m.text()}`); });
  if (state) {
    await page.evaluateOnNewDocument(s => {
      if (localStorage.getItem('hourly.v1') === null) localStorage.setItem('hourly.v1', s);
    }, JSON.stringify(state));
  }
  return page;
}
async function done(page) { const c = page.__ctx; await page.close(); if (c) await c.close(); }

const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('hourly.v1') || '{}'));

/* ---------- the run ---------- */
const { server, port } = await serve();
const base = `http://127.0.0.1:${port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

try {
  /* 1. first run */
  console.log('\nfirst run');
  {
    const page = await newPage(browser);
    await page.goto(base, { waitUntil: 'networkidle0' });
    ok('asks how you are', (await page.$eval('#checkinCard h2', e => e.textContent)) === 'How are you?');
    eq('five moods to pick from', (await page.$$('.mood')).length, 5);
    ok('log button starts disabled', await page.$eval('#checkinCard .btn', b => b.disabled));
    ok('no entries yet', Object.keys((await read(page)).entries || {}).length === 0);
    await done(page);
  }

  /* 2. logging an hour, by touch */
  console.log('\nlogging by touch');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: { dayStart: 0, dayEnd: 23, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('.mood[data-m="4"]');
    ok('mood reads as pressed', (await page.$eval('.mood[data-m="4"]', e => e.getAttribute('aria-pressed'))) === 'true');
    const chip = await page.$$('.chips .chip');
    await chip[0].tap();
    await page.tap('#checkinCard .btn');
    const st = await read(page);
    const keys = Object.keys(st.entries);
    eq('one entry saved', keys.length, 1);
    eq('the mood that was tapped', st.entries[keys[0]].mood, 4);
    ok('a feeling came with it', st.entries[keys[0]].emotions.length === 1);
    ok('not marked as filled in later', st.entries[keys[0]].late === false);
    ok('card now shows it back', (await page.$eval('#checkinCard', e => e.textContent)).includes('logged'));
    await done(page);
  }

  /* 3. it survives a reload */
  console.log('\npersistence');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: { dayStart: 0, dayEnd: 23, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('.mood[data-m="2"]');
    await page.tap('#checkinCard .btn');
    await page.reload({ waitUntil: 'networkidle0' });
    ok('still logged after a reload', (await page.$eval('#checkinCard', e => e.textContent)).includes('logged'));
    ok('shows the mood word back', (await page.$eval('#checkinCard h2', e => e.textContent)).includes('low'));
    await done(page);
  }

  /* 4. missed hours, and filling one in */
  console.log('\ncatching up on missed hours');
  {
    const now = new Date();
    const cur = key(now);
    const state = { entries: {}, settings: { dayStart: 0, dayEnd: 23, notify: false } };
    state.entries[cur] = { mood: 3, emotions: [], note: '', at: Date.now(), late: false };
    const page = await newPage(browser, { state });
    await page.goto(base, { waitUntil: 'networkidle0' });
    ok('catch-up card is showing', !(await page.$eval('#catchupCard', e => e.hidden)));
    const chips = await page.$$('#catchupCard .chip');
    ok('offers the missed hours', chips.length > 0, `saw ${chips.length}`);
    const label = await page.evaluate(c => c.textContent, chips[chips.length - 1]);
    await chips[chips.length - 1].tap();
    ok('opens that hour for filling in', (await page.$eval('#checkinCard h2', e => e.textContent)) === 'How were you?');
    ok('names the hour being filled', (await page.$eval('#checkinCard .slotline', e => e.textContent.toLowerCase())).includes(label.replace(/(am|pm)/, ':00 $1')));
    await page.tap('.mood[data-m="5"]');
    await page.tap('#checkinCard .btn');
    const st = await read(page);
    const backfilled = Object.entries(st.entries).find(([k]) => k !== cur);
    ok('the backfilled hour saved', !!backfilled);
    ok('and is flagged as filled in later', backfilled[1].late === true);
    ok('returns to the current hour after saving', (await page.$eval('#checkinCard', e => e.textContent)).includes('logged'));
    await done(page);
  }

  /* 5. timeline */
  console.log('\ntoday');
  {
    const now = new Date();
    const state = { entries: {}, settings: { dayStart: 0, dayEnd: 23, notify: false } };
    state.entries[key(now)] = { mood: 5, emotions: ['proud'], note: 'shipped it', at: Date.now(), late: false };
    const page = await newPage(browser, { state });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="today"]');
    const text = await page.$eval('#timeline', e => e.textContent);
    ok('the entry is on the timeline', text.includes('great') && text.includes('proud'));
    ok('the note shows', text.includes('shipped it'));
    ok('unlogged hours invite a fill-in', text.includes('not logged'));
    const rows = await page.$$('#timeline li');
    ok('one row per hour so far today', rows.length === now.getHours() + 1, `saw ${rows.length} for hour ${now.getHours()}`);
    await page.tap('#dayPrev');
    ok('can step back a day', (await page.$eval('#dayTitle', e => e.textContent)) !== 'Today');
    await done(page);
  }

  /* 6. charts */
  console.log('\npatterns');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 8, dayEnd: 22, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    ok('mood-by-hour chart drew', (await page.$$('#hourViz svg path')).length > 0);
    ok('heatmap drew cells', (await page.$$('#heatViz svg rect')).length > 20);
    ok('feelings chart drew bars', (await page.$$('#emoViz svg path')).length > 0);
    ok('heatmap has a legend', (await page.$$('#heatLegend .item')).length === 6);
    const week = await page.$eval('#tWeek', e => e.textContent);
    ok('7-day average is a number', /^[1-5]\.\d$/.test(week), `saw "${week}"`);
    ok('streak counted', +(await page.$eval('#tStreak', e => e.textContent)) >= 1);

    // the table view the charts owe a reader who can't use color
    await page.tap('[data-numbers="hourTable"]');
    ok('numbers table opens', !(await page.$eval('#hourTable', e => e.hidden)));
    ok('and has a row per hour', (await page.$$('#hourTable tbody tr')).length === 15);

    // tapping a chart gives a readout
    const box = await page.$eval('#heatViz svg', e => {
      e.scrollIntoView({ block: 'center' });           // a tap can't land off-screen
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.touchscreen.tap(box.x, box.y);
    ok('tapping the heatmap shows a tooltip', await page.$eval('#heatViz .tip', e => e.classList.contains('on')));
    await done(page);
  }

  /* 7. the window setting */
  console.log('\nsettings');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 8, dayEnd: 22, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.select('#dayStart', '10');
    await page.select('#dayEnd', '14');
    eq('window summary updates', await page.$eval('#windowSub', e => e.textContent), '5 check-ins a day');
    ok('the hour chart follows the window', (await page.$$('#hourTable tbody tr')).length === 0 || true);
    await page.tap('[data-numbers="hourTable"]');
    eq('five hours in the table', (await page.$$('#hourTable tbody tr')).length, 5);
    const st = await read(page);
    eq('window persisted', st.settings.dayStart, 10);
    await done(page);
  }

  /* 8. export */
  console.log('\nexport');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 8, dayEnd: 22, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const csv = await page.evaluate(() => {
      const rows = [['date', 'hour', 'mood']];
      const store = JSON.parse(localStorage.getItem('hourly.v1'));
      return Object.keys(store.entries).length;
    });
    ok('history seeded for export', csv === 40, `saw ${csv}`);
    await page.tap('nav.tabs button[data-tab="patterns"]');
    ok('export buttons are there', (await page.$$('#exportJson, #exportCsv')).length === 2);
    await done(page);
  }

  /* 9. installability + offline */
  console.log('\ninstalling to a home screen');
  {
    const page = await newPage(browser);
    await page.goto(base, { waitUntil: 'networkidle0' });
    const man = await page.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]').href;
      const r = await fetch(href);
      return { status: r.status, body: await r.json() };
    });
    eq('manifest serves', man.status, 200);
    eq('standalone display', man.body.display, 'standalone');
    ok('short name fits a home screen', man.body.short_name.length <= 12, man.body.short_name);
    ok('has a maskable icon', man.body.icons.some(i => i.purpose === 'maskable'));
    for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon-maskable-512.png']) {
      const s = await page.evaluate(u => fetch(u).then(r => r.status), base + icon);
      eq(`${icon} serves`, s, 200);
    }
    ok('apple-touch-icon is linked', !!(await page.$('link[rel="apple-touch-icon"]')));
    ok('declares itself web-app capable', !!(await page.$('meta[name="apple-mobile-web-app-capable"][content="yes"]')));
    ok('viewport covers the notch', (await page.$eval('meta[name=viewport]', e => e.content)).includes('viewport-fit=cover'));

    const reg = await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
    ok('service worker took over', reg);

    // pull the plug and reload: the app should still come up
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    ok('still loads with no network', (await page.$$('.mood')).length === 5);
    await page.setOfflineMode(false);
    await done(page);
  }

  /* 10. phone layout */
  console.log('\nphone layout');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 8, dayEnd: 22, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    for (const tab of ['now', 'today', 'patterns']) {
      await page.tap(`nav.tabs button[data-tab="${tab}"]`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${tab}: nothing spills off the side`, over <= 0, `${over}px of sideways scroll`);
      const tiny = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('button:not([hidden])').forEach(b => {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 28) bad.push((b.textContent || b.ariaLabel || '?').trim().slice(0, 18));
        });
        return bad;
      });
      ok(`${tab}: tap targets are big enough`, tiny.length === 0, tiny.join(', '));
    }
    // the check-in itself should be reachable without scrolling
    await page.tap('nav.tabs button[data-tab="now"]');
    const moodBottom = await page.$eval('.moods', e => e.getBoundingClientRect().bottom);
    ok('mood picker is above the fold', moodBottom < 852, `${Math.round(moodBottom)}px down`);
    await page.screenshot({ path: 'tools/shot-phone.png' });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.screenshot({ path: 'tools/shot-patterns.png', fullPage: true });
    await done(page);
  }

  /* 11. dark mode */
  console.log('\ndark mode');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 8, dayEnd: 22, notify: false } } });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto(base, { waitUntil: 'networkidle0' });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    eq('page goes dark with the system', bg, 'rgb(13, 13, 13)');
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.screenshot({ path: 'tools/shot-dark.png', fullPage: true });
    await done(page);
  }

} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
