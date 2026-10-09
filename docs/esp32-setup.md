# ESP32 Firmware Installation & Verification Guide

This guide describes how to configure the Arduino IDE, install required libraries, compile, upload firmware, and verify both the **ESP32 Railway Monitor** and the **ESP32-CAM Live Stream**.

---

## Part 1: Arduino IDE Environment Setup

1. **Download & Install Arduino IDE:**
   - Download the latest Arduino IDE 2.x from [arduino.cc](https://www.arduino.cc/en/software).
2. **Install ESP32 Board Package:**
   - Open Arduino IDE $\rightarrow$ **File** $\rightarrow$ **Preferences**.
   - In "Additional Boards Manager URLs", add:
     ```text
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Click **OK**.
   - Open **Tools** $\rightarrow$ **Board** $\rightarrow$ **Boards Manager**.
   - Search for `esp32` by **Espressif Systems** and click **Install** (version 2.0.x or 3.x).
3. **Install Required Libraries:**
   Open **Sketch** $\rightarrow$ **Include Library** $\rightarrow$ **Manage Libraries...** and search/install:
   - **DHT sensor library** by *Adafruit* (click "Install all" to include Adafruit Unified Sensor dependency).
   - **TinyGPSPlus** by *Mikal Hart* (search `TinyGPSPlus` or `TinyGPS++`).
   *(WiFi and WebServer are built into the ESP32 core).*

---

## Part 2: Uploading ESP32 Railway Monitor

1. **Open Firmware:**
   - Open `esp32/esp32_railway_monitor/esp32_railway_monitor.ino`.
2. **Configure Wi-Fi:**
   - Find lines 45–46:
     ```cpp
     const char* WIFI_SSID     = "YOUR_WIFI_NAME";
     const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
     ```
   - Set your Wi-Fi name and password. (Ensure your computer running the SmartRail dashboard is on the same local Wi-Fi network).
3. **Select Board & Port:**
   - **Tools** $\rightarrow$ **Board** $\rightarrow$ **esp32** $\rightarrow$ Select **DOIT ESP32 DEVKIT V1** (or `ESP32 Dev Module`).
   - **Tools** $\rightarrow$ **Port** $\rightarrow$ Select your USB COM port (e.g. `COM3`, `COM4`).
   - **Tools** $\rightarrow$ **Upload Speed** $\rightarrow$ `921600` (or `115200`).
4. **Compile & Upload:**
   - Click the **Upload** arrow ($\rightarrow$).
   - If the console prints `Connecting........_____.....`, press and hold the **BOOT** button on the ESP32 DevKit for 2 seconds until the flashing percentage begins.
5. **Open Serial Monitor:**
   - Set baud rate to **115200 baud**.
   - Press the **EN/RST** button on the ESP32 once.
   - The monitor will print:
     ```text
     =========================================
       SMARTRAIL ESP32 HARDWARE MONITOR BOOT  
     =========================================
     [WIFI] Connected successfully!
     [WIFI] ESP32 IP Address: 192.168.1.105
     [HTTP] WebServer started on port 80
     [HTTP] Endpoint registered: GET /
     [HTTP] Endpoint registered: GET /data (JSON)
     =========================================
     ```
6. **Verify Endpoints in Web Browser:**
   - Open `http://192.168.1.105/` $\rightarrow$ Displays SmartRail Welcome & Diagnostics page.
   - Open `http://192.168.1.105/data` $\rightarrow$ Displays real sensor JSON payload:
     ```json
     {
       "temperature": 27.8,
       "humidity": 58.4,
       "vibration": 0,
       "gas": 412,
       "flame": 1,
       "distance": 84.2,
       "latitude": null,
       "longitude": null,
       "gasAlert": false,
       "flameAlert": false,
       "vibrationAlert": false,
       "obstacleAlert": false
     }
     ```

---

## Part 3: Uploading ESP32-CAM Live Video Stream

1. **Open Firmware:**
   - Open `esp32/esp32_cam/esp32_cam.ino`.
2. **Configure Wi-Fi:**
   - Enter your Wi-Fi SSID and Password.
3. **Select Board Settings:**
   - **Tools** $\rightarrow$ **Board** $\rightarrow$ **AI Thinker ESP32-CAM**.
   - **Tools** $\rightarrow$ **CPU Frequency** $\rightarrow$ `240MHz (WiFi/BT)`.
   - **Tools** $\rightarrow$ **Flash Frequency** $\rightarrow$ `80MHz`.
   - **Tools** $\rightarrow$ **Partition Scheme** $\rightarrow$ `Huge APP (3MB No OTA/1MB SPIFFS)`.
   - **Tools** $\rightarrow$ **Port** $\rightarrow$ Select your FTDI programmer COM port.
4. **Flashing with FTDI Programmer:**
   - Connect **GPIO 0 to GND** with a jumper wire.
   - Connect FTDI 5V $\rightarrow$ ESP32-CAM 5V, GND $\rightarrow$ GND, TX $\rightarrow$ U0R, RX $\rightarrow$ U0T.
   - Click **Upload**. Press the onboard Reset button when `Connecting...` appears.
   - Once uploaded: **Disconnect GPIO 0 from GND** and press Reset.
5. **Open Serial Monitor at 115200 baud:**
   - Observe output:
     ```text
     [WIFI] Connected successfully!
     [WIFI] ESP32-CAM IP: http://192.168.1.106
     [WIFI] Stream URL:   http://192.168.1.106/stream
     ```
6. **Verify Stream in Browser:**
   - Open `http://192.168.1.106/stream` $\rightarrow$ You will see the real live video feed in real time!

---

## Part 4: Connecting to the SmartRail Dashboard

1. In the `SmartRail` directory, create or edit `.env`:
   ```env
   VITE_ESP32_API_URL=http://192.168.1.105
   VITE_ESP32_CAM_URL=http://192.168.1.106/stream
   ```
   *(Replace with the actual IP addresses printed in your Serial Monitors).*
2. Start the dashboard:
   ```bash
   cd SmartRail
   npm run dev
   ```
3. Open `http://localhost:5173`.
4. Observe the top status area:
   - **ESP32:** `ONLINE` (green)
   - **ESP32-CAM:** `ONLINE` (green)
   - **Track Visualization:** Updates directly with the HC-SR04 distance readings (`TRACK CLEAR` or `OBSTACLE DETECTED`).
