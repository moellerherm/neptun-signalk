# Lokale Testumgebung (ohne Plotter, ohne GPS)

`docker compose up` startet einen Signal-K-Server mit fixer Position **vor Goa (Indien)** —
dort gibt es gerade echte Warnungen (u. a. NAVAREA VIII).

1. `docker compose up`
2. http://localhost:3000 öffnen → Admin-Konto anlegen.
3. **Server → Plugin Config → Neptun Warnings**: aktivieren, API-Key eintragen, speichern.
4. **Freeboard-SK** öffnen: http://localhost:3000/@signalk/freeboard-sk/ → die Warnungen
   erscheinen als Notes auf der Karte.

Andere Position testen: `sk-config/defaults.json` ändern (`navigation.position`) und neu starten.
