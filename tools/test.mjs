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
const ALWAYS = { wake: 0, bed: 0, notify: false };        // wake === bed means never asleep
const DAYTIME = { wake: 8, bed: 23, notify: false };      // 15 awake hours

function seedHistory() {
  // five days of plausible history: rough mornings, busy afternoons, easier nights
  const entries = {};
  for (let back = 1; back <= 5; back++) {
    const day = new Date(Date.now() - back * 864e5);
    for (const [h, feelings] of [[8, ['sad', 'anxious']], [10, ['sad', 'anxious']],
      [12, ['stressed', 'fine']], [14, ['stressed', 'fine']], [16, ['stressed', 'fine']],
      [18, ['happy', 'grateful']], [20, ['happy', 'grateful']], [22, ['happy', 'grateful']]]) {
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
      entries[key(d)] = {
        emotions: feelings, note: h === 14 ? 'test note' : '', at: d.getTime(), late: false,
      };
    }
  }
  return entries;
}

function seedHours(hours) {
  const entries = {};
  for (let back = 1; back <= 3; back++) {
    const day = new Date(Date.now() - back * 864e5);
    for (const h of hours) {
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
      entries[key(d)] = { emotions: ['fine'], note: '', at: d.getTime(), late: false };
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

const wait = ms => new Promise(r => setTimeout(r, ms));
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('hourly.v1') || '{}'));
const picked = page => page.$$eval('.feel[aria-pressed="true"]', els => els.map(e => e.dataset.id));

// Centre the target first: a plain tap() parks an element at the bottom edge of
// the viewport, where the fixed tab bar can swallow the touch.
async function tap(page, sel) {
  await page.$eval(sel, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await wait(70);
  await page.tap(sel);
}
async function logNow(page, ids) {
  for (const id of ids) await tap(page, `.feel[data-id="${id}"]`);
  await tap(page, '#checkinCard .btn');
}

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
    eq('asks about this exact moment', await page.$eval('#checkinCard h2', e => e.textContent), 'How do you feel right now?');
    ok('and says so in as many words', (await page.$eval('.askline', e => e.textContent)).includes('not how the whole hour went'));
    eq('no rating scale anywhere', (await page.$$('.mood, .moods')).length, 0);
    ok('log button starts disabled', await page.$eval('#checkinCard .btn', b => b.disabled));
    await done(page);
  }

  /* 2. the feelings themselves */
  console.log('\neighteen feelings');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: ALWAYS } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const tiles = await page.$$eval('.feel', els => els.map(e => ({
      id: e.dataset.id,
      name: e.querySelector('.nm').textContent,
      color: e.style.getPropertyValue('--fc').trim(),
      marks: e.querySelectorAll('svg.glyph path, svg.glyph circle, svg.glyph ellipse, svg.glyph rect').length,
      hasInfo: !!e.querySelector('.info'),
    })));
    eq('eighteen of them', tiles.length, 18);
    ok('every one has a glyph', tiles.every(t => t.marks > 0));
    ok('every one has a color', tiles.every(t => /^#[0-9a-f]{6}$/i.test(t.color)));
    eq('no two share a color', new Set(tiles.map(t => t.color)).size, 18);
    ok('every one has an info button', tiles.every(t => t.hasInfo));
    const names = tiles.map(t => t.name);
    const wanted = ['Not in control', 'Fine', 'Happy', 'Sad', 'Anxious', 'Stressed', 'Angry', 'Excited',
      'Irritable', 'Hopeful', 'Grateful', 'Confident', 'Social', 'Anti social',
      'Smart', 'Dumb', 'Ugly', 'Beautiful'];
    ok('the whole list is there, stressed included', wanted.every(n => names.includes(n)),
      wanted.filter(n => !names.includes(n)).join(', '));

    const icons = await page.evaluate(() => Object.fromEntries(FEELINGS.map(f => [f.id, f.icon])));
    eq('angry has eyes under the brows', (icons.angry.match(/fill="currentColor"/g) || []).length, 2);
    ok('irritable is a storm cloud', icons.irritable.includes('a3.2 3.2 0 0 1 .5-6.3'));
    ok('excited took the arrow', icons.excited.includes('M4 19.4h16'));
    ok('confident took the sparkle', icons.confident.includes('M11 3.4l1.6 4.6'));
    ok('stressed has its own glyph', !!icons.stressed && icons.stressed !== icons.anxious);
    await done(page);
  }

  /* 3. two at most, and at least one */
  console.log('\npick one or two');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: ALWAYS } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    ok('says the limit up front', (await page.$eval('.capline', e => e.textContent)).includes('up to two'));
    await tap(page, '.feel[data-id="happy"]');
    eq('one picked', (await picked(page)).length, 1);
    ok('which is enough to log', !(await page.$eval('#checkinCard .btn', b => b.disabled)));
    await tap(page, '.feel[data-id="grateful"]');
    eq('two picked', (await picked(page)).length, 2);
    eq('the rest go dim', (await page.$$('.feel[data-blocked="1"]')).length, 16);
    await tap(page, '.feel[data-id="angry"]');
    eq('a third is refused', (await picked(page)).length, 2);
    ok('and it says why', (await page.$eval('.capline', e => e.textContent)).includes('Two is the most'));
    await tap(page, '.feel[data-id="happy"]');
    eq('letting one go frees a slot', (await picked(page)).length, 1);
    await tap(page, '.feel[data-id="stressed"]');
    const ids = await picked(page);
    ok('and the swap sticks', ids.includes('stressed') && ids.includes('grateful'), ids.join(','));
    await tap(page, '#checkinCard .btn');
    const e = Object.values((await read(page)).entries)[0];
    ok('both feelings saved', e.emotions.length === 2 && e.emotions.includes('stressed'));
    ok('and nothing else is recorded', !('mood' in e), Object.keys(e).join(','));
    await done(page);
  }

  /* 4. what a feeling is */
  console.log('\nthe info sheet');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: ALWAYS } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await tap(page, '.feel[data-id="ugly"] .info');
    await wait(320);
    ok('the sheet opens', await page.$eval('#sheet', e => e.classList.contains('on')));
    eq('titled with the feeling', await page.$eval('#sheetTitle span:last-child', e => e.textContent), 'Ugly');
    const body = await page.$eval('#sheet .what', e => e.textContent);
    ok('describes it flatly', body.includes('dissatisfied with how you look'));
    ok('and separates the feeling from the fact', body.includes('not a fact about how you look'));
    const rel = await page.$$eval('#sheet .rel-list .rel-item', els => els.map(e => e.textContent.trim()));
    eq('lists related feelings', rel.length, 2);
    ok('which are drawn from our own list', rel.every(r => ['Sad', 'Anti social'].includes(r)), rel.join(','));
    await page.tap('#sheet .rel-list .rel-item');
    await wait(150);
    ok('tapping one walks you over to it', (await page.$eval('#sheetTitle span:last-child', e => e.textContent)) !== 'Ugly');
    await page.tap('#sheetBg');
    await wait(320);
    ok('the backdrop closes it', !(await page.$eval('#sheet', e => e.classList.contains('on'))));

    // the four opinion-shaped ones have to say they describe a feeling, not a fact
    const claims = await page.evaluate(() => FEELINGS
      .filter(f => ['smart', 'dumb', 'ugly', 'beautiful'].includes(f.id))
      .map(f => ({ id: f.id, what: f.what })));
    eq('all four are covered', claims.length, 4);
    for (const c of claims) {
      ok(`${c.id}: framed as the moment, not a verdict`,
        /moment/i.test(c.what) && /(not a fact|isn't a measurement|rather than a fact|not a measurement)/i.test(c.what));
    }
    // every feeling has a real description and two neighbours that exist
    const bad = await page.evaluate(() => FEELINGS
      .filter(f => !f.what || f.what.length < 40 || !f.related.every(r => FEELINGS.some(x => x.id === r)))
      .map(f => f.id));
    ok('all eighteen describe themselves, with neighbours that exist', bad.length === 0, bad.join(', '));

    await tap(page, '.feel[data-id="stressed"] .info');
    await wait(280);
    ok('stressed has its own entry', (await page.$eval('#sheet .what', e => e.textContent)).includes('more demand than you have resources for'));
    await tap(page, '#sheet .btn');
    await wait(320);
    ok('you can pick it straight from the sheet', (await picked(page)).includes('stressed'));
    await done(page);
  }

  /* 5. no answering ahead */
  console.log('\nno logging ahead');
  {
    const now = new Date();
    const state = { entries: {}, settings: ALWAYS };
    state.entries[key(now)] = { emotions: ['fine'], note: '', at: Date.now(), late: false };
    const page = await newPage(browser, { state });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const card = await page.$eval('#checkinCard', e => e.textContent);
    ok('this hour shows as answered', card.includes('logged'));
    ok('the next hour is named but shut', /check-in opens in/.test(card));
    ok('and it says why', card.includes("can't answer it early"));
    eq('no picker is on screen', (await page.$$('#checkinCard .feel')).length, 0);

    const label = h => { const t = h % 12 === 0 ? 12 : h % 12; return `${t}${h < 12 ? 'am' : 'pm'}`; };
    const nextLabel = label((now.getHours() + 1) % 24);
    await page.tap('nav.tabs button[data-tab="today"]');
    const rows = await page.$$eval('#timeline .when', els => els.map(e => e.textContent));
    ok('the timeline stops at this hour', !rows.includes(nextLabel), rows.slice(-3).join(','));
    await page.tap('nav.tabs button[data-tab="now"]');
    const chips = await page.$$eval('#catchupCard .chip', els => els.map(e => e.textContent));
    ok('catch-up only ever looks backwards', !chips.includes(nextLabel), chips.join(','));
    ok('nothing future got written', !Object.keys((await read(page)).entries)
      .includes(key(new Date(now.getTime() + 3600e3))));
    await done(page);
  }

  /* 6. sleep */
  console.log('\nsleep');
  {
    const h = new Date().getHours();
    // Put right now AND the twelve hours behind it inside the sleep window,
    // whatever time the suite runs: awake is [h+1, h+12), which leaves h-12
    // through h — everything catch-up looks at — asleep.
    const page = await newPage(browser, { state: { entries: {}, settings: { wake: (h + 1) % 24, bed: (h + 12) % 24, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const ask = await page.$eval('.askline', e => e.textContent);
    ok('says you should be asleep', ask.includes('meant to be asleep'));
    ok('nothing is being demanded', ask.includes("nothing's due"));
    eq('but the picker is still there', (await page.$$('.feel')).length, 18);
    ok('no missed hours are held against you', await page.$eval('#catchupCard', e => e.hidden));
    await page.tap('nav.tabs button[data-tab="today"]');
    const label = x => { const t = x % 12 === 0 ? 12 : x % 12; return `${t}${x < 12 ? 'am' : 'pm'}`; };
    const rows = await page.$$eval('#timeline .when', els => els.map(e => e.textContent));
    ok('sleeping hours are off the timeline', !rows.includes(label(h)), rows.join(','));
    await page.tap('nav.tabs button[data-tab="now"]');
    await logNow(page, ['fine']);
    eq('a 3am log is still allowed', Object.keys((await read(page)).entries).length, 1);
    await done(page);
  }

  /* 7. a bedtime past midnight */
  console.log('\na bedtime after midnight');
  {
    const page = await newPage(browser, { state: { entries: seedHours([22, 23, 0, 1, 2, 3, 4, 5]), settings: { wake: 22, bed: 6, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    eq('the window wraps midnight', await page.$eval('#windowSub', e => e.textContent), "8 check-ins a day · none while you're asleep");
    await tap(page, '[data-numbers="whenTable"]');
    const hours = await page.$$eval('#whenTable tbody tr td:first-child', els => els.map(e => e.textContent));
    eq('eight hours on the chart', hours.length, 8);
    eq('starting at wake-up', hours[0], '10:00 PM');
    eq('running through to bed', hours[hours.length - 1], '5:00 AM');
    await done(page);
  }

  /* 8. the old settings shape still opens */
  console.log('\nupgrading from the first version');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: { dayStart: 9, dayEnd: 21, notify: false } } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const st = await read(page);
    eq('wake-up carried over', st.settings.wake, 9);
    eq('bedtime is the hour after the last check-in', st.settings.bed, 22);
    ok('the old keys are gone', st.settings.dayStart === undefined);
    await done(page);
  }

  /* 9. logging, and it survives a reload */
  console.log('\nlogging and persistence');
  {
    const page = await newPage(browser, { state: { entries: {}, settings: ALWAYS } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await logNow(page, ['anxious', 'stressed']);
    await page.reload({ waitUntil: 'networkidle0' });
    const card = await page.$eval('#checkinCard', e => e.textContent);
    ok('still logged after a reload', card.includes('logged'));
    ok('and reads both feelings back', card.includes('Anxious') && card.includes('Stressed'));
    await done(page);
  }

  /* 10. missed hours, and filling one in */
  console.log('\ncatching up');
  {
    const now = new Date();
    const cur = key(now);
    const state = { entries: {}, settings: ALWAYS };
    state.entries[cur] = { emotions: ['fine'], note: '', at: Date.now(), late: false };
    const page = await newPage(browser, { state });
    await page.goto(base, { waitUntil: 'networkidle0' });
    ok('catch-up card is showing', !(await page.$eval('#catchupCard', e => e.hidden)));
    const chips = await page.$$('#catchupCard .chip');
    ok('offers the missed hours', chips.length > 0, `saw ${chips.length}`);
    await chips[chips.length - 1].tap();
    await wait(450);                                   // it smooth-scrolls back to the top
    ok('asks about that hour instead', (await page.$eval('#checkinCard h2', e => e.textContent)).startsWith('How were you at'));
    ok('and allows a rough answer', (await page.$eval('.askline', e => e.textContent)).includes('near enough is fine'));
    await logNow(page, ['sad']);
    const backfilled = Object.entries((await read(page)).entries).find(([k]) => k !== cur);
    ok('the backfilled hour saved', !!backfilled);
    ok('and is flagged as filled in later', backfilled[1].late === true);
    await done(page);
  }

  /* 11. timeline */
  console.log('\ntoday');
  {
    const now = new Date();
    const state = { entries: {}, settings: ALWAYS };
    state.entries[key(now)] = { emotions: ['confident', 'beautiful'], note: 'shipped it', at: Date.now(), late: false };
    const page = await newPage(browser, { state });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="today"]');
    const text = await page.$eval('#timeline', e => e.textContent);
    ok('the entry reads as its feelings', text.includes('Confident and Beautiful'));
    ok('and is drawn as glyphs too', (await page.$$('#timeline svg.glyph')).length >= 2);
    ok('the note shows', text.includes('shipped it'));
    ok('unlogged hours invite a fill-in', text.includes('not logged'));
    ok('the day summary counts hours', (await page.$eval('#daySummary', e => e.textContent)).includes('hours logged'));
    eq('one row per hour so far today', (await page.$$('#timeline li')).length, now.getHours() + 1);
    await done(page);
  }

  /* 12. charts */
  console.log('\npatterns');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: DAYTIME } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="patterns"]');

    const todaySub = await page.$eval('#tTodaySub', e => e.textContent);   // only hours that have happened
    ok("today's tile counts hours so far", /^of ([0-9]|1[0-5]) hours$/.test(todaySub), todaySub);
    ok('the week tile names a feeling', ['Happy', 'Grateful', 'Stressed', 'Fine', 'Sad', 'Anxious']
      .includes(await page.$eval('#tWeek', e => e.textContent)));
    ok('streak counted', +(await page.$eval('#tStreak', e => e.textContent)) >= 1);

    ok('the feelings bar chart drew', (await page.$$('#emoViz svg path')).length > 0);
    ok('each bar wears its feeling’s glyph', (await page.$$('#emoViz svg g')).length >= 4);
    const labels = await page.$$eval('#emoViz svg text.tick', els => els.map(e => e.textContent));
    ok('named, not just colored', labels.includes('Happy') || labels.includes('Stressed'), labels.join(','));

    const chips = await page.$$eval('#whenPick .fchip', els => els.map(e => e.textContent.trim()));
    ok('the when-chart offers your top feelings', chips.length >= 2 && chips.length <= 6, chips.join(','));
    const firstHead = await page.$eval('#whenTable th:last-child, #whenTable', e => e.textContent);
    await tap(page, '#whenPick .fchip:nth-child(2)');
    ok('picking another redraws it', (await page.$$eval('#whenPick .fchip[aria-pressed="true"]', e => e.length)) === 1);
    ok('columns drew for it', (await page.$$('#whenViz svg path')).length > 0);
    await tap(page, '[data-numbers="whenTable"]');
    eq('a row per awake hour', (await page.$$('#whenTable tbody tr')).length, 15);
    ok('the table names which feeling it counts', (await page.$eval('#whenTable th:last-child', e => e.textContent)).length > 2);

    ok('heatmap drew cells', (await page.$$('#heatViz svg rect')).length > 20);
    ok('and a glyph in every logged one', (await page.$$('#heatViz svg g')).length >= 20);
    const box = await page.$eval('#heatViz svg', e => {
      e.scrollIntoView({ block: 'center' });           // a tap can't land off-screen
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.touchscreen.tap(box.x, box.y);
    ok('tapping the heatmap shows a tooltip', await page.$eval('#heatViz .tip', e => e.classList.contains('on')));
    await done(page);
  }

  /* 13. settings */
  console.log('\nsettings');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: DAYTIME } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.select('#wakeSel', '10');
    await page.select('#bedSel', '15');
    eq('the count follows', await page.$eval('#windowSub', e => e.textContent), "5 check-ins a day · none while you're asleep");
    eq('and it persists', (await read(page)).settings.wake, 10);

    eq('names are on by default', await page.$eval('#labelsBtn', e => e.textContent), 'On');
    await tap(page, '#labelsBtn');
    eq('and can be turned off', await page.$eval('#labelsBtn', e => e.textContent), 'Off');
    await page.tap('nav.tabs button[data-tab="now"]');
    eq('leaving just the glyphs', await page.$eval('.feel .nm', e => getComputedStyle(e).display), 'none');
    ok('still named for a screen reader', (await page.$eval('.feel', e => e.getAttribute('aria-label'))).length > 2);
    await done(page);
  }

  /* 14. export */
  console.log('\nexport');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: DAYTIME } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    eq('history seeded', Object.keys((await read(page)).entries).length, 40);
    await page.tap('nav.tabs button[data-tab="patterns"]');
    eq('export buttons are there', (await page.$$('#exportJson, #exportCsv')).length, 2);
    await done(page);
  }

  /* 15. installability + offline */
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
      eq(`${icon} serves`, await page.evaluate(u => fetch(u).then(r => r.status), base + icon), 200);
    }
    ok('apple-touch-icon is linked', !!(await page.$('link[rel="apple-touch-icon"]')));
    ok('declares itself web-app capable', !!(await page.$('meta[name="apple-mobile-web-app-capable"][content="yes"]')));
    ok('viewport covers the notch', (await page.$eval('meta[name=viewport]', e => e.content)).includes('viewport-fit=cover'));
    ok('service worker took over', await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)));
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    eq('still loads with no network', (await page.$$('.feel')).length, 18);
    await page.setOfflineMode(false);
    await done(page);
  }

  /* 16. phone layout */
  console.log('\nphone layout');
  {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: DAYTIME } });
    await page.goto(base, { waitUntil: 'networkidle0' });
    for (const t of ['now', 'today', 'patterns']) {
      await page.tap(`nav.tabs button[data-tab="${t}"]`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${t}: nothing spills off the side`, over <= 0, `${over}px of sideways scroll`);
      const tiny = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('button:not([hidden])').forEach(b => {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.height < 28 || r.width < 28)) {
            bad.push((b.textContent || b.ariaLabel || '?').trim().slice(0, 18));
          }
        });
        return bad;
      });
      ok(`${t}: tap targets are big enough`, tiny.length === 0, tiny.join(', '));
    }
    await page.tap('nav.tabs button[data-tab="now"]');
    const gridTop = await page.$eval('.feelings', e => e.getBoundingClientRect().top);
    ok('the feelings start above the fold', gridTop < 852, `${Math.round(gridTop)}px down`);
    await page.screenshot({ path: 'tools/shot-phone.png' });
    await tap(page, '.feel[data-id="stressed"] .info');
    await wait(320);
    await page.screenshot({ path: 'tools/shot-sheet.png' });
    await page.tap('#sheetBg');
    await wait(320);                                   // the backdrop blocks the tab bar until it's gone
    ok('the sheet lets go of the screen', await page.$eval('#sheet', e => e.hidden || !e.classList.contains('on')));
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.screenshot({ path: 'tools/shot-patterns.png', fullPage: true });
    await done(page);
  }

  /* 17. both themes */
  console.log('\nlight and dark');
  for (const [mode, bg] of [['dark', 'rgb(13, 13, 13)'], ['light', 'rgb(249, 249, 247)']]) {
    const page = await newPage(browser, { state: { entries: seedHistory(), settings: DAYTIME } });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
    await page.goto(base, { waitUntil: 'networkidle0' });
    eq(`page follows the system into ${mode}`, await page.evaluate(() => getComputedStyle(document.body).backgroundColor), bg);
    // every feeling's color has to stay legible against whichever surface it lands on
    const weak = await page.evaluate(() => {
      const srgb = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
      const rgb = s => s.match(/\d+/g).slice(0, 3).map(Number);
      const surface = lum(rgb(getComputedStyle(document.querySelector('.card')).backgroundColor));
      return FEELINGS.filter(f => {
        const l = lum([1, 3, 5].map(i => parseInt(f.color.slice(i, i + 2), 16)));
        const [hi, lo] = l > surface ? [l, surface] : [surface, l];
        return (hi + 0.05) / (lo + 0.05) < 3;
      }).map(f => f.id);
    });
    ok(`every feeling color clears 3:1 in ${mode}`, weak.length === 0, weak.join(', '));
    await page.screenshot({ path: `tools/shot-${mode}.png` });
    await page.tap('nav.tabs button[data-tab="patterns"]');
    await page.screenshot({ path: `tools/shot-${mode}-patterns.png`, fullPage: true });
    await done(page);
  }

} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
