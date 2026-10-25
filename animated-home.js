import * as THREE from 'three';

try {

/* ============ DEVICE DETECTION ============ */
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window && innerWidth < 1024);
const isLowEnd = isMobile || navigator.hardwareConcurrency <= 4;

if (isMobile) document.body.classList.add('is-mobile');

/* ============ RENDERER ============ */
const renderer = new THREE.WebGLRenderer({
  antialias: !isLowEnd,
  powerPreference: 'high-performance'
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, isLowEnd ? 1 : 1.5));
renderer.shadowMap.enabled = !isLowEnd;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

/* ============ SCENE ============ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.Fog(0x050510, 30, 80);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 12); // Near houses (was 14)
camera.rotation.order = 'YXZ';

/* ============ STATE ============ */
let mode = 'street';
let currentHouse = null;
let interiorGroup = null;
let yaw = 0, pitch = 0;
let targetYaw = 0, targetPitch = 0;
const PITCH_LIMIT = Math.PI / 2.2;

const ROOM_W = 6, ROOM_H = 3, ROOM_D = 6;
const WALL_MARGIN = 0.4;

const DOOR_ENTER_DISTANCE = 4.5;
const PC_OPEN_DISTANCE = 3.5;
const EXIT_DOOR_DISTANCE = 3.5;

const VISIBLE_RADIUS = 45;
const MAX_VISIBLE_HOUSES = 14;

const collisionBoxes = [];
const allHouses = [];
let currentHouseData = null;

/* ============ LIGHTING ============ */
const ambient = new THREE.AmbientLight(0x8899bb, 1.0);
scene.add(ambient);

const moon = new THREE.DirectionalLight(0x99bbff, 0.7);
moon.position.set(-30, 40, -20);
if (!isLowEnd) {
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -50;
  moon.shadow.camera.right = 50;
  moon.shadow.camera.top = 50;
  moon.shadow.camera.bottom = -50;
  moon.shadow.bias = -0.001;
}
scene.add(moon);

scene.add(new THREE.HemisphereLight(0x445588, 0x1a1a2a, 0.5));

/* ============ GLOW TEXTURES ============ */
function makeGlowTexture(colorHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  g.addColorStop(0, col);
  g.addColorStop(0.4, col + '88');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW_ORANGE = makeGlowTexture(0xffaa44);
const GLOW_YELLOW = makeGlowTexture(0xffdd66);
const GLOW_BLUE   = makeGlowTexture(0x88aaff);
const GLOW_GREEN  = makeGlowTexture(0x00ff88);

const glowMatOrange = new THREE.SpriteMaterial({
  map: GLOW_ORANGE, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false
});
const glowMatYellow = new THREE.SpriteMaterial({
  map: GLOW_YELLOW, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false
});
const glowMatGreen = new THREE.SpriteMaterial({
  map: GLOW_GREEN, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false
});

/* ============ STARS ============ */
const starGeo = new THREE.BufferGeometry();
const starCount = isLowEnd ? 500 : 1200;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 120 + Math.random() * 60;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 0.85);
  starPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  starPos[i*3+1] = r * Math.cos(phi);
  starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 1.2, sizeAttenuation: true,
  transparent: true, opacity: 0.85
}));
scene.add(stars);

const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: GLOW_BLUE, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false
}));
moonSprite.scale.set(30, 30, 1);
moonSprite.position.set(-60, 60, -80);
scene.add(moonSprite);

/* ============ GROUND ============ */
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 1 })
);
grass.rotation.x = -Math.PI/2;
grass.receiveShadow = !isLowEnd;
scene.add(grass);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 400),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
);
road.rotation.x = -Math.PI/2;
road.position.y = 0.02;
scene.add(road);

const lineGeo = new THREE.PlaneGeometry(0.25, 3);
const lineMat = new THREE.MeshBasicMaterial({ color: 0xaa8800 });
const lineZs = [];
for (let z = -195; z < 195; z += 6) lineZs.push(z);
const lineMesh = new THREE.InstancedMesh(lineGeo, lineMat, lineZs.length);
const dummy = new THREE.Object3D();
lineZs.forEach((z, i) => {
  dummy.position.set(0, 0.03, z);
  dummy.rotation.x = -Math.PI/2;
  dummy.updateMatrix();
  lineMesh.setMatrixAt(i, dummy.matrix);
});
scene.add(lineMesh);

/* ============ HELPERS ============ */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function createNameTexture(name, isAgency = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isAgency ? 'rgba(10, 25, 47, 0.95)' : 'rgba(5,5,15,0.9)';
  roundRect(ctx, 10, 20, 492, 88, 20);
  ctx.fill();
  
  if (isAgency) {
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, '#0066ff');
    grad.addColorStop(1, '#00d2ff');
    ctx.strokeStyle = grad;
  } else {
    ctx.strokeStyle = '#FFD700';
  }
  
  ctx.lineWidth = 5;
  roundRect(ctx, 10, 20, 492, 88, 20);
  ctx.stroke();

  ctx.fillStyle = isAgency ? '#00d2ff' : '#FFD700';
  ctx.font = 'bold 52px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = isAgency ? '#00d2ff' : '#FFD700';
  ctx.shadowBlur = 15;
  ctx.fillText(name, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============ HOUSE BUILDER ============ */
const clickableObjects = [];

function buildHouse(user, x, z, rotY) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.25, 4.4),
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.95 })
  );
  foundation.position.y = 0.125;
  foundation.receiveShadow = !isLowEnd;
  group.add(foundation);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 4),
    new THREE.MeshStandardMaterial({ color: 0xd4c4a8, roughness: 0.85 })
  );
  body.position.y = 1.75;
  body.castShadow = !isLowEnd;
  body.receiveShadow = !isLowEnd;
  body.userData.house = user;
  group.add(body);
  clickableObjects.push(body);

  const trimBottom = new THREE.Mesh(
    new THREE.BoxGeometry(4.05, 0.15, 4.05),
    new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 0.9 })
  );
  trimBottom.position.y = 0.55;
  group.add(trimBottom);

  const roofBase = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.15, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.9 })
  );
  roofBase.position.y = 3.35;
  roofBase.castShadow = !isLowEnd;
  group.add(roofBase);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 1.6, 4),
    new THREE.MeshStandardMaterial({ color: 0x8b3a1a, roughness: 0.7, metalness: 0.1 })
  );
  roof.position.y = 4.2;
  roof.rotation.y = Math.PI/4;
  roof.castShadow = !isLowEnd;
  roof.userData.house = user;
  group.add(roof);
  clickableObjects.push(roof);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.85 })
  );
  chimney.position.set(0.9, 4.45, -0.8);
  chimney.castShadow = !isLowEnd;
  group.add(chimney);

  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 2.35, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 0.7 })
  );
  doorFrame.position.set(0, 1.42, 2.02);
  group.add(doorFrame);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.2, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x5a3010, roughness: 0.6, metalness: 0.1 })
  );
  door.position.set(0, 1.35, 2.05);
  door.userData.house = user;
  group.add(door);
  clickableObjects.push(door);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffd700, metalness: 0.95, roughness: 0.15,
      emissive: 0xffaa00, emissiveIntensity: 0.5
    })
  );
  knob.position.set(0.32, 1.35, 2.13);
  group.add(knob);

  const winFrameMat = new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 0.7 });
  const winGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66, emissive: 0xffaa33, emissiveIntensity: 2
  });

  [[-1.1, 1.8], [1.1, 1.8]].forEach(([wx, wy]) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.08), winFrameMat);
    frame.position.set(wx, wy + 0.25, 2.02);
    group.add(frame);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.06), winGlassMat);
    glass.position.set(wx, wy + 0.25, 2.05);
    group.add(glass);

    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.85 })
    );
    sill.position.set(wx, wy + 0.25 - 0.48, 2.1);
    group.add(sill);

    const glow = new THREE.Sprite(glowMatOrange);
    glow.scale.set(1.6, 1.6, 1);
    glow.position.set(wx, wy + 0.25, 2.5);
    group.add(glow);
  });

  const porchBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  porchBase.position.set(0, 3.15, 2.02);
  group.add(porchBase);

  const porchBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffdd88, emissive: 0xffbb44, emissiveIntensity: 3.5
    })
  );
  porchBulb.position.set(0, 3.1, 2.15);
  group.add(porchBulb);

  const porchGlow = new THREE.Sprite(glowMatOrange);
  porchGlow.scale.set(2.2, 2.2, 1);
  porchGlow.position.set(0, 3.1, 2.2);
  group.add(porchGlow);

  [[-1.6, 2.0], [1.6, 2.0]].forEach(([px, pz]) => {
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a5a1a, roughness: 1 })
    );
    bush.position.set(px, 0.6, pz);
    bush.scale.y = 0.8;
    bush.castShadow = !isLowEnd;
    group.add(bush);
  });

  const nameTex = createNameTexture(user.name);
  const namePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 0.7),
    new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false })
  );
  namePlate.position.set(0, 3.75, 2.08);
  namePlate.userData.house = user;
  group.add(namePlate);
  clickableObjects.push(namePlate);

  const halfSize = 2.5;
  collisionBoxes.push({
    minX: x - halfSize, maxX: x + halfSize,
    minZ: z - halfSize, maxZ: z + halfSize
  });

  return { group, x, z, rotY };
}

/* ============ AGENCY BUILDING ============ */
const AGENCY_SITE = 'https://apply.olio.my';
const AGENCY_DATA = {
  name: 'OLIO AGENCY',
  site: AGENCY_SITE,
  isAgency: true,
  description: "Build your dream house, showcase your unique talent, and get discovered by top companies. This is where creativity meets opportunity."
};

function buildAgency(x, z, rotY) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.25, 6.4),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.95 })
  );
  foundation.position.y = 0.125;
  foundation.receiveShadow = !isLowEnd;
  group.add(foundation);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.7 })
  );
  body.position.y = 2.25;
  body.castShadow = !isLowEnd;
  body.receiveShadow = !isLowEnd;
  body.userData.house = AGENCY_DATA;
  group.add(body);
  clickableObjects.push(body);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x66ccff, emissive: 0x0066ff, emissiveIntensity: 1.2,
    metalness: 0.5, roughness: 0.2
  });

  [[-2, 2.5], [0, 2.5], [2, 2.5], [-2, 1], [0, 1], [2, 1]].forEach(([gx, gy]) => {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.2, 0.1),
      glassMat
    );
    glass.position.set(gx, gy, 3.02);
    group.add(glass);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_BLUE, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(1.5, 1.5, 1);
    glow.position.set(gx, gy, 3.4);
    group.add(glow);
  });

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.3, 6.4),
    new THREE.MeshStandardMaterial({ color: 0x0a192f, roughness: 0.8 })
  );
  roof.position.y = 4.4;
  roof.castShadow = !isLowEnd;
  roof.userData.house = AGENCY_DATA;
  group.add(roof);
  clickableObjects.push(roof);

  const signTex = createNameTexture('OLIO AGENCY', true);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 1.1),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false })
  );
  sign.position.set(0, 5.2, 3.03);
  sign.userData.house = AGENCY_DATA;
  group.add(sign);
  clickableObjects.push(sign);

  const signGlow = new THREE.Sprite(glowMatGreen);
  signGlow.scale.set(6, 2, 1);
  signGlow.position.set(0, 5.2, 3.1);
  group.add(signGlow);

  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.8, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x00d2ff, metalness: 0.8, roughness: 0.3 })
  );
  doorFrame.position.set(0, 1.65, 3.02);
  group.add(doorFrame);

  const doorGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.6, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x66ccff, emissive: 0x0066ff, emissiveIntensity: 1.5,
      metalness: 0.6, roughness: 0.2
    })
  );
  doorGlass.position.set(0, 1.65, 3.05);
  doorGlass.userData.house = AGENCY_DATA;
  group.add(doorGlass);
  clickableObjects.push(doorGlass);

  const doorGlow = new THREE.Sprite(glowMatGreen);
  doorGlow.scale.set(2.5, 2.5, 1);
  doorGlow.position.set(0, 1.65, 3.3);
  group.add(doorGlow);

  const openBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0x00d2ff, emissive: 0x00d2ff, emissiveIntensity: 4
    })
  );
  openBulb.position.set(1.2, 3.3, 3.1);
  group.add(openBulb);

  const halfSize = 3.5;
  collisionBoxes.push({
    minX: x - halfSize, maxX: x + halfSize,
    minZ: z - halfSize, maxZ: z + halfSize
  });

  return { group, x, z, rotY };
}

/* ============ STREET LAMPS ============ */
function addStreetLamps(count) {
  for (let i = 0; i < count; i++) {
    const z = i * 16;
    [-1, 1].forEach(side => {
      const x = side * 4.2;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 5, 8),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.3 })
      );
      pole.position.set(x, 2.5, z);
      scene.add(pole);

      const bulbPos = new THREE.Vector3(x - side*0.6, 4.9, z);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xffdd88, emissive: 0xffaa33, emissiveIntensity: 3
        })
      );
      bulb.position.copy(bulbPos);
      scene.add(bulb);

      const glow = new THREE.Sprite(glowMatYellow);
      glow.scale.set(3, 3, 1);
      glow.position.copy(bulbPos);
      scene.add(glow);
    });
  }
}

/* ============ FETCH REAL OLIO APPLICANTS ============ */
async function loadUsers() {
  try {
    const response = await fetch('https://olio.my/applications', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.success !== true || !Array.isArray(data.applications)) {
      throw new Error('Invalid OLIO API response');
    }

    return data.applications.map(application => ({
      id: application.id,
      name: String(application.full_name || 'Unknown Applicant').trim().toUpperCase(),
      job: application.job || '',
      site: `https://olio.my/application?id=${application.id}`,
      picture: application.profile_image_url || null
    }));
  } catch (error) {
    console.error('Failed to load OLIO applicants:', error);
    showToast('Unable to load real applicants. Please refresh.');
    return [];
  }
}

/* ============ GENERATE STREET (DYNAMIC) ============ */
function generateStreet(users) {
  users.forEach((user, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    // Start near camera (z=2), spread outward
    const zPos = Math.floor(index / 2) * 8 + 2;
    const xPos = side * 9;
    const rotY = side === -1 ? Math.PI / 2 : -Math.PI / 2;

    const houseData = buildHouse(user, xPos, zPos, rotY);
    scene.add(houseData.group);

    allHouses.push({
      group: houseData.group,
      user: user,
      position: new THREE.Vector3(xPos, 0, zPos),
      x: xPos,
      z: zPos,
      rotY: rotY
    });
  });
  console.log(`✅ Generated ${allHouses.length} houses`);
}

/* ============ DISTANCE CULLING ============ */
function updateHouseVisibility() {
  if (mode !== 'street') return;

  const camPos = camera.position;

  const sorted = allHouses
    .map(h => ({ house: h, dist: camPos.distanceTo(h.position) }))
    .sort((a, b) => a.dist - b.dist);

  allHouses.forEach(h => { h.group.visible = false; });

  let visibleCount = 0;
  for (const item of sorted) {
    if (item.dist <= VISIBLE_RADIUS && visibleCount < MAX_VISIBLE_HOUSES) {
      item.house.group.visible = true;
      visibleCount++;
    } else {
      break;
    }
  }
}

/* ============ INTERIOR BUILDER ============ */
let pcHitBox = null;
let exitDoorHitBox = null;
let pcWorldPos = null;
let exitDoorWorldPos = null;
let currentIsAgency = false;

function buildInterior(user, isAgency = false) {
  const group = new THREE.Group();

  const wallColor = isAgency ? 0x1a2a3a : 0xa89880;
  const floorColor = isAgency ? 0x0a192f : 0x3d2817;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.65, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = !isLowEnd;
  group.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 })
  );
  ceiling.rotation.x = Math.PI/2;
  ceiling.position.y = ROOM_H;
  group.add(ceiling);

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.88 });

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  backWall.position.set(0, ROOM_H/2, -ROOM_D/2);
  backWall.receiveShadow = !isLowEnd;
  group.add(backWall);

  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  frontWall.position.set(0, ROOM_H/2, ROOM_D/2);
  frontWall.rotation.y = Math.PI;
  frontWall.receiveShadow = !isLowEnd;
  group.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  leftWall.position.set(-ROOM_W/2, ROOM_H/2, 0);
  leftWall.rotation.y = Math.PI/2;
  leftWall.receiveShadow = !isLowEnd;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  rightWall.position.set(ROOM_W/2, ROOM_H/2, 0);
  rightWall.rotation.y = -Math.PI/2;
  rightWall.receiveShadow = !isLowEnd;
  group.add(rightWall);

  const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
  [[0, 0.06, -ROOM_D/2 + 0.02, ROOM_W, 0], [0, 0.06, ROOM_D/2 - 0.02, ROOM_W, 0],
   [-ROOM_W/2 + 0.02, 0.06, 0, ROOM_D, Math.PI/2], [ROOM_W/2 - 0.02, 0.06, 0, ROOM_D, Math.PI/2]]
  .forEach(([bx, by, bz, bw, br]) => {
    const bb = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, 0.04), baseboardMat);
    bb.position.set(bx, by, bz);
    bb.rotation.y = br;
    group.add(bb);
  });

  const mainLight = new THREE.PointLight(isAgency ? 0xaaddff : 0xffddbb, 2.5, 12, 1.5);
  mainLight.position.set(0, ROOM_H - 0.4, 0);
  if (!isLowEnd) {
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(512, 512);
    mainLight.shadow.bias = -0.001;
  }
  group.add(mainLight);

  const fillLight = new THREE.PointLight(isAgency ? 0x6699cc : 0xffeedd, 0.8, 8, 2);
  fillLight.position.set(0, 2, 1);
  group.add(fillLight);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffffee, emissive: isAgency ? 0xaaddff : 0xffddbb, emissiveIntensity: 3
    })
  );
  bulb.position.set(0, ROOM_H - 0.2, 0);
  group.add(bulb);

  const deskZ = -ROOM_D/2 + 0.65;
  const deskMat = new THREE.MeshStandardMaterial({ color: isAgency ? 0x1a2a3a : 0x4a2a10, roughness: 0.55 });

  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.9), deskMat);
  deskTop.position.set(0, 0.9, deskZ);
  deskTop.castShadow = !isLowEnd;
  deskTop.receiveShadow = !isLowEnd;
  group.add(deskTop);

  [[-1.0, -0.35], [1.0, -0.35], [-1.0, 0.35], [1.0, 0.35]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), deskMat);
    leg.position.set(lx, 0.45, deskZ + lz);
    leg.castShadow = !isLowEnd;
    group.add(leg);
  });

  const standBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.04, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.7, roughness: 0.3 })
  );
  standBase.position.set(0, 0.95, deskZ);
  group.add(standBase);

  const standPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.3, 12),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.7, roughness: 0.3 })
  );
  standPole.position.set(0, 1.12, deskZ);
  group.add(standPole);

  const monitorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 1.05, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.35, metalness: 0.6 })
  );
  monitorFrame.position.set(0, 1.7, deskZ);
  monitorFrame.castShadow = !isLowEnd;
  group.add(monitorFrame);

  const screenColor = isAgency ? 0x00d2ff : 0x3399dd;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, 0.92),
    new THREE.MeshBasicMaterial({ color: screenColor })
  );
  screen.position.set(0, 1.7, deskZ + 0.04);
  group.add(screen);

  const taskbar = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x0a0a15 })
  );
  taskbar.position.set(0, 1.7 - 0.42, deskZ + 0.045);
  group.add(taskbar);

  const screenLight = new THREE.PointLight(screenColor, 1.0, 3.5, 2);
  screenLight.position.set(0, 1.7, deskZ + 0.5);
  group.add(screenLight);

  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.7, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 })
  );
  tower.position.set(1.1, 1.25, deskZ + 0.1);
  tower.castShadow = !isLowEnd;
  group.add(tower);

  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.5, 0.02),
    new THREE.MeshStandardMaterial({
      color: 0x00d2ff, emissive: 0x00d2ff, emissiveIntensity: 4
    })
  );
  led.position.set(1.1, 1.25, deskZ - 0.13);
  group.add(led);

  const kb = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.03, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.3, roughness: 0.7 })
  );
  kb.position.set(0, 0.95, deskZ + 0.45);
  group.add(kb);

  const mouse = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  );
  mouse.scale.set(1, 0.5, 1.3);
  mouse.position.set(0.6, 0.95, deskZ + 0.45);
  group.add(mouse);

  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), chairMat);
  seat.position.set(0, 0.5, deskZ + 1.2);
  seat.castShadow = !isLowEnd;
  group.add(seat);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.1), chairMat);
  backrest.position.set(0, 1, deskZ + 1.5);
  group.add(backrest);

  const chairPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x111111 })
  );
  chairPole.position.set(0, 0.25, deskZ + 1.2);
  group.add(chairPole);

  pcHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.2, 0.4),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  pcHitBox.position.set(0, 1.7, deskZ + 0.1);
  pcHitBox.userData.isPC = true;
  group.add(pcHitBox);

  pcWorldPos = new THREE.Vector3(0, 1.7, deskZ + 0.1);

  const exitFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 2.35, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 0.7 })
  );
  exitFrame.position.set(0, 1.17, ROOM_D/2 - 0.04);
  group.add(exitFrame);

  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 2.2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x5a3010, roughness: 0.6 })
  );
  doorPanel.position.set(0, 1.1, ROOM_D/2 - 0.06);
  doorPanel.userData.isExitDoor = true;
  group.add(doorPanel);

  const doorKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffd700, metalness: 0.95, roughness: 0.15,
      emissive: 0xffaa00, emissiveIntensity: 0.4
    })
  );
  doorKnob.position.set(0.4, 1.1, ROOM_D/2 - 0.15);
  group.add(doorKnob);

  const exitGlow = new THREE.Sprite(glowMatYellow);
  exitGlow.scale.set(1.8, 1.8, 1);
  exitGlow.position.set(0, 2.6, ROOM_D/2 - 0.1);
  group.add(exitGlow);

  exitDoorHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.4, 0.3),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  exitDoorHitBox.position.set(0, 1.1, ROOM_D/2 - 0.05);
  exitDoorHitBox.userData.isExitDoor = true;
  group.add(exitDoorHitBox);

  exitDoorWorldPos = new THREE.Vector3(0, 1.1, ROOM_D/2 - 0.05);

  return group;
}

/* ============ UI ============ */
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingDesc = document.getElementById('loadingDesc');
const backBtn = document.getElementById('backBtn');
const crosshair = document.getElementById('crosshair');
const iframeModal = document.getElementById('iframeModal');
const pcIframe = document.getElementById('pcIframe');
const iframeClose = document.getElementById('iframeClose');
const hintEl = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const applyBtn = document.getElementById('applyBtn');

let toastTimeout = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

/* ============ WORLD VISIBILITY ============ */
const worldObjects = [];
scene.traverse(obj => {
  if (obj.isMesh || obj.isSprite || obj.isPoints || obj.isInstancedMesh) {
    worldObjects.push(obj);
  }
});

function setWorldVisible(visible) {
  worldObjects.forEach(o => o.visible = visible);
}

/* ============ ENTER HOUSE ============ */
function enterHouse(houseObj) {
  if (mode !== 'street') return;
  mode = 'loading';
  currentHouse = houseObj.user;
  currentHouseData = houseObj;
  currentIsAgency = !!houseObj.user.isAgency;

  if (currentIsAgency) {
    loadingTitle.textContent = 'ENTERING OLIO AGENCY';
    loadingDesc.innerHTML = houseObj.user.description;
  } else {
    loadingTitle.textContent = 'ENTERING HOUSE';
    loadingDesc.innerHTML = `Welcome to <strong>${houseObj.user.name}</strong>'s house.<br>Inside, you will find their PC where they showcase their work and talent.`;
  }

  loadingOverlay.classList.add('show');

  setTimeout(() => {
    setWorldVisible(false);

    interiorGroup = buildInterior(houseObj.user, currentIsAgency);
    scene.add(interiorGroup);

    camera.position.set(0, 1.6, ROOM_D/2 - 1);
    yaw = 0; pitch = 0;
    targetYaw = 0; targetPitch = 0;

    loadingOverlay.classList.remove('show');
    backBtn.classList.add('show');
    crosshair.classList.add('show');

    if (currentIsAgency) {
      hintEl.innerHTML = '💼 Click PC to APPLY &nbsp;|&nbsp; 🚪 Door to exit';
    } else {
      hintEl.innerHTML = '🖱️ Look &nbsp;|&nbsp; ⌨️ WASD &nbsp;|&nbsp; 🖥️ Click PC &nbsp;|&nbsp; 🚪 Exit';
    }
    mode = 'interior';
  }, 800);
}

/* ============ EXIT HOUSE ============ */
function exitHouse() {
  if (mode !== 'interior') return;

  if (interiorGroup) {
    scene.remove(interiorGroup);
    interiorGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    interiorGroup = null;
    pcHitBox = null;
    exitDoorHitBox = null;
    pcWorldPos = null;
    exitDoorWorldPos = null;
  }

  setWorldVisible(true);

  // Exit at the door of the house you just left
  if (currentHouseData) {
    const { x, z, rotY } = currentHouseData;
    let doorX = x;
    let doorZ = z;

    if (Math.abs(rotY) === Math.PI/2) {
      const dir = rotY > 0 ? 1 : -1;
      doorX = x + dir * 3.5; 
      doorZ = z;
    } else {
      const dir = rotY === 0 ? 1 : -1;
      doorX = x;
      doorZ = z + dir * 3.5;
    }

    camera.position.set(doorX, 1.7, doorZ);
    yaw = rotY + Math.PI; 
    targetYaw = yaw;
    pitch = 0;
    targetPitch = 0;
  } else {
    camera.position.set(0, 1.7, 12);
    yaw = 0; pitch = 0;
    targetYaw = 0; targetPitch = 0;
  }

  backBtn.classList.remove('show');
  crosshair.classList.remove('show');
  hintEl.innerHTML = isMobile
    ? '👆 Tap to enter &nbsp;|&nbsp; 🕹️ Joystick to move'
    : '🖱️ Mouse look &nbsp;|&nbsp; ⌨️ WASD walk &nbsp;|&nbsp; 🏠 Click house';
  mode = 'street';
  currentHouse = null;
  currentIsAgency = false;
  currentHouseData = null;
}

backBtn.addEventListener('click', exitHouse);

/* ============ IFRAME ============ */
function openPC(site) {
  pcIframe.src = site;
  iframeModal.classList.add('show');
}

iframeClose.addEventListener('click', (e) => {
  e.stopPropagation();
  e.preventDefault();
  iframeModal.classList.remove('show');
  setTimeout(() => pcIframe.src = 'about:blank', 300);
});

// Prevent clicks inside the iframe modal from bubbling to document
iframeModal.addEventListener('click', (e) => {
  e.stopPropagation();
});

/* ============ APPLY BUTTON SHORTCUT ============ */
applyBtn.addEventListener('click', () => {
  if (iframeModal.classList.contains('show')) return;

  if (mode === 'street') {
    const agencyHouseObj = {
      user: AGENCY_DATA,
      x: 0,
      z: -75,
      rotY: 0
    };
    enterHouse(agencyHouseObj);
    setTimeout(() => {
      if (mode === 'interior' && currentIsAgency) {
        openPC(AGENCY_SITE);
      }
    }, 1500);
  } else if (mode === 'interior') {
    if (currentIsAgency) {
      openPC(AGENCY_SITE);
    } else {
      showToast('🚪 Exit first (ESC)');
    }
  }
});

/* ============ MOUSE LOOK (Desktop) ============ */
document.addEventListener('mousemove', (e) => {
  if (isMobile) return;
  if (mode === 'loading') return;
  if (iframeModal.classList.contains('show')) return;

  const mx = (e.clientX / innerWidth) * 2 - 1;
  const my = (e.clientY / innerHeight) * 2 - 1;
  targetYaw = -mx * Math.PI;
  targetPitch = -my * PITCH_LIMIT;
});

/* ============ MOBILE TOUCH LOOK ============ */
let lookTouchId = null;
let lookLastX = 0, lookLastY = 0;

const lookPad = document.getElementById('lookPad');

lookPad.addEventListener('touchstart', (e) => {
  if (mode === 'loading' || iframeModal.classList.contains('show')) return;
  const t = e.changedTouches[0];
  lookTouchId = t.identifier;
  lookLastX = t.clientX;
  lookLastY = t.clientY;
}, { passive: true });

lookPad.addEventListener('touchmove', (e) => {
  if (lookTouchId === null) return;
  if (mode === 'loading') return;

  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) {
      const dx = t.clientX - lookLastX;
      const dy = t.clientY - lookLastY;
      lookLastX = t.clientX;
      lookLastY = t.clientY;

      targetYaw -= dx * 0.008;
      targetPitch -= dy * 0.008;
      targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
    }
  }
}, { passive: true });

lookPad.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) lookTouchId = null;
  }
}, { passive: true });

/* ============ MOBILE JOYSTICK ============ */
const joystickZone = document.getElementById('joystickZone');
const joystickStick = document.getElementById('joystickStick');
let joyTouchId = null;
let joyCenter = { x: 0, y: 0 };
let joyVector = { x: 0, y: 0 };
const JOY_MAX = 45;

function updateJoyStickPosition(dx, dy) {
  const dist = Math.sqrt(dx*dx + dy*dy);
  const clampedDist = Math.min(dist, JOY_MAX);
  const angle = Math.atan2(dy, dx);
  const x = Math.cos(angle) * clampedDist;
  const y = Math.sin(angle) * clampedDist;
  joystickStick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

  joyVector.x = x / JOY_MAX;
  joyVector.y = y / JOY_MAX;
}

function resetJoystick() {
  joystickStick.style.transform = 'translate(-50%, -50%)';
  joyVector.x = 0;
  joyVector.y = 0;
}

joystickZone.addEventListener('touchstart', (e) => {
  if (mode === 'loading' || iframeModal.classList.contains('show')) return;
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;

  const rect = joystickZone.getBoundingClientRect();
  joyCenter.x = rect.left + rect.width/2;
  joyCenter.y = rect.top + rect.height/2;

  updateJoyStickPosition(t.clientX - joyCenter.x, t.clientY - joyCenter.y);
}, { passive: true });

joystickZone.addEventListener('touchmove', (e) => {
  if (joyTouchId === null) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      updateJoyStickPosition(t.clientX - joyCenter.x, t.clientY - joyCenter.y);
    }
  }
}, { passive: true });

joystickZone.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      joyTouchId = null;
      resetJoystick();
    }
  }
}, { passive: true });

/* ============ INTERACTION / RAYCAST ============ */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function handleInteraction(clientX, clientY, isTap) {
  if (iframeModal.classList.contains('show')) return;
  if (mode === 'loading') return;

  if (mode === 'street') {
    mouseNDC.x = (clientX / innerWidth) * 2 - 1;
    mouseNDC.y = -(clientY / innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(clickableObjects, false);

    if (hits.length > 0) {
      const house = hits[0].object.userData.house;
      if (house) {
        const hitPoint = hits[0].point;
        const dist = camera.position.distanceTo(hitPoint);
        if (dist > DOOR_ENTER_DISTANCE) {
          showToast('🚪 Move closer to the door!');
          return;
        }
        
        let houseData = allHouses.find(h => h.user.name === house.name);
        if (!houseData && house.isAgency) {
          houseData = { user: AGENCY_DATA, x: 0, z: -75, rotY: 0 };
        }
        
        if (houseData) enterHouse(houseData);
      }
    }
  } else if (mode === 'interior') {
    mouseNDC.x = 0;
    mouseNDC.y = 0;
    raycaster.setFromCamera(mouseNDC, camera);

    if (pcHitBox && pcWorldPos) {
      const pcHits = raycaster.intersectObject(pcHitBox, false);
      if (pcHits.length > 0 && currentHouse) {
        const dist = camera.position.distanceTo(pcWorldPos);
        if (dist > PC_OPEN_DISTANCE) {
          showToast('🖥️ Move closer to the PC!');
          return;
        }
        openPC(currentHouse.site);
        return;
      }
    }

    if (exitDoorHitBox && exitDoorWorldPos) {
      const doorHits = raycaster.intersectObject(exitDoorHitBox, false);
      if (doorHits.length > 0) {
        const dist = camera.position.distanceTo(exitDoorWorldPos);
        if (dist > EXIT_DOOR_DISTANCE) {
          showToast('🚪 Move closer to the door!');
          return;
        }
        exitHouse();
        return;
      }
    }
  }
}

document.addEventListener('click', (e) => {
  if (isMobile) return;
  if (iframeModal.classList.contains('show')) return; // ← Added guard
  if (e.target.closest('.iframe-modal')) return;      // ← Added guard
  handleInteraction(e.clientX, e.clientY, false);
});

let tapStartTime = 0;
let tapStartX = 0, tapStartY = 0;
let tapMoved = false;

lookPad.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  tapStartTime = performance.now();
  tapStartX = t.clientX;
  tapStartY = t.clientY;
  tapMoved = false;
}, { passive: true });

lookPad.addEventListener('touchmove', (e) => {
  if (tapStartTime === 0) return;
  for (const t of e.changedTouches) {
    const dx = t.clientX - tapStartX;
    const dy = t.clientY - tapStartY;
    if (Math.sqrt(dx*dx + dy*dy) > 15) tapMoved = true;
  }
}, { passive: true });

lookPad.addEventListener('touchend', (e) => {
  if (tapStartTime === 0) return;
  const t = e.changedTouches[0];
  const elapsed = performance.now() - tapStartTime;
  const dx = t.clientX - tapStartX;
  const dy = t.clientY - tapStartY;
  const moved = Math.sqrt(dx*dx + dy*dy);

  if (elapsed < 300 && moved < 15 && !tapMoved) {
    handleInteraction(t.clientX, t.clientY, true);
  }
  tapStartTime = 0;
}, { passive: true });

/* ============ KEYBOARD ============ */
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;

  if (e.key === 'Escape') {
    if (iframeModal.classList.contains('show')) {
      iframeClose.click();
    } else if (mode === 'interior') {
      exitHouse();
    }
  }
});
document.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

/* ============ COLLISION ============ */
function clampInsideRoom(pos) {
  const maxX = ROOM_W/2 - WALL_MARGIN;
  const maxZ = ROOM_D/2 - WALL_MARGIN;
  pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
  pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));
}

function checkStreetCollision(newPos) {
  const r = 0.4;
  for (const box of collisionBoxes) {
    if (newPos.x + r > box.minX && newPos.x - r < box.maxX &&
        newPos.z + r > box.minZ && newPos.z - r < box.maxZ) {
      return true;
    }
  }
  return false;
}

/* ============ CROSSHAIR STATE ============ */
function updateCrosshairState() {
  if (mode !== 'interior' || iframeModal.classList.contains('show')) { // ← Added iframe check
    crosshair.classList.remove('active');
    return;
  }


  mouseNDC.x = 0;
  mouseNDC.y = 0;
  raycaster.setFromCamera(mouseNDC, camera);

  let active = false;

  if (pcHitBox && pcWorldPos) {
    const pcHits = raycaster.intersectObject(pcHitBox, false);
    if (pcHits.length > 0) {
      const dist = camera.position.distanceTo(pcWorldPos);
      if (dist <= PC_OPEN_DISTANCE) active = true;
    }
  }

  if (!active && exitDoorHitBox && exitDoorWorldPos) {
    const doorHits = raycaster.intersectObject(exitDoorHitBox, false);
    if (doorHits.length > 0) {
      const dist = camera.position.distanceTo(exitDoorWorldPos);
      if (dist <= EXIT_DOOR_DISTANCE) active = true;
    }
  }

  if (active) crosshair.classList.add('active');
  else crosshair.classList.remove('active');
}

/* ============ ANIMATION LOOP ============ */
const clock = new THREE.Clock();
let frames = 0, lastFpsTime = performance.now();
const fpsEl = document.getElementById('fps');

let lastCullTime = 0;
const CULL_INTERVAL = 150;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  yaw   += (targetYaw   - yaw)   * 8 * dt;
  pitch += (targetPitch - pitch) * 8 * dt;

  if (!iframeModal.classList.contains('show') && mode !== 'loading') {
    const speed = 4 * dt;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right   = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    let dx = 0, dz = 0;

    if (keys['w'] || keys['arrowup'])    { dx += forward.x; dz += forward.z; }
    if (keys['s'] || keys['arrowdown'])  { dx -= forward.x; dz -= forward.z; }
    if (keys['a'] || keys['arrowleft'])  { dx -= right.x;   dz -= right.z; }
    if (keys['d'] || keys['arrowright']) { dx += right.x;   dz += right.z; }

    if (Math.abs(joyVector.x) > 0.05 || Math.abs(joyVector.y) > 0.05) {
      const fwd = -joyVector.y;
      const rgt = joyVector.x;
      dx += forward.x * fwd + right.x * rgt;
      dz += forward.z * fwd + right.z * rgt;
    }

    if (mode === 'street') {
      const tryX = camera.position.clone();
      tryX.x += dx * speed;
      if (!checkStreetCollision(tryX)) camera.position.x = tryX.x;

      const tryZ = camera.position.clone();
      tryZ.z += dz * speed;
      if (!checkStreetCollision(tryZ)) camera.position.z = tryZ.z;
    } else if (mode === 'interior') {
      camera.position.x += dx * speed;
      camera.position.z += dz * speed;
      clampInsideRoom(camera.position);
    }
  }

  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  const now = performance.now();
  if (now - lastCullTime > CULL_INTERVAL) {
    updateHouseVisibility();
    lastCullTime = now;
  }

  updateCrosshairState();

  renderer.render(scene, camera);

  frames++;
  if (now - lastFpsTime > 500) {
    fpsEl.textContent = Math.round(frames * 1000 / (now - lastFpsTime)) + ' FPS';
    frames = 0;
    lastFpsTime = now;
  }
}

/* ============ INIT ============ */
async function init() {
  loadingOverlay.classList.add('show');
  loadingTitle.textContent = 'LOADING NEIGHBORHOOD';
  loadingDesc.innerHTML = 'Preparing the community...';

  const users = await loadUsers();
  generateStreet(users);

  // Place lamps near the houses (dynamic count)
  addStreetLamps(Math.ceil(users.length / 2) + 2);

  // Agency: place at the end of the houses (dynamic)
  // Agency: place at the START (in front of camera)
const agencyZ = 0; // Start position
const agencyData = buildAgency(0, agencyZ, 0);
scene.add(agencyData.group);
allHouses.push({
  group: agencyData.group,
  user: AGENCY_DATA,
  position: new THREE.Vector3(0, 0, agencyZ),
  x: 0,
  z: agencyZ,
  rotY: 0
});

  loadingOverlay.classList.remove('show');
  if (isMobile) {
    hintEl.innerHTML = '👆 Tap house &nbsp;|&nbsp; 🕹️ Joystick &nbsp;|&nbsp; 👀 Drag right';
  }

  animate();
  console.log(`✅ Scene ready with ${users.length} users`);
}

init();

/* ============ RESIZE ============ */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

} catch (err) {
  console.error('❌ ERROR:', err);
  document.body.innerHTML += `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#e74c3c;color:#fff;padding:20px 30px;border-radius:10px;
      font-family:monospace;z-index:9999;max-width:80%;">
      <b>ERROR:</b> ${err.message}<br><br>
      <small>F12 → Console</small>
    </div>
  `;
}