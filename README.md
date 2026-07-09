# 3D Water Tank — Digital Twin

Real-time 3D water tank monitoring dashboard running on an **ESP32** with a waterproof **HC-SR04 ultrasonic sensor**. The web dashboard is embedded directly in the firmware — just flash and go.

---

## 📐 Tank Specifications

| Dimension | Value | Notes |
|-----------|-------|-------|
| **Width** | 3.5 m | Fixed |
| **Height** | 1.7 m | Fixed |
| **Depth** | 1.8 m | Variable (water level axis) |
| **Max Capacity** | 10,710 L | 3.5 × 1.7 × 1.8 × 1000 |

---

## 🏗️ Architecture

```
┌──────────────────────┐        HTTP/JSON         ┌─────────────────────┐
│       ESP32          │ ◄──────────────────────── │   Browser (Any)     │
│                      │                           │                     │
│  ┌────────────────┐  │   GET /                   │  3D Tank Viz        │
│  │ HC-SR04 Sensor │──┤   GET /water_tank.css     │  (Three.js)         │
│  │ (Ultrasonic)   │  │   GET /water_tank.js      │                     │
│  └────────────────┘  │   GET /api/sensor ─────►  │  Calculates:        │
│                      │   {"distance_cm": 45.2}   │  depth = 1.8 - dist │
│  Web files embedded  │                           │  pct = depth / 1.8  │
│  in firmware (PROGMEM)│                          │  vol = W×H×D × 1000 │
│                      │                           └─────────────────────┘
│  WiFi: 192.168.1.55  │
└──────────────────────┘
```

**The ESP32 only sends the raw ultrasonic distance.** All calculation is done in the browser:

```
water_depth_m  = 1.8 - (distance_cm / 100)
percentage     = water_depth_m / 1.8 × 100
volume_liters  = 3.5 × 1.7 × water_depth_m × 1000
```

---

## 🔌 Wiring

| HC-SR04 Pin | ESP32 Pin | Notes |
|-------------|-----------|-------|
| VCC | 5V (VIN) | Sensor needs 5V |
| GND | GND | Common ground |
| TRIG | GPIO 13 | Trigger pulse |
| ECHO | GPIO 12 | ⚠️ Use voltage divider (5V → 3.3V) |

> **⚠️ WARNING:** The HC-SR04 ECHO pin outputs 5V. Use a voltage divider (1kΩ + 2kΩ) to protect the ESP32:
> ```
> ECHO ──┤ 1kΩ ├──┬── GPIO 12
>                  │
>                 ┤ 2kΩ ├
>                  │
>                 GND
> ```

Mount the ultrasonic sensor at the **top of the tank**, facing downward. Use a **waterproof** variant (JSN-SR04T recommended).

---

## 📁 Project Structure

```
tank_water_indicator/
├── platformio.ini              # PlatformIO configuration
├── src/
│   ├── main.cpp                # ESP32 firmware (WiFi + WebServer + Sensor)
│   ├── config.h                # ⚙️ WiFi credentials, pins, settings
│   └── web_content.h           # 📦 Embedded web files (PROGMEM)
├── 3d_water_tank/              # Web source files (for development/preview)
│   ├── water_tank.html
│   ├── water_tank.css
│   └── water_tank.js
└── README.md
```

**Everything is in `src/`** — no filesystem upload needed. The web files are embedded as PROGMEM strings in `web_content.h` and flashed together with the firmware.

---

## 🚀 Setup & Flash

### 1. Configure WiFi

Edit **`src/config.h`**:

```cpp
#define WIFI_SSID     "YourNetworkName"
#define WIFI_PASS     "YourPassword"

// Static IP (change if needed)
#define STATIC_IP      192, 168, 1, 55
#define GATEWAY_IP     192, 168, 1, 1
```

### 2. Build & Upload

```bash
pio run --target upload
```

That's it. One command. The web dashboard is embedded in the firmware.

### 3. Open Dashboard

Open **http://192.168.1.55** in any browser on the same network.

Serial Monitor output:
```
══════════════════════════════════
  ESP32 Water Tank — Digital Twin
══════════════════════════════════
[OK] Sensor pins: TRIG=13, ECHO=12
[OK] WiFi connected!
[OK] IP Address: 192.168.1.55
[OK] Dashboard:  http://192.168.1.55/
[OK] Web server started on port 80
══════════════════════════════════
```

---

## 🖥️ Dashboard Features

| Feature | Description |
|---------|-------------|
| **3D Tank** | Interactive cylindrical tank (Three.js) |
| **Drag to Rotate** | Click/touch drag to rotate the model |
| **Live Sensor** | Polls `/api/sensor` every 2 seconds |
| **Water Level %** | Calculated from ultrasonic distance |
| **Volume (L)** | Real volume from actual tank dimensions |
| **Low Alert** | Red warning when water < 25% |
| **Connection Badge** | Shows Live / Offline sensor status |
| **Manual Slider** | Override when sensor is offline |
| **Waves & Bubbles** | Animated water surface and particles |

---

## 🔧 API

### `GET /api/sensor`

```json
{
  "distance_cm": 45.2,
  "tank_depth_cm": 180,
  "sensor_ok": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `distance_cm` | float | Air gap from sensor to water (cm). `-1` on error |
| `tank_depth_cm` | int | Total tank depth (always 180) |
| `sensor_ok` | bool | `true` if reading is valid |

---

## 🧪 Local Web Preview

Preview the dashboard without hardware:

```bash
cd 3d_water_tank
python3 -m http.server 8000
# Open http://localhost:8000/water_tank.html
```

The slider works as manual input when the sensor is offline.

---

## 🔄 Updating Web Content

If you edit the web source files in `3d_water_tank/`:

1. Edit `water_tank.html`, `.css`, or `.js`
2. Regenerate the PROGMEM header:
   ```bash
   # From the project root
   python3 -c "
   import os
   files = {'PAGE_HTML': '3d_water_tank/water_tank.html',
            'PAGE_CSS':  '3d_water_tank/water_tank.css',
            'PAGE_JS':   '3d_water_tank/water_tank.js'}
   with open('src/web_content.h', 'w') as out:
       out.write('#ifndef WEB_CONTENT_H\n#define WEB_CONTENT_H\n\n')
       for name, path in files.items():
           content = open(path).read()
           out.write(f'const char {name}[] PROGMEM = R\"rawliteral(\n{content})rawliteral\";\n\n')
       out.write('#endif\n')
   print('web_content.h regenerated')
   "
   ```
3. Flash: `pio run --target upload`

---

## ⚙️ Configuration Reference

All settings are in **`src/config.h`**:

| Setting | Default | Description |
|---------|---------|-------------|
| `WIFI_SSID` | `"YOUR_WIFI_SSID"` | WiFi network name |
| `WIFI_PASS` | `"YOUR_WIFI_PASSWORD"` | WiFi password |
| `STATIC_IP` | `192, 168, 1, 55` | ESP32 IP address |
| `TRIG_PIN` | `13` | Ultrasonic trigger GPIO |
| `ECHO_PIN` | `12` | Ultrasonic echo GPIO |
| `NUM_SAMPLES` | `5` | Readings averaged per request |
| `TANK_DEPTH_CM` | `180` | Tank depth in cm |

---

## 📝 License

MIT
