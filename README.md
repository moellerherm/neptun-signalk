# signalk-neptun-warnings

Shows **official navigational warnings** (Notices to Mariners, coastal warnings, NAVAREA
warnings) from the [Marine-API / Neptun](https://neptun.marine-api.com) service as **notes on
your chart** in Freeboard-SK and compatible MFDs (B&G, Simrad, Lowrance via the Signal K web-app
tile).

The plugin fetches warnings around your vessel's position, translated into your language, and
publishes them as Signal K `notes` resources. It is a thin client — what you see is exactly what
your Neptun API key is entitled to; any region limit is enforced by the server, not here.

> ⚠️ For situational awareness only — **not for navigation**. Always use official,
> up-to-date charts and broadcasts.

## Install

In your Signal K server: **App Store → search "Neptun Warnings"** (once published), or install
this folder manually:

```sh
cd ~/.signalk
npm install /path/to/neptun-signalk
# restart the Signal K server
```

Then enable the plugin under **Server → Plugin Config → Neptun Warnings** and enter your
**Neptun API key** (get one at https://neptun.marine-api.com).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `apiBase` | `https://neptun.marine-api.com` | Neptun API base URL |
| `apiKey` | — | your `mapi_…` key |
| `radiusKm` | 150 | radius around the vessel to request warnings for |
| `intervalMin` | 30 | how often to refresh |
| `lang` | `en` | `en` or `de` |
| `notifyWithinNm` | 0 | raise a Signal K alarm when a warning is within this distance (0 = off) |

## Where it shows

- **Freeboard-SK** (bundled with Signal K) renders the notes on its own map layer.
- **B&G / Simrad / Lowrance**: the Signal K server announces Freeboard-SK as a tile on the MFD
  (Ethernet) — the warnings then appear in that view.
- Any Signal K app that reads `resources/notes`.

## Try it without a plotter (and without a GPS)

You only need Docker (or Node ≥ 18) — the Raspberry Pi is ideal but not required. See
[`test/`](test/): it starts a Signal K server with a **fixed demo position** (off Goa, India, where
there are live warnings right now) so you can open Freeboard-SK in a browser and see the notes
immediately.

```sh
cd test
docker compose up
# then open http://localhost:3000  → admin → enable the plugin, paste your key
# open Freeboard-SK (http://localhost:3000/@signalk/freeboard-sk/) to see the notes
```

To place the "vessel" elsewhere, edit `test/sk-config/defaults.json` (`navigation.position`).

## How it maps warnings

Each Neptun warning becomes one note: `name` = place (closures prefixed `⛔`), `description` =
the translated text plus number/source/validity, `position` = the warning's coordinates,
`url` = link to the source. Expired warnings drop off on the next refresh.

## License

MIT · © rubberduck software
