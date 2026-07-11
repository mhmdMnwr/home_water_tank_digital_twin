/*
 * ESP32 Water Tank — Digital Twin Firmware
 *
 * All configuration is in config.h
 * All web content is embedded in web_content.h (PROGMEM)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "config.h"
#include "web_content.h"
#include "embedded/three_js_gz.h"

// ── Network ──
IPAddress local_IP(STATIC_IP);
IPAddress gateway(GATEWAY_IP);
IPAddress subnet(SUBNET_MASK);
IPAddress dns1(DNS_PRIMARY);
IPAddress dns2(DNS_SECONDARY);

WebServer server(WEB_SERVER_PORT);

// ── Sensor state (non-blocking) ──
float lastDistance = -1.0;
float emaDistance   = -1.0;   // EMA-filtered distance
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL = 500;  // Read sensor every 500ms

// ═══════════════════════════════════════════════════════════════
//  ULTRASONIC SENSOR — 3-Stage Spike Filter
//  Stage 1: Median filter (kills outlier spikes)
//  Stage 2: EMA smoothing (removes jitter)
//  Stage 3: Change clamping (rejects impossible jumps)
// ═══════════════════════════════════════════════════════════════

float readSingleDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, SENSOR_TIMEOUT_US);

  if (duration == 0) {
    return -1.0;
  }

  return duration * 0.0343 / 2.0;
}

// Simple insertion sort for small arrays (NUM_SAMPLES ≤ 11)
void sortArray(float arr[], int n) {
  for (int i = 1; i < n; i++) {
    float key = arr[i];
    int j = i - 1;
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = key;
  }
}

// Called in loop() — reads sensor without blocking web server
void updateSensor() {
  if (millis() - lastSensorRead < SENSOR_INTERVAL) return;
  lastSensorRead = millis();

  // ── Stage 1: Collect samples and take MEDIAN ──
  float samples[NUM_SAMPLES];
  int validCount = 0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    float d = readSingleDistance();
    if (d > 0 && d < MAX_VALID_DISTANCE) {
      samples[validCount++] = d;
    }
    delayMicroseconds(500);  // Tiny delay between samples
  }

  if (validCount == 0) {
    // All readings failed — keep last known value
    Serial.printf("[SENSOR] NO VALID READINGS  (kept %.1f cm)\n", lastDistance);
    return;
  }

  // Sort valid samples and pick the median
  sortArray(samples, validCount);
  float median = samples[validCount / 2];

  // ── Stage 2: EMA smoothing ──
  float filtered;
  if (emaDistance < 0) {
    // First valid reading — initialize EMA
    emaDistance = median;
    filtered = median;
  } else {
    emaDistance = EMA_ALPHA * median + (1.0 - EMA_ALPHA) * emaDistance;
    filtered = emaDistance;
  }

  // ── Stage 3: Spike clamping ──
  if (lastDistance > 0) {
    float change = fabs(filtered - lastDistance);
    if (change > MAX_CHANGE_CM) {
      // Spike detected — clamp to max allowed change
      if (filtered > lastDistance) {
        filtered = lastDistance + MAX_CHANGE_CM;
      } else {
        filtered = lastDistance - MAX_CHANGE_CM;
      }
      emaDistance = filtered;  // Reset EMA to clamped value
      Serial.printf("[FILTER] SPIKE CLAMPED  median=%.1f → clamped=%.1f cm\n",
                    median, filtered);
    }
  }

  lastDistance = filtered;

  Serial.printf("[SENSOR] raw_median=%.1f  ema=%.1f  final=%.1f cm  valid=%d/%d\n",
                median, emaDistance, lastDistance, validCount, NUM_SAMPLES);
}

// ═══════════════════════════════════════════════════════════════
//  REQUEST HANDLERS — with full serial logging
// ═══════════════════════════════════════════════════════════════

void servePROGMEM(const char* contentType, const char* pgmContent) {
  size_t len = strlen(pgmContent);
  server.setContentLength(len);
  server.send(200, contentType, "");

  const size_t CHUNK_SIZE = 2048;
  size_t sent = 0;
  while (sent < len) {
    size_t toSend = len - sent;
    if (toSend > CHUNK_SIZE) toSend = CHUNK_SIZE;
    server.sendContent(pgmContent + sent, toSend);
    sent += toSend;
  }
  Serial.printf("[SERVE] %s  (%d bytes)\n", contentType, (int)len);
}

void handleRoot() {
  Serial.println("[REQ] GET /");
  servePROGMEM("text/html", PAGE_HTML);
}

void handleCSS() {
  Serial.println("[REQ] GET /water_tank.css");
  servePROGMEM("text/css", PAGE_CSS);
}

void handleJS() {
  Serial.println("[REQ] GET /water_tank.js");
  servePROGMEM("application/javascript", PAGE_JS);
}

void handleThreeJS() {
  Serial.printf("[REQ] GET /three.min.js  (%d bytes gzipped)\n", (int)THREE_JS_GZ_LEN);
  server.sendHeader("Content-Encoding", "gzip");
  server.sendHeader("Cache-Control", "public, max-age=31536000");  // Cache 1 year
  server.setContentLength(THREE_JS_GZ_LEN);
  server.send(200, "application/javascript", "");

  const size_t CHUNK_SIZE = 2048;
  size_t sent = 0;
  while (sent < THREE_JS_GZ_LEN) {
    size_t toSend = THREE_JS_GZ_LEN - sent;
    if (toSend > CHUNK_SIZE) toSend = CHUNK_SIZE;
    server.sendContent((const char*)(THREE_JS_GZ + sent), toSend);
    sent += toSend;
  }
}

void handleSensor() {
  Serial.printf("[REQ] GET /api/sensor  → %.1f cm\n", lastDistance);

  char json[128];
  snprintf(json, sizeof(json), 
           "{\"distance_cm\":%.1f,\"tank_depth_cm\":%d,\"sensor_ok\":%s}", 
           lastDistance, TANK_DEPTH_CM, lastDistance > 0 ? "true" : "false");

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-cache");
  server.send(200, "application/json", json);
}

void handleDebug() {
  Serial.println("[REQ] GET /api/debug");
  char info[256];
  snprintf(info, sizeof(info), 
           "{\"heap_free\":%u,\"html_len\":%u,\"css_len\":%u,\"js_len\":%u,\"last_distance\":%.1f,\"uptime_ms\":%lu}",
           ESP.getFreeHeap(), (unsigned int)strlen(PAGE_HTML), (unsigned int)strlen(PAGE_CSS), 
           (unsigned int)strlen(PAGE_JS), lastDistance, millis());
           
  server.send(200, "application/json", info);
}

void handleFavicon() {
  server.send(204);
}

void handleNotFound() {
  Serial.printf("[404] %s\n", server.uri().c_str());
  server.send(404, "text/plain", "404 Not Found");
}

// ═══════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("══════════════════════════════════");
  Serial.println("  ESP32 Water Tank — Digital Twin");
  Serial.println("══════════════════════════════════");

  // Sensor pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.printf("[OK] Sensor pins: TRIG=%d, ECHO=%d\n", TRIG_PIN, ECHO_PIN);

  // Initial sensor test
  float testDist = readSingleDistance();
  Serial.printf("[TEST] Initial sensor read: %.1f cm %s\n",
                testDist, testDist > 0 ? "(OK)" : "(NO ECHO — sensor may not be connected)");

  // Configure static IP
  if (!WiFi.config(local_IP, gateway, subnet, dns1, dns2)) {
    Serial.println("[ERROR] Static IP configuration failed!");
  }

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.printf("[OK] WiFi connected!\n");
    Serial.printf("[OK] IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[OK] Dashboard:  http://%s/\n", WiFi.localIP().toString().c_str());
    Serial.printf("[OK] Debug:      http://%s/api/debug\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println();
    Serial.println("[ERROR] WiFi connection failed!");
    Serial.println("[INFO]  Check WIFI_SSID and WIFI_PASS in config.h");
    return;
  }

  // Register routes
  server.on("/",                handleRoot);
  server.on("/water_tank.html", handleRoot);
  server.on("/water_tank.css",  handleCSS);
  server.on("/water_tank.js",   handleJS);
  server.on("/three.min.js",    handleThreeJS);
  server.on("/api/sensor",      handleSensor);
  server.on("/api/debug",       handleDebug);
  server.on("/favicon.ico",     handleFavicon);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.printf("[OK] Web server started on port %d\n", WEB_SERVER_PORT);
  Serial.println("[OK] Heap free: " + String(ESP.getFreeHeap()) + " bytes");
  Serial.println("══════════════════════════════════");
  Serial.println();
  Serial.println("[READY] Waiting for browser connections...");
  Serial.println();
}

// ═══════════════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════════════

unsigned long lastWifiCheck = 0;

void loop() {
  // Check WiFi connection every 10 seconds
  if (millis() - lastWifiCheck >= 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Disconnected! Attempting reconnection...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      // Let it connect asynchronously in the background
    }
  }

  server.handleClient();
  updateSensor();  // Non-blocking — reads sensor every 500ms
}