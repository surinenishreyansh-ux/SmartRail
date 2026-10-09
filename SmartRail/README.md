# SmartRail — ESP32 Multi-Sensor Railway Safety Simulation

A complete laptop-only React + TypeScript + Vite application. Includes Tailwind CSS, Framer Motion, Recharts, Leaflet, an animated railway, eight virtual sensor modules, telemetry, manual controls, filtered event history, GPS, a scripted demo, and an emergency incident report.

## Run locally

Install Node.js 22.13 or newer. Extract this project, open a terminal in its folder and run:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite (normally http://localhost:5173). Click **Start demo** for the complete scenario. No ESP32, sensor hardware, account, map API key, database or separate server is needed. Dependencies require internet for their first installation; the app itself uses no external services, tiles or fonts.

Other commands:

```sh
npm run test
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build locally. The repository lockfile uses pnpm; `pnpm install --frozen-lockfile` is available for reproducible dependency versions.

## Operating the simulation

- **Start simulation** runs the sensor clock and communication; **Start train** also starts movement.
- **Pause simulation** freezes the clock and train position. **Resume** resumes operation and starts the train if safe.
- **Stop train** stops movement while sensor telemetry continues.
- **Place obstacle** places an obstruction 100 simulated centimetres ahead. The train automatically reduces speed, then brakes below 10 cm.
- **Emergency stop** immediately stops and locks the train. Clear the obstacle and reduce critical vibration, then press **Resume**. No automatic restart happens when an obstacle is removed.
- **Reset** restores the whole session. **Start demo** resets, connects the board, starts the train, introduces an obstacle, increases environmental readings and produces an incident. It usually reaches emergency in approximately 25 seconds.
- Moving any sensor slider selects manual mode. Automatic mode produces smooth safe readings; demo mode uses a scripted incident. Motion, GPS movement, GPS signal, board power and Wi-Fi can be toggled independently.
- Live graphs for all seven metrics are in **Sensor telemetry**. **Event history** provides search, sensor and severity filters and Clear events. The latest 500 events and 90 sensor samples are kept in memory for the current session.
- The GPS route is a tile-free Leaflet schematic using simulated Hyderabad-area coordinates. It works without internet. Map zoom and drag are available.
- The buzzer always has a visual activation indicator. Press the speaker icon to enable audible alarms, subject to browser audio permission.

## Safety rules

| Sensor | Normal / safe | Warning | High / critical | Emergency |
|---|---|---|---|---|
| Obstacle | >50 cm or no obstacle | 20–50 cm | 10–<20 cm danger; exactly 10 cm critical | <10 cm: brake |
| Smoke | <100 ppm | 100–<250 ppm | ≥250 ppm critical | — |
| Temperature | <40 °C | 40–60 °C | >60 °C critical | — |
| Humidity | 30–70% | <30% or >70–85% | >85% high | — |
| Vibration | <35% | 35–<65% | 65–<90% track anomaly | ≥90%: brake |
| Heat | <40 °C | 40–<60 °C | 60–<80 °C high heat; ≥80 °C fire risk | — |

Motion and GPS loss create warnings. Board or Wi-Fi loss creates a communication-critical event. Overall emergency has the highest priority, followed by critical conditions and warnings. Alerts are logged on state transitions rather than on every tick. Cleared conditions create recovery events. The incident captures sensor readings and speed immediately before braking; current speed becomes zero.

This is an educational demonstration: the speed label is km/h, but track motion uses a deliberate demonstration scale (0.18 simulated cm per second per displayed km/h). Centimetre thresholds are for the virtual/model railway, not a full-size railway braking-distance model. No real-world railway safety certification or physical sensor accuracy is implied.

## Architecture

`src/simulation.ts` owns the simulation, sensor thresholds, emergency interlocks, GPS, event history and packet counters. The virtual board samples and processes the sensors, and an in-process communication adapter publishes snapshots to subscribers. The app clock ticks at 10 Hz; virtual packets are sent at approximately 4 Hz; graphs sample at 1 Hz.

The prompt permits a local service instead of a network backend. This project deliberately uses that option: **there are no real HTTP endpoints, WebSockets or hardware connections**. `SimulationService.request(path, method, payload)` provides the following API-shaped service operations:

- POST `/api/sensor-data` — validated smoke, temperature, humidity, vibration or heat payload
- GET `/api/train-status`, `/api/sensors`, `/api/alerts`, `/api/events`, `/api/gps`, `/api/system-status`

The adapter and visible controls use the same authoritative state. Packet and uptime counters stop when board power or Wi-Fi is off; the simulation's physical model continues, and local emergency braking still operates. Sensor cards indicate when modules are offline. GPS coordinates freeze on loss of GPS signal or when movement is disabled.

`src/main.tsx` composes TrainSimulation, SensorCards, GPSPanel, ESP32Panel, Controls, ManualControls, Chart, Alerts, EventHistory and IncidentSummary. Accessible Radix UI primitives implement sliders, switches, tabs, filters and the incident dialog. `src/styles.css` owns the dark command-center theme and responsive layouts.

## Verification

`src/simulation.test.ts` checks boundary thresholds, train movement, slowdown and safe stopping, pause/resume, reset, start/stop controls, interlocks, sensors, GPS, board faults, packet and graph updates, alert deduplication, the complete scripted demo and the API adapter. TypeScript checking and a production Vite build are also required.

Optional browser WebMCP tools expose `read_railway_status` and `control_railway_simulation` when the browser supports the API. Unsupported browsers operate normally.
