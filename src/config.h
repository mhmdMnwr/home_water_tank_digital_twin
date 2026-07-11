#ifndef CONFIG_H
#define CONFIG_H

// ═══════════════════════════════════════════════════════════════
//  WiFi Configuration
// ═══════════════════════════════════════════════════════════════
#define WIFI_SSID     "IdoomFibre_atkCX5J34"
#define WIFI_PASS     "pJ2juYNp"

// Static IP — the ESP32 will always be at this address
#define STATIC_IP      192, 168, 1, 55
#define GATEWAY_IP     192, 168, 1, 1
#define SUBNET_MASK    255, 255, 255, 0
#define DNS_PRIMARY    8, 8, 8, 8
#define DNS_SECONDARY  8, 8, 4, 4

// ═══════════════════════════════════════════════════════════════
//  Ultrasonic Sensor Pins
// ═══════════════════════════════════════════════════════════════
#define TRIG_PIN  13
#define ECHO_PIN  12

// ═══════════════════════════════════════════════════════════════
//  Sensor Settings
// ═══════════════════════════════════════════════════════════════
#define SENSOR_TIMEOUT_US   30000   // Pulse timeout in µs (~5m max range)
#define NUM_SAMPLES         7       // Samples for median filter (use odd number)
#define SAMPLE_DELAY_MS     10      // Delay between samples (ms)
#define MAX_VALID_DISTANCE  400.0   // Max valid reading in cm

// ═══════════════════════════════════════════════════════════════
//  Spike Filtering
// ═══════════════════════════════════════════════════════════════
#define EMA_ALPHA           0.3     // EMA weight: 0.1=very smooth, 0.5=responsive
#define MAX_CHANGE_CM       5.0     // Max allowed change per reading (cm)
                                    // Rejects spikes bigger than this

// ═══════════════════════════════════════════════════════════════
//  Tank Dimensions (meters)
// ═══════════════════════════════════════════════════════════════
#define TANK_DEPTH_CM  180   // 1.8m — the axis the sensor measures

// ═══════════════════════════════════════════════════════════════
//  Web Server
// ═══════════════════════════════════════════════════════════════
#define WEB_SERVER_PORT  80

#endif // CONFIG_H
