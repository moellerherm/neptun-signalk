/*
 * signalk-neptun-warnings
 *
 * Fetches official navigational warnings from the Marine-API / Neptun service
 * (https://neptun.marine-api.com) around the vessel's position and publishes them
 * as Signal K `notes` resources, so they show up on the chart in Freeboard-SK and,
 * via the Signal K web app tile, on Navico/B&G/Simrad/Lowrance MFDs.
 *
 * The plugin is a thin client: it only reads what the API key is entitled to see.
 * Any paywall / region limit is enforced server-side by Neptun, not here.
 */

const API_PATH = '/v1/warnings'

module.exports = function (app) {
  let timer = null
  let notes = {}          // id -> Signal K note resource
  let lastError = null
  let lastRun = 0

  const plugin = {
    id: 'signalk-neptun-warnings',
    name: 'Neptun Warnings',
    description: 'Official navigational warnings from Marine-API / Neptun as notes on the chart',
  }

  plugin.schema = {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiBase: {
        type: 'string',
        title: 'Neptun API base URL',
        default: 'https://neptun.marine-api.com',
      },
      apiKey: {
        type: 'string',
        title: 'Neptun API key (mapi_…)',
        description: 'Get a key at https://neptun.marine-api.com',
      },
      radiusKm: {
        type: 'number',
        title: 'Radius around the vessel (km)',
        default: 150,
      },
      intervalMin: {
        type: 'number',
        title: 'Update interval (minutes)',
        default: 30,
      },
      lang: {
        type: 'string',
        title: 'Language',
        enum: ['en', 'de'],
        default: 'en',
      },
      notifyWithinNm: {
        type: 'number',
        title: 'Raise an alarm when a warning is within this distance (nm); 0 = off',
        default: 0,
      },
    },
  }

  // ---- helpers ---------------------------------------------------------------

  function vesselPosition() {
    const p = app.getSelfPath('navigation.position')
    const v = p && (p.value || p)
    if (v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      return { latitude: v.latitude, longitude: v.longitude }
    }
    return null
  }

  // Map one Neptun warning to a Signal K note resource.
  function toNote(w) {
    const title = (w.closed ? '⛔ ' : '') + (w.place || w.fairway || w.nts || 'Warning')
    const lines = []
    if (w.detail) lines.push(w.detail)
    const meta = []
    if (w.nts) meta.push('№ ' + w.nts)
    if (w.source) meta.push(w.source.toUpperCase())
    if (w.valid_until) meta.push('until ' + new Date(w.valid_until * 1000).toISOString().slice(0, 10))
    if (meta.length) lines.push('(' + meta.join(' · ') + ')')
    return {
      name: title,
      description: lines.join('\n'),
      position: { latitude: w.lat, longitude: w.lon },
      mimeType: 'text/plain',
      url: w.link || undefined,
      // non-standard extras kept for apps that read them; harmless to those that don't
      group: 'neptun-warnings',
      properties: {
        source: w.source,
        category: w.category,
        closed: !!w.closed,
        coarse: !!w.coarse,
        validUntil: w.valid_until || null,
        distanceKm: w.distance_km,
      },
    }
  }

  function haversineNm(a, b) {
    const R = 3440.065 // nautical miles
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(b.latitude - a.latitude)
    const dLon = toRad(b.longitude - a.longitude)
    const lat1 = toRad(a.latitude)
    const lat2 = toRad(b.latitude)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  function sendNotification(id, title, state) {
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: 'notifications.navigation.neptunWarning.' + id,
              value: {
                state: state,
                method: ['visual'],
                message: title,
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    })
  }

  async function refresh(options) {
    const pos = vesselPosition()
    if (!pos) {
      app.setPluginStatus('Waiting for vessel position (navigation.position)')
      return
    }
    const base = (options.apiBase || 'https://neptun.marine-api.com').replace(/\/+$/, '')
    const url =
      base +
      API_PATH +
      '?lat=' + pos.latitude.toFixed(5) +
      '&lon=' + pos.longitude.toFixed(5) +
      '&radius=' + (options.radiusKm || 150) +
      '&lang=' + (options.lang || 'en')
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + options.apiKey },
      })
      if (!res.ok) {
        lastError = 'HTTP ' + res.status
        app.setPluginError('Neptun API ' + lastError)
        return
      }
      const data = await res.json()
      const list = Array.isArray(data.warnings) ? data.warnings : []
      const next = {}
      for (const w of list) {
        if (typeof w.lat !== 'number' || typeof w.lon !== 'number' || !w.id) continue
        next['neptun-' + w.id] = toNote(w)
      }
      notes = next
      lastError = null
      lastRun = Date.now()

      // Optional proximity alarm
      const within = Number(options.notifyWithinNm) || 0
      if (within > 0) {
        for (const w of list) {
          if (typeof w.lat !== 'number') continue
          const d = haversineNm(pos, { latitude: w.lat, longitude: w.lon })
          if (d <= within) {
            sendNotification(w.id, (w.place || 'Warning') + ' – ' + d.toFixed(1) + ' nm', w.closed ? 'alert' : 'warn')
          }
        }
      }

      app.setPluginStatus(
        list.length + ' warnings within ' + (options.radiusKm || 150) + ' km · updated ' +
          new Date(lastRun).toLocaleTimeString(),
      )
      app.debug('fetched %d warnings from %s', list.length, url)
    } catch (e) {
      lastError = String(e && e.message ? e.message : e)
      app.setPluginError('Neptun API: ' + lastError)
    }
  }

  // ---- resource provider -----------------------------------------------------

  function registerProvider() {
    if (typeof app.registerResourceProvider !== 'function') {
      app.debug('registerResourceProvider not available; notes will not be served as resources')
      return
    }
    app.registerResourceProvider({
      type: 'notes',
      methods: {
        listResources: () => Promise.resolve(notes),
        getResource: (id) =>
          notes[id] ? Promise.resolve(notes[id]) : Promise.reject(new Error('not found')),
        setResource: () => Promise.reject(new Error('read-only: provided by Neptun')),
        deleteResource: () => Promise.reject(new Error('read-only: provided by Neptun')),
      },
    })
  }

  // ---- lifecycle -------------------------------------------------------------

  plugin.start = function (options) {
    notes = {}
    registerProvider()
    const everyMs = Math.max(5, Number(options.intervalMin) || 30) * 60 * 1000
    refresh(options)
    timer = setInterval(() => refresh(options), everyMs)
    app.setPluginStatus('Started')
  }

  plugin.stop = function () {
    if (timer) clearInterval(timer)
    timer = null
    notes = {}
    app.setPluginStatus('Stopped')
  }

  return plugin
}
