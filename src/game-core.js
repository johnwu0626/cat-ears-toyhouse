(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CatGameCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BOUNDS = Object.freeze({ left: 24, top: 112, right: 696, bottom: 652 });
  const PLAYER_RADIUS = 16;
  const CAT_RADIUS = 14;
  const PLAYER_SPEED = 175;
  const SPRINT_SPEED = 305;
  const SNEAK_SPEED = 85;
  const PLAYER_ACCELERATION = 2600;
  const CAT_SPEEDS = Object.freeze({ orange: 190, tabby: 215, black: 245 });
  const CAT_BEHAVIORS = Object.freeze({
    orange: Object.freeze({ burst: 1.7, rest: 1.3, feint: false }),
    tabby: Object.freeze({ burst: 1.8, rest: 0.95, feint: true }),
    black: Object.freeze({ burst: 1.35, rest: 2, feint: false })
  });
  const GRID_SIZE = 16;
  const EPSILON = 0.01;
  const gridCache = new WeakMap();

  const SCENES = [
    {
      id: 'living-room', name: '陽光客廳', wall: '#e5e9d8', floor: '#e8ccaa', accent: '#8d9e7c',
      furniture: [
        { x: 360, y: 184, w: 248, h: 88, type: 'sofa' },
        { x: 274, y: 354, w: 170, h: 88, type: 'table' },
        { x: 100, y: 354, w: 78, h: 88, type: 'chair' },
        { x: 550, y: 365, w: 76, h: 120, type: 'shelf' },
        { x: 82, y: 180, w: 42, h: 42, type: 'plant' },
        { x: 180, y: 528, w: 76, h: 65, type: 'chair' }
      ]
    },
    {
      id: 'bedroom', name: '午睡小房間', wall: '#ebddd8', floor: '#e4cbb1', accent: '#b58d91',
      furniture: [
        { x: 94, y: 185, w: 188, h: 168, type: 'bed' },
        { x: 402, y: 174, w: 212, h: 72, type: 'shelf' },
        { x: 420, y: 354, w: 166, h: 94, type: 'table' },
        { x: 112, y: 466, w: 78, h: 80, type: 'chair' },
        { x: 586, y: 541, w: 42, h: 42, type: 'plant' },
        { x: 300, y: 529, w: 76, h: 66, type: 'chair' }
      ]
    },
    {
      id: 'dining-room', name: '暖木餐廳', wall: '#e6dfc8', floor: '#dec09c', accent: '#b99765',
      furniture: [
        { x: 245, y: 292, w: 230, h: 140, type: 'table' },
        { x: 88, y: 302, w: 72, h: 82, type: 'chair' },
        { x: 560, y: 302, w: 72, h: 82, type: 'chair' },
        { x: 290, y: 162, w: 210, h: 65, type: 'shelf' },
        { x: 268, y: 515, w: 72, h: 65, type: 'chair' },
        { x: 602, y: 541, w: 42, h: 42, type: 'plant' }
      ]
    },
    {
      id: 'kitchen', name: '奶油小廚房', wall: '#dce6d9', floor: '#e8d8be', accent: '#91a88c',
      furniture: [
        { x: 84, y: 170, w: 220, h: 80, type: 'counter' },
        { x: 435, y: 170, w: 190, h: 80, type: 'counter' },
        { x: 280, y: 359, w: 180, h: 90, type: 'table' },
        { x: 84, y: 370, w: 76, h: 142, type: 'shelf' },
        { x: 546, y: 390, w: 78, h: 85, type: 'chair' },
        { x: 195, y: 558, w: 38, h: 38, type: 'plant' }
      ]
    },
    {
      id: 'cafe', name: '巷口咖啡館', wall: '#dedfc9', floor: '#d9b994', accent: '#829078',
      furniture: [
        { x: 114, y: 195, w: 130, h: 85, type: 'table' },
        { x: 453, y: 195, w: 130, h: 85, type: 'table' },
        { x: 265, y: 378, w: 190, h: 90, type: 'counter' },
        { x: 100, y: 464, w: 72, h: 75, type: 'chair' },
        { x: 548, y: 465, w: 72, h: 75, type: 'chair' },
        { x: 334, y: 170, w: 42, h: 42, type: 'plant' }
      ]
    },
    {
      id: 'clinic', name: '森林動物診所', wall: '#dce8e3', floor: '#e2d7bc', accent: '#87aba0',
      furniture: [
        { x: 98, y: 187, w: 186, h: 100, type: 'table' },
        { x: 438, y: 181, w: 178, h: 88, type: 'sofa' },
        { x: 278, y: 387, w: 164, h: 90, type: 'table' },
        { x: 88, y: 448, w: 78, h: 110, type: 'shelf' },
        { x: 554, y: 451, w: 76, h: 80, type: 'chair' },
        { x: 337, y: 180, w: 40, h: 40, type: 'plant' }
      ]
    }
  ];
  const NOISE_ZONES = [
    [{ x: 306, y: 498, w: 100, h: 42, type: 'paper' }, { x: 142, y: 252, w: 88, h: 46, type: 'toys' }],
    [{ x: 315, y: 296, w: 76, h: 42, type: 'toys' }, { x: 426, y: 507, w: 80, h: 42, type: 'paper' }],
    [{ x: 118, y: 455, w: 90, h: 42, type: 'paper' }, { x: 520, y: 169, w: 70, h: 42, type: 'toys' }],
    [{ x: 326, y: 275, w: 80, h: 42, type: 'paper' }, { x: 473, y: 525, w: 86, h: 44, type: 'toys' }],
    [{ x: 286, y: 276, w: 98, h: 42, type: 'toys' }, { x: 426, y: 548, w: 80, h: 40, type: 'paper' }],
    [{ x: 190, y: 324, w: 100, h: 42, type: 'paper' }, { x: 469, y: 521, w: 70, h: 42, type: 'toys' }]
  ];
  SCENES.forEach(function (scene, index) {
    scene.noiseZones = NOISE_ZONES[index].map(function (zone) { return Object.freeze({ ...zone }); });
    Object.freeze(scene.noiseZones);
    scene.furniture.forEach(Object.freeze);
    Object.freeze(scene.furniture);
    Object.freeze(scene);
  });
  Object.freeze(SCENES);

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }

  // Navigation uses the inflated furniture footprint. Keeping one collision
  // shape for pointer movement, keyboard movement and cat paths prevents
  // corner clipping and makes the visible furniture behave consistently.
  function isBlocked(scene, x, y, radius) {
    radius = radius === undefined ? PLAYER_RADIUS : Math.max(0, radius);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x - radius < BOUNDS.left || x + radius > BOUNDS.right ||
        y - radius < BOUNDS.top || y + radius > BOUNDS.bottom) return true;
    return scene.furniture.some(function (item) {
      return x >= item.x - radius && x <= item.x + item.w + radius &&
        y >= item.y - radius && y <= item.y + item.h + radius;
    });
  }

  function segmentHitsRect(a, b, left, top, right, bottom) {
    let low = 0;
    let high = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const pair of [[a.x, dx, left, right], [a.y, dy, top, bottom]]) {
      if (Math.abs(pair[1]) < 0.000001) {
        if (pair[0] < pair[2] || pair[0] > pair[3]) return false;
      } else {
        let enter = (pair[2] - pair[0]) / pair[1];
        let leave = (pair[3] - pair[0]) / pair[1];
        if (enter > leave) { const old = enter; enter = leave; leave = old; }
        low = Math.max(low, enter);
        high = Math.min(high, leave);
        if (low > high) return false;
      }
    }
    return high >= 0 && low <= 1;
  }

  function lineClear(scene, start, end, radius) {
    if (isBlocked(scene, start.x, start.y, radius) || isBlocked(scene, end.x, end.y, radius)) return false;
    return !scene.furniture.some(function (item) {
      return segmentHitsRect(start, end, item.x - radius, item.y - radius,
        item.x + item.w + radius, item.y + item.h + radius);
    });
  }

  function getGrid(scene, radius) {
    let entries = gridCache.get(scene);
    if (!entries) { entries = new Map(); gridCache.set(scene, entries); }
    if (entries.has(radius)) return entries.get(radius);
    const minX = BOUNDS.left + radius + EPSILON;
    const maxX = BOUNDS.right - radius - EPSILON;
    const minY = BOUNDS.top + radius + EPSILON;
    const maxY = BOUNDS.bottom - radius - EPSILON;
    const columns = Math.ceil((maxX - minX) / GRID_SIZE) + 1;
    const rows = Math.ceil((maxY - minY) / GRID_SIZE) + 1;
    const xStep = (maxX - minX) / (columns - 1);
    const yStep = (maxY - minY) / (rows - 1);
    const nodes = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = minX + column * xStep;
        const y = minY + row * yStep;
        nodes.push({ x: x, y: y, blocked: isBlocked(scene, x, y, radius), edges: [] });
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const node = nodes[row * columns + column];
        if (node.blocked) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nextRow = row + dy;
            const nextColumn = column + dx;
            if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
            const id = nextRow * columns + nextColumn;
            const next = nodes[id];
            if (next.blocked || !lineClear(scene, node, next, radius)) continue;
            node.edges.push({ id: id, cost: Math.hypot(dx * xStep, dy * yStep) });
          }
        }
      }
    }
    const grid = { nodes: nodes, columns: columns, rows: rows };
    entries.set(radius, grid);
    return grid;
  }

  function nearestNode(scene, grid, point, radius, requireVisible) {
    let id = -1;
    let best = Infinity;
    for (let index = 0; index < grid.nodes.length; index++) {
      const node = grid.nodes[index];
      if (node.blocked) continue;
      const cost = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
      if (cost >= best) continue;
      if (requireVisible && !lineClear(scene, point, node, radius)) continue;
      id = index;
      best = cost;
    }
    return id;
  }

  function normalizeTarget(scene, target, radius, grid) {
    const point = {
      x: clamp(target.x, BOUNDS.left + radius + EPSILON, BOUNDS.right - radius - EPSILON),
      y: clamp(target.y, BOUNDS.top + radius + EPSILON, BOUNDS.bottom - radius - EPSILON)
    };
    if (!isBlocked(scene, point.x, point.y, radius)) return point;
    const nearest = nearestNode(scene, grid, point, radius, false);
    return nearest < 0 ? null : { x: grid.nodes[nearest].x, y: grid.nodes[nearest].y };
  }

  class MinHeap {
    constructor() { this.items = []; }
    push(value) {
      const items = this.items;
      let index = items.length;
      items.push(value);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent].score <= value.score) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = value;
    }
    pop() {
      const items = this.items;
      const first = items[0];
      const last = items.pop();
      if (items.length) {
        let index = 0;
        while (index * 2 + 1 < items.length) {
          let child = index * 2 + 1;
          if (child + 1 < items.length && items[child + 1].score < items[child].score) child++;
          if (items[child].score >= last.score) break;
          items[index] = items[child];
          index = child;
        }
        items[index] = last;
      }
      return first;
    }
  }

  function findPath(scene, start, destination, radius) {
    radius = radius === undefined ? PLAYER_RADIUS : Math.max(0, radius);
    if (!finitePoint(start) || !finitePoint(destination) || isBlocked(scene, start.x, start.y, radius)) return [];
    const grid = getGrid(scene, radius);
    const end = normalizeTarget(scene, destination, radius, grid);
    if (!end || distance(start, end) < 0.5) return [];
    if (lineClear(scene, start, end, radius)) return [end];
    const first = nearestNode(scene, grid, start, radius, true);
    const last = nearestNode(scene, grid, end, radius, true);
    if (first < 0 || last < 0) return [];
    const costs = new Float64Array(grid.nodes.length).fill(Infinity);
    const previous = new Int32Array(grid.nodes.length).fill(-1);
    const closed = new Uint8Array(grid.nodes.length);
    const heap = new MinHeap();
    costs[first] = 0;
    heap.push({ id: first, score: distance(grid.nodes[first], grid.nodes[last]) });
    while (heap.items.length) {
      const current = heap.pop().id;
      if (closed[current]) continue;
      if (current === last) break;
      closed[current] = 1;
      for (const edge of grid.nodes[current].edges) {
        if (closed[edge.id]) continue;
        const candidate = costs[current] + edge.cost;
        if (candidate >= costs[edge.id]) continue;
        costs[edge.id] = candidate;
        previous[edge.id] = current;
        heap.push({ id: edge.id, score: candidate + distance(grid.nodes[edge.id], grid.nodes[last]) });
      }
    }
    if (first !== last && previous[last] < 0) return [];
    const points = [end];
    let current = last;
    while (current >= 0) {
      points.unshift({ x: grid.nodes[current].x, y: grid.nodes[current].y });
      if (current === first) break;
      current = previous[current];
    }
    const result = [];
    let anchor = start;
    let index = 0;
    while (index < points.length) {
      let next = points.length - 1;
      while (next > index && !lineClear(scene, anchor, points[next], radius)) next--;
      if (!lineClear(scene, anchor, points[next], radius)) return [];
      if (distance(anchor, points[next]) > 0.5) result.push(points[next]);
      anchor = points[next];
      index = next + 1;
    }
    return result;
  }

  function makeHideSpots(scene) {
    const points = [];
    scene.furniture.forEach(function (item, index) {
      if (item.type === 'plant' || item.type === 'shelf') return;
      const margin = 24;
      const options = [
        { x: item.x + item.w + margin, y: item.y + item.h * 0.65, side: 'right' },
        { x: item.x - margin, y: item.y + item.h * 0.65, side: 'left' },
        { x: item.x + item.w * 0.55, y: item.y + item.h + margin, side: 'bottom' },
        { x: item.x + item.w * 0.55, y: item.y - margin, side: 'top' }
      ];
      options.forEach(function (point) {
        if (!isBlocked(scene, point.x, point.y, PLAYER_RADIUS)) {
          points.push({ x: point.x, y: point.y, side: point.side, furnitureIndex: index });
        }
      });
    });
    return points;
  }

  function advanceAlongPath(actor, path, length) {
    let moved = false;
    while (path.length && length > 0) {
      const next = path[0];
      const dx = next.x - actor.x;
      const dy = next.y - actor.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining < 0.001) { path.shift(); continue; }
      const amount = Math.min(remaining, length);
      actor.x += dx / remaining * amount;
      actor.y += dy / remaining * amount;
      actor.dir = Math.atan2(dy, dx);
      moved = true;
      length -= amount;
      if (amount >= remaining - 0.001) path.shift();
    }
    actor.moving = moved;
    return moved;
  }

  class Game {
    constructor(options) {
      options = options || {};
      this.type = Object.hasOwn(CAT_SPEEDS, options.type) ? options.type : 'orange';
      this.sceneIndex = Number.isInteger(options.sceneIndex) ? clamp(options.sceneIndex, 0, SCENES.length - 1) : 0;
      this.model = {};
      this.restart();
    }

    get scene() { return this.model.scene; }
    get player() { return this.model.player; }
    get cat() { return this.model.cat; }
    get time() { return this.model.time; }
    get mode() { return this.model.mode; }
    get target() { return this.model.target; }
    get particles() { return this.model.particles; }
    get stamina() { return this.model.stamina; }
    get lureCharges() { return this.model.lureCharges; }
    get lures() { return this.model.lures; }
    get noise() { return this.model.noise; }
    get stats() { return this.model.stats; }

    restart() {
      const scene = SCENES[this.sceneIndex];
      const spawn = { x: 398, y: 610 };
      this.hideSpots = makeHideSpots(scene).filter(function (point) {
        return findPath(scene, spawn, point, PLAYER_RADIUS).length > 0;
      });
      const first = this.hideSpots[0];
      Object.assign(this.model, {
        scene: scene,
        player: { x: spawn.x, y: spawn.y, moving: false, dir: -Math.PI / 2, sprinting: false, sneaking: false,
          speed: 0, speedRatio: 0, burst: false },
        cat: { x: first.x, y: first.y, type: this.type, moving: false, hidden: true,
          dir: Math.PI, alert: 0, state: 'hidden', hideSide: first.side, furnitureIndex: first.furnitureIndex,
          restRemaining: 0, feint: false, returning: false, speed: 0, speedRatio: 0, burst: false },
        time: 0,
        mode: 'ready',
        target: null,
        particles: [],
        escapes: 0,
        stamina: 100,
        lureCharges: 3,
        lures: [],
        noise: 0,
        stats: { scares: 0, luresUsed: 0, sprintTime: 0 }
      });
      this._playerPath = [];
      this._catPath = [];
      this._direction = { x: 0, y: 0 };
      this._wantsSprint = false;
      this._wantsSneak = false;
      this._sprintLocked = false;
      this._playerSpeed = 0;
      this._sprintAge = 0;
      this._wasSprinting = false;
      this._burstTime = 0;
      this._dashAge = 0;
      this._restTimer = 0;
      this._feintTimer = 0;
      this._feintDone = false;
      this._lureCooldown = 0;
      this._lureStay = null;
      this._activeLureId = null;
      this._nextLureId = 1;
      this._usedLures = new Set();
      this._footprintTime = 0;
      this._destination = first;
      return this.model;
    }

    start() {
      if (this.model.mode === 'ready') this.model.mode = 'playing';
      return this.model.mode;
    }

    pause() {
      if (this.model.mode === 'playing') {
        this.model.mode = 'paused'; this.clearInput();
        this.cat.speed = 0; this.cat.speedRatio = 0; this.cat.burst = false; this.cat.moving = false;
      }
      return this.model.mode;
    }

    resume() {
      if (this.model.mode === 'paused') this.model.mode = 'playing';
      return this.model.mode;
    }

    clearInput() {
      this._direction = { x: 0, y: 0 };
      this._playerPath = [];
      this.model.target = null;
      this.model.player.moving = false;
      this._wantsSprint = false;
      this._wantsSneak = false;
      this.player.sprinting = false;
      this.player.sneaking = false;
      this.player.speed = 0;
      this.player.speedRatio = 0;
      this.player.burst = false;
      this._playerSpeed = 0;
      this._sprintAge = 0;
      this._wasSprinting = false;
    }

    setSprint(enabled) {
      if (this.mode !== 'playing') return false;
      this._wantsSprint = Boolean(enabled);
      if (enabled) { this._wantsSneak = false; this.player.sneaking = false; }
      if (!enabled) this.player.sprinting = false;
      return true;
    }

    setSneak(enabled) {
      if (this.mode !== 'playing') return false;
      this._wantsSneak = Boolean(enabled);
      this.player.sneaking = this._wantsSneak;
      if (enabled) { this._wantsSprint = false; this.player.sprinting = false; }
      return true;
    }

    placeLure(x, y) {
      if (this.mode !== 'playing' || this.lureCharges <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const point = normalizeTarget(this.scene, { x: x, y: y }, PLAYER_RADIUS, getGrid(this.scene, PLAYER_RADIUS));
      if (!point || (distance(this.cat, point) > 0.5 && !findPath(this.scene, this.cat, point, CAT_RADIUS).length)) return false;
      this.model.lures.push({ id: this._nextLureId++, x: point.x, y: point.y, life: 6 });
      this.model.lureCharges--;
      this.stats.luresUsed++;
      return true;
    }

    setTarget(x, y) {
      if (this.model.mode !== 'playing' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      this._direction = { x: 0, y: 0 };
      this._playerPath = findPath(this.scene, this.player, { x: x, y: y }, PLAYER_RADIUS);
      const last = this._playerPath[this._playerPath.length - 1];
      this.model.target = last ? { x: last.x, y: last.y } : null;
      return Boolean(last);
    }

    setDirection(x, y) {
      if (this.model.mode !== 'playing') return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) { this.clearInput(); return; }
      const length = Math.hypot(x, y);
      this._direction = length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
      this._playerPath = [];
      this.model.target = null;
      if (!length) {
        this._playerSpeed = 0;
        this.player.speed = 0;
        this.player.speedRatio = 0;
        this.player.moving = false;
        this.player.burst = false;
        this.player.sprinting = false;
        this._sprintAge = 0;
        this._wasSprinting = false;
      }
    }

    _movePlayer(dt) {
      const actor = this.player;
      const direction = this._direction;
      if (this._sprintLocked && this.stamina >= 30) this._sprintLocked = false;
      const sprinting = this._wantsSprint && !this._sprintLocked && this.stamina > 0;
      const wantsMovement = Boolean(direction.x || direction.y || this._playerPath.length);
      if (!sprinting || !this._wasSprinting) this._sprintAge = 0;
      // A brief push-off rises quickly, then settles to a sustainable run.
      const sprintBoost = sprinting ? 48 * Math.max(0, 1 - this._sprintAge / 0.55) : 0;
      const targetSpeed = this._wantsSneak ? SNEAK_SPEED : sprinting ? SPRINT_SPEED + sprintBoost : PLAYER_SPEED;
      if (!wantsMovement) this._playerSpeed = 0;
      else if (targetSpeed < this._playerSpeed) this._playerSpeed = targetSpeed;
      else this._playerSpeed = Math.min(targetSpeed, this._playerSpeed + PLAYER_ACCELERATION * dt);
      const speed = this._playerSpeed;
      const startX = actor.x, startY = actor.y;
      actor.sneaking = this._wantsSneak;
      if (direction.x || direction.y) {
        const before = { x: actor.x, y: actor.y };
        const dx = direction.x * speed * dt;
        const dy = direction.y * speed * dt;
        if (!isBlocked(this.scene, actor.x + dx, actor.y + dy, PLAYER_RADIUS)) {
          actor.x += dx;
          actor.y += dy;
        } else {
          if (!isBlocked(this.scene, actor.x + dx, actor.y, PLAYER_RADIUS)) actor.x += dx;
          if (!isBlocked(this.scene, actor.x, actor.y + dy, PLAYER_RADIUS)) actor.y += dy;
        }
        actor.moving = distance(before, actor) > 0.01;
        if (actor.moving) actor.dir = Math.atan2(actor.y - before.y, actor.x - before.x);
      } else {
        advanceAlongPath(actor, this._playerPath, speed * dt);
        if (!this._playerPath.length) this.model.target = null;
      }
      actor.sprinting = sprinting && actor.moving && !actor.sneaking;
      actor.speed = Math.hypot(actor.x - startX, actor.y - startY) / dt;
      actor.speedRatio = actor.speed / PLAYER_SPEED;
      actor.burst = actor.sprinting && this._sprintAge < 0.4;
      this._wasSprinting = actor.sprinting;
      if (actor.sprinting) this._sprintAge += dt;
      if (!actor.moving) {
        this._playerSpeed = 0;
        actor.speed = 0;
        actor.speedRatio = 0;
        actor.burst = false;
      }
      if (actor.sprinting) {
        this.model.stamina = clamp(this.stamina - 27 * dt, 0, 100);
        this.stats.sprintTime += dt;
        if (this.stamina <= 0) this._sprintLocked = true;
      } else this.model.stamina = clamp(this.stamina + 18 * dt, 0, 100);
      const onNoisyFloor = actor.moving && this.scene.noiseZones.some(function (zone) {
        return actor.x >= zone.x && actor.x <= zone.x + zone.w && actor.y >= zone.y && actor.y <= zone.y + zone.h;
      });
      const baseNoise = !actor.moving ? 0 : actor.sneaking ? 0.05 : actor.sprinting ? 0.9 : 0.3;
      const floorNoise = !onNoisyFloor ? 0 : actor.sneaking ? 0.22 : 0.55;
      const targetNoise = clamp(baseNoise + floorNoise, 0, 1);
      this.model.noise += (targetNoise - this.noise) * Math.min(1, dt * 10);
      actor.onNoiseZone = Boolean(onNoisyFloor);
    }

    _escapeRoute(nearest, avoidFurniture) {
      const player = this.player;
      const cat = this.cat;
      let best = null;
      let bestScore = -Infinity;
      for (const spot of this.hideSpots) {
        if (distance(spot, cat) < (nearest ? 8 : 100) || spot.furnitureIndex === avoidFurniture) continue;
        const path = findPath(this.scene, cat, spot, CAT_RADIUS);
        if (!path.length) continue;
        let pathLength = 0;
        let previous = cat;
        for (const point of path) { pathLength += distance(previous, point); previous = point; }
        const first = path[0];
        const firstDistance = distance(first, cat);
        const sampleRatio = Math.min(1, 70 / Math.max(1, firstDistance));
        let minimumClearance = distance(cat, player);
        for (let fraction = 0.2; fraction <= 1.01; fraction += 0.2) {
          const sample = { x: cat.x + (first.x - cat.x) * sampleRatio * fraction,
            y: cat.y + (first.y - cat.y) * sampleRatio * fraction };
          minimumClearance = Math.min(minimumClearance, distance(sample, player));
        }
        const approach = Math.max(0, distance(cat, player) - minimumClearance);
        const immediateDanger = approach > 8 ? 1000 + approach * 5 : approach * 5;
        const score = nearest ? -pathLength : distance(spot, player) + pathLength * 0.05 - immediateDanger;
        if (score > bestScore) { bestScore = score; best = { spot: spot, path: path }; }
      }
      return best;
    }

    _flee(scared) {
      const route = this._escapeRoute(!scared);
      this._activeLureId = null;
      this._lureStay = null;
      this._lureCooldown = scared ? 1.1 : 0.3;
      this._burstTime = 0;
      this._dashAge = 0;
      this._restTimer = 0;
      this._feintTimer = 0;
      this._feintDone = false;
      this.cat.feint = false;
      this.cat.restRemaining = 0;
      this.cat.speed = 0;
      this.cat.speedRatio = 0;
      this.cat.burst = false;
      this.cat.returning = !scared;
      this.cat.alert = scared ? 1 : 0;
      this.cat.hidden = false;
      if (!route) {
        this._catPath = [];
        this.cat.state = 'resting';
        this._restTimer = 1.3;
        return;
      }
      this._catPath = route.path;
      this._destination = route.spot;
      this.cat.state = 'fleeing';
      this.cat.moving = true;
      if (scared) { this.model.escapes++; this.stats.scares++; }
    }

    _settleAtDestination() {
      this.cat.state = 'hidden';
      this.cat.hidden = true;
      this.cat.moving = false;
      this.cat.alert = 0;
      this.cat.feint = false;
      this.cat.returning = false;
      this.cat.restRemaining = 0;
      this.cat.speed = 0;
      this.cat.speedRatio = 0;
      this.cat.burst = false;
      this.cat.hideSide = this._destination.side;
      this.cat.furnitureIndex = this._destination.furnitureIndex;
      this._lureCooldown = 0.3;
    }

    _awareness(dt, distracted) {
      const player = this.player;
      const cat = this.cat;
      const separation = distance(player, cat);
      const radius = player.sprinting ? 175 : player.sneaking ? (distracted ? 32 : 60) : (distracted ? 58 : 115);
      const extraNoise = Math.max(0, this.noise - (player.sprinting ? 0.9 : player.sneaking ? 0.05 : 0.3));
      const effectiveRadius = radius + extraNoise * 65;
      const visible = lineClear(this.scene, player, cat, 0);
      const heard = this.noise > 0.55 && separation < effectiveRadius;
      if (separation < effectiveRadius && (visible || heard)) {
        const proximity = 1 - separation / effectiveRadius;
        let rate = player.sprinting ? 4.8 : player.sneaking ? 0.65 : 3.1;
        if (distracted && !player.sprinting) rate *= 0.5;
        if (!player.moving) rate *= 0.7;
        rate += proximity * 0.7 + extraNoise * 1.8;
        if (!visible) rate *= 0.55;
        cat.alert = clamp(cat.alert + rate * dt, 0, 1);
      } else cat.alert = clamp(cat.alert - dt * 0.65, 0, 1);
      return cat.alert >= 1;
    }

    _tryLure() {
      if (this._lureCooldown > 0 || this.cat.alert > 0.85) return false;
      const candidates = this.lures.filter(lure => !this._usedLures.has(lure.id) && lure.life > 0 && distance(this.cat, lure) <= 240);
      candidates.sort((a, b) => distance(this.cat, a) - distance(this.cat, b));
      for (const lure of candidates) {
        const path = findPath(this.scene, this.cat, lure, CAT_RADIUS);
        if (!path.length && distance(this.cat, lure) > 1) continue;
        this._usedLures.add(lure.id);
        this._activeLureId = lure.id;
        this._catPath = path;
        this._lureStay = path.length ? null : 2;
        this._restTimer = 0;
        this.cat.state = 'lured';
        this.cat.hidden = false;
        this.cat.alert = Math.max(0, this.cat.alert - 0.3);
        this.cat.feint = false;
        this.cat.returning = false;
        this.cat.restRemaining = 0;
        return true;
      }
      return false;
    }

    _moveLured(dt) {
      if (this._awareness(dt, true)) { this._flee(true); return; }
      if (this._lureStay !== null) {
        this.cat.moving = false;
        this._lureStay -= dt;
        if (this._lureStay <= 0) this._flee(false);
        return;
      }
      if (!this.lures.some(lure => lure.id === this._activeLureId)) { this._flee(false); return; }
      const beforeX = this.cat.x, beforeY = this.cat.y;
      advanceAlongPath(this.cat, this._catPath, 95 * dt);
      this.cat.speed = Math.hypot(this.cat.x - beforeX, this.cat.y - beforeY) / dt;
      this.cat.speedRatio = this.cat.speed / CAT_SPEEDS[this.type];
      if (!this._catPath.length) {
        this._lureStay = 2; this.cat.moving = false;
        this.cat.speed = 0; this.cat.speedRatio = 0;
      }
    }

    _moveFleeing(dt) {
      const cat = this.cat;
      const behavior = CAT_BEHAVIORS[this.type];
      cat.alert = Math.max(cat.returning ? 0 : 0.35, cat.alert - dt * 0.28);
      if (this._feintTimer > 0) {
        this._feintTimer = Math.max(0, this._feintTimer - dt);
        cat.moving = false;
        if (!this._feintTimer) {
          const alternate = this._escapeRoute(false, this._destination.furnitureIndex);
          if (alternate) { this._catPath = alternate.path; this._destination = alternate.spot; }
          cat.feint = false;
          this._dashAge = 0;
        }
        return;
      }
      const launch = Math.max(0, 1 - this._dashAge / 0.48);
      const coast = 1 - 0.16 * clamp((this._dashAge - 0.62) / 0.7, 0, 1);
      const speed = cat.returning ? 115 : CAT_SPEEDS[this.type] * (coast + 0.58 * launch * launch);
      const beforeX = cat.x, beforeY = cat.y;
      advanceAlongPath(cat, this._catPath, speed * dt);
      cat.speed = Math.hypot(cat.x - beforeX, cat.y - beforeY) / dt;
      cat.speedRatio = cat.speed / CAT_SPEEDS[this.type];
      cat.burst = cat.moving && !cat.returning && this._dashAge < 0.48;
      this._dashAge += dt;
      this._burstTime += dt;
      this._footprintTime -= dt;
      if (this._footprintTime <= 0 && cat.moving) {
        this._footprintTime = 0.16;
        this.particles.push({ x: cat.x, y: cat.y + 7, vx: 0, vy: 0, life: 0.8,
          maxLife: 0.8, color: '#a78865', size: 3, kind: 'paw', rotation: cat.dir });
      }
      if (cat.returning) {
        if (!this._catPath.length) this._settleAtDestination();
        return;
      }
      if (behavior.feint && !this._feintDone && this._burstTime >= 0.7 && this._catPath.length) {
        this._feintDone = true;
        this._feintTimer = 0.34;
        cat.feint = true;
        cat.moving = false;
        cat.speed = 0; cat.speedRatio = 0; cat.burst = false;
        return;
      }
      if (!this._catPath.length || this._burstTime >= behavior.burst) {
        this._restTimer = behavior.rest;
        cat.state = 'resting';
        cat.restRemaining = this._restTimer;
        cat.moving = false;
        cat.speed = 0; cat.speedRatio = 0; cat.burst = false;
        cat.alert = Math.min(cat.alert, 0.2);
      }
    }

    _moveCat(dt) {
      const cat = this.cat;
      cat.speed = 0; cat.speedRatio = 0; cat.burst = false;
      this._lureCooldown = Math.max(0, this._lureCooldown - dt);
      if (cat.state === 'fleeing') { this._moveFleeing(dt); return; }
      if (cat.state === 'lured') { this._moveLured(dt); return; }
      if (this._tryLure()) { this._moveLured(dt); return; }
      if (cat.state === 'resting') {
        cat.moving = false;
        cat.alert = Math.max(0, cat.alert - dt * 0.4);
        this._restTimer = Math.max(0, this._restTimer - dt);
        cat.restRemaining = this._restTimer;
        if (this._restTimer <= 0) {
          if (this._catPath.length) { cat.state = 'fleeing'; this._burstTime = 0; this._dashAge = 0; }
          else this._settleAtDestination();
        }
        return;
      }
      cat.moving = false;
      if (this._awareness(dt, false)) { this._flee(true); return; }
      cat.state = cat.alert > 0.08 ? 'alert' : 'hidden';
    }

    _updateParticles(dt) {
      this.model.particles = this.particles.filter(function (particle) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        if (particle.kind === 'confetti') {
          particle.vy += 65 * dt;
          particle.rotation += dt * 3;
        }
        return particle.life > 0;
      });
    }

    _win() {
      this.model.mode = 'won';
      this.clearInput();
      this._catPath = [];
      this.cat.moving = false;
      this.cat.hidden = false;
      this.cat.alert = 0;
      this.cat.state = 'resting';
      this.cat.feint = false;
      this.cat.restRemaining = 0;
      this.cat.captured = true;
      this.cat.speed = 0; this.cat.speedRatio = 0; this.cat.burst = false;
      const colors = ['#cb8e64', '#839576', '#d9b95d', '#e6c1af'];
      for (let index = 0; index < 28; index++) {
        const angle = Math.PI * 2 * index / 28;
        this.particles.push({ x: this.cat.x, y: this.cat.y - 16,
          vx: Math.cos(angle) * (45 + Math.random() * 55), vy: -40 + Math.sin(angle) * 65,
          life: 1.5 + Math.random(), maxLife: 2.5, color: colors[index % colors.length],
          size: 3 + Math.random() * 3, kind: 'confetti', rotation: angle });
      }
    }

    step(dt, elapsedDt = dt) {
      if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(elapsedDt) || elapsedDt < 0) return this.model;
      // Simulate normal slow frames fully. For exceptional gaps, preserve the
      // actual clock even when limiting catch-up work to one physical second.
      let remaining = Math.min(dt, 1);
      const clockRate = elapsedDt / remaining;
      if (this.mode === 'won') { this._updateParticles(remaining); return this.model; }
      if (this.mode !== 'playing') return this.model;
      while (remaining > 0.000001 && this.mode === 'playing') {
        const part = Math.min(remaining, 1 / 60);
        this.model.time += part * clockRate;
        this._updateParticles(part);
        this.model.lures = this.lures.filter(function (lure) { lure.life -= part; return lure.life > 0; });
        this._movePlayer(part);
        if (distance(this.player, this.cat) <= 30 && lineClear(this.scene, this.player, this.cat, 0)) {
          this._win();
          break;
        }
        this._moveCat(part);
        if (distance(this.player, this.cat) <= 30 && lineClear(this.scene, this.player, this.cat, 0)) this._win();
        remaining -= part;
      }
      return this.model;
    }
  }

  return Object.freeze({ Game: Game, SCENES: SCENES, findPath: findPath, isBlocked: isBlocked,
    BOUNDS: BOUNDS, PLAYER_RADIUS: PLAYER_RADIUS, CAT_RADIUS: CAT_RADIUS,
    PLAYER_SPEED: PLAYER_SPEED, SPRINT_SPEED: SPRINT_SPEED, SNEAK_SPEED: SNEAK_SPEED,
    CAT_SPEEDS: CAT_SPEEDS, CAT_BEHAVIORS: CAT_BEHAVIORS });
});
