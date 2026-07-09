/**
 * 3D Water Tank — Cylindrical design + reference behavior
 * - Rounded glass cylinder tank with rims, bars, measurement rings
 * - Direct drag-to-rotate tankGroup (no OrbitControls)
 * - Fixed camera, inertia with ease-back-to-upright
 * - PlaneGeometry water surface (circular) with waves
 * - Sphere bubbles with active/inactive spawning
 * - Caustics on tank floor
 * - Smooth water level easing
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── Tank dimensions ──
  const TANK_R = 1.0;
  const TANK_H = 2.2;
  const CAPACITY = 10000;
  const LOW_THRESH = 0.25;
  const WAVE_AMP = 0.012;
  const WATER_SEG = 48;

  // ── State ──
  let waterLevel = 0.75;
  let targetLevel = 0.75;
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

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════
  function init() {
    setupRenderer();
    setupScene();
    setupLights();
    buildTank();
    buildWater();
    buildBubbles();
    buildCaustics();
    setupDrag();
    bindSlider();
    syncUI(waterLevel);

    setTimeout(() => $('loadingOverlay').classList.add('hidden'), 700);
    animate();
  }

  // ── Renderer ──
  function setupRenderer() {
    const canvas = $('tankCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x080c18, 1);
  }

  // ── Scene & Camera (fixed) ──
  function setupScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
      44, window.innerWidth / window.innerHeight, 0.1, 100
    );
    camera.position.set(0, 0.25, 5.5);
    camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ── Lights (matching reference) ──
  function setupLights() {
    scene.add(new THREE.AmbientLight(0x203050, 1.1));

    const dirLight = new THREE.DirectionalLight(0xc8e0ff, 1.8);
    dirLight.position.set(5, 10, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);

    blueLight = new THREE.PointLight(0x0077ff, 3.0, 20);
    blueLight.position.set(-5, 5, -4);
    scene.add(blueLight);

    const fillLight = new THREE.PointLight(0x00ccff, 1.5, 16);
    fillLight.position.set(4, -2, 5);
    scene.add(fillLight);

    const underLight = new THREE.PointLight(0x002266, 1.2, 10);
    underLight.position.set(0, -4, 0);
    scene.add(underLight);
  }

  // ══════════════════════════════════════════════════════════════
  //  CYLINDRICAL TANK
  // ══════════════════════════════════════════════════════════════
  function buildTank() {
    tankGroup = new THREE.Group();
    tankGroup.rotation.y = 0.4;
    scene.add(tankGroup);

    // ── Glass cylinder wall ──
    const wallGeo = new THREE.CylinderGeometry(
      TANK_R, TANK_R, TANK_H, 64, 1, true
    );
    const wallMat = new THREE.MeshPhysicalMaterial({
      color: 0x99ccff,
      transparent: true,
      opacity: 0.15,
      roughness: 0.02,
      metalness: 0.0,
      transmission: 0.7,
      thickness: 0.4,
      side: THREE.DoubleSide,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      depthWrite: false,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 0;
    tankGroup.add(wall);

    // ── Bottom disc ──
    const botGeo = new THREE.CircleGeometry(TANK_R, 64);
    const botMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a3a4a,
      transparent: true,
      opacity: 0.6,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const botDisc = new THREE.Mesh(botGeo, botMat);
    botDisc.rotation.x = -Math.PI / 2;
    botDisc.position.y = -TANK_H / 2;
    tankGroup.add(botDisc);

    // ── Rims (top + bottom) ──
    const rimGeo = new THREE.TorusGeometry(TANK_R, 0.04, 12, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xc8d6e0,
      metalness: 0.85,
      roughness: 0.1,
    });

    const topRim = new THREE.Mesh(rimGeo, rimMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = TANK_H / 2;
    tankGroup.add(topRim);

    const botRim = topRim.clone();
    botRim.position.y = -TANK_H / 2;
    tankGroup.add(botRim);

    // ── Top lip ──
    const lipGeo = new THREE.TorusGeometry(TANK_R + 0.01, 0.022, 12, 64);
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0xd8e4ec,
      metalness: 0.85,
      roughness: 0.1,
    });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = TANK_H / 2 + 0.04;
    tankGroup.add(lip);

    // ── 6 vertical structural bars ──
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const barGeo = new THREE.CylinderGeometry(0.018, 0.018, TANK_H + 0.08, 8);
      const barMat = new THREE.MeshStandardMaterial({
        color: 0xaabbcc,
        metalness: 0.7,
        roughness: 0.2,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(
        Math.cos(angle) * TANK_R,
        0,
        Math.sin(angle) * TANK_R
      );
      tankGroup.add(bar);
    }

    // ── Measurement rings (25%, 50%, 75%) ──
    [0.25, 0.5, 0.75].forEach((lvl) => {
      const y = -TANK_H / 2 + lvl * TANK_H;
      const mGeo = new THREE.TorusGeometry(TANK_R + 0.01, 0.005, 8, 64);
      const mMat = new THREE.MeshBasicMaterial({
        color: 0x667788,
        transparent: true,
        opacity: 0.25,
      });
      const ring = new THREE.Mesh(mGeo, mMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      tankGroup.add(ring);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  WATER
  // ══════════════════════════════════════════════════════════════
  function buildWater() {
    // Circular surface using CircleGeometry (subdivided for waves)
    waterGeo = new THREE.CircleGeometry(TANK_R * 0.96, WATER_SEG);
    waterSurface = new THREE.Mesh(
      waterGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0x003a8a,
        transparent: true,
        opacity: 0.88,
        metalness: 0.05,
        roughness: 0.04,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    waterSurface.rotation.x = -Math.PI / 2;
    waterSurface.position.y = -TANK_H / 2 + waterLevel * TANK_H;
    tankGroup.add(waterSurface);

    rebuildBody(waterLevel);
  }

  function rebuildBody(lvl) {
    if (waterBody) {
      tankGroup.remove(waterBody);
      waterBody.geometry.dispose();
    }
    const h = Math.max(0.001, lvl * TANK_H);
    waterBody = new THREE.Mesh(
      new THREE.CylinderGeometry(TANK_R * 0.96, TANK_R * 0.96, h, 64, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0x002e7a,
        transparent: true,
        opacity: 0.42,
        roughness: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    waterBody.position.y = -TANK_H / 2 + h / 2;
    waterBody.renderOrder = 1;
    tankGroup.add(waterBody);
  }

  // ══════════════════════════════════════════════════════════════
  //  BUBBLES (sphere meshes)
  // ══════════════════════════════════════════════════════════════
  function buildBubbles() {
    const geo = new THREE.SphereGeometry(0.009, 7, 7);
    bubbleArr = Array.from({ length: 50 }, () => {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshPhysicalMaterial({
          color: 0x88ddff,
          transparent: true,
          opacity: 0.4,
          roughness: 0.1,
        })
      );
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * TANK_R * 0.8;
      m.userData = {
        vy: 0.004 + Math.random() * 0.009,
        ox: Math.cos(angle) * r,
        oz: Math.sin(angle) * r,
        phase: Math.random() * Math.PI * 2,
        active: false,
      };
      m.position.y = -TANK_H - 2;
      tankGroup.add(m);
      return m;
    });
  }

  function resetBubble(b) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * TANK_R * 0.8;
    b.position.set(
      Math.cos(angle) * r,
      -TANK_H / 2 + 0.05,
      Math.sin(angle) * r
    );
    b.userData.ox = b.position.x;
    b.userData.oz = b.position.z;
    b.userData.vy = 0.004 + Math.random() * 0.009;
    b.userData.active = true;
  }

  // ══════════════════════════════════════════════════════════════
  //  CAUSTICS (on tank floor)
  // ══════════════════════════════════════════════════════════════
  function buildCaustics() {
    causticsArr = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.03 + Math.random() * 0.06, 20),
        new THREE.MeshBasicMaterial({
          color: 0x0077bb,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = -TANK_H / 2 + 0.003;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * TANK_R * 0.7;
      m.userData = {
        ox: Math.cos(a) * r,
        oz: Math.sin(a) * r,
        phase: Math.random() * Math.PI * 2,
      };
      tankGroup.add(m);
      return m;
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  DRAG-TO-ROTATE
  // ══════════════════════════════════════════════════════════════
  function setupDrag() {
    const canvas = $('tankCanvas');

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      velX = 0;
      velY = 0;
      const hint = $('dragHint');
      if (hint) hint.style.opacity = '0';
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouse.x) * 0.009;
      const dy = (e.clientY - prevMouse.y) * 0.006;
      velX = dx;
      velY = dy;
      tankGroup.rotation.y += dx;
      tankGroup.rotation.x = Math.max(-0.5, Math.min(0.5, tankGroup.rotation.x + dy));
      prevMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      velX = 0;
      velY = 0;
    }, { passive: true });

    window.addEventListener('touchend', () => { isDragging = false; });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = (e.touches[0].clientX - prevMouse.x) * 0.009;
      const dy = (e.touches[0].clientY - prevMouse.y) * 0.006;
      velX = dx;
      velY = dy;
      tankGroup.rotation.y += dx;
      tankGroup.rotation.x = Math.max(-0.5, Math.min(0.5, tankGroup.rotation.x + dy));
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
  }

  // ══════════════════════════════════════════════════════════════
  //  SLIDER
  // ══════════════════════════════════════════════════════════════
  function bindSlider() {
    $('waterLevel').addEventListener('input', function () {
      targetLevel = this.value / 100;
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  UI SYNC
  // ══════════════════════════════════════════════════════════════
  function syncUI(lvl) {
    const pct = Math.round(lvl * 100);
    const vol = Math.round(lvl * CAPACITY);

    $('statPercent').textContent = pct;
    $('statVolume').textContent = vol.toLocaleString();
    $('sliderReadout').textContent = `${pct}%`;

    $('sliderFill').style.width = `${pct}%`;
    $('sliderGlow').style.width = `${pct}%`;

    const warn = $('lowWarning');
    if (lvl < LOW_THRESH) {
      warn.classList.add('visible');
    } else {
      warn.classList.remove('visible');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  ANIMATION LOOP
  // ══════════════════════════════════════════════════════════════
  function animate() {
    requestAnimationFrame(animate);
    clock += 0.016;

    // Smooth level easing
    waterLevel += (targetLevel - waterLevel) * 0.05;

    // Inertia + ease back to upright
    if (!isDragging) {
      tankGroup.rotation.y += velX;
      tankGroup.rotation.x += velY;
      tankGroup.rotation.x *= 0.92;
      velX *= 0.90;
      velY *= 0.90;
    }

    // ── Waves ──
    const pos = waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const w =
        Math.sin(x * 8 + clock * 2.6) * WAVE_AMP +
        Math.cos(y * 6 - clock * 2.0) * WAVE_AMP * 0.6 +
        Math.sin((x + y) * 4 + clock * 3.2) * WAVE_AMP * 0.3;
      pos.setZ(i, w);
    }
    pos.needsUpdate = true;
    waterGeo.computeVertexNormals();
    waterSurface.position.y = -TANK_H / 2 + waterLevel * TANK_H;

    // ── Water body ──
    rebuildBody(waterLevel);

    // ── Bubbles ──
    const top = -TANK_H / 2 + waterLevel * TANK_H;
    bubbleArr.forEach((b) => {
      if (!b.userData.active) {
        if (Math.random() < 0.005 && waterLevel > 0.07) resetBubble(b);
        return;
      }
      b.position.y += b.userData.vy;
      b.position.x = b.userData.ox + Math.sin(clock * 1.7 + b.userData.phase) * 0.022;
      b.position.z = b.userData.oz + Math.cos(clock * 1.3 + b.userData.phase) * 0.018;
      if (b.position.y >= top) {
        b.userData.active = false;
        b.position.y = -TANK_H - 2;
      }
    });

    // ── Caustics ──
    causticsArr.forEach((c) => {
      c.position.x = c.userData.ox + Math.sin(clock * 0.9 + c.userData.phase) * 0.12;
      c.position.z = c.userData.oz + Math.cos(clock * 1.1 + c.userData.phase) * 0.09;
      c.material.opacity =
        (0.03 + Math.abs(Math.sin(clock * 1.4 + c.userData.phase)) * 0.065) * waterLevel;
      c.visible = waterLevel > 0.05;
    });

    // ── Light pulse ──
    blueLight.intensity = 2.8 + Math.sin(clock * 1.0) * 0.5;

    syncUI(waterLevel);
    renderer.render(scene, camera);
  }

  // ── Boot ──
  window.addEventListener('DOMContentLoaded', init);
})();
