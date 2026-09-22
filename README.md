# Hourly

An app that asks how you feel, every hour, and remembers the answer. One file, no
build step, no server, no account — open `index.html` and go. On a phone it
installs to the home screen and works with the network off.

Everything you log stays in `localStorage` on the device you logged it on.
Nothing is uploaded anywhere, which also means nothing syncs between devices and
clearing your browser data erases it — use **Patterns → Your data → JSON** now and
then if you'd be sad to lose it.

## Put it on your iPhone

1. Open the page in **Safari** (not Chrome — only Safari can install to the home
   screen on iOS).
2. Tap the **Share** button, scroll down, tap **Add to Home Screen**, then **Add**.
3. Open it from the icon, not from Safari. That way it runs fullscreen with no
   address bar, and iOS keeps its data separate from the browser's.

It works offline from then on — the service worker keeps a copy of the whole app.

## The hourly part

Here is the honest situation, because it shapes the whole design:

**An installed web app can't wake itself up on an iPhone.** iOS gives it no
background timers, and Safari has no API for scheduling a local notification for
later. A real ping while the app is closed would need a push server sending it —
a machine somewhere running a clock. That's a bigger project, and this app doesn't
have one.

So the nudge works three ways instead:

- **It notices what you missed.** Open the app and any unlogged hour from the last
  twelve is waiting on the Now screen as a tappable chip. Fill it in from memory;
  it gets marked *filled in later* so you can tell honest-in-the-moment data from
  reconstructed data.
- **It notifies you while it's open.** Turn on *Notify me on the hour* in Settings.
  On a Mac or an Android phone this fires reliably. On an iPhone it only fires
  while the app is actually open and in front of you.
- **iOS can do the reminding for it** — see below.

### The 30-second fix: a repeating reminder

This is the setup that actually works on an iPhone, and it's free:

1. Open **Reminders**, make a new reminder called *How do you feel?*
2. Tap the ⓘ next to it → **Date** and **Time**, set it to the next hour.
3. Tap **Repeat → Custom → Every 1 hour**.
4. Optional: put the app's URL in the reminder's notes so the notification gives
   you a link straight into it.

You'll get a real iOS notification every hour whether or not the app is open, and
tapping it takes about five seconds to answer.

*(If you'd rather it open the app directly: Shortcuts → Automation → Time of Day →
**Open App** → Hourly. Personal automations don't repeat hourly, so that route
means one automation per hour of the day — reliable, but tedious to set up.)*

## Using it

**Now** — the current hour, five faces, and as many feelings as fit. A mood is the
only thing required; feelings and a note are optional. Under it: the hours you
missed, and how much of today you've logged.

**Today** — every hour laid out in order, with what you picked and whatever you
wrote. Tap an empty hour to fill it in, or *edit* on one you want to change. The
arrows step back through previous days.

**Patterns** —

- **Mood by time of day** — every hour you've ever logged, averaged. This is the
  one that tells you something: most people have a shape to their day and don't
  know what it is. The line connects across a single unlogged hour but breaks
  across a longer gap, so it never draws a shape there's no evidence for.
- **The last 7 days** — one square per hour, colored low (red) through neutral
  (gray) to high (blue). Hollow squares are hours you didn't log.
- **What you feel most** — which feelings you actually reach for.

Every chart has a **Numbers** button that shows the same data as a plain table,
so nothing is readable only by color.

**Settings** — the hours you want to be asked about (default 8am–10pm; outside
that window the app leaves you alone), notifications, export, and erase.

## Layout

```
index.html               the whole app — open this
sw.js                    offline, and one refresh always lands on the current build
manifest.webmanifest     what makes it installable
icon.svg                 the icon; the PNGs are rendered from it
tools/make-icons.mjs     icon.svg -> icon-192/512, apple-touch-icon, maskable
tools/test.mjs           headless checks on an iPhone-shaped viewport
```

There's no build step. Edit `index.html` and reload.

## Tests

```sh
npm install          # puppeteer-core, for headless Chrome
npm test
```

60 checks, all of them on a 393×852 viewport driven by touch events rather than
clicks: logging, backfilling a missed hour, persistence across a reload, the
charts and their table views, the manifest and every icon, the service worker
taking over, the app still loading with the network cut, and a sweep for anything
smaller than a thumb or spilling off the side of the screen. Set `CHROME_PATH` if
Chrome isn't in the default macOS location.

## Deploying

It's static, so anything that serves files works. On GitHub Pages: **Settings →
Pages → Source: Deploy from a branch → main / (root)**. Give it a minute, and it's
at `https://<user>.github.io/emotions-app/`.

HTTPS matters — the service worker and the install prompt both need it, which is
why opening `index.html` off the disk gives you the app but not the offline or
installable parts.

## A note on what this is

It's a diary with a stopwatch, not a mental health tool. It doesn't score you,
diagnose anything, or decide that a run of low hours means something. If it ever
starts feeling like homework you're failing, a gap in the chart is allowed to just
be a gap.
