# Signal Chime Lab

Small iPhone-friendly MVP for testing:

- live camera preview
- distinct green and yellow tones
- green tone reused for the lead-car fallback
- 10-second stationary gate for the lead-car fallback
- parked mode after 7 minutes stationary
- cooldown so alerts do not spam
- local COCO-SSD model files for offline use after load
- service worker cache for repeat offline launches
- optional OpenStreetMap traffic-signal prior with local caching for offline reuse
- tuned conservatively for driving: smaller OSM search radius and stricter "likely" confidence before the map meaningfully nudges vision

## Run

```powershell
node server.js
```

Then open:

```text
http://localhost:8080
```

Camera access requires a secure context, so `localhost` is the easiest path for testing.
If you open it on iPhone from another machine, you will still need HTTPS or a local network path for the first load, but the cached app can keep running offline afterward.

## Notes

- `Sim Green` and `Sim Yellow` let you test the alert tones before a real model is connected.
- `Lead car pulled away` uses the same sound as green.
- GPS speed is optional and only helps with the stopped-state heuristic.
- When enabled, the OSM map prior looks up nearby `highway=traffic_signals` nodes and uses them to bias vision, but it never beeps by itself.
- The lead pull-away slider is a rough proxy, not a true physical distance reading.
