/*
 * signalk-neptun-warnings
 *
 * Fetches official navigational warnings from Neptun (https://neptun.marine-api.com) around the
 * vessel's position and publishes them as Signal K resources:
 *   - `notes`   one per warning, at its position (Freeboard-SK, MFD web-app tile)
 *   - `regions` one per restricted/warning area, when the authority gives corner points,
 *               a box or a radius (Neptun derives the polygon from the notice text)
 *
 * The plugin is a thin client. What it shows is exactly what the plotter key is entitled to:
 * the region limit (1 or 3 regions, bound automatically to where the boat is) is enforced by
 * Neptun, not here. The last good result is kept on disk, so the chart still shows warnings
 * when the boat has no internet.
 */

const fs = require('fs')
const path = require('path')
const VERSION = require('./package.json').version

const API_PATH = '/v1/warnings'
const CLIENT = 'signalk-neptun-warnings/' + VERSION
const SIGNUP = 'https://neptun.marine-api.com/signalk/'
const STATUS_PATH = 'notifications.neptunWarnings.status'
const ALARM_PATH = 'notifications.navigation.neptunWarning.'

const TEXT = {
  en: {
    waiting: 'Waiting for vessel position (navigation.position)',
    status: (n, a, r, t) => `${n} warnings · ${a} areas${r} · updated ${t}`,
    offline: (age) => `Offline — showing the last update from ${age} ago`,
    until: 'until',
    noKey: 'No plotter key set. Get one at ' + SIGNUP,
    badKey: 'Plotter key not valid or no longer active (trial ended?). Manage your subscription at ' + SIGNUP,
    needPlotter: 'This key is not a plotter key. The plugin needs a plotter key: ' + SIGNUP,
    limit: (d) => `Your plan covers ${d.limit} region${d.limit > 1 ? 's' : ''} (${names(d)}). “${d.region_name}” ` +
      `would be one more. ${frees(d, 'en')}Need more regions? ${SIGNUP}`,
    quota: 'Too many requests — the plugin will try again at the next interval.',
    region: (name, n, max) => ` · region ${name} (${n}/${max})`,
    inside: 'inside',
  },
  de: {
    waiting: 'Warte auf die Bootsposition (navigation.position)',
    status: (n, a, r, t) => `${n} Meldungen · ${a} Flächen${r} · Stand ${t}`,
    offline: (age) => `Offline — zeige den letzten Stand von vor ${age}`,
    until: 'bis',
    noKey: 'Kein Plotter-Schlüssel eingetragen. Schlüssel holen: ' + SIGNUP,
    badKey: 'Plotter-Schlüssel ungültig oder nicht mehr aktiv (Probezeit abgelaufen?). Abo verwalten: ' + SIGNUP,
    needPlotter: 'Das ist kein Plotter-Schlüssel. Das Plugin braucht einen Plotter-Schlüssel: ' + SIGNUP,
    limit: (d) => `Dein Plan umfasst ${d.limit === 1 ? '1 Revier' : d.limit + ' Reviere'} (${names(d)}). ` +
      `„${d.region_name}“ wäre eines mehr. ${frees(d, 'de')}Mehr Reviere: ${SIGNUP}`,
    quota: 'Zu viele Abrufe — das Plugin versucht es beim nächsten Intervall erneut.',
    region: (name, n, max) => ` · Revier ${name} (${n}/${max})`,
    inside: 'im Gebiet',
  },
}

// Region-limit answer from Neptun: { limit, region_name, regions: [{ name, free_from }] }
function names(d) {
  return (d.regions || []).map((r) => r.name).join(', ')
}

function frees(d, lang) {
  const first = (d.regions || []).map((r) => r.free_from).filter(Boolean).sort()[0]
  if (!first) return ''
  const day = new Date(first * 1000).toISOString().slice(0, 10)
  return lang === 'de' ? `Frei wird ein Revier am ${day}, wenn bis dahin keine Abrufe daraus kommen. `
    : `A region becomes free on ${day} if it gets no requests until then. `
}

module.exports = function (app) {
  let timer = null
  let notes = {}       // id -> Signal K note
  let regions = {}     // id -> Signal K region
  let lastGood = null  // { ts, warnings, plotter }
  let alarmed = new Set()
  let opts = {}

  const plugin = {
    id: 'signalk-neptun-warnings',
    name: 'Neptun Warnings',
    description: 'Official navigational warnings and restricted areas from Neptun on your chart',
  }

  plugin.schema = {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiKey: {
        type: 'string',
        title: 'Neptun plotter key (mapi_…)',
        description: '30 days free, then 1 region €1.99 or 3 regions €3.99 a month: ' + SIGNUP,
      },
      lang: { type: 'string', title: 'Language of the warnings', enum: ['en', 'de'], default: 'en' },
      radiusKm: {
        type: 'number', title: 'Radius around the vessel (km)', default: 150, minimum: 10, maximum: 200,
      },
      intervalMin: { type: 'number', title: 'Update interval (minutes)', default: 30, minimum: 15 },
      areas: { type: 'boolean', title: 'Show restricted and warning areas as regions', default: true },
      notifyWithinNm: {
        type: 'number', title: 'Raise an alarm when a warning is within this distance (nm); 0 = off', default: 0,
      },
      apiBase: { type: 'string', title: 'Neptun API base URL (leave as is)', default: 'https://neptun.marine-api.com' },
    },
  }

  const t = () => TEXT[opts.lang === 'de' ? 'de' : 'en']

  // ---- helpers ---------------------------------------------------------------

  function vesselPosition() {
    const p = app.getSelfPath('navigation.position')
    const v = p && (p.value || p)
    if (v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      return { latitude: v.latitude, longitude: v.longitude }
    }
    return null
  }

  function cacheFile() {
    try {
      return path.join(app.getDataDirPath(), 'last-warnings.json')
    } catch (e) {
      return null
    }
  }

  function saveCache(entry) {
    const f = cacheFile()
    if (!f) return
    try {
      fs.writeFileSync(f, JSON.stringify(entry))
    } catch (e) {
      app.debug('cache not written: %s', e.message)
    }
  }

  function loadCache() {
    const f = cacheFile()
    if (!f) return null
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch (e) {
      return null
    }
  }

  function safeId(s) {
    return String(s).replace(/[^A-Za-z0-9_-]/g, '-')
  }

  function age(ms) {
    const m = Math.round(ms / 60000)
    if (m < 90) return m + ' min'
    const h = Math.round(m / 60)
    return h < 48 ? h + ' h' : Math.round(h / 24) + ' d'
  }

  function haversineNm(a, b) {
    const R = 3440.065
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(b.latitude - a.latitude)
    const dLon = toRad(b.longitude - a.longitude)
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  // GeoJSON rings of a Polygon or MultiPolygon → array of outer rings ([lon, lat] pairs)
  function rings(geometry) {
    if (!geometry) return []
    if (geometry.type === 'Polygon') return [geometry.coordinates[0]]
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0])
    return []
  }

  function inside(pos, ring) {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (((yi > pos.latitude) !== (yj > pos.latitude)) &&
          pos.longitude < ((xj - xi) * (pos.latitude - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }

  // Distance from the boat to a warning: 0 inside an area, else to the nearest corner or the point.
  function distanceNm(pos, w) {
    let best = (typeof w.lat === 'number' && typeof w.lon === 'number')
      ? haversineNm(pos, { latitude: w.lat, longitude: w.lon }) : Infinity
    for (const ring of rings(w.geometry)) {
      if (inside(pos, ring)) return 0
      for (const [lon, lat] of ring) best = Math.min(best, haversineNm(pos, { latitude: lat, longitude: lon }))
    }
    return best
  }

  function key(w) {
    return safeId(w.mid || w.id)
  }

  function title(w) {
    return (w.closed ? '⛔ ' : '') + (w.place || w.fairway || w.nts || 'Warning')
  }

  function describe(w) {
    const lines = []
    if (w.detail) lines.push(w.detail)
    const meta = []
    if (w.nts) meta.push('№ ' + w.nts)
    if (w.source) meta.push(String(w.source).toUpperCase())
    if (w.valid_until) meta.push(t().until + ' ' + new Date(w.valid_until * 1000).toISOString().slice(0, 10))
    if (meta.length) lines.push('(' + meta.join(' · ') + ')')
    if (w.attribution) lines.push(w.attribution)
    return lines.join('\n')
  }

  function build(warnings) {
    const n = {}
    const r = {}
    for (const w of warnings) {
      if (typeof w.lat !== 'number' || typeof w.lon !== 'number' || !(w.mid || w.id)) continue
      const id = key(w)
      const note = {
        name: title(w),
        description: describe(w),
        position: { latitude: w.lat, longitude: w.lon },
        mimeType: 'text/plain',
        url: w.link || undefined,
        group: 'neptun-warnings',
        properties: {
          source: w.source, kind: w.kind, closed: !!w.closed, coarse: !!w.coarse,
          validUntil: w.valid_until || null, distanceKm: w.distance_km,
        },
      }
      if (opts.areas !== false && w.geometry && rings(w.geometry).length) {
        const rid = 'neptun-area-' + id
        r[rid] = {
          name: title(w),
          description: describe(w),
          feature: {
            type: 'Feature',
            geometry: w.geometry,
            properties: { closed: !!w.closed, source: w.source, kind: w.kind },
          },
        }
        note.href = '/resources/regions/' + rid
      }
      n['neptun-' + id] = note
    }
    notes = n
    regions = r
  }

  function notify(fullPath, state, message) {
    app.handleMessage(plugin.id, {
      updates: [{
        values: [{
          path: fullPath,
          value: { state, method: state === 'normal' ? [] : ['visual'], message, timestamp: new Date().toISOString() },
        }],
      }],
    })
  }

  function proximity(pos, warnings) {
    const within = Number(opts.notifyWithinNm) || 0
    const now = new Set()
    if (within > 0) {
      for (const w of warnings) {
        const d = distanceNm(pos, w)
        if (d > within) continue
        const id = key(w)
        now.add(id)
        const wo = d === 0 ? t().inside : d.toFixed(1) + ' nm'
        notify(ALARM_PATH + id, w.closed ? 'alert' : 'warn', title(w) + ' – ' + wo)
      }
    }
    for (const id of alarmed) if (!now.has(id)) notify(ALARM_PATH + id, 'normal', '')
    alarmed = now
  }

  function showStatus(plotter, ts) {
    let r = ''
    if (plotter && plotter.region_name) {
      r = t().region(plotter.region_name, (plotter.regions || []).length, plotter.limit)
    }
    app.setPluginStatus(t().status(Object.keys(notes).length, Object.keys(regions).length, r,
      new Date(ts).toLocaleTimeString()))
  }

  function problem(message, state) {
    app.setPluginError(message)
    notify(STATUS_PATH, state || 'warn', message)
  }

  // ---- fetch -----------------------------------------------------------------

  async function refresh() {
    if (!opts.apiKey) return problem(t().noKey, 'warn')
    const pos = vesselPosition()
    if (!pos) {
      app.setPluginStatus(t().waiting)
      return
    }
    const base = (opts.apiBase || 'https://neptun.marine-api.com').replace(/\/+$/, '')
    const radius = Math.min(200, Math.max(10, Number(opts.radiusKm) || 150))
    const url = base + API_PATH + '?lat=' + pos.latitude.toFixed(5) + '&lon=' + pos.longitude.toFixed(5) +
      '&radius=' + radius + '&lang=' + (opts.lang === 'de' ? 'de' : 'en')
    let res
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + opts.apiKey, 'X-Neptun-Client': CLIENT },
        signal: AbortSignal.timeout(30000),
      })
    } catch (e) {
      // No network: keep showing the last good result, say how old it is.
      if (lastGood) {
        app.setPluginStatus(t().offline(age(Date.now() - lastGood.ts)))
        proximity(pos, lastGood.warnings)
      } else {
        app.setPluginError('Neptun: ' + (e && e.message ? e.message : e))
      }
      return
    }
    let body = null
    try {
      body = await res.json()
    } catch (e) {
      body = null
    }
    if (!res.ok) {
      const d = (body && body.detail) || {}
      if (res.status === 401) return problem(t().badKey, 'alert')
      if (res.status === 403 && d.error === 'plotter_key_required') return problem(t().needPlotter, 'alert')
      if (res.status === 403 && d.error === 'region_limit') return problem(t().limit(d), 'warn')
      if (res.status === 429) return app.setPluginStatus(t().quota)
      return app.setPluginError('Neptun API HTTP ' + res.status)
    }
    const list = Array.isArray(body && body.warnings) ? body.warnings : []
    const attribution = body && body.attribution
    for (const w of list) if (!w.attribution && attribution) w.attribution = attribution
    lastGood = { ts: Date.now(), warnings: list, plotter: body.plotter || null }
    saveCache(lastGood)
    build(list)
    notify(STATUS_PATH, 'normal', '')
    proximity(pos, list)
    showStatus(lastGood.plotter, lastGood.ts)
    app.debug('fetched %d warnings from %s', list.length, url)
  }

  // ---- resource providers ----------------------------------------------------

  function provider(type, store) {
    return {
      type,
      methods: {
        listResources: () => Promise.resolve(store()),
        getResource: (id) => (store()[id] ? Promise.resolve(store()[id]) : Promise.reject(new Error('not found'))),
        setResource: () => Promise.reject(new Error('read-only: provided by Neptun')),
        deleteResource: () => Promise.reject(new Error('read-only: provided by Neptun')),
      },
    }
  }

  function registerProviders() {
    if (typeof app.registerResourceProvider !== 'function') {
      app.debug('registerResourceProvider not available (Signal K server < 2)')
      return
    }
    app.registerResourceProvider(provider('notes', () => notes))
    app.registerResourceProvider(provider('regions', () => regions))
  }

  // ---- lifecycle -------------------------------------------------------------

  plugin.start = function (options) {
    opts = options || {}
    notes = {}
    regions = {}
    alarmed = new Set()
    registerProviders()
    lastGood = loadCache()
    if (lastGood && Array.isArray(lastGood.warnings)) {
      build(lastGood.warnings)
      app.setPluginStatus(t().offline(age(Date.now() - lastGood.ts)))
    }
    const everyMs = Math.max(15, Number(opts.intervalMin) || 30) * 60 * 1000
    refresh()
    timer = setInterval(refresh, everyMs)
  }

  plugin.stop = function () {
    if (timer) clearInterval(timer)
    timer = null
    for (const id of alarmed) notify(ALARM_PATH + id, 'normal', '')
    alarmed = new Set()
    notes = {}
    regions = {}
  }

  return plugin
}
