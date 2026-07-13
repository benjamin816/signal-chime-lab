# Signal Chime Lab

Small iPhone-friendly MVP for testing:

- live camera preview
- distinct green and yellow tones
- green tone reused for the lead-car fallback
- 5-second stationary gate
- cooldown so alerts do not spam
- local COCO-SSD model files for offline use after load
- service worker cache for repeat offline launches

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
- The lead pull-away slider is a rough proxy, not a true physical distance reading.
