# Smart City 🏙️

**Live:** https://smart-city-cyan.vercel.app/

Hackathon platform where kids train computer-vision models to detect urban hazards
(potholes, faded crosswalks, litter, broken signs), tour real Israeli streets
virtually (default city: Sderot), and watch their model's detections appear as
pins on a real map.

Built on the proven [thinkCV Hakaton](https://github.com/ariel198989/thinkcv-hakaton)
pipeline: browser frame extraction, YOLO dataset export, free Colab GPU training,
TF.js in-browser inference.

## Modules
- 🗺️ **City map** — MapLibre + CARTO dark, hazard pins, heatmap, coverage layer
- 🚶 **Street tour** — Google Street View embed + geotagged frame viewer + 🔴 **live tour**: the trained model runs on every frame; detections above threshold auto-save as map pins
- 🎓 **Training studio** — collect → curate → tag → export YOLO ZIP → Colab → load model back; shared pool merges all teams into a "city model"
- 🏭 **Data factory** (admin) — drive video + GPX → sharp geotagged frames → city dataset
- 📋 **Hazard board** — moderation (approve/reject), team leaderboard, CSV report for the municipality

## Stack
Static ES modules (no build step) · MapLibre GL · TensorFlow.js · JSZip · Supabase (auth, `sc_*` tables with RLS, public storage) · YOLOv8n trained on free Colab GPU.

Hebrew RTL throughout. Storage keys are ASCII-only (Hebrew stays in DB rows).
