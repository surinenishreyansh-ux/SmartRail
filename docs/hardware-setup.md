# SmartRail Hardware Setup & Wiring Guide

This guide provides the complete physical wiring, pin assignments, and safety requirements for connecting the physical sensors and actuators to the **ESP32 DevKit V1** and configuring the **ESP32-CAM**.

---

## 1. Hardware Bill of Materials (BOM)

| # | Component | Model / Spec | Purpose |
|---|---|---|---|
| 1 | Main Microcontroller | **ESP32 DevKit V1** (30-pin or 36-pin) | Real sensor telemetry & HTTP WebServer (`/data`) |
| 2 | Camera Microcontroller | **AI-Thinker ESP32-CAM** (with OV2640) | Real-time live MJPEG video stream (`/stream`) |
| 3 | Temperature & Humidity | **DHT22** (AM2302) | Real ambient environmental monitoring |
| 4 | Gas & Smoke Sensor | **MQ-2** Analog Module | Smoke and combustible gas detection |
| 5 | Flame Sensor | **IR Flame Sensor Module** (LM393) | Fire detection (Active LOW) |
| 6 | Track Vibration Sensor | **SW-420** Digital Vibration Sensor | Track structural shock & vibration |
| 7 | Ultrasonic Obstacle Sensor | **HC-SR04** | Track obstacle distance measurement |
| 8 | GPS Module | **NEO-6M / NEO-7M / ATGM336H** | Real satellite coordinates (TinyGPS++) |
| 9 | Audible Alarm | **Active Buzzer** (5V / 3.3V) | Audio alert on any hazard condition |
| 10 | Visual Alarm | **5mm Red LED** + 220Ω resistor | Visual alert on any hazard condition |
| 11 | Resistors | **1 kΩ & 2 kΩ** (or 2.2 kΩ & 3.3 kΩ) | **Critical HC-SR04 ECHO voltage divider** |
| 12 | Power Supply | 5V / 2.5A USB or External DC Buck | Stable Wi-Fi current supply |

---

## 2. Complete ESP32 DevKit V1 Pinout Table

| Component | Component Pin | ESP32 GPIO | Logic Type | Wiring / Safety Notes |
|---|---|---|---|---|
| **DHT22** | DATA / OUT | **GPIO 4** | Digital (Bidirectional) | Pull-up 4.7kΩ to 10kΩ to 3.3V (often built into 3-pin module). Powered by 3.3V. |
| **Vibration Sensor** | DO (Digital Out) | **GPIO 34** | Digital Input | Input-only pin. Active HIGH on vibration trigger. |
| **MQ-2 Gas Sensor** | AO (Analog Out) | **GPIO 35** | Analog Input (ADC1) | Connects to ADC1 channel. Calibration threshold set to `1800`. |
| **Flame Sensor** | DO (Digital Out) | **GPIO 32** | Digital Input | Standard module outputs LOW when IR flame is detected. |
| **HC-SR04 TRIG** | TRIG | **GPIO 33** | Digital Output | 3.3V trigger pulse sent from ESP32. |
| **HC-SR04 ECHO** | ECHO | **GPIO 25** | Digital Input | **CRITICAL: MUST PASS THROUGH VOLTAGE DIVIDER!** (See Section 3) |
| **Buzzer** | + (Anode) | **GPIO 27** | Digital Output | Active HIGH drives buzzer ON when alert triggered. |
| **Alarm LED** | Anode (+) via 220Ω | **GPIO 26** | Digital Output | Active HIGH illuminates LED when alert triggered. |
| **GPS Module** | TX | **GPIO 12** | UART2 RX | GPS TX connects to ESP32 RX2 (GPIO 12). |
| **GPS Module** | RX | **GPIO 14** | UART2 TX | GPS RX connects to ESP32 TX2 (GPIO 14). |

---

## 3. HC-SR04 5V Voltage Level Safety & Protection

> [!WARNING]
> **CRITICAL HARDWARE SAFETY NOTICE:**
> The HC-SR04 ultrasonic sensor requires a **5V VCC supply** to operate reliably. As a consequence, its **ECHO** pin outputs a **5.0V logic pulse**.
> The ESP32's GPIO pins are strictly rated for a maximum of **3.3V / 3.6V**. Connecting a raw 5V signal directly to GPIO 25 can permanently damage the ESP32 input pin or degrade the chip over time.

### Recommended Voltage Divider Circuit

Use two resistors to step down the 5V ECHO output to a safe ~3.3V before feeding it into GPIO 25:

```text
  HC-SR04 ECHO Pin (5V Pulse)
          │
          ▼
      ┌───────┐
      │ 1 kΩ  │ (R1)
      └───────┘
          │
          ├──────────────────────────► ESP32 GPIO 25 (Input: ~3.33V)
          │
      ┌───────┐
      │ 2 kΩ  │ (R2)
      └───────┘
          │
          ▼
      GND (Ground)
```

**Calculation:**
$$V_{out} = V_{in} \times \frac{R_2}{R_1 + R_2} = 5.0\text{V} \times \frac{2000}{1000 + 2000} = 3.33\text{V}$$

*Alternative resistor values if 1k/2k are unavailable:*
- $R_1 = 2.2\text{ k}\Omega$, $R_2 = 3.3\text{ k}\Omega \implies V_{out} \approx 3.0\text{V}$ (Safe and recognized as logic HIGH by ESP32).

---

## 4. GPS Receiver Wiring & Satellite Acquisition

1. **Power Supply:** Connect GPS VCC to 3.3V (or 5V if module has onboard regulator) and GND to ESP32 GND.
2. **Serial Connection:**
   - **GPS TX** $\rightarrow$ **ESP32 GPIO 12** (HardwareSerial 2 RX)
   - **GPS RX** $\rightarrow$ **ESP32 GPIO 14** (HardwareSerial 2 TX)
3. **Baud Rate:** Standard GPS modules (NEO-6M) default to `9600 baud`. The firmware initializes UART2 at 9600 baud.
4. **Acquiring Satellites (Fix):**
   - GPS satellite signals cannot penetrate reinforced concrete. Place the antenna outdoors or next to a clear window.
   - The onboard LED on the NEO-6M will begin blinking once a valid 3D GPS fix is locked.
   - When no satellite fix is present, the ESP32 will cleanly return `latitude: null, longitude: null`, and the SmartRail dashboard displays **"GPS UNAVAILABLE"** without inventing fake locations.

---

## 5. ESP32-CAM AI-Thinker Wiring & Flashing

The AI-Thinker ESP32-CAM does not include an onboard USB-to-UART chip. An external FTDI or CP2102 USB-to-TTL programmer is used to flash the firmware.

### Flashing Mode Connection Table

| FTDI / USB-TTL Programmer | ESP32-CAM Pin | Purpose |
|---|---|---|
| **VCC (Set to 5V)** | **5V** | ESP32-CAM power |
| **GND** | **GND** | Common ground |
| **TXD** | **U0R (GPIO 3)** | Serial programming data into ESP32 |
| **RXD** | **U0T (GPIO 1)** | Serial feedback from ESP32 |
| **GND** | **GPIO 0** | **CRITICAL: Connect GPIO 0 to GND during upload to enter Bootloader mode!** |

### Upload Steps:
1. Jumper **GPIO 0 to GND**.
2. Plug the FTDI programmer into your PC's USB port.
3. In Arduino IDE, select `AI Thinker ESP32-CAM`.
4. Click **Upload**. When `Connecting........` appears in the console, press the **RESET** button on the bottom of the ESP32-CAM.
5. Once flashing completes: **Unplug USB, remove the jumper wire from GPIO 0**, and plug USB back in.
6. Open Serial Monitor at **115200 baud** and press RESET once.
7. Note down the IP address printed (e.g. `http://192.168.1.120`).

---

## 6. Power Considerations

The ESP32 Wi-Fi radio and camera draw momentary peak currents of up to **450–500mA**.
- Power your ESP32 boards using a powered USB hub, external 5V/2A supply, or dedicated USB wall adapter.
- Avoid running multiple high-current modules from a laptop USB port through cheap unpowered hubs.
- Ensure common Ground (GND) is connected across all sensors and the ESP32.
