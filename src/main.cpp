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
#include <PubSubClient.h>

// ── Network ──
IPAddress local_IP(STATIC_IP);
IPAddress gateway(GATEWAY_IP);
IPAddress subnet(SUBNET_MASK);
IPAddress dns1(DNS_PRIMARY);
IPAddress dns2(DNS_SECONDARY);

WebServer server(WEB_SERVER_PORT);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ── Sensor state (non-blocking) ──
float lastDistance = -1.0;
float emaDistance   = -1.0;   // EMA-filtered distance
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL = 500;  // Read sensor every 500ms

bool isFilling = false;
float lastStableDistance = -1.0;
const float FILL_DELTA_CM = 3.6; // Trigger filling arrows if distance drops by 3.6cm

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

  if (lastStableDistance < 0) {
    lastStableDistance = filtered;
    isFilling = false;
  } else {
    float delta = filtered - lastStableDistance;
    if (delta <= -FILL_DELTA_CM) { // Distance dropped, water level rising
      isFilling = true;
      lastStableDistance = filtered;
    } else if (delta >= FILL_DELTA_CM) { // Distance rose or stable, water level dropping/stable
      isFilling = false;
      lastStableDistance = filtered;
    }
  }

  Serial.printf("[SENSOR] raw_median=%.1f  ema=%.1f  final=%.1f cm  valid=%d/%d\n",
                median, emaDistance, lastDistance, validCount, NUM_SAMPLES);
}

// ═══════════════════════════════════════════════════════════════
//  REQUEST HANDLERS — with full serial logging
// ═══════════════════════════════════════════════════════════════

// HTTP endpoints for serving static files removed because we are only using the cloud dashboard now.

void handleSensor() {
  Serial.printf("[REQ] GET /api/sensor  → %.1f cm\n", lastDistance);

  char json[128];
  snprintf(json, sizeof(json), 
           "{\"distance_cm\":%.1f,\"tank_depth_cm\":%d,\"sensor_ok\":%s,\"is_filling\":%s}", 
           lastDistance, TANK_DEPTH_CM, lastDistance > 0 ? "true" : "false", isFilling ? "true" : "false");

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-cache");
  server.send(200, "application/json", json);
}

void handleDebug() {
  Serial.println("[REQ] GET /api/debug");
  char info[256];
  snprintf(info, sizeof(info), 
           "{\"heap_free\":%u,\"last_distance\":%.1f,\"uptime_ms\":%lu}",
           ESP.getFreeHeap(), lastDistance, millis());
           
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

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);

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

  // Register API routes
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
unsigned long lastMqttPublish = 0;

void reconnectMQTT() {
  if (WiFi.status() == WL_CONNECTED && !mqttClient.connected()) {
    Serial.print("[MQTT] Attempting connection to ");
    Serial.print(MQTT_BROKER);
    Serial.print("...");
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println(" connected");
    } else {
      Serial.print(" failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" - will try again later");
    }
  }
}

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

  // Non-blocking MQTT reconnect (every 5 seconds if disconnected)
  if (!mqttClient.connected() && millis() - lastWifiCheck >= 5000) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Publish telemetry every MQTT_PUBLISH_MS
  if (mqttClient.connected() && millis() - lastMqttPublish >= MQTT_PUBLISH_MS) {
    lastMqttPublish = millis();
    char payload[128];
    snprintf(payload, sizeof(payload), 
             "{\"distance_cm\":%.1f,\"tank_depth_cm\":%d,\"sensor_ok\":%s,\"is_filling\":%s}", 
             lastDistance, TANK_DEPTH_CM, lastDistance > 0 ? "true" : "false", isFilling ? "true" : "false");
    mqttClient.publish(MQTT_TOPIC, payload);
    Serial.printf("[MQTT] Published: %s\n", payload);
  }
}