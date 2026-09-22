# Hourly

An app that asks how you feel *right now* — not how the hour went — and remembers
the answer. You answer in feelings, not in numbers. One file, no build step, no
server, no account. On a phone it installs to the home screen and works with the
network off.

Everything you log stays in `localStorage` on the device you logged it on. Nothing
is uploaded anywhere, which also means nothing syncs between devices and clearing
your browser data erases it — use **Patterns → Your data → JSON** now and then if
you'd be sad to lose it.

## Put it on your iPhone

1. Open the page in **Safari** (not Chrome — only Safari can install to the home
   screen on iOS).
2. Tap **Share**, scroll down, tap **Add to Home Screen**, then **Add**.
3. Open it from the icon, not from Safari. It runs fullscreen with no address bar,
   and iOS keeps its data separate from the browser's.

It works offline from then on — the service worker keeps a copy of the whole app.

## The three rules it's built around

**This moment, not this hour.** The question is how you feel the second you open
the app. The screen says so every time, and the answer is stamped with the hour
only because that's how often it asks.

**You can't answer ahead.** Log 8am at 8:05 and the 9am slot stays shut until 9am
actually arrives — the card tells you how long that is. An hour you fill in *early*
would be a guess about the future, which is the one thing this app has no use for.

**You can answer late, and it says so.** Any unlogged hour from the last twelve is
waiting on the Now screen as a tappable chip. Those get marked *filled in later*
everywhere they appear, so reconstructed data never passes itself off as
in-the-moment data.

## The feelings

Eighteen, each with its own color and glyph, in an order that doesn't sort them
into good ones and bad ones:

> Not in control · Fine · Happy · Sad · Anxious · Stressed · Angry · Excited ·
> Irritable · Hopeful · Grateful · Confident · Social · Anti social · Smart ·
> Dumb · Ugly · Beautiful

**One or two, nothing else.** A feeling is the whole entry — there's no rating,
no score, no 1-to-5. Three feelings would be a mood board; two is a feeling. When
two are picked the rest dim, and tapping one of your two lets it go.

**The ⓘ on each one** opens a flat description of what that state *is* and what it
tends to come with — never whether it should be there. Anxiety and excitement are
described as physically near-identical, because they are. Under each description
is **Related**, pointing at the two nearest feelings on this same list, so you can
walk between neighbours until one fits.

**Smart, Dumb, Ugly and Beautiful** aren't emotions in the strict sense — they're
judgments. You can still *feel* them as plainly as anything else, so they're here,
and their descriptions say outright that they record how you feel in this moment
and not whether you "actually are" any of those things. Feeling dumb is tiredness
and unfamiliar material; it isn't a measurement. Feeling ugly can change twice in a
day while nothing about your appearance has changed.

Names sit under the glyphs by default. **Settings → Names under the icons → Off**
strips it back to just the glyphs once you know them. Screen readers get the names
either way.

## Sleep

Settings has the hour you wake up and the hour you go to bed, and a bedtime after
midnight works properly. While you're meant to be asleep nothing is asked for,
nothing counts as missed, and those hours stay off your timeline and your charts —
but the picker is still there if you're up at 3am and want to log it.

## The rest of it

**Now** — the current hour, the feelings grid, an optional note. Under it: the
hours you missed and how much of today you've logged.

**Today** — every hour in order with what you picked and anything you wrote. Tap an
empty hour to fill it in, *edit* to change one. The arrows step back through days.

**Patterns** —

- **What you feel most** — which feelings you actually reach for, each with its own
  glyph and color.
- **When you feel it** — pick one of your most-logged feelings and see which hours it
  turns up in. This is the one that tells you something: most people have a shape to
  their day and don't know what it is. Anxious at 8am and never at 8pm is a fact
  about your mornings.
- **The last 7 days** — one square an hour, carrying that hour's glyph in its own
  color. Hollow squares are hours you didn't log.

Every chart has a **Numbers** button showing the same data as a plain table, and
every colored mark carries its glyph, so nothing is ever readable by color alone.

## The hourly part

Here is the honest situation, because it shapes the whole design:

**An installed web app can't wake itself up on an iPhone.** iOS gives it no
background timers, and Safari has no API for scheduling a local notification for
later. A real ping while the app is closed needs a push server — a machine
somewhere running a clock. That's a bigger project, and this app doesn't have one.

So: the app notices what you missed, and notifies you on the hour *while it's open*
(reliable on a Mac or Android, foreground-only on iPhone). For the closed-app case,
iOS can do the reminding for it:

1. Open **Reminders**, make one called *How do you feel?*
2. Tap the ⓘ → **Date** and **Time**, set it to the next hour.
3. **Repeat → Custom → Every 1 hour**.
4. Optionally put the app's URL in the notes, so the notification links into it.

That gives you a real notification every hour whether the app is open or not.

*(Shortcuts → Automation → Time of Day → Open App works too and skips the tap, but
personal automations don't repeat hourly — that route means one automation per hour
of the day.)*

## Layout

```
index.html               the whole app — open this
sw.js                    offline, and one refresh always lands on the current build
manifest.webmanifest     what makes it installable
icon.svg                 the icon; the PNGs are rendered from it
tools/make-icons.mjs     icon.svg -> icon-192/512, apple-touch-icon, maskable
tools/solve-colors.mjs   solves each feeling's color for contrast on both themes
tools/test.mjs           headless checks on an iPhone-shaped viewport
```

No build step. Edit `index.html` and reload.

### Changing a feeling's color or glyph

Both live on the one object in `FEELINGS`, near the top of the script in
`index.html`. `color` is a single hex used in both themes — if you change one by
hand, keep it above 3:1 against `#fcfcfb` and `#1a1a19`, or add your hue to
`tools/solve-colors.mjs` and let it pick the lightness. `icon` is raw SVG on a
24×24 grid, stroked in `currentColor`; the test suite checks every feeling has a
glyph and that no two share a color.

## Tests

```sh
npm install          # puppeteer-core, for headless Chrome
npm test
```

123 checks on a 393×852 viewport driven by touch events rather than clicks: the
one-or-two rule, the info sheet and its related links, the four judgment-shaped
feelings each stating they describe a moment and not a fact, the refusal to log
ahead, sleep windows including one that crosses midnight, upgrading from older
saved settings, backfilling, the charts and their table views, every feeling's
color clearing 3:1 in both themes, the manifest and icons, the service worker, the
app still loading with the network cut, and a sweep for anything smaller than a
thumb or spilling off the side. Set `CHROME_PATH` if Chrome isn't in
the default macOS location.

## Deploying

Static, so anything that serves files works. On GitHub Pages: **Settings → Pages →
Source: Deploy from a branch → main / (root)**. A minute later it's at
`https://<user>.github.io/emotions-app/`.

HTTPS matters — the service worker and the install prompt both need it, which is
why opening `index.html` off the disk gives you the app but not the offline or
installable parts.

## A note on what this is

It's a diary with a stopwatch, not a mental health tool. It doesn't score you,
diagnose anything, or decide that a run of low hours means something. If it ever
starts feeling like homework you're failing, a gap in the chart is allowed to just
be a gap.
