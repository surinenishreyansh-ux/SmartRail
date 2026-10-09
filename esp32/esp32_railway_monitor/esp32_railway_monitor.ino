/*
 * ==============================================================================================
 * SMARTRAIL / RAILWAY INTELLIGENCE — STANDALONE ESP32 RAILWAY MONITOR FIRMWARE
 * ==============================================================================================
 *
 * Target Board: DOIT ESP32 DEVKIT V1 (or compatible ESP32 Dev Module)
 * Architecture: Standalone Embedded WebServer (Zero PC/Node.js/Python dependencies)
 * Protocol:     HTTP GET /data -> Real JSON sensor telemetry with CORS headers
 *
 * SENSORS & PIN MAPPING (EXACT PHYSICAL CONNECTIONS PER HARDWARE DOCUMENTATION):
 * ----------------------------------------------------------------------------------------------
 * Component         | Pin / GPIO   | Direction      | Description / Exact Wiring
 * ------------------+--------------+----------------+-------------------------------------------
 * DHT22             | GPIO 4       | Bidirectional  | DATA -> D4, VCC -> 3V3, GND -> GND
 * Vibration (SW420) | GPIO 34      | Digital Input  | DO -> D34, VCC -> 3V3, GND -> GND (Input-only)
 * MQ-2 Gas / Smoke  | GPIO 35      | Analog Input   | AO -> D35, VCC -> 3V3, GND -> GND (ADC1_CH7)
 * Flame Sensor (IR) | GPIO 32      | Digital Input  | DO -> D32, VCC -> 3V3, GND -> GND (Active LOW)
 * HC-SR04 TRIG      | GPIO 33      | Digital Output | TRIG -> D33, VCC -> 5V, GND -> GND
 * HC-SR04 ECHO      | GPIO 25      | Digital Input  | ECHO -> D25 (CRITICAL: 1k/2k voltage divider to 3.3V)
 * Buzzer            | GPIO 27      | Digital Output | (+) -> D27, (-) -> GND
 * Alert LED         | GPIO 26      | Digital Output | (+) -> D26 through 220 ohm, (-) -> GND
 * GPS NEO-6M (RX)   | GPIO 12      | UART2 RX       | GPS TX -> D12, VCC -> 3V3, GND -> GND
 * GPS NEO-6M (TX)   | GPIO 14      | UART2 TX       | GPS RX -> D14
 * ESP32-CAM Serial  | GPIO 18 / 19 | UART Links     | ESP32-CAM UOR -> D18, UOT -> D19, 3V3/GND
 * ----------------------------------------------------------------------------------------------
 *
 * REQUIRED ARDUINO LIBRARIES (Install via Library Manager):
 * 1. "DHT sensor library" by Adafruit
 * 2. "Adafruit Unified Sensor" by Adafruit (dependency for DHT)
 * 3. "TinyGPSPlus" by Mikal Hart (search TinyGPSPlus or TinyGPS++)
 * Note: WiFi.h and WebServer.h are built into the ESP32 Board Package.
 *
 * SERIAL MONITOR:
 * Baud rate: 115200 baud
 * ==============================================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <TinyGPS++.h>

// ==============================================================================================
// 1. WI-FI CONFIGURATION
// ==============================================================================================
// Replace these with your local Wi-Fi network credentials before uploading:
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ==============================================================================================
// 2. PIN ASSIGNMENTS (Exact User Hardware Documentation)
// ==============================================================================================
#define DHT_PIN            4    // GPIO 4  - DHT22 DATA (VCC -> 3V3, GND -> GND)
#define DHT_TYPE           DHT22

#define VIBRATION_PIN      34   // GPIO 34 - SW-420 DO (VCC -> 3V3, GND -> GND, Input-only)
#define MQ2_PIN            35   // GPIO 35 - MQ-2 AO Analog Output (ADC1_CH7, VCC -> 3V3, GND -> GND)
#define FLAME_PIN          32   // GPIO 32 - Flame Sensor DO (VCC -> 3V3, GND -> GND, Active LOW)

#define TRIG_PIN           33   // GPIO 33 - HC-SR04 TRIG (Digital Output, 3.3V trigger)
#define ECHO_PIN           25   // GPIO 25 - HC-SR04 ECHO (Digital Input, via 1k/2k voltage divider)

#define BUZZER_PIN         27   // GPIO 27 - Buzzer (+)
#define LED_PIN            26   // GPIO 26 - Alert LED (+) through 220 ohm

#define GPS_RX_PIN         12   // GPIO 12 - ESP32 RX2 connects to GPS NEO-6M TX
#define GPS_TX_PIN         14   // GPIO 14 - ESP32 TX2 connects to GPS NEO-6M RX
#define GPS_BAUD_RATE      9600

#define CAM_TX_PIN         18   // GPIO 18 - ESP32 TX connects to ESP32-CAM UOR (RX)
#define CAM_RX_PIN         19   // GPIO 19 - ESP32 RX connects to ESP32-CAM UOT (TX)

// ==============================================================================================
// 3. HARDWARE THRESHOLDS & LOGIC CONFIGURATION
// ==============================================================================================
// MQ-2 Gas threshold: Raw ADC (0 - 4095). Readings above this trigger gasAlert.
const int GAS_THRESHOLD = 1800;

// HC-SR04 Obstacle threshold in centimeters. Distances <= 50.0 cm trigger obstacleAlert.
const float DISTANCE_THRESHOLD = 50.0;

// Flame sensor trigger logic: Standard modules output LOW when flame is detected.
const int FLAME_DETECTED_LEVEL = LOW;

// ==============================================================================================
// 4. GLOBAL OBJECTS & STATE VARIABLES
// ==============================================================================================
WebServer server(80);
DHT dht(DHT_PIN, DHT_TYPE);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2); // UART2 Hardware Serial on pins 12 (RX) and 14 (TX)

// Physical sensor readings cache
float lastTemperature = 0.0;
float lastHumidity    = 0.0;
bool  dhtValid        = false;

int   lastGasValue    = 0;
int   lastFlameValue  = 1;
int   lastVibration   = 0;

float lastDistance    = -1.0;
bool  distanceValid   = false;

double lastLatitude   = 0.0;
double lastLongitude  = 0.0;
bool   gpsFixed       = false;

// Alert states
bool gasAlertState       = false;
bool flameAlertState     = false;
bool vibrationAlertState = false;
bool obstacleAlertState  = false;

// Timing interval for sensor polling (non-blocking loop)
unsigned long lastSensorReadTime = 0;
const unsigned long SENSOR_READ_INTERVAL_MS = 250; // Sample physical sensors at 4 Hz

// ==============================================================================================
// 5. SENSOR ACQUISITION FUNCTIONS
// ==============================================================================================

// Read HC-SR04 ultrasonic distance (cm) with safety timeout & physical range validation
float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // pulseIn timeout 25000us (~4.3 meters max) prevents blocking the web server
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 25000);
  if (duration == 0) {
    return -1.0; // Echo timeout or no reflected obstacle (sensor unplugged or open space)
  }

  // Speed of sound calculation (343 m/s = 0.0343 cm/us)
  float cm = (duration * 0.0343) / 2.0;

  // Realistic physical range for HC-SR04 is 2.0cm to 400.0cm
  if (cm < 2.0 || cm > 400.0) {
    return -1.0;
  }
  return cm;
}

// Ingest GPS NMEA sentences from HardwareSerial UART2
void readGPS() {
  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    gps.encode(c);
  }

  if (gps.location.isValid() && gps.location.age() < 5000) {
    lastLatitude  = gps.location.lat();
    lastLongitude = gps.location.lng();
    gpsFixed      = true;
  } else {
    gpsFixed      = false;
  }
}

// Read all physical sensor inputs
void readSensors() {
  // 1. DHT22 Temperature & Humidity
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    lastTemperature = t;
    lastHumidity    = h;
    dhtValid        = true;
  } else {
    dhtValid        = false;
  }

  // 2. MQ-2 Gas / Smoke Sensor (AO on GPIO 35)
  lastGasValue = analogRead(MQ2_PIN);

  // 3. Flame IR Sensor (DO on GPIO 32, Active LOW with pullup)
  lastFlameValue = digitalRead(FLAME_PIN);

  // 4. Vibration Sensor (DO on GPIO 34)
  lastVibration = digitalRead(VIBRATION_PIN);

  // 5. HC-SR04 Ultrasonic Sensor (TRIG on GPIO 33, ECHO on GPIO 25 via voltage divider)
  float d = readDistance();
  if (d > 0.0) {
    lastDistance  = d;
    distanceValid = true;
  } else {
    lastDistance  = -1.0;
    distanceValid = false;
  }
}

// Evaluate alert states and actuate physical Buzzer and LED
void checkAlerts() {
  // Gas Alert
  gasAlertState = (lastGasValue > GAS_THRESHOLD);

  // Flame Alert
  flameAlertState = (lastFlameValue == FLAME_DETECTED_LEVEL);

  // Vibration Alert (HIGH indicates movement / shock)
  vibrationAlertState = (lastVibration == HIGH);

  // Obstacle Alert (Valid obstacle detected closer than or equal to DISTANCE_THRESHOLD)
  obstacleAlertState = (distanceValid && (lastDistance > 0.0) && (lastDistance <= DISTANCE_THRESHOLD));

  // Determine master alert state
  bool anyAlertActive = gasAlertState || flameAlertState || vibrationAlertState || obstacleAlertState;

  // Actuate physical Buzzer (GPIO 27) and Alert LED (GPIO 26)
  digitalWrite(BUZZER_PIN, anyAlertActive ? HIGH : LOW);
  digitalWrite(LED_PIN,    anyAlertActive ? HIGH : LOW);
}

// Serial Monitor Debug Output (115200 baud)
void printSerialDebug() {
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint < 2000) return; // Print every 2 seconds
  lastPrint = millis();

  Serial.println("-----------------------------------------");
  Serial.print("ESP32 IP address: "); Serial.println(WiFi.localIP());

  Serial.print("Temperature : ");
  if (dhtValid) { Serial.print(lastTemperature, 1); Serial.println(" *C"); }
  else { Serial.println("DHT22 UNAVAILABLE"); }

  Serial.print("Humidity    : ");
  if (dhtValid) { Serial.print(lastHumidity, 1); Serial.println(" %"); }
  else { Serial.println("DHT22 UNAVAILABLE"); }

  Serial.print("MQ-2 Gas    : "); Serial.print(lastGasValue);
  Serial.print(" (ADC AO=D35)");
  Serial.println(gasAlertState ? " [ALERT!]" : " [NORMAL]");

  Serial.print("Flame (D32) : "); Serial.print(lastFlameValue);
  Serial.println(flameAlertState ? " [FIRE DETECTED!]" : " [CLEAR]");

  Serial.print("Vib (D34)   : "); Serial.print(lastVibration);
  Serial.println(vibrationAlertState ? " [VIBRATION!]" : " [NORMAL]");

  Serial.print("Distance    : ");
  if (distanceValid) {
    Serial.print(lastDistance, 1); Serial.print(" cm");
    Serial.println(obstacleAlertState ? " [OBSTACLE DETECTED!]" : " [TRACK CLEAR]");
  } else {
    Serial.println("ULTRASONIC DATA UNAVAILABLE (No echo / out of range)");
  }

  Serial.print("GPS Fix     : ");
  if (gpsFixed) {
    Serial.print(lastLatitude, 6); Serial.print(", "); Serial.println(lastLongitude, 6);
  } else {
    Serial.println("GPS UNAVAILABLE (Waiting for satellites)");
  }

  Serial.print("Alert Buzzer: "); Serial.println((gasAlertState || flameAlertState || vibrationAlertState || obstacleAlertState) ? "ON" : "OFF");
  Serial.println("-----------------------------------------");
}

// ==============================================================================================
// 6. HTTP SERVER HANDLERS & CORS HEADERS
// ==============================================================================================

// Set standard CORS headers to permit direct browser dashboard queries from any origin
void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
}

// OPTIONS pre-flight handler
void handleOptions() {
  setCorsHeaders();
  server.send(204);
}

// GET / - Root welcome and hardware diagnostics page
void handleRoot() {
  setCorsHeaders();
  String html = "<!DOCTYPE html><html><head><title>SmartRail ESP32 Monitor</title>";
  html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<style>body{font-family:sans-serif;background:#0d1b22;color:#d8e8ea;padding:30px;line-height:1.6;}";
  html += "h1{color:#41e0ac;} a{display:inline-block;padding:10px 18px;background:#41e0ac;color:#0b1920;text-decoration:none;border-radius:6px;font-weight:bold;}";
  html += "code{background:#142731;padding:4px 8px;border-radius:4px;color:#85e3c7;}";
  html += "</style></head><body>";
  html += "<h1>SmartRail Standalone ESP32 Hardware Monitor</h1>";
  html += "<p>ESP32 DevKit V1 is online and reading physical sensors autonomously.</p>";
  html += "<p><a href='/data'>View Live Sensor JSON (/data)</a></p>";
  html += "<p>Hardware IP: <code>" + WiFi.localIP().toString() + "</code></p>";
  html += "<p>SmartRail dashboard endpoint: <code>http://" + WiFi.localIP().toString() + "/data</code></p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

// GET /data - REAL SENSOR TELEMETRY (JSON)
void handleData() {
  setCorsHeaders();

  // Construct complete JSON string from real sensor readings
  String json = "{";

  // Temperature (float or null)
  json += "\"temperature\":";
  if (dhtValid) {
    json += String(lastTemperature, 1);
  } else {
    json += "null";
  }
  json += ",";

  // Humidity (float or null)
  json += "\"humidity\":";
  if (dhtValid) {
    json += String(lastHumidity, 1);
  } else {
    json += "null";
  }
  json += ",";

  // Vibration (0 or 1)
  json += "\"vibration\":" + String(lastVibration) + ",";

  // Gas / Smoke (raw analog reading 0-4095)
  json += "\"gas\":" + String(lastGasValue) + ",";

  // Flame (digital 0 or 1)
  json += "\"flame\":" + String(lastFlameValue) + ",";

  // Distance (float in cm or null if invalid/out-of-range/disconnected)
  json += "\"distance\":";
  if (distanceValid) {
    json += String(lastDistance, 1);
  } else {
    json += "null";
  }
  json += ",";

  // GPS Latitude & Longitude (double with 6 decimals or null)
  json += "\"latitude\":";
  if (gpsFixed) {
    json += String(lastLatitude, 6);
  } else {
    json += "null";
  }
  json += ",";

  json += "\"longitude\":";
  if (gpsFixed) {
    json += String(lastLongitude, 6);
  } else {
    json += "null";
  }
  json += ",";

  // Real alert boolean flags
  json += "\"gasAlert\":" + String(gasAlertState ? "true" : "false") + ",";
  json += "\"flameAlert\":" + String(flameAlertState ? "true" : "false") + ",";
  json += "\"vibrationAlert\":" + String(vibrationAlertState ? "true" : "false") + ",";
  json += "\"obstacleAlert\":" + String(obstacleAlertState ? "true" : "false");

  json += "}";

  server.send(200, "application/json", json);
}

// Handle 404
void handleNotFound() {
  setCorsHeaders();
  server.send(404, "text/plain", "Endpoint Not Found");
}

// ==============================================================================================
// 7. SETUP & INITIALIZATION
// ==============================================================================================
void setup() {
  // 1. Initialize Serial Monitor
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=========================================");
  Serial.println("  SMARTRAIL ESP32 HARDWARE MONITOR BOOT  ");
  Serial.println("=========================================");

  // 2. Configure Pin Modes per hardware documentation
  pinMode(VIBRATION_PIN, INPUT);        // GPIO 34 (SW-420 DO, Input-only)
  pinMode(MQ2_PIN,       INPUT);        // GPIO 35 (MQ-2 AO Analog ADC1_CH7)
  pinMode(FLAME_PIN,     INPUT_PULLUP); // GPIO 32 (Flame DO Active LOW)

  pinMode(TRIG_PIN,      OUTPUT);       // GPIO 33 (HC-SR04 TRIG)
  pinMode(ECHO_PIN,      INPUT);        // GPIO 25 (HC-SR04 ECHO via 1k/2k voltage divider)
  digitalWrite(TRIG_PIN, LOW);

  pinMode(BUZZER_PIN,    OUTPUT);       // GPIO 27 (Buzzer)
  pinMode(LED_PIN,       OUTPUT);       // GPIO 26 (LED)
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN,    LOW);

  // ESP32-CAM Serial connection pins
  pinMode(CAM_TX_PIN,    OUTPUT);       // GPIO 18 -> ESP32-CAM UOR (RX)
  pinMode(CAM_RX_PIN,    INPUT);        // GPIO 19 <- ESP32-CAM UOT (TX)

  // 3. Initialize DHT22
  Serial.println("[SETUP] Initializing DHT22 sensor on GPIO 4...");
  dht.begin();

  // 4. Initialize HardwareSerial UART2 for GPS on GPIO 12 (RX) and GPIO 14 (TX)
  Serial.println("[SETUP] Initializing GPS UART2 (RX=12, TX=14) at 9600 baud...");
  gpsSerial.begin(GPS_BAUD_RATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // 5. Connect to Wi-Fi
  Serial.print("[WIFI] Connecting to: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected");
    Serial.print("ESP32 IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection pending. Check credentials.");
  }

  // 6. Register WebServer Endpoints
  server.on("/", HTTP_GET, handleRoot);
  server.on("/data", HTTP_GET, handleData);
  server.on("/data", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);

  // 7. Start HTTP WebServer
  server.begin();
  Serial.println("[HTTP] WebServer started on port 80");
  Serial.println("[HTTP] Available Endpoints:");
  Serial.println("  -> GET /      (Web Overview)");
  Serial.println("  -> GET /data  (Real Sensor JSON)");
  Serial.println("=========================================\n");
}

// ==============================================================================================
// 8. MAIN LOOP (NON-BLOCKING STANDALONE EXECUTION)
// ==============================================================================================
void loop() {
  // Always service incoming HTTP client requests
  server.handleClient();

  // Ingest any incoming GPS NMEA bytes
  readGPS();

  // Periodically read physical sensors and update alerts
  unsigned long currentMillis = millis();
  if (currentMillis - lastSensorReadTime >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadTime = currentMillis;
    readSensors();
    checkAlerts();
  }

  // Periodic Serial Monitor output
  printSerialDebug();
}
