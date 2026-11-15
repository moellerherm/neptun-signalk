# Lokale Testumgebung (ohne Plotter, ohne GPS)

`docker compose up` startet einen Signal-K-Server mit fixer Position (siehe `sk-config/defaults.json`) und installiert
dieses Plugin aus dem Arbeitsordner.

1. `docker compose up`
2. http://localhost:3000 öffnen → Admin-Konto anlegen.
3. **Server → Plugin Config → Neptun Warnings**: aktivieren, **Plotter-Schlüssel** eintragen, speichern.
   Ein Free-Dev- oder API-Schlüssel wird abgewiesen (das Plugin meldet sich mit `X-Neptun-Client`).
4. **Freeboard-SK** öffnen: http://localhost:3000/@signalk/freeboard-sk/ → Meldungen als Notes, Sperrgebiete als Regions.

Andere Position testen: `sk-config/defaults.json` ändern (`navigation.position`) und neu starten. Achtung: Ein
Plotter-Schlüssel bindet jedes neue Revier — zum Testen einen eigenen Schlüssel nehmen und danach seine Reviere
löschen (`DELETE FROM key_revier WHERE khash=…` in `/data/cache/apikeys.db` im Container `neptun-api`).
