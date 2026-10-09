# SMARTRAIL / RAILWAY INTELLIGENCE
## Real Hardware Railway Monitoring & Intelligent Safety Platform

This repository contains the complete firmware, web control center dashboard, and hardware integration for the **SmartRail** autonomous railway safety and inspection prototype.

The system connects **real physical sensors**, a **real ESP32 DevKit V1**, an **ESP32-CAM live video streamer**, and a **real GPS module** directly to a **React Railway Control Center dashboard** over Wi-Fi.

---

## 1. System Architecture

```text
 ┌────────────────────────────────────────────────────────┐
 │                   ESP32 DevKit V1                      │
 │                                                        │
 │   • DHT22 Temperature & Humidity (GPIO 4)              │
 │   • MQ-2 Gas & Smoke Detector (GPIO 35)                │
 │   • Optical Flame IR Detector (GPIO 32)                │
 │   • Track Vibration Sensor (GPIO 34)                   │
 │   • HC-SR04 Ultrasonic Obstacle Radar (GPIO 33 / 25)   │
 │   • GPS Satellite Receiver (GPIO 12 / 14)              │
 │   • Physical Alarm Buzzer (GPIO 27)                    │
 │   • Physical Alert LED (GPIO 26)                       │
 └───────────────────────────┬────────────────────────────┘
                             │
                             │ Wi-Fi (HTTP WebServer)
                             │ GET /data (JSON with CORS)
                             ▼
              ┌──────────────────────────────┐
              │  SMARTRAIL CONTROL CENTER    │
              │  (React 19 + TypeScript)     │
              │                              │
              │  • Real Sensor Monitoring    │
              │  • Real Obstacle Radar       │
              │  • Real Satellite GPS Map    │
              │  • Safety Alerts & History   │
              │  • System Status Diagnostics │
              └──────────────┬───────────────┘
                             │
                             │ Wi-Fi (HTTP Stream)
                             │ GET /stream (MJPEG)
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │                   AI-Thinker ESP32-CAM                 │
 │                                                        │
 │   • OV2640 Camera Sensor                               │
 │   • Real-Time MJPEG Video Streamer                     │
 │   • Onboard Diagnostic Web Interface                   │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```text
SmartRail-project/
├── docs/
│   ├── hardware-setup.md              # Complete hardware pinout & safety guide
│   └── esp32-setup.md                 # Step-by-step Arduino IDE flashing instructions
│
├── esp32/
│   ├── esp32_railway_monitor/
│   │   └── esp32_railway_monitor.ino  # ESP32 DevKit V1 sensor firmware (WebServer GET /data)
│   │
│   └── esp32_cam/
│       └── esp32_cam.ino              # AI-Thinker ESP32-CAM MJPEG streaming firmware
│
├── SmartRail/                         # Modern Railway Control Center dashboard
│   ├── src/
│   │   ├── esp32-api.ts               # Hardware API client for GET /data
│   │   ├── main.tsx                   # Main dashboard, sidebar, track view, sensors
│   │   └── styles.css                 # Dark railway control room theme
│   ├── .env.example                   # Environment configuration template
│   ├── .env                           # Local hardware IP configuration
│   └── package.json
│
├── .env.example                       # Root environment variables reference
└── README.md                          # Master documentation
```

---

## 3. Hardware Pin Mapping & Wiring Guide

### ESP32 DevKit V1 (30-pin / 36-pin)

| Component | Component Pin | ESP32 GPIO | Logic Type | Safety & Hardware Notes |
|---|---|---|---|---|
| **DHT22** | DATA | **GPIO 4** | Digital I/O | Temperature & Humidity. Powered by 3.3V. |
| **Vibration Sensor** | DO | **GPIO 34** | Digital Input | SW-420 shock sensor. Active HIGH on vibration trigger. |
| **MQ-2 Gas / Smoke** | AO | **GPIO 35** | Analog Input (ADC1) | Analog reading (0–4095). Threshold: `1800`. |
| **Flame Sensor** | DO | **GPIO 32** | Digital Input | LM393 IR Flame detector (Active LOW on fire detection). |
| **HC-SR04 TRIG** | TRIG | **GPIO 33** | Digital Output | Ultrasonic trigger pulse. |
| **HC-SR04 ECHO** | ECHO | **GPIO 25** | Digital Input | **CRITICAL: 5V ECHO MUST USE 1kΩ / 2kΩ VOLTAGE DIVIDER!** |
| **Buzzer** | Anode (+) | **GPIO 27** | Digital Output | Active HIGH alarm buzzer on any safety hazard. |
| **Alarm LED** | Anode (+) via 220Ω | **GPIO 26** | Digital Output | Active HIGH visual alarm indicator. |
| **GPS Module** | TX | **GPIO 12** | UART2 RX | Connects to GPS module TX (TinyGPS++). |
| **GPS Module** | RX | **GPIO 14** | UART2 TX | Connects to GPS module RX. |

### HC-SR04 Ultrasonic Voltage Level Safety

> [!WARNING]
> The HC-SR04 sensor operates on 5V VCC and outputs a **5.0V pulse on the ECHO pin**. ESP32 GPIOs are **3.3V maximum**.
> Connect a voltage divider between ECHO and GPIO 25:
> - **1 kΩ resistor** between HC-SR04 ECHO and ESP32 GPIO 25.
> - **2 kΩ resistor** between ESP32 GPIO 25 and GND.
> - This steps 5.0V down to a safe **3.33V**.

---

## 4. Required Arduino Libraries

Install via the Arduino IDE Library Manager (**Sketch** $\rightarrow$ **Include Library** $\rightarrow$ **Manage Libraries...**):

1. **DHT sensor library** by *Adafruit* (version 1.4.x)
2. **Adafruit Unified Sensor** by *Adafruit* (version 1.1.x)
3. **TinyGPSPlus** by *Mikal Hart* (version 1.0.x)
*(WiFi and WebServer are built into the official ESP32 Arduino Core).*

---

## 5. Firmware Flashing Instructions

### A. ESP32 Railway Monitor
1. Open `esp32/esp32_railway_monitor/esp32_railway_monitor.ino` in Arduino IDE.
2. Update Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Network";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   ```
3. In **Tools** $\rightarrow$ **Board**, select **DOIT ESP32 DEVKIT V1** (or `ESP32 Dev Module`).
4. Select the COM port and click **Upload**.
5. Open Serial Monitor at **115200 baud** and record the IP address printed:
   ```text
   [WIFI] Connected successfully!
   [WIFI] ESP32 IP Address: 192.168.1.105
   [HTTP] WebServer started on port 80
   [HTTP] Endpoint registered: GET /data (JSON)
   ```

### B. ESP32-CAM Live Video Streamer
1. Open `esp32/esp32_cam/esp32_cam.ino` in Arduino IDE.
2. Update Wi-Fi credentials.
3. In **Tools** $\rightarrow$ **Board**, select **AI Thinker ESP32-CAM**.
4. In **Tools** $\rightarrow$ **Partition Scheme**, select **Huge APP (3MB No OTA/1MB SPIFFS)**.
5. Connect **GPIO 0 to GND** (bootloader mode) and upload via FTDI programmer.
6. Once uploaded, remove the GPIO 0 jumper and press Reset.
7. Open Serial Monitor at **115200 baud** and record the IP address:
   ```text
   [WIFI] ESP32-CAM IP: http://192.168.1.106
   [WIFI] Stream URL:   http://192.168.1.106/stream
   ```

---

## 6. Testing the Hardware Endpoints

### 1. Test Sensor JSON Telemetry:
Open in any browser:
```text
http://<ESP32_IP>/data
```
Expected output:
```json
{
  "temperature": 28.4,
  "humidity": 61.2,
  "vibration": 0,
  "gas": 420,
  "flame": 1,
  "distance": 85.4,
  "latitude": null,
  "longitude": null,
  "gasAlert": false,
  "flameAlert": false,
  "vibrationAlert": false,
  "obstacleAlert": false
}
```

### 2. Test Live Camera Feed:
Open in any browser:
```text
http://<ESP32_CAM_IP>/stream
```
You should immediately see the live MJPEG camera video.

---

## 7. Starting the SmartRail Dashboard

1. Navigate to the `SmartRail` directory:
   ```bash
   cd SmartRail
   ```
2. Verify or edit `.env`:
   ```env
   VITE_ESP32_API_URL=http://<ESP32_IP>
   VITE_ESP32_CAM_URL=http://<ESP32_CAM_IP>/stream
   ```
   *(Note: You can also adjust or test these IPs directly in the dashboard UI under the **Settings** tab without restarting the server!)*
3. Install dependencies and start the Vite dev server:
   ```bash
   npm install
   npm run dev
   ```
4. Open the printed localhost URL in your browser (e.g. `http://localhost:5173`).

---

## 8. Verification & Acceptance Tests

1. **Wi-Fi Connectivity:** Both ESP32 and ESP32-CAM connect and print their LAN IP addresses in the Serial Monitor.
2. **Dashboard Reachability:** Top status pill transitions from `ESP32 OFFLINE` to `ESP32 ONLINE` with real-time ping updates.
3. **HC-SR04 Obstacle Test:**
   - With track clear: Track banner shows `TRACK CLEAR` and measured distance > 50 cm.
   - Place an obstacle closer than 50 cm (e.g. 35–40 cm): Track banner immediately triggers `OBSTACLE DETECTED`, visual barrier 🚧 appears on the track at the measured distance, and the physical buzzer/LED activate.
4. **MQ-2 Gas / Smoke Test:** Gently expose sensor to butane/smoke. Gas reading increases past 1800; gas alert triggers.
5. **Flame Sensor Test:** Expose sensor to infrared/lighter flame. Sensor triggers `FIRE DETECTED!`.
6. **Vibration Sensor Test:** Tap or shake the SW-420 sensor. `VIBRATION DETECTED` triggers.
7. **GPS Satellite Test:** Place antenna near a window or outdoors. Once satellites lock, real Latitude and Longitude appear on the interactive Leaflet map.
8. **Live Camera Feed:** Real video feed streams smoothly in the **Live Camera** panel with `CAMERA ONLINE` badge.
