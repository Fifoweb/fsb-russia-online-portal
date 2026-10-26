import * as THREE from './vendor/three/three.module.min.js';
import { createFactionEmblem } from './faction-emblem.js?v=restored-v-clean-emblem';

/** A self-contained presentation scene. It never reads or authenticates user data. */
export function mountHeroScene(container) {
  if (!container) return () => {};
  const canvas = container.querySelector('canvas');
  const fallback = container.querySelector('.scene-fallback');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  let disposed = false, readySent = false, visible = true, lost = false, frameId = 0;
  let width = 1, height = 1, mobile = false;
  window.__portalSceneReady = false;

  const ready = (success, mode = 'faction') => {
    if (disposed || readySent) return;
    readySent = true;
    window.__portalSceneReady = true;
    container.dataset.sceneMode = mode;
    window.dispatchEvent(new CustomEvent('portal:scene-ready', { detail: { success, mode } }));
  };
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    if (canvas) canvas.hidden = true;
    ready(false, 'static');
    return () => { disposed = true; };
  }
  renderer.setClearColor(0x050607, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 70);
  camera.position.set(0, 0.05, 10.4);
  const emblem = new THREE.Group();
  const orbit = new THREE.Group();
  orbit.position.z = -0.8;
  scene.add(emblem, orbit);
  scene.add(new THREE.HemisphereLight(0xd9e6f2, 0x08090a, 1.0));
  const key = new THREE.DirectionalLight(0xffefd6, 2.3);
  key.position.set(-4, 6, 7);
  const front = new THREE.DirectionalLight(0xdde8f8, 1.35);
  front.position.set(2, 1, 9);
  const rim = new THREE.DirectionalLight(0xd42b39, 1.4);
  rim.position.set(5, -0.5, -4);
  scene.add(key, front, rim);

  // The studio reflection is generated from simple colour bands, not an external image.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512; envCanvas.height = 256;
  const ctx = envCanvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#323b49'); gradient.addColorStop(0.3, '#9098a3');
  gradient.addColorStop(0.5, '#20262d'); gradient.addColorStop(0.8, '#11151b'); gradient.addColorStop(1, '#080a0d');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#d9dde0'; ctx.fillRect(60, 28, 36, 138);
  ctx.fillStyle = '#8e9198'; ctx.fillRect(335, 20, 68, 140);
  const envTexture = new THREE.CanvasTexture(envCanvas);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  envTexture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(envTexture);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.85;
  envTexture.dispose(); pmrem.dispose();

  function ring(radius, color, opacity, tilt = 0) {
    const points = [];
    for (let i = 0; i < 180; i++) {
      const angle = i / 180 * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    line.rotation.x = tilt;
    orbit.add(line);
    return line;
  }
  ring(3.55, 0x59626e, 0.16, 0.12);
  const outer = ring(3.82, 0x88212d, 0.19, -0.1);
  ring(3.23, 0x89909a, 0.08, 0.0);
  const tickPoints = [];
  for (let i = 0; i < 96; i++) {
    const angle = i * Math.PI * 2 / 96;
    const length = i % 4 === 0 ? 0.19 : 0.07;
    for (const r of [3.91, 3.91 + length]) tickPoints.push(Math.cos(angle) * r, Math.sin(angle) * r, -0.02);
  }
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tickPoints, 3)), new THREE.LineBasicMaterial({ color: 0x9f2431, transparent: true, opacity: 0.47, depthWrite: false }));
  orbit.add(ticks);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const g = glowCanvas.getContext('2d');
  const glowGradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glowGradient.addColorStop(0, 'rgba(180,28,47,0.27)');
  glowGradient.addColorStop(0.44, 'rgba(115,18,37,0.10)');
  glowGradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glowGradient; g.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(-0.7, 0.2, -1.6); glow.scale.set(10, 10, 1); scene.add(glow);

  // Deterministic fine particles keep the background calm and repeatable.
  let seed = 481516;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [];
  for (let i = 0; i < 290; i++) positions.push((random() - 0.5) * 14, (random() - 0.5) * 11, -2 - random() * 5);
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)), new THREE.PointsMaterial({ color: 0xa1aab9, size: 0.018, transparent: true, opacity: 0.48, sizeAttenuation: true, depthWrite: false }));
  scene.add(dust);

  let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
  const pointer = event => {
    targetX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 0.23;
    targetY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 0.10;
    if (reduced) targetX = targetY = 0;
  };
  const leave = () => { targetX = targetY = 0; };
  function draw(now = performance.now()) {
    frameId = 0;
    if (disposed || lost || !visible || document.hidden) return;
    const time = now * 0.001;
    currentX += (targetX - currentX) * 0.035;
    currentY += (targetY - currentY) * 0.035;
    emblem.rotation.y = -0.12 + (reduced ? 0 : Math.sin(time * 0.34) * 0.075 + currentX);
    emblem.rotation.x = 0.035 + (reduced ? 0 : Math.sin(time * 0.29) * 0.025 + currentY);
    emblem.position.y = (mobile ? 0.1 : 0.0) + (reduced ? 0 : Math.sin(time * 0.7) * 0.045);
    orbit.rotation.z = reduced ? 0.12 : time * 0.015;
    outer.rotation.y = reduced ? 0.10 : Math.sin(time * 0.17) * 0.13;
    ticks.rotation.z = reduced ? -0.08 : -time * 0.022;
    dust.rotation.z = reduced ? 0 : time * 0.002;
    renderer.render(scene, camera);
    if (!reduced) frameId = requestAnimationFrame(draw);
  }
  function schedule() {
    if (disposed || lost || !visible || document.hidden || frameId) return;
    frameId = requestAnimationFrame(draw);
  }
  function resize() {
    if (disposed) return;
    const box = container.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    mobile = window.innerWidth < 761;
    camera.aspect = width / height;
    camera.position.z = mobile ? 10.9 : (camera.aspect < 0.86 ? 11.6 : 10.4);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.8));
    renderer.setSize(width, height, false);
    schedule();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    if (!visible) { cancelAnimationFrame(frameId); frameId = 0; }
    else schedule();
  }, { rootMargin: '100px' });
  intersection.observe(container);
  const visibility = () => {
    if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
    else schedule();
  };
  const contextLost = event => {
    event.preventDefault(); lost = true;
    cancelAnimationFrame(frameId); frameId = 0;
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
    ready(false, 'static');
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pointermove', pointer, { passive: true });
  window.addEventListener('pointerout', leave, { passive: true });
  resize();

  function placeModel(model) {
    if (disposed) { disposeObject(model); return; }
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = 5.85 / Math.max(0.01, size.y);
    model.scale.setScalar(scale);
    model.position.set(-centre.x * scale, -centre.y * scale + 0.14, -centre.z * scale);
    model.traverse(node => {
      if (!node.isMesh) return;
      for (const material of [].concat(node.material)) {
        if ('envMapIntensity' in material) material.envMapIntensity = 1.15;
      }
    });
    emblem.add(model);
    container.classList.add('scene-ready');
    if (fallback) fallback.hidden = true;
    schedule();
  }

  try {
    placeModel(createFactionEmblem());
    ready(true, 'faction');
  } catch (error) {
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
    ready(false, 'static');
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect(); intersection.disconnect();
    window.removeEventListener('pointermove', pointer);
    window.removeEventListener('pointerout', leave);
    document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('webglcontextlost', contextLost);
    disposeObject(scene);
    environment.dispose();
    renderer.dispose();
  };
}

function disposeObject(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of node.material ? [].concat(node.material) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => { texture.source?.data?.close?.(); texture.dispose(); });
  materials.forEach(material => material.dispose());
}
