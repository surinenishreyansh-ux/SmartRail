/*
 * ==============================================================================================
 * SMARTRAIL / RAILWAY INTELLIGENCE — REAL ESP32-CAM LIVE STREAMING FIRMWARE
 * ==============================================================================================
 * 
 * Target Board: AI Thinker ESP32-CAM (OV2640 Camera Module)
 * Architecture: Embedded MJPEG HTTP Streaming Server
 * Target Stream URL for SmartRail Dashboard: http://<ESP32_CAM_IP>/stream
 *
 * HOW IT WORKS:
 * 1. Initializes the OV2640 camera sensor with AI-Thinker pin definitions.
 * 2. Connects to the local Wi-Fi network.
 * 3. Starts an HTTP server on port 80.
 * 4. Serves continuous multipart/x-mixed-replace MJPEG video frames on:
 *      GET /stream
 *    and a single snapshot JPEG on:
 *      GET /capture
 * 5. Serves an onboard HTML diagnostic page on:
 *      GET /
 * 6. Adds CORS headers (Access-Control-Allow-Origin: *) for browser dashboard integration.
 *
 * INSTRUCTIONS FOR UPLOADING:
 * 1. Open this file in Arduino IDE.
 * 2. Go to Tools -> Board -> ESP32 Arduino -> Select "AI Thinker ESP32-CAM".
 * 3. Tools -> CPU Frequency: 240MHz (WiFi/BT).
 * 4. Tools -> Flash Frequency: 80MHz (or 40MHz).
 * 5. Tools -> Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)".
 * 6. Wiring for FTDI / USB-to-TTL programmer:
 *    - FTDI 5V  -> ESP32-CAM 5V (or VCC)
 *    - FTDI GND -> ESP32-CAM GND
 *    - FTDI TX  -> ESP32-CAM U0R (GPIO 3)
 *    - FTDI RX  -> ESP32-CAM U0T (GPIO 1)
 *    - **FLASH MODE:** Connect GPIO 0 to GND before plugging in USB!
 * 7. Click Upload. When "Connecting......" appears, press the RESET button on the ESP32-CAM.
 * 8. After upload finishes: Disconnect GPIO 0 from GND and press RESET.
 * 9. Open Serial Monitor at 115200 baud to read the camera IP address.
 * 10. Copy the IP and set VITE_ESP32_CAM_URL=http://<ESP32_CAM_IP>/stream in your dashboard.
 * ==============================================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ==============================================================================================
// 1. WI-FI CONFIGURATION
// ==============================================================================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ==============================================================================================
// 2. CAMERA PIN DEFINITIONS (AI-THINKER MODEL)
// ==============================================================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Optional onboard flash LED on GPIO 4
#define FLASH_LED_PIN      4

// HTTP Server Handle
httpd_handle_t stream_httpd = NULL;

// Multipart boundary string for MJPEG stream
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ==============================================================================================
// 3. HTTP STREAM HANDLER (MJPEG)
// ==============================================================================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  // Set response headers with CORS wildcard so browser dashboard loads the stream freely
  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "X-Framerate", "25");

  // Frame timing: target ~20fps (50ms/frame) for smooth Wi-Fi streaming
  // Without a delay the ESP32 floods TCP buffers causing stutter & freeze.
  const TickType_t FRAME_DELAY_MS = 50; // 50ms = 20fps max
  TickType_t lastFrameTime = xTaskGetTickCount();

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM ERROR] Camera capture failed!");
      res = ESP_FAIL;
    } else {
      _jpg_buf_len = fb->len;
      _jpg_buf = fb->buf;
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }

    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (res != ESP_OK) {
      break;
    }

    if (res != ESP_OK) {
      break;
    }

    // Pace frame delivery: wait remaining time to hit target frame rate
    TickType_t elapsed = xTaskGetTickCount() - lastFrameTime;
    if (elapsed < pdMS_TO_TICKS(FRAME_DELAY_MS)) {
      vTaskDelay(pdMS_TO_TICKS(FRAME_DELAY_MS) - elapsed);
    }
    lastFrameTime = xTaskGetTickCount();
  }

  return res;
}

// Single JPEG capture endpoint
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM ERROR] Snapshot capture failed!");
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// Diagnostic index page
static esp_err_t index_handler(httpd_req_t *req) {
  const char* html = 
    "<!DOCTYPE html><html><head><title>SmartRail ESP32-CAM</title>"
    "<meta name='viewport' content='width=device-width, initial-scale=1'>"
    "<style>"
    "body{margin:0;background:#0d1b22;color:#dfe9ec;font-family:sans-serif;text-align:center;padding:20px;}"
    "h1{color:#41e0ac;margin-bottom:8px;}"
    ".stream-box{max-width:640px;margin:20px auto;border:2px solid #294552;border-radius:8px;overflow:hidden;box-shadow:0 0 20px rgba(0,0,0,0.5);}"
    "img{width:100%;display:block;}"
    ".badge{display:inline-block;padding:6px 12px;background:#15342c;color:#41e0ac;border-radius:4px;font-size:12px;margin:10px;}"
    "code{background:#1a2e38;padding:4px 8px;border-radius:4px;color:#9fead2;}"
    "</style></head><body>"
    "<h1>SmartRail ESP32-CAM Live View</h1>"
    "<div class='badge'>STREAM ACTIVE (MJPEG)</div>"
    "<div class='stream-box'><img src='/stream' alt='Live Video Stream'></div>"
    "<p>Direct Stream Endpoint: <code>/stream</code></p>"
    "<p>Single JPEG Snapshot: <code>/capture</code></p>"
    "</body></html>";

  httpd_resp_set_type(req, "text/html");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, html, strlen(html));
}

// ==============================================================================================
// 4. HTTP STREAM SERVER START
// ==============================================================================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t capture_uri = {
    .uri       = "/capture",
    .method    = HTTP_GET,
    .handler   = capture_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t index_uri = {
    .uri       = "/",
    .method    = HTTP_GET,
    .handler   = index_handler,
    .user_ctx  = NULL
  };

  Serial.printf("[HTTP] Starting web server on port: '%d'\n", config.server_port);
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &capture_uri);
    httpd_register_uri_handler(stream_httpd, &index_uri);
    Serial.println("[HTTP] Camera stream server online!");
    Serial.println("[HTTP] Stream available at: http://<ESP32_CAM_IP>/stream");
  } else {
    Serial.println("[HTTP] Failed to start camera web server!");
  }
}

// ==============================================================================================
// 5. SETUP & INITIALIZATION
// ==============================================================================================
void setup() {
  // Disable brownout detector to prevent reboot on Wi-Fi current draw peaks
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=========================================");
  Serial.println("  SMARTRAIL ESP32-CAM LIVE STREAM BOOT   ");
  Serial.println("=========================================");

  // Optional onboard flash pin
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW); // Keep flash OFF by default

  // Configure camera hardware parameters
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Frame resolution & quality tuning for smooth Wi-Fi streaming
  // QVGA (320x240) delivers smooth ~20fps over a standard hotspot connection.
  // VGA (640x480) often causes stuttering due to larger frame size per TCP packet.
  if (psramFound()) {
    Serial.println("[CAMERA] PSRAM detected! Frame size: QVGA (320x240) @ quality 10");
    config.frame_size   = FRAMESIZE_QVGA;  // 320x240 — smooth over Wi-Fi
    config.jpeg_quality = 10;              // 0=best 63=worst — lower = better quality
    config.fb_count     = 3;              // Triple-buffering reduces stall on PSRAM
  } else {
    Serial.println("[CAMERA] No PSRAM. Frame size: QVGA (320x240) @ quality 12");
    config.frame_size   = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count     = 2;
  }

  // Camera sensor initialize
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAMERA] Camera init failed with error 0x%x\n", err);
    Serial.println("[CAMERA] Check ribbon cable connection and power supply!");
    return;
  }
  Serial.println("[CAMERA] OV2640 sensor initialized successfully.");

  // Adjust sensor settings for smooth, clear output
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);     // Slightly brighter for indoor
    s->set_contrast(s, 0);       // -2 to 2
    s->set_saturation(s, 0);     // -2 to 2
    s->set_special_effect(s, 0); // 0 = No Effect
    s->set_whitebal(s, 1);       // 1 = enable AWB
    s->set_awb_gain(s, 1);       // 1 = enable AWB gain
    s->set_wb_mode(s, 0);        // 0 = Auto
    s->set_exposure_ctrl(s, 1);  // Auto exposure
    s->set_aec2(s, 1);           // AEC DSP enable for better exposure
    s->set_gain_ctrl(s, 1);      // Auto gain
    s->set_agc_gain(s, 0);       // AGC gain 0-30
    s->set_gainceiling(s, (gainceiling_t)2); // Gain ceiling
    s->set_bpc(s, 1);            // Bad pixel correction
    s->set_wpc(s, 1);            // White pixel correction
    s->set_dcw(s, 1);            // Downsize enable
    s->set_vflip(s, 0);          // Flip vertically if mounted upside down
    s->set_hmirror(s, 0);        // Mirror horizontally
    s->set_lenc(s, 1);           // Lens correction
  }

  // Connect to Wi-Fi with maximum TX power for stable streaming
  Serial.print("[WIFI] Connecting to SSID: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_19_5dBm); // Max TX power for range & stability
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 30) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] ESP32-CAM IP: http://");
    Serial.println(WiFi.localIP());
    Serial.print("[WIFI] Stream URL:   http://");
    Serial.print(WiFi.localIP());
    Serial.println("/stream");
  } else {
    Serial.println("\n[WIFI] Failed to connect to Wi-Fi! Verify credentials.");
  }

  // Start MJPEG HTTP server
  startCameraServer();

  Serial.println("=========================================");
  Serial.println("  ESP32-CAM READY FOR SMARTRAIL STREAM   ");
  Serial.print("  Target URL: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/stream");
  Serial.println("=========================================\n");
}

// ==============================================================================================
// 6. MAIN LOOP
// ==============================================================================================
void loop() {
  // HTTP server runs in background FreeRTOS tasks created by httpd_start()
  delay(1000);
}
