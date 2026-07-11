/**
 * 3D Water Tank — Digital Twin
 *
 * Real tank: 3.5m width × 1.7m height × 1.8m depth
 * Depth is the variable dimension (water level direction).
 * ESP32 ultrasonic sensor measures distance from top to water surface.
 * Water depth (m) = TANK_DEPTH - sensor_distance
 * Percentage = water_depth / TANK_DEPTH × 100
 *
 * The web app fetches raw distance from /api/sensor and calculates locally.
 * Slider acts as manual override when sensor is offline (demo mode).
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── Real tank dimensions (meters) ──
  const TANK_WIDTH = 3.5;    // fixed
  const TANK_HEIGHT = 1.7;   // fixed
  const TANK_DEPTH = 1.8;    // variable (water fills this axis)
  // Max capacity in liters
  const CAPACITY = TANK_WIDTH * TANK_HEIGHT * TANK_DEPTH * 1000; // 10,710 L

  // ── 3D visual dimensions (scaled for display) ──
  const SCALE = 1.5;
  const VIS_W = 3.5 / SCALE;
  const VIS_H = 1.8 / SCALE;
  const VIS_D = 1.7 / SCALE;
  const WAVE_AMP = 0.012;
  const WATER_SEG = 32;
  const LOW_THRESH = 0.25;

  // ── Sensor config ──
  const SENSOR_POLL_MS = 2000;
  let sensorActive = false;
  let sensorFails = 0;

  // ── State ──
  let waterLevel = 0;
  let targetLevel = 0;
  let clock = 0;

  // Drag rotation
  let isDragging = false;
  let prevMouse = { x: 0, y: 0 };
  let velX = 0, velY = 0;

  // Three.js refs
  let scene, camera, renderer;
  let tankGroup, waterGeo, waterSurface, waterBody;
  let blueLight;
  let bubbleArr = [];
  let causticsArr = [];
  
  // Hatch door state
  let hatchDoorGroup, hatchDoorMesh;
  let doorOpen = true;
  let targetDoorAngle = -Math.PI / 2.5;
  let currentDoorAngle = -Math.PI / 2.5;
  let raycaster, mouse;

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════
  function init() {
    var lt = document.getElementById('loadingText');
    function step(msg) { if (lt) lt.textContent = msg; }
    try {
      step('Checking Three.js...');
      if (typeof THREE === 'undefined') {
        throw new Error('Three.js not loaded. Check internet connection.');
      }
      step('Creating renderer...');
      setupRenderer();
      step('Setting up scene...');
      setupScene();
      step('Adding lights...');
      setupLights();
      step('Building tank...');
      buildTank();
      step('Creating water...');
      buildWater();
      step('Adding bubbles...');
      buildBubbles();
      step('Adding caustics...');
      buildCaustics();
      step('Setting up controls...');
      setupDrag();
      step('Binding slider...');
      bindSlider();
      step('Syncing UI...');
      syncUI(waterLevel);
      step('Connecting sensor...');
      startSensorPolling();
      step('Ready!');
      setTimeout(function() {
        document.getElementById('loadingOverlay').classList.add('hidden');
      }, 700);
      animate();
    } catch (err) {
      step('ERROR: ' + err.message);
      if (lt) lt.style.color = '#f43f5e';
      console.error('Init failed:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SENSOR POLLING
  // ══════════════════════════════════════════════════════════════
  function startSensorPolling() {
    fetchSensor(); // first call immediately
    setInterval(fetchSensor, SENSOR_POLL_MS);
  }

  function fetchSensor() {
    fetch('/api/sensor')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((data) => {
        const distanceCm = data.distance_cm;
        if (distanceCm < 0) return; // sensor error, ignore

        // Calculate water depth: total depth minus air gap
        const distanceM = distanceCm / 100;
        const waterDepthM = Math.max(0, Math.min(TANK_DEPTH, TANK_DEPTH - distanceM));
        const pct = waterDepthM / TANK_DEPTH;

        targetLevel = pct;
        sensorActive = true;
        sensorFails = 0;

        // Update slider to match sensor (visual feedback)
        $('waterLevel').value = Math.round(pct * 100);

        // Disable manual slider while sensor is live
        $('sliderPanel').classList.add('live-mode');

        updateConnBadge('live', 'Sensor Live');
      })
      .catch(() => {
        sensorFails++;
        if (sensorFails >= 3) {
          sensorActive = false;
          $('sliderPanel').classList.remove('live-mode');
          updateConnBadge('offline', 'Sensor Offline');
        }
      });
  }

  function updateConnBadge(state, text) {
    const badge = $('connBadge');
    badge.className = 'conn-badge ' + state;
    $('connText').textContent = text;
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDERER
  // ══════════════════════════════════════════════════════════════
  function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas: $('tankCanvas'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x080c18, 1);
  }

  function setupScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.5, 4.5);
    camera.lookAt(0, 0, 0);

    function updateCameraZ() {
      const aspect = window.innerWidth / window.innerHeight;
      if (aspect < 0.6) {
        camera.position.z = 7.5;
      } else if (aspect < 1.0) {
        camera.position.z = 6.0;
      } else {
        camera.position.z = 4.5;
      }
    }
    updateCameraZ();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      updateCameraZ();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ── Lights ──
  function setupLights() {
    scene.add(new THREE.AmbientLight(0x203050, 1.1));
    const dir = new THREE.DirectionalLight(0xc8e0ff, 1.8);
    dir.position.set(5, 10, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    scene.add(dir);
    blueLight = new THREE.PointLight(0x0077ff, 3.0, 20);
    blueLight.position.set(-5, 5, -4);
    scene.add(blueLight);
    const pl1 = new THREE.PointLight(0x00ccff, 1.5, 16);
    pl1.position.set(4, -2, 5);
    scene.add(pl1);
    const pl2 = new THREE.PointLight(0x002266, 1.2, 10);
    pl2.position.set(0, -4, 0);
    scene.add(pl2);
  }

  // ══════════════════════════════════════════════════════════════
  //  CYLINDRICAL TANK
  // ══════════════════════════════════════════════════════════════
  function buildTank() {
    tankGroup = new THREE.Group();
    tankGroup.rotation.y = 0.4;
    scene.add(tankGroup);

    const wallMat = new THREE.MeshPhysicalMaterial({
      color: 0x99ccff, transparent: true, opacity: 0.15,
      roughness: 0.02, metalness: 0.0, transmission: 0.7,
      thickness: 0.4, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.05, depthWrite: false,
    });
    
    // Front, Back, Right, Left walls
    const wallZ = new THREE.Mesh(new THREE.PlaneGeometry(VIS_W, VIS_H), wallMat);
    wallZ.position.z = VIS_D / 2;
    tankGroup.add(wallZ);
    const wallZ2 = new THREE.Mesh(new THREE.PlaneGeometry(VIS_W, VIS_H), wallMat);
    wallZ2.position.z = -VIS_D / 2;
    wallZ2.rotation.y = Math.PI;
    tankGroup.add(wallZ2);
    
    const wallX = new THREE.Mesh(new THREE.PlaneGeometry(VIS_D, VIS_H), wallMat);
    wallX.position.x = VIS_W / 2;
    wallX.rotation.y = Math.PI / 2;
    tankGroup.add(wallX);
    const wallX2 = new THREE.Mesh(new THREE.PlaneGeometry(VIS_D, VIS_H), wallMat);
    wallX2.position.x = -VIS_W / 2;
    wallX2.rotation.y = -Math.PI / 2;
    tankGroup.add(wallX2);

    // Bottom rect
    const botDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(VIS_W, VIS_D),
      new THREE.MeshPhysicalMaterial({ color: 0x2a3a4a, transparent: true, opacity: 0.6, roughness: 0.2, side: THREE.DoubleSide })
    );
    botDisc.rotation.x = -Math.PI / 2;
    botDisc.position.y = -VIS_H / 2;
    tankGroup.add(botDisc);

    // Rims & Structural edges
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
    
    function createFrame(y, offset) {
      const gX = new THREE.BoxGeometry(VIS_W + offset, offset, offset);
      const gZ = new THREE.BoxGeometry(offset, offset, VIS_D + offset);
      
      const r1 = new THREE.Mesh(gX, rimMat); r1.position.set(0, y, (VIS_D + offset) / 2); tankGroup.add(r1);
      const r2 = new THREE.Mesh(gX, rimMat); r2.position.set(0, y, -(VIS_D + offset) / 2); tankGroup.add(r2);
      const r3 = new THREE.Mesh(gZ, rimMat); r3.position.set((VIS_W + offset) / 2, y, 0); tankGroup.add(r3);
      const r4 = new THREE.Mesh(gZ, rimMat); r4.position.set(-(VIS_W + offset) / 2, y, 0); tankGroup.add(r4);
    }
    createFrame(VIS_H / 2, 0.04);
    createFrame(-VIS_H / 2, 0.04);
    createFrame(VIS_H / 2 + 0.04, 0.022); // Top lip

    // Vertical pillars
    function createPillar(x, z) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, VIS_H + 0.08, 0.04),
        rimMat
      );
      p.position.set(x, 0, z);
      tankGroup.add(p);
    }
    createPillar(VIS_W/2 + 0.02, VIS_D/2 + 0.02);
    createPillar(-VIS_W/2 - 0.02, VIS_D/2 + 0.02);
    createPillar(VIS_W/2 + 0.02, -VIS_D/2 - 0.02);
    createPillar(-VIS_W/2 - 0.02, -VIS_D/2 - 0.02);

    // Measurement rings
    [0.25, 0.5, 0.75].forEach((lvl) => {
      const y = -VIS_H / 2 + lvl * VIS_H;
      const gX = new THREE.BoxGeometry(VIS_W, 0.01, 0.01);
      const gZ = new THREE.BoxGeometry(0.01, 0.01, VIS_D);
      const mat = new THREE.MeshBasicMaterial({ color: 0x667788, transparent: true, opacity: 0.25 });
      
      const r1 = new THREE.Mesh(gX, mat); r1.position.set(0, y, VIS_D / 2); tankGroup.add(r1);
      const r2 = new THREE.Mesh(gX, mat); r2.position.set(0, y, -VIS_D / 2); tankGroup.add(r2);
      const r3 = new THREE.Mesh(gZ, mat); r3.position.set(VIS_W / 2, y, 0); tankGroup.add(r3);
      const r4 = new THREE.Mesh(gZ, mat); r4.position.set(-VIS_W / 2, y, 0); tankGroup.add(r4);
    });

    // Top Cover
    const hW = 0.45;
    const hD = 0.5;
    const cX = -VIS_W / 4;
    const cZ = 0;
    
    // Left piece
    const w1 = VIS_W / 2 + cX - hW / 2;
    const leftP = new THREE.Mesh(new THREE.PlaneGeometry(w1, VIS_D), wallMat);
    leftP.rotation.x = -Math.PI / 2;
    leftP.position.set(-VIS_W / 2 + w1 / 2, VIS_H / 2, 0);
    tankGroup.add(leftP);
    
    // Right piece
    const w2 = VIS_W / 2 - (cX + hW / 2);
    const rightP = new THREE.Mesh(new THREE.PlaneGeometry(w2, VIS_D), wallMat);
    rightP.rotation.x = -Math.PI / 2;
    rightP.position.set(VIS_W / 2 - w2 / 2, VIS_H / 2, 0);
    tankGroup.add(rightP);
    
    // Back piece
    const d1 = VIS_D / 2 - hD / 2;
    const backP = new THREE.Mesh(new THREE.PlaneGeometry(hW, d1), wallMat);
    backP.rotation.x = -Math.PI / 2;
    backP.position.set(cX, VIS_H / 2, -VIS_D / 2 + d1 / 2);
    tankGroup.add(backP);
    
    // Front piece
    const frontP = new THREE.Mesh(new THREE.PlaneGeometry(hW, d1), wallMat);
    frontP.rotation.x = -Math.PI / 2;
    frontP.position.set(cX, VIS_H / 2, VIS_D / 2 - d1 / 2);
    tankGroup.add(frontP);
    
    // Hatch Frame
    const t = 0.04;
    const fgX = new THREE.BoxGeometry(hW + t, t, t);
    const fgZ = new THREE.BoxGeometry(t, t, hD - t);
    const hY = VIS_H / 2 + t / 2;
    
    const f1 = new THREE.Mesh(fgX, rimMat); f1.position.set(cX, hY, cZ + hD/2); tankGroup.add(f1);
    const f2 = new THREE.Mesh(fgX, rimMat); f2.position.set(cX, hY, cZ - hD/2); tankGroup.add(f2);
    const f3 = new THREE.Mesh(fgZ, rimMat); f3.position.set(cX + hW/2, hY, cZ); tankGroup.add(f3);
    const f4 = new THREE.Mesh(fgZ, rimMat); f4.position.set(cX - hW/2, hY, cZ); tankGroup.add(f4);
    
    // Hatch Door (basement style)
    hatchDoorGroup = new THREE.Group();
    hatchDoorGroup.position.set(cX, hY + t / 2, cZ - hD/2); // hinge at back
    hatchDoorGroup.rotation.x = currentDoorAngle; // open angle
    
    const doorDepth = hD + t;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, metalness: 0.3, roughness: 0.7 });
    hatchDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(hW + t, 0.02, doorDepth), doorMat);
    hatchDoorMesh.position.set(0, 0.01, doorDepth / 2); 
    hatchDoorGroup.add(hatchDoorMesh);
    
    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), new THREE.MeshStandardMaterial({color: 0x222222, metalness: 0.9, roughness: 0.1}));
    handle.position.set(0, 0.03, doorDepth - 0.06);
    hatchDoorGroup.add(handle);
    
    tankGroup.add(hatchDoorGroup);
  }

  // ══════════════════════════════════════════════════════════════
  //  WATER
  // ══════════════════════════════════════════════════════════════
  function buildWater() {
    // Rectangular water surface
    waterGeo = new THREE.PlaneGeometry(VIS_W - 0.02, VIS_D - 0.02, WATER_SEG, Math.floor(WATER_SEG * (VIS_D / VIS_W)));
    waterSurface = new THREE.Mesh(waterGeo, new THREE.MeshPhysicalMaterial({
      color: 0x003a8a, transparent: true, opacity: 0.88,
      metalness: 0.05, roughness: 0.04, side: THREE.DoubleSide, depthWrite: false,
    }));
    waterSurface.rotation.x = -Math.PI / 2;
    waterSurface.position.y = -VIS_H / 2 + waterLevel * VIS_H;
    tankGroup.add(waterSurface);
    rebuildBody(waterLevel);
  }

  function rebuildBody(lvl) {
    if (waterBody) { tankGroup.remove(waterBody); waterBody.geometry.dispose(); }
    const h = Math.max(0.001, lvl * VIS_H);
    waterBody = new THREE.Mesh(
      new THREE.BoxGeometry(VIS_W - 0.02, h, VIS_D - 0.02),
      new THREE.MeshPhysicalMaterial({
        color: 0x002e7a, transparent: true, opacity: 0.42,
        roughness: 0.08, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    waterBody.position.y = -VIS_H / 2 + h / 2;
    waterBody.renderOrder = 1;
    tankGroup.add(waterBody);
  }

  // ── Bubbles ──
  function buildBubbles() {
    const geo = new THREE.SphereGeometry(0.009, 7, 7);
    bubbleArr = Array.from({ length: 50 }, () => {
      const rx = (Math.random() - 0.5) * (VIS_W * 0.9);
      const rz = (Math.random() - 0.5) * (VIS_D * 0.9);
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0x88ddff, transparent: true, opacity: 0.4, roughness: 0.1,
      }));
      m.userData = { vy: 0.004 + Math.random() * 0.009, ox: rx, oz: rz, phase: Math.random() * Math.PI * 2, active: false };
      m.position.y = -VIS_H - 2;
      tankGroup.add(m);
      return m;
    });
  }
  function resetBubble(b) {
    const rx = (Math.random() - 0.5) * (VIS_W * 0.9);
    const rz = (Math.random() - 0.5) * (VIS_D * 0.9);
    b.position.set(rx, -VIS_H / 2 + 0.05, rz);
    b.userData.ox = b.position.x; b.userData.oz = b.position.z;
    b.userData.vy = 0.004 + Math.random() * 0.009;
    b.userData.active = true;
  }

  // ── Caustics ──
  function buildCaustics() {
    causticsArr = Array.from({ length: 15 }, () => {
      const rx = (Math.random() - 0.5) * (VIS_W * 0.8);
      const rz = (Math.random() - 0.5) * (VIS_D * 0.8);
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.03 + Math.random() * 0.06, 20),
        new THREE.MeshBasicMaterial({ color: 0x0077bb, transparent: true, opacity: 0.06, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = -VIS_H / 2 + 0.003;
      m.userData = { ox: rx, oz: rz, phase: Math.random() * Math.PI * 2 };
      tankGroup.add(m);
      return m;
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  DRAG-TO-ROTATE & CLICKS
  // ══════════════════════════════════════════════════════════════
  function setupDrag() {
    const c = $('tankCanvas');
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    let clickStartX, clickStartY;

    function checkDoorClick(clientX, clientY) {
      if (!raycaster || !hatchDoorMesh) return;
      mouse.x = (clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects([hatchDoorMesh]);
      if (intersects.length > 0) {
        doorOpen = !doorOpen;
        targetDoorAngle = doorOpen ? -Math.PI / 2.5 : 0;
      }
    }

    c.addEventListener('mousedown', (e) => { 
      isDragging = true; 
      prevMouse = { x: e.clientX, y: e.clientY }; 
      clickStartX = e.clientX; clickStartY = e.clientY;
      velX = 0; velY = 0; 
      const h = $('dragHint'); if (h) h.style.opacity = '0'; 
    });
    window.addEventListener('mouseup', (e) => { 
      isDragging = false; 
      if (Math.abs(e.clientX - clickStartX) < 5 && Math.abs(e.clientY - clickStartY) < 5) {
        checkDoorClick(e.clientX, e.clientY);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouse.x) * 0.009, dy = (e.clientY - prevMouse.y) * 0.006;
      velX = dx; velY = dy;
      tankGroup.rotation.y += dx;
      tankGroup.rotation.x = Math.max(-0.5, Math.min(0.5, tankGroup.rotation.x + dy));
      prevMouse = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('touchstart', (e) => { 
      if (e.touches.length !== 1) return; 
      isDragging = true; 
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY }; 
      clickStartX = prevMouse.x; clickStartY = prevMouse.y;
      velX = 0; velY = 0; 
    }, { passive: true });
    window.addEventListener('touchend', (e) => { 
      isDragging = false; 
      if (e.changedTouches.length === 1) {
        const tx = e.changedTouches[0].clientX;
        const ty = e.changedTouches[0].clientY;
        if (Math.abs(tx - clickStartX) < 10 && Math.abs(ty - clickStartY) < 10) {
          checkDoorClick(tx, ty);
        }
      }
    });
    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = (e.touches[0].clientX - prevMouse.x) * 0.009, dy = (e.touches[0].clientY - prevMouse.y) * 0.006;
      velX = dx; velY = dy;
      tankGroup.rotation.y += dx;
      tankGroup.rotation.x = Math.max(-0.5, Math.min(0.5, tankGroup.rotation.x + dy));
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
  }

  // ── Slider (manual mode when sensor offline) ──
  function bindSlider() {
    $('waterLevel').addEventListener('input', function () {
      if (!sensorActive) {
        targetLevel = this.value / 100;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  UI SYNC
  // ══════════════════════════════════════════════════════════════
  function syncUI(lvl) {
    const pct = Math.round(lvl * 100);
    // Volume based on real tank dimensions
    const waterDepthM = lvl * TANK_DEPTH;
    const vol = Math.round(TANK_WIDTH * TANK_HEIGHT * waterDepthM * 1000);

    $('statPercent').textContent = pct;
    $('statVolume').textContent = vol.toLocaleString();
    $('sliderReadout').textContent = pct + '%';
    $('sliderFill').style.width = pct + '%';
    $('sliderGlow').style.width = pct + '%';

    // Red text when low, default when normal
    const el = $('statPercent');
    el.style.color = (lvl < LOW_THRESH && lvl > 0.01) ? 'var(--red)' : '';
  }

  // ══════════════════════════════════════════════════════════════
  //  ANIMATION LOOP
  // ══════════════════════════════════════════════════════════════
  function animate() {
    requestAnimationFrame(animate);
    clock += 0.016;

    if (hatchDoorGroup) {
      currentDoorAngle += (targetDoorAngle - currentDoorAngle) * 0.1;
      hatchDoorGroup.rotation.x = currentDoorAngle;
    }

    // Smooth level easing
    waterLevel += (targetLevel - waterLevel) * 0.05;

    // Inertia + ease back upright
    if (!isDragging) {
      tankGroup.rotation.y += velX;
      tankGroup.rotation.x += velY;
      tankGroup.rotation.x *= 0.92;
      velX *= 0.90; velY *= 0.90;
    }

    // Waves
    const pos = waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i,
        Math.sin(x * 8 + clock * 2.6) * WAVE_AMP +
        Math.cos(y * 6 - clock * 2.0) * WAVE_AMP * 0.6 +
        Math.sin((x + y) * 4 + clock * 3.2) * WAVE_AMP * 0.3
      );
    }
    pos.needsUpdate = true;
    waterGeo.computeVertexNormals();
    waterSurface.position.y = -VIS_H / 2 + waterLevel * VIS_H;

    rebuildBody(waterLevel);

    // Bubbles
    const top = -VIS_H / 2 + waterLevel * VIS_H;
    bubbleArr.forEach((b) => {
      if (!b.userData.active) { if (Math.random() < 0.005 && waterLevel > 0.07) resetBubble(b); return; }
      b.position.y += b.userData.vy;
      b.position.x = b.userData.ox + Math.sin(clock * 1.7 + b.userData.phase) * 0.022;
      b.position.z = b.userData.oz + Math.cos(clock * 1.3 + b.userData.phase) * 0.018;
      if (b.position.y >= top) { b.userData.active = false; b.position.y = -VIS_H - 2; }
    });

    // Caustics
    causticsArr.forEach((c) => {
      c.position.x = c.userData.ox + Math.sin(clock * 0.9 + c.userData.phase) * 0.12;
      c.position.z = c.userData.oz + Math.cos(clock * 1.1 + c.userData.phase) * 0.09;
      c.material.opacity = (0.03 + Math.abs(Math.sin(clock * 1.4 + c.userData.phase)) * 0.065) * waterLevel;
      c.visible = waterLevel > 0.05;
    });

    blueLight.intensity = 2.8 + Math.sin(clock * 1.0) * 0.5;
    syncUI(waterLevel);
    renderer.render(scene, camera);
  }

  // Boot — handle case where DOMContentLoaded already fired
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(init, 100);
      });
    } else {
      // DOM is already ready
      setTimeout(init, 100);
    }
  }

  boot();
})();
