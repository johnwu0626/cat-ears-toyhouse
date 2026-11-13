import * as THREE from './vendor/three.module.js';

const ROOM = Object.freeze({left: 24, right: 696, top: 112, bottom: 652});
const CAT_COLORS = Object.freeze({
  orange: {fur: '#df9451', light: '#f3bc7c', stripe: '#ae693b', cream: '#fff0d5', eye: '#35443c', collar: '#6c9f91'},
  tabby: {fur: '#979c92', light: '#bdc0af', stripe: '#636f66', cream: '#f5eedc', eye: '#3c4d42', collar: '#ce8b70'},
  black: {fur: '#414c4f', light: '#5d6c6a', stripe: '#303a3e', cream: '#e8ddc4', eye: '#d8b768', collar: '#cc9e53'}
});
const TOYS = ['#d59069', '#8ca899', '#dfbd76', '#b3a0b9'];
const CAT_TYPES = ['orange', 'tabby', 'black'];
const EMPTY = Object.freeze([]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wx = x => (x - 360) / 100;
const wz = y => (y - 380) / 100;
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const damp = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt));

function roundedCube() {
  const s = new THREE.Shape(), a = -.42, b = .42, r = .10;
  s.moveTo(a + r, a); s.lineTo(b - r, a); s.quadraticCurveTo(b, a, b, a + r);
  s.lineTo(b, b - r); s.quadraticCurveTo(b, b, b - r, b);
  s.lineTo(a + r, b); s.quadraticCurveTo(a, b, a, b - r);
  s.lineTo(a, a + r); s.quadraticCurveTo(a, a, a + r, a);
  const g = new THREE.ExtrudeGeometry(s, {depth: .84, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .08, bevelThickness: .08, curveSegments: 5});
  g.translate(0, 0, -.42);
  g.computeVertexNormals();
  return g;
}

/** A real, independently renderable Three.js toy room. It owns no game state. */
export class ToyRenderer {
  constructor(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('ToyRenderer requires a canvas element.');
    this.canvas = canvas;
    this.disposed = false;
    this.contextLost = false;
    this.materials = new Map();
    this.geometries = new Set();
    this.tubeCache = new Map();
    this.textures = new Set();
    this.sceneSpec = null;
    try {
      this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'high-performance'});
    } catch (error) {
      throw new Error('WebGL is unavailable. Please enable hardware acceleration or use a browser with WebGL support.', {cause: error});
    }
    this.renderer.setClearColor('#f3eadc', 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.8));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 60);
    this.camera.position.set(8.4, 11.8, 10.8);
    this.camera.lookAt(0, .63, -.02);
    this.camera.updateMatrixWorld();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hitPoint = new THREE.Vector3();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tempVector = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.fitPoints = [];
    for (const x of [-3.74, 3.74]) for (const z of [-3.08, 3.10]) this.fitPoints.push(new THREE.Vector3(x, -.38, z));
    for (const x of [-3.74, 3.74]) this.fitPoints.push(new THREE.Vector3(x, 2.33, -3.08));
    this.fitPoints.push(new THREE.Vector3(-3.74, 2.33, .32), new THREE.Vector3(-3.74, 1.33, 2.92), new THREE.Vector3(3.74, 1.90, -2.42));
    this.geo = {
      round: this._geometry(roundedCube()),
      box: this._geometry(new THREE.BoxGeometry(1, 1, 1)),
      sphere: this._geometry(new THREE.SphereGeometry(1, 20, 14)),
      cylinder: this._geometry(new THREE.CylinderGeometry(1, 1, 1, 20)),
      cone: this._geometry(new THREE.ConeGeometry(1, 1, 3, 1)),
      plane: this._geometry(new THREE.PlaneGeometry(1, 1)),
      ring: this._geometry(new THREE.TorusGeometry(1, .045, 6, 40)),
      cup: this._geometry(new THREE.CylinderGeometry(1, .83, 1, 20)),
      pot: this._geometry(new THREE.CylinderGeometry(1, .72, 1, 16)),
      shade: this._geometry(new THREE.CylinderGeometry(.65, 1, 1, 24, 1, true))
    };
    this._makeTextures();
    this._lights();
    this.room = new THREE.Group(); this.scene.add(this.room);
    this.player = this._makePlayer(); this.scene.add(this.player.root);
    this.cats = {};
    for (const type of CAT_TYPES) { this.cats[type] = this._makeCat(type); this.scene.add(this.cats[type].root); }
    this._makeMarkers();
    this._makeParticlePool();
    this._initMotion();
    this._makeMotionPool();
    this.lurePool = Array.from({length: 8}, () => this._makeYarn());
    this.lurePool.forEach(g => {g.visible = false; this.scene.add(g);});
    this._onContextLost = event => {event.preventDefault(); this.contextLost = true;};
    this.canvas.addEventListener('webglcontextlost', this._onContextLost);
    this._resizeHandler = () => this.resize();
    if (typeof ResizeObserver !== 'undefined') {this.observer = new ResizeObserver(this._resizeHandler); this.observer.observe(canvas);}
    this.resize();
  }

  _geometry(g) { this.geometries.add(g); return g; }
  _mat(color, options) {
    const key = options ? color + '|' + JSON.stringify(options) : color;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({color, roughness: .76, metalness: 0, ...options}));
    return this.materials.get(key);
  }
  _mesh(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  _box(parent, x, y, z, w, h, d, color, round = true, options) {
    return this._mesh(parent, round ? this.geo.round : this.geo.box, this._mat(color, options), x, y, z, w, h, d);
  }
  _ball(parent, x, y, z, rx, ry, rz, color, options) {
    return this._mesh(parent, this.geo.sphere, this._mat(color, options), x, y, z, rx, ry, rz);
  }
  _cyl(parent, x, y, z, r, h, color, options) {
    return this._mesh(parent, this.geo.cylinder, this._mat(color, options), x, y, z, r, h, r);
  }
  _ring(parent, x, y, z, radius, color, options) {
    return this._mesh(parent, this.geo.ring, this._mat(color, options), x, y, z, radius, radius, radius);
  }
  _rod(parent, a, b, radius, color, options) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), delta = vb.clone().sub(va);
    const mesh = this._cyl(parent, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, radius, delta.length(), color, options);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return mesh;
  }
  _tube(parent, points, radius, color, segments = 20, options) {
    const key = JSON.stringify([points, radius, segments]);
    let geometry = this.tubeCache.get(key);
    if (!geometry) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
      geometry = this._geometry(new THREE.TubeGeometry(curve, segments, radius, 7, false));
      this.tubeCache.set(key, geometry);
    }
    return this._mesh(parent, geometry, this._mat(color, options), 0, 0, 0);
  }
  _group(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  _makeTextures() {
    const make = (size, paint) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d'); if (!ctx) throw new Error('Canvas textures are unavailable.');
      paint(ctx, size);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.textures.add(texture); return texture;
    };
    this.woodTexture = make(256, (c, s) => {
      c.fillStyle = '#d8b781'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 180; i++) {
        const y = (i * 37) % s;
        c.strokeStyle = i % 3 ? 'rgba(140,91,44,.08)' : 'rgba(255,248,218,.23)';
        c.lineWidth = i % 4 ? .6 : 1.8; c.beginPath(); c.moveTo(0, y);
        c.bezierCurveTo(s * .34, y + Math.sin(i) * 8, s * .65, y - Math.cos(i) * 5, s, y); c.stroke();
      }
    });
    this.woodTexture.wrapS = this.woodTexture.wrapT = THREE.RepeatWrapping;
    this.woodTexture.repeat.set(1.3, 1);
    this.rugTexture = make(256, (c, s) => {
      c.fillStyle = '#e2ac6d'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        c.fillStyle = i % 8 ? 'rgba(130,103,66,.12)' : 'rgba(255,252,230,.7)'; c.fillRect(i, 0, 1, s);
        c.fillStyle = i % 8 ? 'rgba(255,252,225,.4)' : 'rgba(129,106,71,.12)'; c.fillRect(0, i, s, 1);
      }
      c.strokeStyle = '#fff0ce'; c.lineWidth = 14; c.strokeRect(21, 21, s - 42, s - 42);
      c.strokeStyle = '#b76f47'; c.lineWidth = 3; c.strokeRect(35, 35, s - 70, s - 70);
      c.fillStyle = '#f7e6bf';
      for (const x of [79, 128, 177]) for (const y of [79, 128, 177]) {
        c.beginPath(); c.moveTo(x, y - 15); c.lineTo(x + 13, y); c.lineTo(x, y + 15); c.lineTo(x - 13, y); c.closePath(); c.fill();
      }
    });
    this.shadowTexture = make(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(63,45,29,.34)'); g.addColorStop(.45, 'rgba(63,45,29,.18)'); g.addColorStop(1, 'rgba(63,45,29,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    });
    this.shadowMat = new THREE.MeshBasicMaterial({map: this.shadowTexture, transparent: true, depthWrite: false, opacity: .72, toneMapped: false});
    this.materials.set('contact-shadow', this.shadowMat);
    this.floorMaterial = new THREE.MeshStandardMaterial({color: '#f5d7aa', map: this.woodTexture, roughness: .82});
    this.materials.set('wood-floor', this.floorMaterial);
    this.rugMaterial = new THREE.MeshStandardMaterial({color: '#fff0d0', map: this.rugTexture, roughness: 1});
    this.materials.set('woven-rug', this.rugMaterial);
  }

  _contact(parent, x, z, w, d, y = .052) {
    const m = this._mesh(parent, this.geo.plane, this.shadowMat, x, y, z, w, d, 1);
    m.rotation.x = -Math.PI / 2; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1; return m;
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight('#fff6df', '#8f9f82', 1.55));
    this.scene.add(new THREE.AmbientLight('#fff0d9', .20));
    const sun = new THREE.DirectionalLight('#fff0d8', 3.1);
    sun.position.set(-3.8, 8, -4.5); sun.target.position.set(.4, 0, .4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
    sun.shadow.camera.near = .5; sun.shadow.camera.far = 24;
    sun.shadow.normalBias = .035; sun.shadow.bias = -.00025; sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#dbeee9', .85); fill.position.set(4, 4, 6); this.scene.add(fill);
  }

  setScene(scene) {
    if (this.disposed) throw new Error('ToyRenderer has been disposed.');
    if (!scene || !Array.isArray(scene.furniture)) throw new Error('ToyRenderer.setScene requires a furniture array.');
    this.sceneSpec = scene;
    // Every mesh uses shared cached geometry/material, so changing rooms is cheap.
    this.room.clear();
    this._buildRoom(scene);
    for (const f of scene.furniture) this._furniture(f, scene);
    for (const zone of scene.noiseZones || []) this._noiseZone(zone);
    if (this.motion) this._resetMotion();
  }

  _buildRoom(spec) {
    const r = this.room;
    const wall = spec.id === 'bedroom' ? '#c9aaa5' : spec.id === 'dining-room' ? '#c3c39c' : '#b5cdbd';
    const sideWall = '#e6d6b7';
    this._box(r, 0, -.25, .02, 7.34, .38, 6.08, '#99683e');
    this._box(r, 0, -.085, .02, 7.36, .13, 6.10, '#c89b64');
    this._box(r, 0, -.325, .02, 7.18, .12, 5.94, '#805638');
    // Individually modelled floorboards add genuine depth at their seams.
    const z0 = -2.72, rows = 15, rowDepth = 5.48 / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        const x0 = -3.4 + col * 1.70;
        const m = this._mesh(r, this.geo.box, this.floorMaterial, x0 + .847, .013, z0 + row * rowDepth + rowDepth / 2, 1.686, .042, rowDepth - .012);
        m.castShadow = false;
      }
    }
    // Rear wall with a real rectangular opening rather than a painted window.
    this._box(r, -1.66, 1.05, -2.84, 3.68, 2.10, .15, wall, false);
    this._box(r, 2.82, 1.05, -2.84, 1.30, 2.10, .15, wall, false);
    this._box(r, 1.08, .34, -2.84, 2.20, .68, .15, wall, false);
    this._box(r, 1.08, 1.985, -2.84, 2.20, .23, .15, wall, false);
    this._box(r, 0, 2.11, -2.84, 7.04, .10, .20, '#edf1de');
    this._box(r, 0, .13, -2.735, 7.00, .15, .055, '#faf2da');
    this._window(r, 1.08, 1.30, -2.83, 2.04, 1.16, false);
    // Side wall is lower in front, leaving every playable route visible.
    this._box(r, -3.49, 1.05, -2.38, .15, 2.10, .82, sideWall, false);
    this._box(r, -3.49, .32, -.88, .15, .64, 2.20, sideWall, false);
    this._box(r, -3.49, 1.985, -.88, .15, .23, 2.20, sideWall, false);
    this._box(r, -3.49, .57, 1.43, .15, 1.14, 2.42, sideWall, false);
    this._box(r, -3.49, .13, .0, .20, .15, 5.5, '#faf2da');
    this._window(r, -3.49, 1.30, -.88, 2.02, 1.16, true);
    this._box(r, -3.49, 1.16, 1.45, .21, .10, 2.44, '#edf1de');
    this._box(r, -3.49, 2.11, -1.08, .21, .10, 3.42, '#edf1de');
    // Framed miniature botanical prints have physical frames and raised leaves.
    this._frame(r, -2.55, 1.36, -2.73, .46, .59, '#8cae91', 0);
    this._frame(r, -1.86, 1.46, -2.73, .45, .62, '#d0a776', 1);
    this._clock(r, -.91, 1.55, -2.72);
    const rug = this._mesh(r, this.geo.round, this.rugMaterial, .0, .052, .5, 3.45, .025, 2.84);
    rug.castShadow = false;
    for (let i = 0; i < 26; i++) {
      const x = -1.50 + i * .12;
      this._box(r, x, .056, -.96, .016, .012, .14, '#d2c3a0');
      this._box(r, x, .056, 1.96, .016, .012, .14, '#d2c3a0');
    }
    this._lamp(r, 3.46, -2.42);
    this._catDoor(r, 2.85, -2.73);
    // A nameplate on the wooden plinth reinforces the miniature scale.
    this._box(r, 2.45, -.21, 3.08, .70, .15, .025, '#d6b16d', true, {metalness: .35, roughness: .4});
    for (const x of [2.15, 2.75]) this._ball(r, x, -.21, 3.103, .012, .012, .009, '#8d7447');
  }

  _window(parent, x, y, z, w, h, side) {
    const g = this._group(parent, x, y, z); if (side) g.rotation.y = Math.PI / 2;
    const frame = '#f8f0db';
    this._box(g, -w / 2, 0, .015, .075, h + .14, .13, frame);
    this._box(g, w / 2, 0, .015, .075, h + .14, .13, frame);
    this._box(g, 0, -h / 2, .02, w + .16, .08, .15, frame);
    this._box(g, 0, h / 2, .02, w + .16, .08, .15, frame);
    this._box(g, 0, 0, .035, .055, h, .075, frame);
    this._box(g, 0, -.06, .035, w, .045, .075, frame);
    this._box(g, 0, -h / 2 - .04, .12, w + .25, .085, .34, '#e5c99d');
    const pane = this._box(g, 0, 0, -.055, w, h, .018, '#c7e3de', false, {transparent: true, opacity: .32, roughness: .18, metalness: .02, depthWrite: false});
    pane.castShadow = false;
    // Three-dimensional greenery outside the windows, entirely outside the playfield.
    for (let i = 0; i < 3; i++) this._ball(g, -.62 + i * .61, -.37 + (i % 2) * .11, -.20, .39, .29, .13, i % 2 ? '#b6c7a2' : '#c6d6b5');
    const curtain = '#eee8d3';
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 4; i++) this._cyl(g, sign * (w / 2 + .09) + (i - 1.5) * .055, -.02, .10 + Math.sin(i) * .025, .053, h + .18, curtain);
      this._box(g, sign * (w / 2 + .09), -.18, .15, .21, .07, .04, '#b8c4a4');
    }
    this._rod(g, [-w / 2 - .22, h / 2 + .14, .10], [w / 2 + .22, h / 2 + .14, .10], .025, '#b39a72');
  }

  _frame(parent, x, y, z, w, h, accent, variant) {
    const g = this._group(parent, x, y, z);
    this._box(g, 0, 0, 0, w, h, .07, '#b58c64');
    this._box(g, 0, 0, .045, w - .065, h - .065, .025, '#fff6dc');
    if (!variant) {
      this._rod(g, [0, -.18, .065], [0, .18, .065], .009, '#829b77');
      for (let i = 0; i < 4; i++) {
        const leaf = this._ball(g, (i % 2 ? 1 : -1) * .06, -.10 + i * .07, .075, .055, .10, .013, accent);
        leaf.rotation.z = i % 2 ? -.6 : .6;
      }
    } else {
      this._ball(g, .02, .08, .075, .095, .095, .012, '#d7af73');
      this._ball(g, -.035, -.11, .08, .15, .07, .015, accent);
      this._ball(g, .07, -.16, .09, .12, .055, .015, '#a9b08a');
    }
  }
  _clock(parent, x, y, z) {
    const g = this._group(parent, x, y, z);
    const rim = this._cyl(g, 0, 0, 0, .23, .07, '#b9966d'); rim.rotation.x = Math.PI / 2;
    const face = this._cyl(g, 0, 0, .045, .199, .013, '#fff5dc'); face.rotation.x = Math.PI / 2;
    for (let i = 0; i < 12; i++) this._ball(g, Math.sin(i * Math.PI / 6) * .163, Math.cos(i * Math.PI / 6) * .163, .06, .01, .01, .008, '#a29678');
    this._rod(g, [0, 0, .07], [0, .11, .07], .008, '#637463');
    this._rod(g, [0, 0, .073], [.085, -.045, .073], .009, '#637463');
  }
  _lamp(parent, x, z) {
    const brass = '#c3a064', opts = {metalness: .45, roughness: .38};
    this._cyl(parent, x, .07, z, .19, .09, brass, opts);
    this._cyl(parent, x, .77, z, .023, 1.40, brass, opts);
    this._ball(parent, x, 1.49, z, .065, .08, .065, '#fff1bb', {emissive: '#f5cf77', emissiveIntensity: .4});
    this._mesh(parent, this.geo.shade, this._mat('#f9eac8', {side: THREE.DoubleSide, roughness: 1}), x, 1.53, z, .27, .34, .27);
    const edge = this._ring(parent, x, 1.36, z, .27, '#d8bd8f'); edge.rotation.x = Math.PI / 2;
  }
  _catDoor(parent, x, z) {
    this._box(parent, x, .34, z + .03, .64, .66, .12, '#cea889');
    this._ball(parent, x, .29, z + .105, .235, .255, .018, '#6a6655', {roughness: 1});
    const rim = this._ring(parent, x, .31, z + .125, .238, '#e0ba94'); rim.scale.y *= 1.08;
    this._box(parent, x, .07, z + .16, .49, .10, .16, '#e4c5a2');
    const earL = this._mesh(parent, this.geo.cone, this._mat('#cea889'), x - .20, .71, z + .025, .09, .18, .09); earL.rotation.z = .25;
    const earR = this._mesh(parent, this.geo.cone, this._mat('#cea889'), x + .20, .71, z + .025, .09, .18, .09); earR.rotation.z = -.25;
  }

  _furniture(f, scene) {
    const x = wx(f.x + f.w / 2), z = wz(f.y + f.h / 2), w = f.w / 100, d = f.h / 100;
    this._contact(this.room, x, z, w + .30, d + .30);
    const g = this._group(this.room, x, .04, z);
    switch (f.type) {
      case 'sofa': this._sofa(g, w, d); break;
      case 'chair': this._chair(g, w, d); break;
      case 'bed': this._bed(g, w, d, scene); break;
      case 'counter': this._counter(g, w, d); break;
      case 'shelf': this._shelf(g, w, d); break;
      case 'plant': this._plant(g, 0, 0, 0, Math.min(w, d) / .46); break;
      default: this._table(g, w, d);
    }
  }
  _legs(g, w, d, height, inset = .12) {
    for (const x of [-w / 2 + inset, w / 2 - inset]) for (const z of [-d / 2 + inset, d / 2 - inset]) this._cyl(g, x, height / 2, z, .045, height, '#b68b5b');
  }
  _sofa(g, w, d) {
    const teal = '#3d9189', light = '#63a99a';
    this._legs(g, w, d, .20, .13);
    this._box(g, 0, .24, 0, w, .22, d, '#326e69');
    this._box(g, 0, .57, -d / 2 + .13, w - .06, .68, .30, teal);
    for (const sign of [-1, 1]) this._box(g, sign * (w / 2 - .10), .43, .035, .23, .47, d + .01, teal);
    const seatW = (w - .40) / 2;
    for (const sign of [-1, 1]) {
      this._box(g, sign * (seatW / 2 + .012), .41, .08, seatW - .018, .18, d - .28, light);
      this._box(g, sign * (seatW / 2 + .01), .65, -d / 2 + .255, seatW - .03, .37, .16, '#579f92');
    }
    const pillowA = this._box(g, -w * .27, .63, .0, .37, .36, .15, '#e47f38'); pillowA.rotation.z = .15; pillowA.rotation.x = -.13;
    const pillowB = this._box(g, w * .28, .63, .0, .34, .34, .15, '#edc463'); pillowB.rotation.z = -.13; pillowB.rotation.x = -.10;
    this._ball(g, -w * .27, .63, .09, .025, .025, .012, '#c68252');
    this._ball(g, w * .28, .63, .09, .023, .023, .012, '#d2bc8c');
    const blanket = this._box(g, w * .07, .514, .19, .32, .025, d * .6, '#e8d8ae'); blanket.rotation.y = -.08;
    this._box(g, w * .07, .35, d / 2 + .012, .32, .31, .025, '#e8d8ae');
    for (let i = 0; i < 5; i++) this._box(g, w * .07 - .13 + i * .065, .34, d / 2 + .029, .012, .29, .009, '#c2c3a2');
  }
  _table(g, w, d) {
    const height = .57;
    this._legs(g, w, d, height, .14);
    this._box(g, 0, height + .035, 0, w, .12, d, '#a87545');
    this._box(g, 0, height + .10, 0, w - .025, .035, d - .025, '#cea16a');
    if (w > .75) {
      this._book(g, w * .23, height + .14, -.06, .30, .36, '#4d918c', -.15);
      this._cup(g, -w * .23, height + .13, -.04, .85);
      if (w > 1.6) {
        const plate = this._cyl(g, .0, height + .14, d * .24, .14, .030, '#ecdba6');
        for (let i = 0; i < 3; i++) {
          const ox = Math.sin(i * 2.1) * .055, oz = d * .24 + Math.cos(i * 2.1) * .045;
          this._ball(g, ox, height + .205, oz, .054, .052, .051, i === 1 ? '#efac35' : '#dc7d25');
          this._ball(g, ox, height + .257, oz, .013, .005, .016, '#63844c');
        }
        plate.castShadow = false;
      }
    }
  }
  _chair(g, w, d) {
    this._legs(g, w, d, .37, .12);
    this._box(g, 0, .38, .025, w, .11, d - .03, '#cea87a');
    this._box(g, 0, .45, .07, w - .10, .085, d - .18, '#dcd5ad');
    this._box(g, 0, .66, -d / 2 + .055, w, .53, .12, '#d7b98b');
    this._box(g, 0, .72, -d / 2 + .123, w - .10, .26, .025, '#e9d1a8');
    this._ball(g, 0, .495, .07, .025, .009, .025, '#c0bc94');
  }
  _bed(g, w, d, spec) {
    this._legs(g, w, d, .20, .12);
    this._box(g, 0, .22, 0, w, .20, d, '#c6a279');
    this._box(g, 0, .48, -d / 2 + .06, w + .02, .75, .15, '#d6b88f');
    this._box(g, 0, .38, .01, w - .09, .20, d - .10, '#faf0d8');
    this._box(g, 0, .493, d * .15, w - .07, .045, d * .66, spec.accent || '#c3a4a1');
    this._box(g, 0, .44, d / 2 - .02, w - .07, .18, .035, spec.accent || '#c3a4a1');
    for (const s of [-1, 1]) this._box(g, s * w * .235, .52, -d * .30, w * .37, .12, d * .24, '#fff6e1');
    for (let i = 0; i < 6; i++) this._box(g, -w * .40 + i * w * .16, .52, d * .15, .012, .006, d * .63, '#e4d2c2');
    for (let i = 0; i < 5; i++) this._box(g, 0, .522, -d * .13 + i * d * .14, w - .13, .006, .012, '#e4d2c2');
  }
  _counter(g, w, d) {
    this._box(g, 0, .42, 0, w, .82, d, '#91ad99');
    this._box(g, 0, .08, d / 2 - .02, w - .10, .11, .025, '#698d79');
    const n = Math.max(2, Math.round(w / .55));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + .5) * w / n;
      this._box(g, x, .46, d / 2 + .012, w / n - .035, .62, .035, '#a2bba4');
      this._rod(g, [x - .06, .65, d / 2 + .05], [x + .06, .65, d / 2 + .05], .012, '#d7bd7b', {metalness: .4, roughness: .4});
    }
    this._box(g, 0, .87, 0, w + .025, .10, d + .025, '#f2e8d1');
    this._box(g, -w * .23, .925, -.05, w * .30, .018, d * .58, '#a7bab3');
    this._box(g, -w * .23, .936, -.05, w * .26, .013, d * .49, '#c5d1c5');
    this._tube(g, [[-w * .23, .94, -d * .33], [-w * .23, 1.15, -d * .33], [-w * .23, 1.20, -.07], [-w * .23, 1.08, -.07]], .019, '#9cafaa', 14, {metalness: .6, roughness: .3});
    this._book(g, w * .27, .94, .07, .30, .23, '#c7ad7b', .1);
    this._ball(g, w * .27, 1.0, .06, .055, .05, .05, '#cf8465');
    this._cup(g, w * .19, .93, -d * .30, .62);
  }
  _shelf(g, w, d) {
    const h = 1.16, bookDepth = Math.min(d * .55, .29);
    this._box(g, 0, h / 2, -d / 2 + .035, w, h, .07, '#c69e6f');
    for (const sign of [-1, 1]) this._box(g, sign * (w / 2 - .035), h / 2, 0, .07, h, d, '#d2b184');
    for (let row = 0; row < 4; row++) this._box(g, 0, .05 + row * h / 3, 0, w, .065, d, '#d9b98c');
    const colors = ['#9db2a0', '#d4a17d', '#d9c398', '#7f9b94', '#b2a6ac', '#f0d8a8'];
    for (let row = 0; row < 3; row++) {
      let x = -w / 2 + .095;
      for (let i = 0; x < w / 2 - .10; i++) {
        const bw = .045 + ((i * 3 + row) % 4) * .012;
        const bh = .20 + ((i * 5 + row) % 4) * .026;
        this._box(g, x + bw / 2, .088 + row * h / 3 + bh / 2, d / 2 - bookDepth / 2 - .035, bw, bh, bookDepth, colors[(i + row * 2) % colors.length]);
        this._box(g, x + bw / 2, .13 + row * h / 3, d / 2 - .028, bw * .65, .012, .006, '#f8e8c7');
        x += bw + .013;
      }
    }
    this._plant(g, -w * .22, 1.26, .06, .40);
    const frame = this._group(g, w * .22, 1.40, .05); frame.rotation.x = -.08;
    this._box(frame, 0, 0, 0, .24, .30, .035, '#af8961');
    this._box(frame, 0, 0, .023, .205, .264, .008, '#f9ecd2');
    this._ball(frame, 0, .03, .033, .065, .065, .006, '#d8b47d');
  }
  _book(g, x, y, z, w, d, color, angle) {
    const b = this._group(g, x, y, z); b.rotation.y = angle;
    this._box(b, 0, .017, 0, w, .055, d, color);
    this._box(b, .01, .021, .005, w - .02, .028, d - .025, '#f7ecd2');
    this._box(b, 0, .044, 0, w, .012, d, color);
    this._box(b, 0, .052, -.03, w * .45, .003, .018, '#e8ddbf');
  }
  _cup(g, x, y, z, scale = 1) {
    const c = this._group(g, x, y, z); c.scale.setScalar(scale);
    this._cyl(c, 0, .012, 0, .13, .022, '#f5eddc');
    this._mesh(c, this.geo.cup, this._mat('#fff8e8', {roughness: .3}), 0, .075, 0, .075, .12, .075);
    this._cyl(c, 0, .137, 0, .064, .006, '#8d6242');
    this._ring(c, .085, .08, 0, .043, '#fff8e8', {roughness: .3}).rotation.y = Math.PI / 2;
    this._ball(c, -.015, .142, .0, .028, .002, .015, '#d6b98a');
  }
  _plant(g, x, y, z, scale = 1) {
    const p = this._group(g, x, y, z); p.scale.setScalar(scale);
    this._mesh(p, this.geo.pot, this._mat('#d09c7b'), 0, .16, 0, .19, .31, .19);
    this._cyl(p, 0, .32, 0, .19, .045, '#e2b48e');
    this._cyl(p, 0, .347, 0, .158, .01, '#847459');
    this._rod(p, [0, .34, 0], [.025, .85, 0], .012, '#6e8760');
    const leaves = [[-.15, .57, .03, -.65, .25], [.16, .68, .02, .65, -.1], [-.10, .82, -.04, -.4, .4], [.13, .91, -.02, .5, -.3], [-.19, .42, .07, -1.0, .2], [.16, .47, .11, .85, -.4]];
    leaves.forEach((l, i) => {
      this._rod(p, [0, .35 + i * .055, 0], [l[0], l[1], l[2]], .008, '#718c62');
      const leaf = this._ball(p, l[0], l[1], l[2], .115, .235, .035, i % 2 ? '#648f58' : '#3f7850');
      leaf.rotation.z = l[3]; leaf.rotation.y = l[4];
      const vein = this._rod(p, [0, -.17, .035], [0, .17, .035], .0035, '#afbf91');
      p.remove(vein); leaf.add(vein); vein.position.set(0, 0, 1.02); vein.scale.set(.04, .65, .07);
    });
  }

  _noiseZone(zone) {
    const g = this._group(this.room, wx(zone.x + zone.w / 2), .048, wz(zone.y + zone.h / 2));
    const w = zone.w / 100, d = zone.h / 100;
    const patch = this._box(g, 0, 0, 0, w, .008, d, '#dcae73', true, {transparent: true, opacity: .20, depthWrite: false}); patch.castShadow = false;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 37 % 100) / 100 - .5) * w * .72, z = ((i * 61 % 100) / 100 - .5) * d * .66;
      if (i % 2) {
        const bag = this._group(g, x, .03, z); bag.rotation.y = i * 1.3;
        this._box(bag, 0, 0, 0, .18, .038, .24, '#dbbd8c');
        this._box(bag, 0, .03, -.08, .17, .06, .03, '#cba776');
        this._box(bag, 0, .028, .07, .10, .012, .07, '#ead0a2');
      } else {
        const block = this._box(g, x, .035, z, .09, .065, .10, TOYS[i % TOYS.length]); block.rotation.y = i;
        this._ball(g, x + .08, .06, z + .04, .04, .04, .04, '#e0b56e');
      }
    }
  }

  _makePlayer() {
    const root = new THREE.Group(), body = this._group(root);
    const shadow = this._contact(root, 0, 0, .65, .52, .045);
    const legs = [], arms = [];
    for (const sign of [-1, 1]) {
      const leg = this._group(body, sign * .085, .26, 0);
      this._box(leg, 0, -.09, 0, .13, .22, .14, '#7f9b83');
      this._box(leg, 0, -.195, .035, .15, .09, .23, '#967351');
      this._box(leg, 0, -.222, .04, .15, .025, .24, '#d2bd95'); legs.push(leg);
      const arm = this._group(body, sign * .215, .53, 0);
      this._box(arm, 0, -.115, 0, .12, .26, .14, '#f6ead0');
      this._ball(arm, 0, -.25, .0, .065, .065, .060, '#e6ba91'); arms.push(arm);
    }
    this._box(body, 0, .43, 0, .38, .36, .28, '#fff0d2');
    this._box(body, 0, .29, 0, .37, .07, .28, '#e9d5af');
    this._box(body, 0, .44, -.18, .27, .31, .14, '#95ad91');
    this._box(body, 0, .40, -.26, .20, .14, .04, '#7f9a7b');
    for (const sign of [-1, 1]) this._box(body, sign * .13, .46, .145, .028, .26, .012, '#c1c9a5');
    this._ball(body, 0, .46, .151, .035, .030, .008, '#c89760');
    for (let i = 0; i < 3; i++) this._ball(body, (i - 1) * .027, .50 + (i === 1 ? .01 : 0), .152, .012, .014, .007, '#c89760');
    this._cyl(body, 0, .64, 0, .075, .10, '#e7bb93');
    const head = this._group(body, 0, .76, 0);
    this._ball(head, 0, 0, -.015, .20, .205, .185, '#7b573e');
    this._ball(head, 0, -.015, .034, .181, .175, .17, '#efc59d');
    for (const sign of [-1, 1]) {
      this._ball(head, sign * .18, -.035, .015, .045, .060, .045, '#e6b58d');
      this._ball(head, sign * .065, .008, .186, .020, .026, .012, '#423e34');
      this._ball(head, sign * .095, -.052, .181, .030, .013, .009, '#d99379');
      this._ball(head, sign * .061 - .005, .016, .197, .005, .006, .004, '#fff9e5');
    }
    this._ball(head, .0, -.028, .203, .024, .025, .024, '#e0ad84');
    this._tube(head, [[-.025, -.077, .182], [0, -.084, .190], [.025, -.077, .182]], .005, '#aa7356', 8);
    const hat = this._group(head, 0, .101, 0);
    this._ball(hat, 0, .046, -.007, .205, .13, .189, '#d99154');
    const brim = this._cyl(hat, 0, 0, .006, .226, .055, '#e5a367');
    brim.scale.z *= .91;
    this._ball(hat, .0, .169, -.007, .040, .034, .040, '#e4ac70');
    this._box(hat, .13, .015, .157, .065, .035, .013, '#f7dba6');
    return {root, body, legs, arms, head, hat, shadow};
  }

  _makeCat(type) {
    const p = CAT_COLORS[type], root = new THREE.Group(), body = this._group(root), legs = [];
    const shadow = this._contact(root, 0, 0, .65, .65, .047);
    this._ball(body, 0, .32, -.02, .205, .22, .27, p.fur);
    this._ball(body, 0, .30, .15, .13, .16, .12, p.cream);
    for (let i = 0; i < 4; i++) {
      const sign = i % 2 ? 1 : -1, front = i < 2;
      const leg = this._group(body, sign * .12, .22, front ? .12 : -.16);
      this._box(leg, 0, -.07, 0, .115, .19, .13, p.fur);
      this._ball(leg, 0, -.155, .025, .074, .047, .09, p.cream); legs.push(leg);
    }
    const head = this._group(body, 0, .59, .15);
    this._ball(head, 0, 0, 0, .255, .225, .215, p.fur);
    this._ball(head, 0, -.055, .12, .20, .145, .13, p.light);
    for (const sign of [-1, 1]) {
      const ear = this._mesh(head, this.geo.cone, this._mat(p.fur), sign * .16, .215, -.005, .125, .27, .10);
      ear.rotation.y = Math.PI / 6; ear.rotation.z = -sign * .15;
      const inner = this._mesh(head, this.geo.cone, this._mat('#dda68e'), sign * .16, .216, .052, .073, .165, .025);
      inner.rotation.y = Math.PI / 6; inner.rotation.z = -sign * .15;
      this._ball(head, sign * .085, -.087, .223, .085, .068, .045, p.cream);
      this._ball(head, sign * .105, .018, .204, .034, .047, .023, p.eye, {roughness: .28});
      this._ball(head, sign * .105 - .009, .033, .226, .010, .012, .006, '#fff9df', {roughness: .25});
      this._ball(head, sign * .185, -.065, .163, .032, .017, .012, type === 'black' ? '#7d7168' : '#dda087');
      for (let i = 0; i < 3; i++) this._rod(head, [sign * .14, -.073 - i * .025, .228], [sign * (.29 + i * .014), -.05 - i * .043, .22], .0032, type === 'black' ? '#d8d0b7' : '#80664d');
    }
    this._ball(head, 0, -.067, .266, .032, .020, .020, '#bd837a');
    this._tube(head, [[-.038, -.111, .257], [-.020, -.123, .26], [0, -.109, .263], [.020, -.123, .26], [.038, -.111, .257]], .0045, '#8b6a53', 12);
    if (type !== 'black') {
      for (const x of [-.065, 0, .065]) {
        const stripe = this._box(head, x, .126, .168, .026, .105, .019, p.stripe); stripe.rotation.x = -.40; stripe.rotation.z = -x * 2;
      }
      for (const sign of [-1, 1]) for (let i = 0; i < 2; i++) this._box(body, sign * .19, .36 + i * .055, -.05, .017, .025, .18, p.stripe);
    }
    const collar = this._ring(body, 0, .427, .137, .166, p.collar); collar.rotation.x = Math.PI / 2; collar.scale.z *= .75;
    this._ball(body, 0, .406, .293, .032, .034, .024, '#deb764', {metalness: .35, roughness: .35});
    const tail = this._group(body, 0, .30, -.23);
    this._tube(tail, [[0, 0, 0], [.02, .10, -.18], [.05, .35, -.23], [-.04, .47, -.18], [-.12, .43, -.12]], .049, p.fur, 22);
    this._ball(tail, -.12, .43, -.12, .050, .050, .050, type === 'black' ? p.fur : p.stripe);
    return {root, body, legs, head, tail, shadow};
  }

  _makeMarkers() {
    this.target = new THREE.Group(); this.scene.add(this.target);
    const tr = this._ring(this.target, 0, .066, 0, .17, '#fcf3da', {emissive: '#f9e8c3', emissiveIntensity: .25}); tr.rotation.x = Math.PI / 2;
    const inner = this._ring(this.target, 0, .068, 0, .115, '#7c9f86'); inner.rotation.x = Math.PI / 2;
    this._cyl(this.target, 0, .065, 0, .026, .008, '#7c9f86');
    this.target.visible = false;
    this.alert = new THREE.Group(); this.scene.add(this.alert);
    this._ball(this.alert, 0, 0, 0, .14, .14, .025, '#fff1bd', {emissive: '#f5d16a', emissiveIntensity: .1});
    this._box(this.alert, 0, .035, .032, .034, .103, .018, '#bb7e43');
    this._ball(this.alert, 0, -.052, .033, .019, .019, .012, '#bb7e43');
    this.alert.visible = false;
    this.alertRing = this._ring(this.scene, 0, .061, 0, .34, '#d29a56', {transparent: true, opacity: .45, depthWrite: false});
    this.alertRing.rotation.x = Math.PI / 2; this.alertRing.visible = false; this.alertRing.castShadow = false;
    this.noiseRing = this._ring(this.scene, 0, .060, 0, .30, '#d69b68', {transparent: true, opacity: .35, depthWrite: false});
    this.noiseRing.rotation.x = Math.PI / 2; this.noiseRing.visible = false; this.noiseRing.castShadow = false;
  }
  _makeYarn() {
    const g = new THREE.Group();
    this._ball(g, 0, .14, 0, .13, .13, .13, '#d28a9e');
    for (let i = 0; i < 5; i++) {
      const ring = this._ring(g, 0, .14, 0, .129, i % 2 ? '#e9b2bd' : '#b8758d');
      ring.rotation.set(i * .45, i * .61, i * .25); ring.scale.z = .30;
    }
    this._tube(g, [[.09, .08, .07], [.19, .025, .12], [.25, .025, .07], [.33, .025, .11]], .009, '#d798ab', 10);
    this._contact(g, 0, 0, .46, .46);
    return g;
  }
  _makeParticlePool() {
    this.particles = [];
    for (let i = 0; i < 72; i++) {
      const mesh = this._mesh(this.scene, this.geo.round, this._mat(TOYS[i % TOYS.length]), 0, 0, 0, .04, .012, .025);
      mesh.visible = false; mesh.castShadow = false; this.particles.push(mesh);
    }
  }

  _initMotion() {
    this.reducedMotion = false;
    this.playView = false;
    this.portraitPlay = false;
    this.cameraHome = this.camera.position.clone();
    this.cameraFollow = new THREE.Vector2();
    this.motionPool = [];
    this.motion = {player: {}, cat: {}};
    this._resetMotion();
  }

  /** Keep essential portrait tracking while disabling optional motion effects. */
  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
    if (this.reducedMotion) {
      this._clearMotionEffects();
      if (!this.portraitPlay) {
        this.cameraFollow.set(0, 0);
        this.camera.position.copy(this.cameraHome);
      }
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    }
  }

  /** Switch between the complete toy-room preview and a close portrait chase. */
  setPlayView(active) {
    const next = !!active;
    if (next === this.playView) return;
    this.playView = next;
    this._playCameraReady = false;
    this.cameraFollow.set(0, 0);
    this.camera.position.copy(this.cameraHome);
    this.camera.zoom = 1;
    this.resize();
  }

  _resetMotion() {
    const reset = state => Object.assign(state, {initialized: false, x: 0, y: 0, yaw: 0,
      speed: 0, phase: 0, blend: 0, turn: 0, launch: 0, emit: 0,
      wasMoving: false, wasSprint: false, previousState: '', lastFoot: 0});
    reset(this.motion.player); reset(this.motion.cat);
    this._actorRef = null;
    this._lastGameTime = -1;
    this._lastVisualTime = null;
    this._poseTime = 0;
    this._winAge = 0;
    this._previousMode = 'ready';
    this._playCameraReady = false;
    this._clearMotionEffects();
    if (this.cameraHome) {
      this.cameraFollow.set(0, 0);
      this.camera.position.copy(this.cameraHome);
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    }
  }

  _makeMotionPool() {
    for (let i = 0; i < 64; i++) {
      const kind = i < 36 ? 'dust' : i < 60 ? 'streak' : 'ring';
      const mat = new THREE.MeshBasicMaterial({color: kind === 'dust' ? '#e2bd83' : '#fff0bd',
        transparent: true, opacity: 0, depthWrite: false, toneMapped: false});
      this.materials.set('motion-fx-' + i, mat);
      const mesh = this._mesh(this.scene, kind === 'dust' ? this.geo.sphere : kind === 'ring' ? this.geo.ring : this.geo.round,
        mat, 0, 0, 0);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
      this.motionPool.push({mesh, kind, life: 0, total: 1, size: 0, vx: 0, vy: 0, vz: 0, spin: 0});
    }
    this._fxSerial = 0;
  }

  _clearMotionEffects() {
    for (const fx of this.motionPool || EMPTY) {fx.life = 0; fx.mesh.visible = false;}
  }

  _spawnMotion(kind, x, z, dir, strength = 1, cat = false) {
    if (this.reducedMotion) return;
    const fx = this.motionPool.find(item => item.kind === kind && item.life <= 0);
    if (!fx) return;
    const serial = this._fxSerial++;
    const side = serial % 2 ? 1 : -1;
    const back = kind === 'streak' ? .24 : .10;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    fx.mesh.position.set(x - dx * back - dz * side * .09, kind === 'streak' ? .14 : .075, z - dz * back + dx * side * .09);
    fx.mesh.rotation.set(kind === 'ring' ? Math.PI / 2 : 0, kind === 'ring' ? 0 : Math.PI / 2 - dir, 0);
    fx.total = kind === 'dust' ? .28 + (serial % 3) * .045 : kind === 'ring' ? .25 : .16;
    fx.life = fx.total;
    fx.size = kind === 'dust' ? .038 + strength * .028 : kind === 'ring' ? .22 : .15 + strength * .10;
    fx.vx = -dx * (kind === 'streak' ? .8 : .16) - dz * side * .18;
    fx.vz = -dz * (kind === 'streak' ? .8 : .16) + dx * side * .18;
    fx.vy = kind === 'dust' ? .19 + strength * .07 : 0;
    fx.spin = side * 1.5;
    fx.mesh.material.color.set(kind === 'dust' ? (cat ? '#e6bb76' : '#e5ceb0') : cat ? '#ffd07a' : '#fff3cf');
    fx.mesh.visible = true;
  }

  _motionStep(state, actor, dt, rawDt, active) {
    const wantedYaw = Math.PI / 2 - (Number(actor.dir) || 0);
    if (!state.initialized || Math.hypot(actor.x - state.x, actor.y - state.y) > 130) {
      state.x = actor.x; state.y = actor.y; state.yaw = wantedYaw;
      state.initialized = true; state.speed = 0; state.turn = 0;
    }
    const measured = rawDt > .0001 ? Math.hypot(actor.x - state.x, actor.y - state.y) / rawDt : 0;
    const moving = active && !!actor.moving;
    const targetSpeed = moving ? clamp(Number.isFinite(actor.speed) ? actor.speed : measured || 145, 0, 450) : 0;
    const turn = angleDelta(state.yaw, wantedYaw);
    state.speed = damp(state.speed, targetSpeed, moving ? 18 : 25, dt);
    state.blend = damp(state.blend, moving ? 1 : 0, moving ? 20 : 22, dt);
    state.turn = this.reducedMotion || !active ? 0 : damp(state.turn, moving ? clamp(turn * 2.5, -.65, .65) : 0, 13, dt);
    state.yaw += turn * (this.reducedMotion || !active ? 1 : 1 - Math.exp(-19 * dt));
    if (moving && !this.reducedMotion) state.phase += clamp(state.speed * .093, 7, 29) * dt;
    state.launch = Math.max(0, state.launch - dt);
    state.x = actor.x; state.y = actor.y;
    return moving;
  }

  _animatePlayer(actor, model, dt, rawDt, t) {
    const rig = this.player, state = this.motion.player;
    const active = model.mode === 'playing';
    const moving = this._motionStep(state, actor, dt, rawDt, active);
    const sprint = moving && !!actor.sprinting;
    if (sprint && !state.wasSprint) {
      state.launch = .23;
      this._spawnMotion('ring', wx(actor.x), wz(actor.y), actor.dir, 1.1);
      for (let i = 0; i < 4; i++) this._spawnMotion('dust', wx(actor.x), wz(actor.y), actor.dir, 1.6);
    }
    const blend = active && !this.reducedMotion ? state.blend : 0;
    const stride = Math.sin(state.phase), spring = Math.abs(Math.cos(state.phase));
    const sneaking = active && !!actor.sneaking;
    const effort = sprint ? 1 : sneaking ? .22 : .58;
    const takeoff = state.launch > 0 ? Math.sin((1 - state.launch / .23) * Math.PI) : 0;
    const bob = blend * (spring * (sprint ? .115 : sneaking ? .014 : .067) + takeoff * .065);
    const winning = model.mode === 'won' && !this.reducedMotion;
    const cheer = winning ? Math.max(0, Math.sin(this._winAge * 12)) * Math.max(0, 1 - this._winAge / 1.1) : 0;
    rig.root.position.set(wx(actor.x), 0, wz(actor.y));
    rig.root.rotation.y = state.yaw;
    rig.body.position.y = bob + cheer * .19 + (!active && !winning && !this.reducedMotion ? Math.sin(t * 2.2) * .008 : 0);
    rig.body.rotation.set(blend * (sprint ? .31 : sneaking ? .22 : .13), 0, -state.turn * .36);
    rig.body.scale.set(1 - blend * spring * .045,
      sneaking ? .83 : 1 + blend * (spring - .5) * .12,
      1 + (sprint ? blend * .12 : 0));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      rig.legs[i].rotation.set(side * stride * (sprint ? 1.06 : sneaking ? .31 : .70) * blend, 0, state.turn * .08);
      rig.arms[i].rotation.set(-side * stride * effort * 1.1 * blend - (sprint ? blend * .16 : 0) - cheer * 1.4, 0, (i === 0 ? -1 : 1) * (.06 + cheer * .55));
    }
    rig.head.rotation.set(-rig.body.rotation.x * .55 + blend * spring * .045, state.turn * .34, -state.turn * .20 + stride * blend * .045);
    rig.hat.position.y = .101 + bob * .22;
    rig.hat.rotation.set(-rig.body.rotation.x * .18, 0, stride * blend * .045 - state.turn * .24);
    rig.shadow.scale.set(.65 + bob * .55, .52 + bob * .40, 1);
    if (moving && !sneaking && !this.reducedMotion) {
      state.emit += dt;
      if (state.emit >= (sprint ? .055 : .12)) {
        state.emit = 0;
        this._spawnMotion('dust', wx(actor.x), wz(actor.y), actor.dir, sprint ? 1.3 : .48);
        if (sprint) this._spawnMotion('streak', wx(actor.x), wz(actor.y), actor.dir, 1.35);
      }
    } else state.emit = 0;
    state.wasMoving = moving; state.wasSprint = sprint;
    this.noiseRing.visible = active && !this.reducedMotion && (!!actor.sprinting || (Number(model.noise) || 0) > .2);
    this.noiseRing.position.set(wx(actor.x), .060, wz(actor.y));
    const ns = .30 + (Math.sin(t * 9) + 1) * .055;
    this.noiseRing.scale.set(ns, ns, ns);
  }

  _animateCat(actor, model, dt, rawDt, t) {
    const rig = this.cats[actor.type] || this.cats.orange, state = this.motion.cat;
    const active = model.mode === 'playing';
    const moving = this._motionStep(state, actor, dt, rawDt, active);
    const fleeing = moving && actor.state === 'fleeing';
    const launched = fleeing && state.previousState !== 'fleeing';
    if (launched) {
      state.launch = .32;
      this._spawnMotion('ring', wx(actor.x), wz(actor.y), actor.dir, 1.3, true);
      for (let i = 0; i < 5; i++) this._spawnMotion('dust', wx(actor.x), wz(actor.y), actor.dir, 1.7, true);
    }
    const blend = active && !this.reducedMotion ? state.blend : 0;
    const gallop = Math.sin(state.phase), flight = Math.max(0, gallop);
    const alert = clamp(Number(actor.alert) || 0, 0, 1);
    const coiled = active && !moving && !actor.captured ? alert : 0;
    const takeoff = state.launch > 0 ? Math.sin((1 - state.launch / .32) * Math.PI) : 0;
    const hidden = !!actor.hidden && !moving;
    const jump = blend * (flight * (fleeing ? .16 : .07) + takeoff * .15);
    const winning = model.mode === 'won' && !this.reducedMotion;
    const cheer = winning ? Math.max(0, Math.sin(this._winAge * 12 + .5)) * Math.max(0, 1 - this._winAge / 1.1) : 0;
    rig.root.position.set(wx(actor.x), 0, wz(actor.y));
    rig.root.rotation.y = state.yaw;
    rig.body.position.y = jump + cheer * .12 + (!moving && !this.reducedMotion ? Math.sin(t * 3) * .008 : 0);
    const coil = this.reducedMotion ? 0 : coiled;
    rig.body.scale.set(1 + coil * .10 - blend * flight * .05,
      hidden ? .79 - coil * .18 : 1 - blend * .10 + blend * flight * .20,
      1 + coil * .17 + blend * (fleeing ? .20 + gallop * .10 : .06));
    rig.body.rotation.set(blend * (gallop * .10 + takeoff * -.18) + coil * -.08, 0, -state.turn * .45);
    for (let i = 0; i < rig.legs.length; i++) {
      const front = i < 2;
      const gait = fleeing ? Math.sin(state.phase + (front ? .45 : Math.PI + .12) + (i % 2) * .16) : Math.sin(state.phase + (i === 0 || i === 3 ? 0 : Math.PI));
      rig.legs[i].rotation.set(gait * blend * (fleeing ? 1.12 : .60) - (front ? coil * .18 : -coil * .28), 0, state.turn * .12);
    }
    rig.tail.rotation.set(blend * -.36 + flight * blend * .22,
      this.reducedMotion ? 0 : Math.sin(t * (fleeing ? 12 : coiled > .2 ? 9 : 2.3)) * (fleeing ? .65 : .28) - state.turn * .7,
      this.reducedMotion ? 0 : state.turn * .25);
    rig.head.rotation.set(-rig.body.rotation.x * .65 - coil * .11,
      moving ? state.turn * .32 : this.reducedMotion ? 0 : Math.sin(t * 1.6) * .12,
      -state.turn * .25 + (hidden && !this.reducedMotion ? Math.sin(t * 2.4) * .06 : 0));
    rig.shadow.scale.set(.65 + jump * .45, .65 + jump * .55, 1);
    if (moving && !this.reducedMotion) {
      state.emit += dt;
      if (state.emit >= (fleeing ? .052 : .13)) {
        state.emit = 0;
        this._spawnMotion('dust', wx(actor.x), wz(actor.y), actor.dir, fleeing ? 1.3 : .45, true);
        if (fleeing) this._spawnMotion('streak', wx(actor.x), wz(actor.y), actor.dir, 1.6, true);
      }
    } else state.emit = 0;
    state.wasMoving = moving; state.previousState = active ? actor.state : '';
  }

  _updateMotionEffects(dt, active) {
    if (!active || this.reducedMotion) {this._clearMotionEffects(); return;}
    for (const fx of this.motionPool) {
      if (fx.life <= 0) continue;
      fx.life = Math.max(0, fx.life - dt);
      const life = fx.life / fx.total, age = 1 - life, m = fx.mesh;
      m.visible = life > 0;
      m.position.x += fx.vx * dt; m.position.z += fx.vz * dt; m.position.y += fx.vy * dt;
      if (fx.kind === 'dust') {
        const size = fx.size * (.65 + age * 1.6);
        m.scale.set(size, size * .62, size);
        m.material.opacity = life * .40;
      } else if (fx.kind === 'streak') {
        m.scale.set(.017 * life, .009, fx.size * (.7 + age * .7));
        m.material.opacity = life * .66;
      } else {
        const size = fx.size + age * .50;
        m.scale.set(size, size, size);
        m.material.opacity = life * .45;
      }
    }
  }

  _updateMotionCamera(model, dt) {
    const p = model.player;
    if (this.portraitPlay && p) {
      // Freeze the current composition while a pause/result covers the room.
      if (this._playCameraReady && (model.mode === 'paused' || model.mode === 'won')) return;
      const cat = model.cat;
      let dx = cat ? wx(cat.x) - wx(p.x) : 0;
      let dz = cat ? wz(cat.y) - wz(p.y) : 0;
      const distance = Math.hypot(dx, dz);
      // A small look toward the cat helps planning without zooming the player out.
      const look = distance > 0 ? Math.min(distance * .20, .72) / distance : 0;
      dx *= look; dz *= look;
      const sprint = model.mode === 'playing' && !this.reducedMotion && p.sprinting && p.moving;
      const lead = sprint ? .10 : 0;
      const targetX = wx(p.x) + dx + lead * Math.cos(Number(p.dir) || 0);
      const targetZ = wz(p.y) + dz + lead * Math.sin(Number(p.dir) || 0);
      if (!this._playCameraReady) {
        this.cameraFollow.set(targetX, targetZ);
        this._playCameraReady = true;
      } else {
        this.cameraFollow.x = damp(this.cameraFollow.x, targetX, 10, dt);
        this.cameraFollow.y = damp(this.cameraFollow.y, targetZ, 10, dt);
      }
      const zoom = sprint ? 1.025 : 1;
      const nextZoom = this.reducedMotion ? 1 : damp(this.camera.zoom, zoom, 8, dt);
      if (Math.abs(nextZoom - this.camera.zoom) > .00001) {
        this.camera.zoom = nextZoom;
        this.camera.updateProjectionMatrix();
      }
      this.camera.position.set(this.cameraHome.x + this.cameraFollow.x, this.cameraHome.y, this.cameraHome.z + this.cameraFollow.y);
      this.camera.updateMatrixWorld();
      return;
    }
    const engaged = model.mode === 'playing' && !this.reducedMotion;
    if (!engaged) {
      this.cameraFollow.set(0, 0);
      this.camera.position.copy(this.cameraHome);
      if (this.camera.zoom !== 1) {this.camera.zoom = 1; this.camera.updateProjectionMatrix();}
      this.camera.updateMatrixWorld();
      return;
    }
    const sprint = engaged && p && p.sprinting && p.moving;
    const zoom = sprint ? 1.035 : 1;
    const nextZoom = damp(this.camera.zoom, zoom, sprint ? 7 : 9, dt);
    if (Math.abs(nextZoom - this.camera.zoom) > .00001) {this.camera.zoom = nextZoom; this.camera.updateProjectionMatrix();}
    const lead = sprint ? .075 : 0;
    this.cameraFollow.x = damp(this.cameraFollow.x, lead * Math.cos(Number(p?.dir) || 0), 5, dt);
    this.cameraFollow.y = damp(this.cameraFollow.y, lead * Math.sin(Number(p?.dir) || 0), 5, dt);
    this.camera.position.set(this.cameraHome.x + this.cameraFollow.x, this.cameraHome.y, this.cameraHome.z + this.cameraFollow.y);
    this.camera.updateMatrixWorld();
  }

  render(model, visualTime = 0) {
    if (this.disposed) throw new Error('ToyRenderer has been disposed.');
    if (this.contextLost) throw new Error('The WebGL context was lost. Reload the game to restore the 3D view.');
    if (!model || !model.scene) return;
    if (this.sceneSpec !== model.scene) this.setScene(model.scene);
    const t = Number.isFinite(visualTime) ? visualTime : 0;
    if (this._actorRef !== model.player || (Number(model.time) || 0) < this._lastGameTime) {
      this._resetMotion(); this._actorRef = model.player;
    }
    const rawDt = this._lastVisualTime === null ? 1 / 60 : Math.max(0, t - this._lastVisualTime);
    const dt = Math.min(rawDt, .05);
    this._lastVisualTime = t;
    this._lastGameTime = Number(model.time) || 0;
    if (model.mode !== 'paused') this._poseTime = t;
    const poseTime = this._poseTime;
    if (model.mode === 'won') this._winAge += dt; else this._winAge = 0;
    const p = model.player;
    if (p) {
      this.player.root.visible = true;
      this._animatePlayer(p, model, dt, rawDt, poseTime);
    } else this.player.root.visible = false;
    this._updateMotionCamera(model, dt);
    const cat = model.cat;
    for (const type of CAT_TYPES) this.cats[type].root.visible = !!cat && (cat.type === type || (!CAT_COLORS[cat.type] && type === 'orange'));
    if (cat) {
      this._animateCat(cat, model, dt, rawDt, poseTime);
      const alert = clamp(Number(cat.alert) || 0, 0, 1);
      this.alert.visible = alert > .24 && model.mode !== 'won';
      this.alert.position.set(wx(cat.x), 1.19 + (this.reducedMotion ? 0 : Math.sin(poseTime * 8) * .045), wz(cat.y));
      this.alert.quaternion.copy(this.camera.quaternion);
      this.alert.scale.setScalar(.82 + alert * .23);
      this.alertRing.visible = alert > .1 && model.mode !== 'won';
      this.alertRing.position.set(wx(cat.x), .061, wz(cat.y));
      const s = .30 + alert * .14;
      this.alertRing.scale.set(s, s, s);
    } else {this.alert.visible = false; this.alertRing.visible = false;}
    this.target.visible = !!model.target && model.mode === 'playing';
    if (this.target.visible) {
      this.target.position.set(wx(model.target.x), 0, wz(model.target.y));
      this.target.scale.setScalar(this.reducedMotion ? 1 : .94 + Math.sin(poseTime * 4) * .06);
    }
    const lures = Array.isArray(model.lures) ? model.lures : EMPTY;
    for (let i = 0; i < this.lurePool.length; i++) {
      const lure = lures[i], g = this.lurePool[i]; g.visible = !!lure;
      if (lure) {g.position.set(wx(lure.x), this.reducedMotion ? 0 : Math.sin(poseTime * 3 + i) * .006, wz(lure.y)); g.rotation.y = this.reducedMotion ? i : poseTime * .12 + i;}
    }
    const particles = Array.isArray(model.particles) ? model.particles : EMPTY;
    for (let i = 0; i < this.particles.length; i++) {
      const mesh = this.particles[i], part = particles[i]; mesh.visible = !!part && !this.reducedMotion;
      if (!mesh.visible) continue;
      const life = typeof part.maxLife === 'number' && part.maxLife > 0 ? clamp(part.life / part.maxLife, 0, 1) : 1;
      const size = (part.size || 3) / 100;
      mesh.position.set(wx(part.x), part.kind === 'paw' ? .060 : .13 + life * .8, wz(part.y));
      mesh.scale.set(size * life, part.kind === 'paw' ? .004 : size * .35, size * life * .72);
      mesh.rotation.set(part.kind === 'paw' ? 0 : poseTime + i, part.rotation || 0, part.kind === 'paw' ? 0 : poseTime * .7);
      mesh.material = this._mat(part.color || TOYS[i % TOYS.length]);
    }
    this._updateMotionEffects(dt, model.mode === 'playing');
    this._previousMode = model.mode;
    this.renderer.render(this.scene, this.camera);
  }

  screenToWorld(clientX, clientY) {
    if (this.disposed) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.hitPoint)) return null;
    const x = this.hitPoint.x * 100 + 360, y = this.hitPoint.z * 100 + 380;
    if (x < ROOM.left || x > ROOM.right || y < ROOM.top || y > ROOM.bottom) return null;
    return {x, y};
  }

  /** Project a game coordinate through the current camera into client pixels. */
  worldToScreen(x, y, height = 0) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.tempVector.set(wx(x), Number.isFinite(height) ? height : 0, wz(y)).project(this.camera);
    return {
      x: rect.left + (this.tempVector.x + 1) * rect.width / 2,
      y: rect.top + (1 - this.tempVector.y) * rect.height / 2,
      visible: Math.abs(this.tempVector.x) <= 1 && Math.abs(this.tempVector.y) <= 1 && Math.abs(this.tempVector.z) <= 1
    };
  }

  /** Screen-space right/down vectors become game-space x/y movement. */
  screenDirection(dx, dy) {
    const e = this.camera.matrixWorld.elements;
    const rl = Math.hypot(e[0], e[2]) || 1, dl = Math.hypot(e[4], e[6]) || 1;
    let x = dx * e[0] / rl - dy * e[4] / dl;
    let y = dx * e[2] / rl - dy * e[6] / dl;
    const length = Math.hypot(x, y);
    if (length > 1) {x /= length; y /= length;}
    return {x, y};
  }

  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    if (this.cameraHome) this.camera.position.copy(this.cameraHome);
    this.camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of this.fitPoints) {
      this.tempVector.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, this.tempVector.x); maxX = Math.max(maxX, this.tempVector.x);
      minY = Math.min(minY, this.tempVector.y); maxY = Math.max(maxY, this.tempVector.y);
    }
    const aspect = width / height;
    const wasPortrait = this.portraitPlay;
    this.portraitPlay = this.playView && aspect < .95;
    // Width-fitting the entire room made actors tiny on tall phone screens.
    const vertical = this.portraitPlay ? 4.8 : Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.025;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.camera.left = cx - vertical * aspect; this.camera.right = cx + vertical * aspect;
    this.camera.top = cy + vertical; this.camera.bottom = cy - vertical;
    if (this.portraitPlay && this._playCameraReady) {
      this.camera.position.set(this.cameraHome.x + this.cameraFollow.x, this.cameraHome.y, this.cameraHome.z + this.cameraFollow.y);
    } else if (wasPortrait !== this.portraitPlay && this.cameraFollow) {
      this.cameraFollow.set(0, 0);
      this._playCameraReady = false;
      this.camera.zoom = 1;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.observer) this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.scene.clear();
    this.geometries.forEach(g => g.dispose());
    this.materials.forEach(m => m.dispose());
    this.textures.forEach(t => t.dispose());
    this.renderer.dispose();
    this.materials.clear(); this.geometries.clear(); this.textures.clear(); this.tubeCache.clear();
  }
}
