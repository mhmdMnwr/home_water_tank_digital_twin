PlatformIO project — venv recommended

Quick steps to build and upload using the project's Python virtualenv (recommended):

1. Create and activate the venv (only if not present):

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -U pip setuptools wheel
pip install platformio intelhex
```

2. Build:

```bash
.venv/bin/platformio run
```

3. Upload (adjust port if needed):

```bash
.venv/bin/platformio run --target upload --upload-port /dev/ttyUSB0
```

VS Code: use the provided tasks (`PlatformIO: Build (venv)`, `PlatformIO: Upload (venv)`).

Alternative: install `python3-intelhex` system package to satisfy esptool dependency.
