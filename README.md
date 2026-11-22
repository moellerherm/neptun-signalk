# Navigational Warnings & Notices to Mariners for Signal K

Official navigational warnings and restricted areas from [Neptun](https://neptun.marine-api.com/signalk/) on your
chart: notices to mariners, coastal and NAVAREA warnings, closures of fairways, locks and bridges. Translated into
your language, shown as points and areas in Freeboard-SK and on B&G, Simrad and Lowrance plotters on the boat's network.

> ⚠️ For situational awareness only — **not for navigation**. The official notices and corrected charts prevail.

## What you get

- **Warnings as notes** at their position, with the full text, number, source, validity and a link to the original.
- **Restricted and warning areas as regions** whenever the authority gives corner points, a box or a radius.
- **Proximity alarm** (optional): a Signal K notification when a warning is closer than a set distance, or when the
  boat is inside an area.
- **Offline**: the last update is kept on board and shown with its age when there is no internet.
- **Sources**: national hydrographic offices and waterway authorities plus NGA NAVAREA warnings, see the
  [coverage map](https://neptun.marine-api.com/coverage/).

## Pricing

This plugin is **Neptun K-Boating**. It is free and open source (MIT). The data needs a **Neptun Boating key** — the
same key also works in **Neptun P-Boating**, the view for chartplotters and tablets (https://neptun.marine-api.com/plotter/app/):

| Plan | Regions | Monthly | Yearly |
|---|---|---|---|
| Home waters | 1 | €1.99 | €19 |
| Cruising | 3 | €3.99 | €39 |
| Worldwide | all | €6.99 | €59 |

Every plan starts with **30 days free, no card needed**. If no payment method is added by then, access simply ends.
Get a key: **https://neptun.marine-api.com/signalk/**

### How regions count

You don't pick anything. A region is bound on the first request from where your boat is. A region without requests
for 30 days becomes free again, so you can sail on. When your plan is full and you enter a new region, the plugin
tells you which regions are bound and when the first one becomes free.

Sea before inland: where sea and inland regions overlap (Kiel: Baltic and Kiel Canal), the sea region is the one that
counts. Inland waters at the boat's position (canals, rivers) are included without counting. If you only sail inland,
your inland region counts as normal.

Border waters: notices from a neighbouring region within 3 nm of the boat are always included, without counting
(Flensburg Fjord: the Danish shore).

## Data use

A full update is 30–115 KB (compressed), depending on how busy your waters are. Since 1.0.1 the plugin asks whether
anything has changed; if not, the answer is empty. In practice that is a few MB per month on board.

## Install

In your Signal K server (version 2 or later): **App Store → search “notices to mariners” or “navigational warnings” → Install**, restart the server.

Or by hand:

```sh
cd ~/.signalk
npm install signalk-neptun-warnings
# restart the Signal K server
```

Then **Server → Plugin Config → Navigational Warnings & Notices to Mariners**: enable, paste your Neptun Boating key, save.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `apiKey` | — | your Neptun Boating key (`mapi_…`) |
| `lang` | `en` | language of the warnings (`en` or `de`) |
| `radiusKm` | 150 | radius around the vessel, 10–200 km |
| `intervalMin` | 30 | update interval, at least 15 minutes |
| `areas` | on | show restricted and warning areas as regions |
| `notifyWithinNm` | 0 | alarm when a warning is within this distance (0 = off) |
| `apiBase` | `https://neptun.marine-api.com` | leave as is |

## Where it shows

- **Freeboard-SK** (bundled with Signal K): notes and regions on the chart.
- **B&G / Simrad / Lowrance**: the Signal K server offers Freeboard-SK as a web-app tile on the MFD (Ethernet).
- Any Signal K app that reads `resources/notes` and `resources/regions`.

Status and problems appear under **Server → Plugin Config** and as the notification
`notifications.neptunWarnings.status`. Proximity alarms use `notifications.navigation.neptunWarning.<id>`.

## What is sent to Neptun

The vessel position (rounded to 5 decimals), the radius, the language and your key — nothing else. Neptun stores which
regions a key has used and when, to apply the region limit.

## Try it without a boat

[`test/`](test/) starts a Signal K server in Docker with a fixed demo position, so you can see the warnings in
Freeboard-SK from your desk.

## Licence

Plugin: MIT. Warning texts: the issuing authorities; every note carries the source and its attribution.

## Changes

- **1.0.3** (not yet published): Neptun K-Boating — one Neptun Boating key for the plugin and Neptun P-Boating;
  new plans Worldwide and yearly prices; texts and sign-up link updated.
- **1.0.2** (15 Nov 2026): plugin renamed to “Navigational Warnings & Notices to Mariners” so the App Store
  search finds it by what it does.
- **1.0.1** (15 Nov 2026): unchanged warnings are not downloaded again (`If-None-Match`/ETag → 304), which saves most
  of the data on board.
- **1.0.0** (15 Nov 2026): first release — notes and regions, offline cache, proximity alarm, plotter keys.
