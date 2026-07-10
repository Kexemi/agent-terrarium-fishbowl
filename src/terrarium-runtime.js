import {
  TILE,
  createTerrariumEngine,
  stepTerrariumEngine,
  selectAtWorldPoint,
  findNearestEntity,
  inspectEntity,
  performTerrariumAction,
  getGameHud,
  getRenderScene,
  snapshotEngine,
  applyWorldSnapshot,
} from './terrarium-engine.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const worldBadge = document.getElementById('worldBadge');
const modePill = document.getElementById('modePill');
const selectedTitle = document.getElementById('selectedTitle');
const selectedState = document.getElementById('selectedState');
const selectedBody = document.getElementById('selectedBody');
const proofSource = document.getElementById('proofSource');
const proofTime = document.getElementById('proofTime');
const proofStatus = document.getElementById('proofStatus');
const proofToggle = document.getElementById('proofToggle');
const verbLook = document.getElementById('verbLook');
const verbFollow = document.getElementById('verbFollow');
const verbGather = document.getElementById('verbGather');
const verbClear = document.getElementById('verbClear');
const verbGate = document.getElementById('verbGate');
const verbGuide = document.getElementById('verbGuide');
const proofValue = document.getElementById('proofValue');
const signalValue = document.getElementById('signalValue');
const questTitle = document.getElementById('questTitle');
const questBody = document.getElementById('questBody');
const gameMessage = document.getElementById('gameMessage');
const morningBrief = document.getElementById('morningBrief');
const briefHealth = document.getElementById('briefHealth');
const briefWork = document.getElementById('briefWork');
const briefGate = document.getElementById('briefGate');
const briefFresh = document.getElementById('briefFresh');

const WORLD_REFRESH_MS = 15_000;
const queryParams = new URLSearchParams(window.location.search);
const fullMapMode = queryParams.get('full-map') === '1';
if (fullMapMode) document.documentElement.dataset.fullMap = 'true';
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
const runtimeDebugEnabled = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  || queryParams.get('debug') === '1';

const keys = new Set();
const virtualKeys = new Set();
const state = {
  raw: null,
  engine: null,
  world: null,
  mode: 'loading',
  error: '',
  tick: 0,
  camera: { x: 0, y: 0 },
  player: { x: 8.5 * TILE, y: 12.5 * TILE, speed: 3.2, facing: 'down' },
  selected: null,
  rawProofOpen: false,
  logOpen: false,
  snapshotVersion: '',
  lastRefreshAt: '',
  refreshError: '',
  refreshTimer: null,
};

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function worldVersion(raw) {
  const queue = raw?.fishbowl?.queue || {};
  return JSON.stringify({
    eventId: raw?.meta?.event_id || raw?.viewport?.event_bus?.current_event_id || '',
    latestAt: raw?.fishbowl?.freshness?.latest_at || raw?.meta?.created_at || '',
    queued: queue.queued ?? null,
    claimed: queue.claimed ?? null,
    receipted: queue.receipted ?? null,
    health: raw?.fishbowl?.health?.label || '',
    owner: raw?.fishbowl?.owner?.label || '',
    sourceCount: raw?.source_ledger?.source_count ?? null,
  });
}

function snapshotTimestamp(raw) {
  return raw?.fishbowl?.freshness?.latest_at || raw?.meta?.created_at || '';
}

function snapshotAgeLabel(raw = state.raw, mode = state.mode) {
  if (mode !== 'live') return 'offline snapshot';
  const parsed = Date.parse(snapshotTimestamp(raw));
  if (!Number.isFinite(parsed)) return 'snapshot age unknown';
  const ageMs = Math.max(0, Date.now() - parsed);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 2) return 'fresh snapshot';
  if (minutes < 60) return `${minutes}m snapshot`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h stale snapshot`;
  return `${Math.floor(hours / 24)}d stale snapshot`;
}

function adoptEngine(nextEngine) {
  state.engine = nextEngine;
  state.world = nextEngine.world;
  state.player = nextEngine.player;
  state.camera = nextEngine.camera;
  state.selected = state.world.entities.find((entity) => entity.id === nextEngine.selectedId)
    || state.world.buildings[0]
    || state.world.agents[0]
    || null;
}

async function refreshWorldSnapshot({ force = false } = {}) {
  try {
    const live = await fetchJson('public/world.json');
    const nextVersion = worldVersion(live);
    const changed = force || state.mode !== 'live' || nextVersion !== state.snapshotVersion;
    state.mode = 'live';
    state.raw = live;
    state.error = '';
    state.refreshError = '';
    state.lastRefreshAt = new Date().toISOString();
    if (changed) {
      adoptEngine(applyWorldSnapshot(state.engine, live, { mode: 'live' }));
      state.snapshotVersion = nextVersion;
    }
    updateHud();
    updateInspector();
    updateGameHud();
    return { ok: true, changed, eventId: live?.meta?.event_id || 'event pending', lastRefreshAt: state.lastRefreshAt };
  } catch (error) {
    state.refreshError = String(error?.message || error);
    updateGameHud();
    return { ok: false, changed: false, reason: 'refresh_failed', message: state.refreshError, lastRefreshAt: state.lastRefreshAt };
  }
}

function getViewportSize() {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || 390),
    height: Math.max(1, rect.height || 665),
  };
}

async function loadWorld() {
  try {
    const live = await fetchJson('public/world.json');
    state.mode = 'live';
    state.raw = live;
    state.error = '';
  } catch (liveError) {
    try {
      const fixture = await fetchJson('public/world.fixture.json');
      state.mode = 'fixture';
      state.raw = fixture;
      state.error = liveError.message;
    } catch (fixtureError) {
      state.mode = 'fixture';
      state.error = `${liveError.message}; fixture failed: ${fixtureError.message}`;
      state.raw = emergencyWorld();
    }
  }
  adoptEngine(createTerrariumEngine(state.raw, {
    mode: state.mode,
    viewportSize: getViewportSize(),
  }));
  state.snapshotVersion = worldVersion(state.raw);
  state.lastRefreshAt = new Date().toISOString();
  updateHud();
  updateInspector();
  updateGameHud();
}

function emergencyWorld() {
  return {
    meta: {
      title: 'Emergency Runtime Fixture',
      source_mode: 'OFFLINE_FIXTURE',
      warning: 'Neither public/world.json nor public/world.fixture.json loaded.',
      event_id: 'e308f229927efd61',
    },
    tilemap: { width: 32, height: 22, tile_size: 32 },
    organs: [
      {
        id: 'runtime-emergency-forge',
        title: 'Runtime Emergency Forge',
        state: 'fixture_only',
        x: 10,
        y: 8,
        w: 6,
        h: 5,
        body: 'The renderer is alive, but source truth is missing.',
        proof: { status: 'proof_failed', source_path: 'public/world.json', timestamp: 'missing' },
        next_event: 'manual_world_compile',
      },
    ],
    agents: [
      {
        id: 'world-to-game',
        title: 'Runtime Sprite',
        state: 'active',
        mood: 'green',
        x: 14,
        y: 12,
        body: 'Canvas, camera, movement, and inspector are running in emergency mode.',
        proof: { status: 'emergency_fixture', source_path: 'src/terrarium-runtime.js', timestamp: 'runtime' },
        next_event: 'proof_failed',
      },
    ],
    gates: [],
    resources: [],
    fog: [],
    quests: [],
    receipts: [],
  };
}

function normalizeViewportObjects(viewport, raw, mode) {
  const source = viewport && Array.isArray(viewport.objects) ? viewport.objects : [];
  return source.map((obj, index) => {
    const proof = {
      status: obj.proof_status || obj.proofStatus || 'viewport_object',
      source_path: obj.source_path || obj.path || raw?.meta?.source_path || 'source path pending',
      timestamp: obj.timestamp || obj.mtime_iso || raw?.meta?.created_at || 'timestamp pending',
      event_id: obj.event_id || raw?.meta?.event_id || raw?.viewport?.event_bus?.current_event_id || 'event pending',
    };
    return {
      id: obj.entity_id || obj.id || `viewport-${index}`,
      title: obj.title || obj.entity_id || obj.id || `Viewport ${index + 1}`,
      visible_as: obj.visible_as || obj.kind || 'building',
      state: obj.state || obj.status || proof.status,
      x: Number.isFinite(Number(obj.x)) ? Number(obj.x) : null,
      y: Number.isFinite(Number(obj.y)) ? Number(obj.y) : null,
      body: obj.body || obj.summary || `Viewport object compiled from ${proof.source_path}.`,
      proof: normalizeProof(proof, raw, mode),
      next_event: obj.next_event || obj.nextEvent || 'optimal_action_requested',
    };
  });
}

function viewportBuildingKind(visibleAs) {
  switch (visibleAs) {
    case 'locked_door': return 'gate';
    case 'receipt_light': return 'proof';
    case 'resource_light': return 'north_star';
    case 'fog_alarm': return 'proof_gap';
    case 'source_root': return 'source_root';
    default: return 'viewport';
  }
}

function viewportBuilding(obj, index, width, height) {
  const derived = placeByIndex(index, width, height);
  return {
    id: obj.id,
    title: obj.title,
    kind: viewportBuildingKind(obj.visible_as),
    state: obj.state,
    x: obj.x !== null ? obj.x : derived.x,
    y: obj.y !== null ? obj.y : derived.y,
    w: obj.visible_as === 'source_root' ? 6 : 5,
    h: obj.visible_as === 'locked_door' ? 5 : 4,
    body: obj.body,
    proof: obj.proof,
    next_event: obj.next_event,
  };
}

function viewportAgent(obj, index, buildings) {
  const anchor = buildings[index % Math.max(1, buildings.length)] || { x: 8, y: 8, h: 2 };
  return {
    id: obj.id,
    title: obj.title,
    role: obj.id,
    state: obj.state,
    mood: moodFromState(obj.state),
    x: obj.x !== null ? obj.x : anchor.x + 1 + (index % 3),
    y: obj.y !== null ? obj.y : anchor.y + anchor.h + 1,
    body: obj.body,
    proof: obj.proof,
    next_event: obj.next_event,
    wobble: (hash(obj.id || index) % 100) / 100,
  };
}

function normalizeWorld(raw, mode) {
  const tilemap = raw.tilemap || {};
  const width = Number(tilemap.width || raw.width || 42);
  const height = Number(tilemap.height || raw.height || 30);
  const tileSize = Number(tilemap.tile_size || tilemap.tileSize || TILE);
  const viewportObjects = normalizeViewportObjects(raw.viewport, raw, mode);
  const viewportBuildings = viewportObjects
    .filter((obj) => obj.visible_as !== 'agent_sprite')
    .map((obj, index) => viewportBuilding(obj, index, width, height));
  const organs = Array.isArray(raw.organs) ? raw.organs : [];
  const organBuildings = organs.map((organ, index) => {
    const derived = placeByIndex(index, width, height);
    return {
      id: organ.id || `organ-${index}`,
      title: organ.title || organ.name || organ.id || `Organ ${index + 1}`,
      kind: organ.kind || organ.type || 'organ',
      state: organ.state || organ.status || 'unknown',
      x: Number.isFinite(Number(organ.x)) ? Number(organ.x) : derived.x,
      y: Number.isFinite(Number(organ.y)) ? Number(organ.y) : derived.y,
      w: Number(organ.w || organ.width || 5),
      h: Number(organ.h || organ.height || 4),
      body: organ.body || organ.description || 'No body text yet; inspect proof trail before trusting this state.',
      proof: normalizeProof(organ.proof, raw, mode),
      next_event: organ.next_event || organ.nextEvent || 'proof_failed',
    };
  });
  const buildings = viewportBuildings.length ? viewportBuildings : organBuildings;

  const viewportAgents = viewportObjects
    .filter((obj) => obj.visible_as === 'agent_sprite')
    .map((obj, index) => viewportAgent(obj, index, buildings));
  const sourceAgents = (Array.isArray(raw.agents) ? raw.agents : []).map((agent, index) => {
    const anchor = buildings[index % Math.max(1, buildings.length)] || { x: 8, y: 8, w: 2, h: 2 };
    return {
      id: agent.id || `agent-${index}`,
      title: agent.title || agent.name || agent.id || `Agent ${index + 1}`,
      role: agent.role || agent.kind || 'worker',
      state: agent.state || 'unknown',
      mood: agent.mood || moodFromState(agent.state),
      x: Number.isFinite(Number(agent.x)) ? Number(agent.x) : anchor.x + 1 + (index % 3),
      y: Number.isFinite(Number(agent.y)) ? Number(agent.y) : anchor.y + anchor.h + 1,
      body: agent.body || agent.description || 'Agent body exists; its source proof decides whether it is live or decorative.',
      proof: normalizeProof(agent.proof, raw, mode),
      next_event: agent.next_event || agent.nextEvent || 'playtest_result',
      wobble: (hash(agent.id || index) % 100) / 100,
    };
  });
  const agents = viewportAgents.length ? viewportAgents : sourceAgents;

  return {
    meta: raw.meta || {},
    viewport: raw.viewport || {},
    viewportObjects,
    tilemap: { width, height, tileSize, biome: tilemap.biome || 'terrarium', weather: tilemap.weather || 'still' },
    buildings,
    agents,
    gates: Array.isArray(raw.gates) ? raw.gates : [],
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    fog: Array.isArray(raw.fog) ? raw.fog : [],
    quests: Array.isArray(raw.quests) ? raw.quests : [],
    receipts: Array.isArray(raw.receipts) ? raw.receipts : [],
  };
}

function normalizeProof(proof, raw, mode) {
  const p = proof || {};
  return {
    status: p.status || (mode === 'live' ? 'unknown_live' : 'fixture_not_truth'),
    source_path: p.source_path || p.path || raw?.meta?.source_path || 'source path pending',
    timestamp: p.timestamp || p.mtime_iso || p.created_at || raw?.meta?.created_at || 'timestamp pending',
    event_id: p.event_id || raw?.meta?.event_id || 'event pending',
  };
}

function placeByIndex(index, width, height) {
  const positions = [
    [5, 7], [16, 5], [28, 7], [24, 19], [12, 20], [33, 23], [7, 22], [34, 12],
  ];
  const pair = positions[index % positions.length];
  return { x: clamp(pair[0], 2, width - 8), y: clamp(pair[1], 2, height - 6) };
}

function moodFromState(agentState) {
  const text = String(agentState || '').toLowerCase();
  if (text.includes('block') || text.includes('fail') || text.includes('missing')) return 'red';
  if (text.includes('wait') || text.includes('pending')) return 'gold';
  if (text.includes('active') || text.includes('pass')) return 'green';
  return 'blue';
}

function updateHud() {
  const modeText = state.mode === 'live' ? 'Local snapshot' : 'Offline safety view';
  modePill.dataset.mode = state.mode === 'live' ? 'live' : 'fixture';
  modePill.textContent = modeText;
  const viewportCount = state.world?.viewportObjects?.length || 0;
  worldBadge.textContent = state.mode === 'live'
    ? `Latest local snapshot · ${viewportCount} things to inspect`
    : 'Offline safety view · proof-labeled fallback';
}

function updateInspector() {
  const item = state.selected;
  if (!item) return;
  const details = state.engine ? inspectEntity(state.engine, item.id) : null;
  selectedTitle.textContent = details?.title || item.title || item.id;
  selectedState.textContent = formatStateLabel(details?.state || item.state || item.role || 'unknown');
  const nextEvent = details?.nextEvent || item.next_event;
  const next = nextEvent ? ` Next safe signal: ${formatEventLabel(nextEvent)}.` : '';
  const architecture = formatLoopArchitecture(details?.architecture || state.world?.loopArchitecture);
  const architectureNote = architecture ? ` Loop architecture: ${architecture}` : '';
  const mode = state.mode === 'live' ? '' : ' Offline view: confirm live state before trusting it.';
  const proofOnlyDetail = state.rawProofOpen ? `${next}${architectureNote}` : '';
  const guide = details?.ownerGuide || item.ownerGuide || null;
  if (guide && (item.visible_as === 'owner_guide' || details?.kind === 'owner_guide' || state.engine?.game?.ownerGuideOpen)) {
    selectedState.textContent = 'Owner ops';
    selectedBody.textContent = formatOwnerGuideBody(guide, details?.body || item.body || '');
  } else {
    selectedBody.textContent = `${details?.body || item.body || 'No description.'}${proofOnlyDetail}${mode}`;
  }
  renderProofLine(details, item);
}

function formatOwnerGuideBody(guide, summary) {
  const section = (title, rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    return `${title}\n- ${list.slice(0, 5).join('\n- ')}`;
  };
  return [
    summary || 'Owner operating guide.',
    section('SAY', guide.say),
    section('IGNORE', guide.ignore),
    section('APPROVE', guide.approve),
    section('OUTCOMES', guide.outcomes),
    section('FIRST 30s', guide.first_30_seconds || guide.first30Seconds),
  ].filter(Boolean).join('\n\n');
}

function formatStateLabel(raw) {
  const text = String(raw || '').toLowerCase();
  if (text.includes('following')) return 'Following you';
  if (text.includes('locked') || text.includes('gate')) return 'Locked gate';
  if (text.includes('fail') || text.includes('missing') || text.includes('fog')) return 'Needs proof';
  if (text.includes('cleared')) return 'Cleared locally';
  if (text.includes('active') || text.includes('pass')) return 'Active';
  if (text.includes('listen') || text.includes('pending') || text.includes('wait')) return 'Listening';
  if (text.includes('visible') || text.includes('source') || text.includes('exists')) return 'Visible work';
  return 'Workspace item';
}

function formatEventLabel(raw) {
  return String(raw || 'next event').replace(/_/g, ' ');
}

function formatLoopArchitecture(architecture) {
  if (!architecture) return '';
  const name = architecture.name || 'event-driven loops';
  const fabric = architecture.fabric || 'event fabric';
  const eventType = formatEventLabel(architecture.currentEventType || architecture.current_event_type || 'event pending');
  const eventId = architecture.currentEventId || architecture.current_event_id || 'event pending';
  const activeLoops = Array.isArray(architecture.activeLoops || architecture.active_loops)
    ? (architecture.activeLoops || architecture.active_loops).slice(0, 3).join(' → ')
    : '';
  const active = activeLoops ? ` Active loops: ${activeLoops}.` : '';
  return `${name} via ${fabric}; current event ${eventType} / ${eventId}.${active}`;
}

function formatProofStatus(raw) {
  const text = String(raw || 'pending').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compactTime(raw) {
  const text = String(raw || 'pending');
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return `${text.replace('T', ' ').replace(/Z$/, '').slice(0, 16)}Z`;
  return text;
}

function proofDetails(details, item) {
  return {
    source: details?.proof?.sourcePath || item.proof?.source_path || 'pending',
    time: details?.proof?.timestamp || item.proof?.timestamp || 'pending',
    status: details?.proof?.proofStatus || item.proof?.status || 'pending',
    eventId: details?.proof?.eventId || item.proof?.event_id || 'event pending',
    sha256: details?.proof?.sha256 || item.sha256 || item.proof?.sha256 || 'sha256 pending',
    hashScope: details?.proof?.hashScope || item.hashScope || item.proof?.hash_scope || 'source_content_sha256',
  };
}

function renderProofLine(details, item) {
  const proof = proofDetails(details, item);
  proofSource.dataset.raw = proof.source;
  proofTime.dataset.raw = proof.time;
  proofStatus.dataset.raw = proof.status;
  proofToggle.setAttribute('aria-expanded', state.rawProofOpen ? 'true' : 'false');
  proofToggle.textContent = state.rawProofOpen ? 'Hide proof' : 'Proof trail';
  if (state.rawProofOpen) {
    proofSource.innerHTML = `<b>Source</b> ${escapeText(proof.source)}`;
    proofTime.innerHTML = `<b>Time</b> ${escapeText(proof.time)}`;
    const hashLabel = String(proof.hashScope).includes('metadata') ? 'metadata hash' : 'source hash';
    proofStatus.innerHTML = `<b>Proof</b> ${escapeText(proof.status)} · event ${escapeText(proof.eventId)} · ${hashLabel} ${escapeText(String(proof.sha256).slice(0, 12))}`;
    return;
  }
  proofSource.innerHTML = '<b>Source</b> linked';
  proofTime.innerHTML = `<b>Time</b> ${escapeText(compactTime(proof.time))}`;
  proofStatus.innerHTML = `<b>Proof</b> ${escapeText(formatProofStatus(proof.status))}`;
}

function updateMorningBrief(hud) {
  const brief = hud?.morningBrief || {};
  const queue = hud?.queue || {};
  if (morningBrief) morningBrief.dataset.tone = brief.tone || 'watch';
  if (briefHealth) briefHealth.textContent = brief.health || 'Snapshot unavailable';
  if (briefWork) briefWork.textContent = brief.working || 'Local work state unavailable';
  if (briefGate) briefGate.textContent = brief.owner || 'Nothing needs you';
  if (briefFresh) briefFresh.textContent = `${snapshotAgeLabel()}${state.refreshError ? ' · refresh paused' : ''}`;
  if (worldBadge) {
    const queued = Number(queue.queued || 0);
    const claimed = Number(queue.claimed || 0);
    const receipted = Number(queue.receipted || 0);
    worldBadge.textContent = `${queued} waiting · ${claimed} working · ${receipted} finished`;
  }
}

function updateGameHud() {
  if (!state.engine) return;
  const hud = getGameHud(state.engine);
  updateMorningBrief(hud);
  proofValue.textContent = String(hud.proof);
  signalValue.textContent = String(hud.signal);
  questTitle.textContent = hud.activeQuest ? hud.activeQuest.title : 'All local quests settled';
  questBody.textContent = hud.activeQuest ? `${hud.activeQuest.progress} · ${hud.activeQuest.body}` : 'No open local loop quest.';
  gameMessage.textContent = hud.message || 'Keep moving through the working room.';
  gameMessage.dataset.nearby = hud.nearbyEntityId || '';
  state.gameHud = hud;
}

function escapeText(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function updatePlayer() {
  const inputKeys = [...keys, ...virtualKeys];
  const viewportSize = getViewportSize();
  if (state.engine) {
    stepTerrariumEngine(state.engine, {
      keys: inputKeys,
      deltaMs: 1000 / 60,
      viewportSize,
    });
    state.world = state.engine.world;
    state.player = state.engine.player;
    state.camera = state.engine.camera;
    if (state.engine.selectedId) {
      state.selected = state.world.entities.find((entity) => entity.id === state.engine.selectedId) || state.selected;
    }
    updateGameHud();
    return;
  }

  let dx = 0;
  let dy = 0;
  if (keys.has('arrowleft') || keys.has('a') || virtualKeys.has('left')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d') || virtualKeys.has('right')) dx += 1;
  if (keys.has('arrowup') || keys.has('w') || virtualKeys.has('up')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s') || virtualKeys.has('down')) dy += 1;
  if (dx || dy) {
    const len = Math.hypot(dx, dy) || 1;
    state.player.x += (dx / len) * state.player.speed;
    state.player.y += (dy / len) * state.player.speed;
    state.player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  const world = state.world;
  if (!world) return;
  const worldW = world.tilemap.width * world.tilemap.tileSize;
  const worldH = world.tilemap.height * world.tilemap.tileSize;
  state.player.x = clamp(state.player.x, 16, worldW - 16);
  state.player.y = clamp(state.player.y, 16, worldH - 16);
  state.camera.x += (state.player.x - viewportSize.width / 2 - state.camera.x) * 0.1;
  state.camera.y += (state.player.y - viewportSize.height / 2 - state.camera.y) * 0.1;
  state.camera.x = clamp(state.camera.x, 0, Math.max(0, worldW - viewportSize.width));
  state.camera.y = clamp(state.camera.y, 0, Math.max(0, worldH - viewportSize.height));
}

function draw() {
  resizeCanvas();
  updatePlayer();
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!state.world) {
    requestAnimationFrame(draw);
    return;
  }
  const world = state.world;
  drawTiles(world, rect);
  drawPond(world);
  drawRoads(world);
  drawQueueCrates(world);
  world.fog.forEach(drawFog);
  world.resources.forEach(drawResource);
  world.receipts.forEach(drawProofLantern);
  world.gates.forEach(drawGate);
  world.buildings.forEach(drawBuilding);
  drawWaterwheel(world);
  world.quests.forEach(drawQuestMarker);
  world.agents.forEach(drawAgent);
  drawPlayer();
  drawFishbowlGlass(rect);
  state.tick += 1;
  requestAnimationFrame(draw);
}

function toScreen(tileX, tileY) {
  return { x: tileX * TILE - state.camera.x, y: tileY * TILE - state.camera.y };
}

function drawTiles(world, rect) {
  const startX = Math.floor(state.camera.x / TILE) - 1;
  const startY = Math.floor(state.camera.y / TILE) - 1;
  const endX = Math.ceil((state.camera.x + rect.width) / TILE) + 1;
  const endY = Math.ceil((state.camera.y + rect.height) / TILE) + 1;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const h = hash(`${x},${y},${world.tilemap.biome}`);
      const px = x * TILE - state.camera.x;
      const py = y * TILE - state.camera.y;
      const color = h % 9 === 0 ? '#6f9b58' : h % 5 === 0 ? '#82aa5f' : '#78a35a';
      ctx.fillStyle = color;
      ctx.fillRect(px, py, TILE, TILE);
      if (h % 4 === 0) {
        ctx.fillStyle = '#5f874d';
        ctx.fillRect(px + 6 + (h % 13), py + 8 + (h % 11), 2, 5);
        ctx.fillRect(px + 9 + (h % 13), py + 10 + (h % 11), 2, 3);
      }
      if (h % 31 === 0) {
        const flower = h % 2 ? '#f8d36d' : '#f5b3b6';
        ctx.fillStyle = flower;
        ctx.fillRect(px + 19, py + 7, 3, 3);
        ctx.fillStyle = '#4f7746';
        ctx.fillRect(px + 20, py + 10, 1, 5);
      }
      ctx.fillStyle = 'rgba(255,255,210,0.035)';
      ctx.fillRect(px + 1, py + 1, TILE - 2, 2);
    }
  }
}

function drawPond(world) {
  const pond = { x: 18, y: 11, w: 7, h: 4 };
  const s = toScreen(pond.x, pond.y);
  const w = pond.w * TILE;
  const h = pond.h * TILE;
  const motionTick = reducedMotion ? 0 : state.tick;
  ctx.save();
  ctx.fillStyle = '#42684d';
  ctx.fillRect(s.x - 7, s.y + 8, w + 14, h - 16);
  ctx.fillRect(s.x + 8, s.y - 7, w - 16, h + 14);
  ctx.fillStyle = '#397d86';
  ctx.fillRect(s.x, s.y + 10, w, h - 20);
  ctx.fillRect(s.x + 10, s.y, w - 20, h);
  ctx.fillStyle = '#60b5ae';
  ctx.fillRect(s.x + 10, s.y + 8, w - 20, h - 20);
  ctx.fillStyle = 'rgba(220,255,231,0.32)';
  for (let i = 0; i < 5; i += 1) {
    const rippleX = s.x + 24 + ((motionTick * (0.14 + i * 0.01) + i * 43) % Math.max(40, w - 48));
    const rippleY = s.y + 24 + (i % 3) * 34;
    ctx.fillRect(rippleX, rippleY, 14, 2);
    ctx.fillRect(rippleX + 4, rippleY + 3, 7, 1);
  }
  const fishColors = ['#f4c85d', '#f29a69', '#fff1c7'];
  fishColors.forEach((color, i) => {
    const travel = Math.max(32, w - 70);
    const fx = s.x + 28 + ((motionTick * (0.09 + i * 0.02) + i * 71) % travel);
    const fy = s.y + 42 + i * 31;
    ctx.fillStyle = color;
    ctx.fillRect(fx, fy, 10, 5);
    ctx.fillRect(fx - 4, fy + 1, 4, 3);
    ctx.fillStyle = '#3d5f5b';
    ctx.fillRect(fx + 7, fy + 1, 1, 1);
  });
  const queue = world.fishbowl?.queue || {};
  const bubbles = clamp(Math.ceil(Number(queue.queued || 0) / 60), 0, 6);
  ctx.strokeStyle = 'rgba(236,255,246,0.68)';
  ctx.lineWidth = 1;
  for (let i = 0; i < bubbles; i += 1) {
    const bx = s.x + 40 + i * 27;
    const by = s.y + h - 22 - ((motionTick * 0.16 + i * 17) % Math.max(24, h - 44));
    ctx.strokeRect(bx, by, 3 + (i % 2), 3 + (i % 2));
  }
  ctx.restore();
}

function drawRoads(world) {
  if (!world.buildings.length) return;
  const center = toScreen(16, 17);
  const left = toScreen(3, 17);
  const right = toScreen(39, 17);
  const top = toScreen(16, 3);
  const bottom = toScreen(16, 28);
  ctx.save();
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#b99461';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.stroke();
  ctx.strokeStyle = '#d4b77e';
  ctx.lineWidth = 8;
  ctx.setLineDash([13, 10]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#a98358';
  ctx.lineWidth = 9;
  world.buildings.slice(0, 7).forEach((building) => {
    const x = (building.x + building.w / 2) * TILE - state.camera.x;
    const y = (building.y + building.h / 2) * TILE - state.camera.y;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(center.x, y);
    ctx.lineTo(center.x, center.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawQueueCrates(world) {
  const queue = world.fishbowl?.queue || {};
  const granary = world.buildings.find((item) => item.id === 'workflow-queue' || /granary/i.test(item.title || ''));
  if (!granary) return;
  const queued = Number(queue.queued || 0);
  const crateCount = queued <= 0 ? 0 : clamp(Math.ceil(Math.log2(queued + 1)), 1, 8);
  const s = toScreen(granary.x + granary.w - 0.6, granary.y + granary.h - 0.4);
  ctx.save();
  for (let i = 0; i < crateCount; i += 1) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = s.x + col * 15;
    const y = s.y - row * 14;
    ctx.fillStyle = '#a9683d';
    ctx.fillRect(x, y, 13, 12);
    ctx.strokeStyle = '#5b3c2d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 13, 12);
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + 11, y + 10);
    ctx.moveTo(x + 11, y + 2);
    ctx.lineTo(x + 2, y + 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBuilding(building) {
  const archetype = buildingArchetype(building);
  if (archetype === 'orchard') {
    drawOrchard(building);
    return;
  }
  const s = toScreen(building.x, building.y);
  const sourceW = building.w * TILE;
  const sourceH = building.h * TILE;
  const w = clamp(sourceW, 92, 148);
  const h = clamp(sourceH, 76, 116);
  const x = s.x + (sourceW - w) / 2;
  const y = s.y + sourceH - h;
  const palette = buildingPalette(archetype, building.proof?.status);
  ctx.save();
  ctx.fillStyle = 'rgba(47,45,32,0.26)';
  ctx.fillRect(x + 5, y + h - 3, w, 9);
  ctx.fillStyle = palette.wall;
  ctx.fillRect(x + 5, y + 31, w - 10, h - 31);
  ctx.fillStyle = palette.trim;
  ctx.fillRect(x + 5, y + 48, w - 10, 4);
  ctx.fillStyle = palette.roof;
  ctx.fillRect(x - 3, y + 20, w + 6, 16);
  ctx.fillRect(x + 7, y + 9, w - 14, 16);
  ctx.fillRect(x + 19, y, w - 38, 13);
  ctx.fillStyle = palette.roofLight;
  ctx.fillRect(x + 9, y + 11, w - 18, 4);
  ctx.fillStyle = '#5b3b2e';
  ctx.fillRect(x + w / 2 - 9, y + h - 34, 18, 34);
  ctx.fillStyle = '#d9a75f';
  ctx.fillRect(x + w / 2 + 4, y + h - 18, 3, 3);
  ctx.fillStyle = palette.light;
  ctx.fillRect(x + 17, y + 50, 16, 14);
  ctx.fillRect(x + w - 33, y + 50, 16, 14);
  ctx.fillStyle = '#6d4a35';
  ctx.fillRect(x + 15, y + 48, 20, 3);
  ctx.fillRect(x + w - 35, y + 48, 20, 3);
  ctx.fillStyle = '#5f7541';
  ctx.fillRect(x + 12, y + h - 7, 22, 5);
  ctx.fillRect(x + w - 35, y + h - 7, 22, 5);
  if (archetype === 'workshop') {
    ctx.fillStyle = '#5e392b';
    ctx.fillRect(x + w - 26, y - 12, 12, 28);
    ctx.fillStyle = '#d8c198';
    ctx.fillRect(x + w - 28, y - 15, 16, 5);
  }
  ctx.strokeStyle = state.selected?.id === building.id ? '#fff2a8' : '#4b342d';
  ctx.lineWidth = state.selected?.id === building.id ? 4 : 2;
  ctx.strokeRect(x + 1, y + 21, w - 2, h - 21);
  ctx.fillStyle = '#fff7d6';
  ctx.font = '900 10px "Segoe UI", sans-serif';
  ctx.fillText(shortLabel(building.title), x + 8, y + h - 10, w - 16);
  const proofText = `${building.proof?.status || ''} ${building.state || ''}`.toLowerCase();
  drawProofSpark(x + w - 13, y + 11, proofText.includes('fail') || proofText.includes('missing') ? '#b94e62' : '#f4c85d');
  ctx.restore();
}

function buildingArchetype(building) {
  const text = `${building.id || ''} ${building.title || ''} ${building.kind || ''}`.toLowerCase();
  if (text.includes('proof-orchard') || text.includes('orchard')) return 'orchard';
  if (text.includes('workflow') || text.includes('granary') || text.includes('queue')) return 'granary';
  if (text.includes('inbox') || text.includes('sorting') || text.includes('refinery')) return 'sorting';
  if (text.includes('service') || text.includes('hearth')) return 'hearth';
  if (text.includes('terrarium') || text.includes('workshop') || text.includes('event-bus')) return 'workshop';
  if (text.includes('library') || text.includes('viewport')) return 'library';
  if (text.includes('constitution') || text.includes('steward')) return 'hall';
  if (text.includes('owner') || text.includes('guide')) return 'farmhouse';
  if (text.includes('capability') || text.includes('tool shed')) return 'tool-shed';
  return 'cottage';
}

function buildingPalette(kind, proofStatus) {
  const status = String(proofStatus || '').toLowerCase();
  if (status.includes('fail') || status.includes('missing')) return { wall: '#b46c65', roof: '#7c3f4b', roofLight: '#c76970', trim: '#edd2a3', light: '#ffe7a7' };
  const palettes = {
    granary: { wall: '#c37a4c', roof: '#7b3f36', roofLight: '#aa5946', trim: '#efc478', light: '#ffedaa' },
    sorting: { wall: '#d29a58', roof: '#84503b', roofLight: '#b26a4b', trim: '#f3d28d', light: '#fff0b8' },
    hearth: { wall: '#e2b46e', roof: '#8a4c45', roofLight: '#bc6c58', trim: '#fff0b3', light: '#fff8cf' },
    workshop: { wall: '#b67852', roof: '#4d6960', roofLight: '#76917b', trim: '#e6c384', light: '#d8f2c0' },
    library: { wall: '#d0a468', roof: '#596c7c', roofLight: '#8193a0', trim: '#f2d9a0', light: '#d7ecdd' },
    hall: { wall: '#c58d62', roof: '#6f4b64', roofLight: '#92708a', trim: '#efd19e', light: '#f5e3bf' },
    farmhouse: { wall: '#e2bd7c', roof: '#774550', roofLight: '#a65d67', trim: '#fff0b5', light: '#fff7d1' },
    'tool-shed': { wall: '#ae7b55', roof: '#4e6a50', roofLight: '#728d67', trim: '#dec18c', light: '#e6efbb' },
    cottage: { wall: '#d7aa6d', roof: '#7d5141', roofLight: '#a86c51', trim: '#f3d99e', light: '#fff0b3' },
  };
  return palettes[kind] || palettes.cottage;
}

function drawOrchard(building) {
  const s = toScreen(building.x, building.y);
  const cbr = Number(state.world?.fishbowl?.proof?.cbr_r || 0);
  const mesReal = state.world?.fishbowl?.proof?.mes_r_status === 'REAL';
  const ripe = clamp(Math.round(cbr * 4), 0, 8);
  ctx.save();
  for (let i = 0; i < 6; i += 1) {
    const x = s.x + 24 + (i % 3) * 38;
    const y = s.y + 28 + Math.floor(i / 3) * 50;
    ctx.fillStyle = '#6e4a32';
    ctx.fillRect(x - 3, y + 12, 7, 23);
    ctx.fillStyle = mesReal ? '#4f864c' : '#6f8c50';
    ctx.fillRect(x - 15, y, 31, 22);
    ctx.fillRect(x - 10, y - 8, 22, 34);
    const fruitCount = clamp(ripe - i, 0, 3);
    ctx.fillStyle = mesReal ? '#d95f54' : '#e5b853';
    for (let f = 0; f < fruitCount; f += 1) ctx.fillRect(x - 8 + f * 8, y + 5 + (f % 2) * 6, 4, 4);
  }
  ctx.fillStyle = '#fff3c5';
  ctx.font = '900 10px "Segoe UI", sans-serif';
  ctx.fillText('Proof Orchard', s.x + 14, s.y + 127);
  if (state.selected?.id === building.id) {
    ctx.strokeStyle = '#fff2a8';
    ctx.lineWidth = 3;
    ctx.strokeRect(s.x + 6, s.y - 12, 126, 145);
  }
  ctx.restore();
}

function shortLabel(text) {
  const s = String(text || 'item');
  return s.length > 18 ? `${s.slice(0, 17)}…` : s;
}

function drawProofSpark(x, y, color) {
  const pulse = reducedMotion ? 4 : 4 + Math.sin(state.tick / 12) * 2;
  ctx.fillStyle = color;
  ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.38;
  ctx.strokeRect(x - pulse, y - pulse, pulse * 2, pulse * 2);
  ctx.globalAlpha = 1;
}

function drawWaterwheel(world) {
  const workshop = world.buildings.find((item) => item.id === 'agent-terrarium' || /waterwheel|workshop/i.test(item.title || ''));
  if (!workshop) return;
  const s = toScreen(workshop.x + workshop.w - 0.2, workshop.y + workshop.h - 1.3);
  const flow = clamp(Number(world.fishbowl?.proof?.cbr_r || 0), 0.08, 1.4);
  const angle = reducedMotion ? 0 : state.tick * 0.012 * flow;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(angle);
  ctx.strokeStyle = '#62412e';
  ctx.lineWidth = 5;
  ctx.strokeRect(-22, -22, 44, 44);
  ctx.strokeStyle = '#d8aa62';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();
    ctx.fillStyle = '#805437';
    ctx.fillRect(18, -5, 12, 10);
    ctx.fillRect(-30, -5, 12, 10);
  }
  ctx.fillStyle = '#f0cc82';
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();
}

function drawAgent(agent) {
  const baseTileX = Number.isFinite(agent.renderX) ? agent.renderX : agent.x;
  const baseTileY = Number.isFinite(agent.renderY) ? agent.renderY : agent.y;
  const baseX = baseTileX * TILE - state.camera.x;
  const baseY = baseTileY * TILE - state.camera.y;
  const proofAge = Date.now() - Date.parse(agent.timestamp || '');
  const receiptBacked = /receipt|route_active/.test(String(agent.proofStatus || '').toLowerCase())
    && Number.isFinite(proofAge) && proofAge >= 0 && proofAge <= 5 * 60_000;
  const animate = agent.following || receiptBacked;
  const truthScale = animate ? Number(agent.activityScale ?? 0.55) : 0;
  const step = !reducedMotion && animate ? Math.sin(state.tick / 8 + agent.wobble * 5) * Math.min(2, truthScale * 2) : 0;
  const x = baseX;
  const y = baseY + step;
  const color = agentColor(agent.mood);
  const hatVariant = hash(agent.id || agent.title) % 3;
  ctx.save();
  ctx.fillStyle = 'rgba(45,45,28,0.26)';
  ctx.fillRect(x - 9, y + 19, 23, 6);
  ctx.fillStyle = color.legs;
  ctx.fillRect(x - 5, y + 12, 6, 10);
  ctx.fillRect(x + 6, y + 12, 6, 10);
  ctx.fillStyle = color.body;
  ctx.fillRect(x - 8, y - 2, 20, 17);
  ctx.fillStyle = color.apron;
  ctx.fillRect(x - 3, y + 3, 10, 12);
  ctx.fillStyle = '#efc49c';
  ctx.fillRect(x - 5, y - 14, 14, 13);
  ctx.fillStyle = '#5c3b31';
  ctx.fillRect(x - 6, y - 15, 16, 5);
  if (hatVariant === 0) {
    ctx.fillStyle = color.hat;
    ctx.fillRect(x - 10, y - 20, 24, 5);
    ctx.fillRect(x - 5, y - 25, 14, 6);
  } else if (hatVariant === 1) {
    ctx.fillStyle = color.hat;
    ctx.fillRect(x - 7, y - 21, 18, 7);
    ctx.fillRect(x - 10, y - 18, 24, 4);
  } else {
    ctx.fillStyle = color.hat;
    ctx.fillRect(x - 6, y - 21, 16, 6);
  }
  ctx.fillStyle = '#3b2a25';
  ctx.fillRect(x - 1, y - 9, 2, 2);
  ctx.fillRect(x + 5, y - 9, 2, 2);
  ctx.fillStyle = color.signal;
  ctx.fillRect(x - 11, y + 3, 3, 6);
  if (state.selected?.id === agent.id) {
    ctx.strokeStyle = '#fff2a8';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 14, y - 29, 33, 55);
  }
  if (agent.following || state.engine?.game?.followedAgentId === agent.id) {
    ctx.strokeStyle = '#f4c85d';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x - 18, y - 32, 41, 62);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function agentColor(mood) {
  switch (mood) {
    case 'red': return { body: '#b94e62', apron: '#f0ba9c', legs: '#553b3c', hat: '#7d3e4e', signal: '#eaa2a9' };
    case 'gold': return { body: '#d39a45', apron: '#fff0b3', legs: '#66513a', hat: '#9a633a', signal: '#ffe07b' };
    case 'violet': return { body: '#8b668e', apron: '#e5cedf', legs: '#4c4357', hat: '#6f536f', signal: '#d5aad2' };
    case 'blue': return { body: '#557c86', apron: '#c9e2d6', legs: '#3a4e54', hat: '#45656c', signal: '#8bc5c1' };
    default: return { body: '#5f9257', apron: '#e6efbb', legs: '#405646', hat: '#8c5035', signal: '#b6d977' };
  }
}

function drawProofLantern(receipt) {
  const s = toScreen(receipt.x || 0, receipt.y || 0);
  if (receipt.collected) {
    drawCollectedProof(s.x, s.y, receipt.title || receipt.id);
    return;
  }
  const pulse = reducedMotion ? 2 : 2 + Math.sin(state.tick / 13 + hash(receipt.id) % 7) * 1.5;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#fff1a2';
  ctx.fillRect(s.x - 10 - pulse, s.y - 12 - pulse, 20 + pulse * 2, 24 + pulse * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#654531';
  ctx.fillRect(s.x - 7, s.y - 12, 16, 3);
  ctx.fillRect(s.x - 9, s.y + 10, 20, 4);
  ctx.fillRect(s.x - 9, s.y - 9, 3, 19);
  ctx.fillRect(s.x + 8, s.y - 9, 3, 19);
  ctx.fillStyle = '#f7c95a';
  ctx.fillRect(s.x - 5, s.y - 8, 12, 17);
  ctx.fillStyle = '#fff2ae';
  ctx.fillRect(s.x - 2, s.y - 5, 5, 9);
  if (state.selected?.id === receipt.id) {
    ctx.strokeStyle = '#fff2a8';
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x - 13, s.y - 17, 28, 35);
  }
  ctx.restore();
}

function drawGate(gate) {
  const s = toScreen(gate.x || 0, gate.y || 0);
  const checked = gate.gateChecked || String(gate.state || '').includes('approval_checked');
  ctx.save();
  ctx.fillStyle = '#654531';
  ctx.fillRect(s.x, s.y + 8, 8, 48);
  ctx.fillRect(s.x + 54, s.y + 8, 8, 48);
  ctx.fillStyle = '#96603c';
  ctx.fillRect(s.x + 6, s.y + 15, 50, 8);
  ctx.fillRect(s.x + 6, s.y + 40, 50, 8);
  ctx.fillStyle = '#c48a50';
  ctx.fillRect(s.x + 11, s.y + 18, 6, 30);
  ctx.fillRect(s.x + 25, s.y + 18, 6, 30);
  ctx.fillRect(s.x + 40, s.y + 18, 6, 30);
  ctx.fillStyle = '#f0c65d';
  ctx.fillRect(s.x + 24, s.y + 29, 14, 12);
  ctx.fillStyle = '#5a3d31';
  ctx.fillRect(s.x + 28, s.y + 25, 7, 7);
  ctx.fillRect(s.x + 30, s.y + 34, 3, 4);
  ctx.fillStyle = '#fff1c7';
  ctx.font = '900 9px "Segoe UI", sans-serif';
  ctx.fillText('OWNER GATE', s.x - 1, s.y + 4);
  if (checked) drawGateCheck(s.x + 31, s.y + 9, 'STILL LOCKED');
  if (state.selected?.id === gate.id) {
    ctx.strokeStyle = '#fff2a8';
    ctx.lineWidth = 3;
    ctx.strokeRect(s.x - 5, s.y - 8, 72, 69);
  }
  ctx.restore();
}

function drawResource(resource) {
  const s = toScreen(resource.x || 0, resource.y || 0);
  if (resource.collected) {
    drawCollectedProof(s.x, s.y, resource.title || resource.id);
    return;
  }
  drawProofSpark(s.x, s.y, resource.id?.includes('ember') ? '#ffd76b' : '#69f2a8');
}

function drawQuestMarker(quest) {
  const x = Number.isFinite(Number(quest.x)) ? Number(quest.x) : 6;
  const y = Number.isFinite(Number(quest.y)) ? Number(quest.y) : 15;
  const s = toScreen(x, y);
  ctx.save();
  ctx.fillStyle = '#654531';
  ctx.fillRect(s.x - 7, s.y + 13, 7, 28);
  ctx.fillRect(s.x + 43, s.y + 13, 7, 28);
  ctx.fillStyle = '#a86a42';
  ctx.fillRect(s.x - 12, s.y - 20, 67, 38);
  ctx.strokeStyle = '#54372c';
  ctx.lineWidth = 3;
  ctx.strokeRect(s.x - 12, s.y - 20, 67, 38);
  ctx.fillStyle = '#fff1c7';
  ctx.fillRect(s.x - 4, s.y - 13, 51, 24);
  ctx.fillStyle = '#754b34';
  ctx.font = '900 9px "Segoe UI", sans-serif';
  ctx.fillText('TODAY', s.x + 7, s.y + 1);
  ctx.fillStyle = '#f4c85d';
  ctx.fillRect(s.x + 38, s.y - 10, 5, 5);
  ctx.restore();
}

function drawCollectedProof(x, y, label = 'collected') {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = '#69f2a8';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 8, y - 8, 16, 16);
  ctx.fillStyle = '#07151c';
  ctx.fillRect(x - 5, y - 5, 10, 10);
  ctx.fillStyle = '#69f2a8';
  ctx.font = '900 9px sans-serif';
  ctx.fillText('✓', x - 3, y + 3);
  ctx.font = '700 9px sans-serif';
  ctx.fillText(shortLabel(label), x + 10, y + 3);
  ctx.restore();
}

function drawGateCheck(x, y, label = 'LOCKED') {
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(255, 215, 107, 0.16)';
  ctx.fillRect(x - 31, y - 13, 62, 22);
  ctx.strokeStyle = '#ffd76b';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 31, y - 13, 62, 22);
  ctx.fillStyle = '#fff0ba';
  ctx.font = '900 9px sans-serif';
  ctx.fillText(label, x - 22, y + 2);
  ctx.restore();
}

function drawFog(fog) {
  if (fog.cleared) {
    drawClearedFog(fog);
    return;
  }
  const s = toScreen(fog.x || 0, fog.y || 0);
  const w = (fog.w || 4) * TILE;
  const h = (fog.h || 3) * TILE;
  const drift = reducedMotion ? 0 : Math.sin(state.tick / 32 + hash(fog.id) % 5) * 5;
  ctx.save();
  ctx.globalAlpha = 0.56;
  ctx.fillStyle = '#bba7bd';
  ctx.fillRect(s.x + 8 + drift, s.y + 22, Math.max(24, w - 16), Math.max(20, h - 38));
  ctx.fillStyle = '#d7c6d4';
  ctx.fillRect(s.x + 22 + drift, s.y + 10, Math.max(20, w - 48), 25);
  ctx.fillRect(s.x - 2 + drift, s.y + 34, 36, 28);
  ctx.fillRect(s.x + w - 39 + drift, s.y + 29, 38, 31);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#5b6f4a';
  for (let i = 0; i < 5; i += 1) {
    const x = s.x + 12 + i * Math.max(12, (w - 24) / 5);
    ctx.fillRect(x, s.y + h - 18, 3, 17);
    ctx.fillRect(x - 4, s.y + h - 13, 5, 3);
    ctx.fillRect(x + 3, s.y + h - 9, 5, 3);
  }
  ctx.restore();
}

function drawClearedFog(fog) {
  const s = toScreen(fog.x || 0, fog.y || 0);
  const w = (fog.w || 4) * TILE;
  const h = (fog.h || 3) * TILE;
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.strokeStyle = '#d9e8a6';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(s.x + 5, s.y + 5, Math.max(12, w - 10), Math.max(12, h - 10));
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(233, 244, 180, 0.14)';
  ctx.fillRect(s.x + 8, s.y + 8, Math.max(8, w - 16), Math.max(8, h - 16));
  ctx.fillStyle = '#fff1c7';
  ctx.font = '900 9px "Segoe UI", sans-serif';
  ctx.fillText('PATH SEEN', s.x + 12, s.y + 22);
  ctx.restore();
}

function drawPlayer() {
  const x = state.player.x - state.camera.x;
  const y = state.player.y - state.camera.y;
  const step = reducedMotion ? 0 : Math.sin(state.tick / 7) * 1.5;
  ctx.save();
  ctx.fillStyle = 'rgba(45,45,28,0.28)';
  ctx.fillRect(x - 11, y + 17, 25, 6);
  ctx.fillStyle = '#4e665d';
  ctx.fillRect(x - 6, y + 8 + step, 7, 11);
  ctx.fillRect(x + 6, y + 8 + step, 7, 11);
  ctx.fillStyle = '#f2e4b6';
  ctx.fillRect(x - 8, y - 4 + step, 21, 16);
  ctx.fillStyle = '#5f7f7f';
  ctx.fillRect(x - 4, y + 1 + step, 13, 12);
  ctx.fillStyle = '#eabf92';
  ctx.fillRect(x - 5, y - 15 + step, 15, 12);
  ctx.fillStyle = '#6a4432';
  ctx.fillRect(x - 6, y - 16 + step, 17, 5);
  ctx.fillStyle = '#d6a455';
  ctx.fillRect(x - 12, y - 22 + step, 29, 5);
  ctx.fillRect(x - 7, y - 28 + step, 19, 8);
  ctx.fillStyle = '#48342b';
  ctx.fillRect(x - 1, y - 10 + step, 2, 2);
  ctx.fillRect(x + 6, y - 10 + step, 2, 2);
  ctx.strokeStyle = '#fff2a8';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 14, y - 31 + step, 34, 55);
  ctx.restore();
}

function drawFishbowlGlass(rect) {
  ctx.save();
  const edge = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  edge.addColorStop(0, 'rgba(240,255,245,0.52)');
  edge.addColorStop(0.25, 'rgba(255,255,255,0.06)');
  edge.addColorStop(0.75, 'rgba(255,255,255,0.04)');
  edge.addColorStop(1, 'rgba(180,229,221,0.42)');
  ctx.strokeStyle = edge;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, Math.max(1, rect.width - 6), Math.max(1, rect.height - 6));
  ctx.strokeStyle = 'rgba(54,88,81,0.58)';
  ctx.lineWidth = 2;
  ctx.strokeRect(7, 7, Math.max(1, rect.width - 14), Math.max(1, rect.height - 14));
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillRect(12, 12, 42, 3);
  ctx.fillRect(12, 15, 3, 34);
  ctx.fillRect(rect.width - 39, rect.height - 15, 27, 3);
  ctx.restore();
}

function selectAt(clientX, clientY) {
  if (!state.world) return;
  const rect = canvas.getBoundingClientRect();
  const wx = clientX - rect.left + state.camera.x;
  const wy = clientY - rect.top + state.camera.y;
  if (state.engine) {
    const hit = selectAtWorldPoint(state.engine, { x: wx, y: wy }, { cycleAfterId: state.selected?.id || '' });
    if (hit) state.selected = hit;
    updateInspector();
    return;
  }
  const tx = wx / TILE;
  const ty = wy / TILE;
  const hitBuilding = state.world.buildings.findLast((b) => tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h);
  const hitAgent = state.world.agents.findLast((a) => Math.hypot(tx - a.x, ty - a.y) < 1.2);
  state.selected = hitAgent || hitBuilding || state.selected;
  updateInspector();
}

function nearestAgent() {
  if (state.engine) return findNearestEntity(state.engine, { kind: 'agent' });
  if (!state.world?.agents.length) return null;
  return state.world.agents
    .map((agent) => ({ agent, dist: Math.hypot(agent.x * TILE - state.player.x, agent.y * TILE - state.player.y) }))
    .sort((a, b) => a.dist - b.dist)[0].agent;
}

function focusItem(item) {
  if (!item) return;
  state.selected = item;
  if (state.engine) state.engine.selectedId = item.id;
  state.player.x = clamp((item.x || 1) * TILE - 18, 16, state.world.tilemap.width * TILE - 16);
  state.player.y = clamp((item.y || 1) * TILE + 12, 16, state.world.tilemap.height * TILE - 16);
  updateInspector();
}

function focusEntity(entityId) {
  const item = state.world?.entities?.find((entity) => entity.id === entityId)
    || state.world?.buildings?.find((entity) => entity.id === entityId)
    || state.world?.agents?.find((entity) => entity.id === entityId)
    || state.world?.resources?.find((entity) => entity.id === entityId)
    || state.world?.fog?.find((entity) => entity.id === entityId)
    || state.world?.gates?.find((entity) => entity.id === entityId);
  if (!item) return { ok: false, reason: 'entity_not_found', entityId };
  focusItem(item);
  if (state.engine) {
    stepTerrariumEngine(state.engine, { deltaMs: 16, viewportSize: getViewportSize() });
    state.world = state.engine.world;
    state.player = state.engine.player;
    state.camera = state.engine.camera;
    state.selected = state.world.entities.find((entity) => entity.id === state.engine.selectedId) || item;
  }
  updateInspector();
  updateGameHud();
  return {
    ok: true,
    entityId: item.id,
    kind: item.visible_as || item.kind || item.engineKind,
    selectedId: state.selected?.id || null,
    player: { ...state.player },
  };
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key)) {
    keys.add(key);
    event.preventDefault();
  }
  if (key === 'e') {
    performAction('collectProof');
    event.preventDefault();
  }
  if (key === 'f') {
    performAction('followAgent');
    event.preventDefault();
  }
  if (key === ' ') {
    performAction('inspectNearest');
    event.preventDefault();
  }
  if (key === 'g') {
    performAction('openOwnerGuide');
    event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('click', (event) => selectAt(event.clientX, event.clientY));
canvas.addEventListener('touchstart', (event) => {
  const touch = event.changedTouches[0];
  if (touch) selectAt(touch.clientX, touch.clientY);
  event.preventDefault();
}, { passive: false });
document.querySelectorAll('[data-move]').forEach((button) => {
  const direction = button.dataset.move;
  const press = (event) => {
    virtualKeys.add(direction);
    button.dataset.held = 'true';
    if (event.pointerId && button.setPointerCapture) {
      try { button.setPointerCapture(event.pointerId); } catch {}
    }
    event.preventDefault();
  };
  const release = (event) => {
    virtualKeys.delete(direction);
    button.dataset.held = 'false';
    event.preventDefault();
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
});

function performAction(action) {
  if (!state.engine) return { ok: false, reason: 'engine_not_ready' };
  const result = performTerrariumAction(state.engine, action);
  state.world = state.engine.world;
  state.player = state.engine.player;
  state.camera = state.engine.camera;
  state.selected = state.world.entities.find((entity) => entity.id === state.engine.selectedId) || state.selected;
  updateInspector();
  updateGameHud();
  return result;
}

verbLook.addEventListener('click', () => performAction('inspectNearest'));
verbFollow.addEventListener('click', () => performAction('followAgent'));
verbGather.addEventListener('click', () => performAction('collectProof'));
verbClear.addEventListener('click', () => performAction('clearFog'));
verbGate.addEventListener('click', () => performAction('unlockGate'));
if (verbGuide) verbGuide.addEventListener('click', () => performAction('openOwnerGuide'));
proofToggle.addEventListener('click', () => {
  state.rawProofOpen = !state.rawProofOpen;
  updateInspector();
});

function setPlayerForTest(tileX, tileY) {
  if (!runtimeDebugEnabled || !state.engine || !state.world) return { ok: false, reason: 'debug_runtime_unavailable' };
  const rect = canvas.getBoundingClientRect();
  const worldWidth = state.world.tilemap.width * TILE;
  const worldHeight = state.world.tilemap.height * TILE;
  state.engine.player.x = clamp(Number(tileX) * TILE, 16, worldWidth - 16);
  state.engine.player.y = clamp(Number(tileY) * TILE, 16, worldHeight - 16);
  state.engine.camera.x = clamp(state.engine.player.x - rect.width / 2, 0, Math.max(0, worldWidth - rect.width));
  state.engine.camera.y = clamp(state.engine.player.y - rect.height / 2, 0, Math.max(0, worldHeight - rect.height));
  stepTerrariumEngine(state.engine, { keys: [], deltaMs: 0, viewportSize: { width: rect.width, height: rect.height } });
  state.player = state.engine.player;
  state.camera = state.engine.camera;
  updateGameHud();
  return {
    ok: true,
    player: { ...state.player },
    camera: { ...state.camera },
  };
}

function findEmptyPointForTest() {
  if (!runtimeDebugEnabled || !state.world) return { ok: false, reason: 'debug_runtime_unavailable' };
  let best = { x: 1.5, y: 1.5, clearance: -1 };
  for (let y = 1.5; y < state.world.tilemap.height - 1; y += 1) {
    for (let x = 1.5; x < state.world.tilemap.width - 1; x += 1) {
      const clearance = Math.min(...state.world.entities.map((entity) => {
        const centerX = entity.x + (entity.w || 1) / 2;
        const centerY = entity.y + (entity.h || 1) / 2;
        return Math.hypot(centerX - x, centerY - y);
      }));
      if (clearance > best.clearance) best = { x, y, clearance };
    }
  }
  return { ok: best.clearance > 5.5, ...best };
}

function screenPointForEntity(entityId) {
  if (!runtimeDebugEnabled || !state.engine) return { ok: false, reason: 'debug_runtime_unavailable' };
  const command = getRenderScene(state.engine).commands.find((item) => item.id === entityId);
  if (!command) return { ok: false, reason: 'entity_missing' };
  const rect = canvas.getBoundingClientRect();
  const pointX = command.kind === 'agent_sprite' ? command.x : command.x + (command.w || 1) / 2;
  const pointY = command.kind === 'agent_sprite' ? command.y : command.y + (command.h || 1) / 2;
  const centerX = pointX * TILE - state.camera.x;
  const centerY = pointY * TILE - state.camera.y;
  return {
    ok: true,
    x: rect.left + centerX,
    y: rect.top + centerY,
    inCanvas: centerX >= 0 && centerX <= rect.width && centerY >= 0 && centerY <= rect.height,
    command: { id: command.id, kind: command.kind, x: command.x, y: command.y, w: command.w, h: command.h },
  };
}

function getWorldGeometry() {
  const rect = canvas.getBoundingClientRect();
  const width = state.world?.tilemap?.width || 0;
  const height = state.world?.tilemap?.height || 0;
  return {
    tiles: { width, height, tileSize: TILE },
    worldWidth: width * TILE,
    worldHeight: height * TILE,
    camera: { ...state.camera },
    canvas: { width: rect.width, height: rect.height },
    fullMapMode,
  };
}

const runtimeApi = {
  getMode: () => state.mode,
  getPlayer: () => ({ ...state.player }),
  performAction: (action) => performAction(action),
  focusEntity: (entityId) => focusEntity(entityId),
  setPlayerForTest: (tileX, tileY) => setPlayerForTest(tileX, tileY),
  findEmptyPointForTest: () => findEmptyPointForTest(),
  screenPointForEntity: (entityId) => screenPointForEntity(entityId),
  getWorldGeometry: () => getWorldGeometry(),
  getGameHud: () => (state.engine ? getGameHud(state.engine) : null),
  getRenderScene: () => (state.engine ? getRenderScene(state.engine) : null),
  snapshotEngine: () => (state.engine ? snapshotEngine(state.engine) : null),
  getEventQueue: () => (state.engine ? state.engine.eventQueue.map((event) => ({ ...event })) : []),
  refreshWorld: (options = {}) => refreshWorldSnapshot(options),
  getRefreshSummary: () => ({
    snapshotAge: snapshotAgeLabel(),
    snapshotVersion: state.snapshotVersion,
    lastRefreshAt: state.lastRefreshAt,
    refreshError: state.refreshError,
    intervalMs: WORLD_REFRESH_MS,
  }),
  getSelected: () => (state.selected ? {
    id: state.selected.id,
    title: state.selected.title,
    state: state.selected.state,
    proof: { ...state.selected.proof },
    next_event: state.selected.next_event,
    architecture: state.engine ? inspectEntity(state.engine, state.selected.id)?.architecture : state.world?.loopArchitecture || null,
  } : null),
  getWorldSummary: () => ({
    mode: state.mode,
    eventId: state.raw?.meta?.event_id || state.raw?.viewport?.event_bus?.current_event_id || 'event pending',
    loopArchitecture: state.world?.loopArchitecture || null,
    buildings: state.world?.buildings?.length || 0,
    agents: state.world?.agents?.length || 0,
    viewportObjects: state.world?.viewportObjects?.length || 0,
    proof: state.engine ? getGameHud(state.engine).proof : 0,
    signal: state.engine ? getGameHud(state.engine).signal : 0,
    followedAgentId: state.engine ? getGameHud(state.engine).followedAgentId : null,
    questLog: state.engine ? getGameHud(state.engine).questLog.length : 0,
    hasSourceProof: Boolean(state.selected?.proof?.source_path && state.selected?.proof?.timestamp),
    snapshotAge: snapshotAgeLabel(),
    lastRefreshAt: state.lastRefreshAt,
    refreshError: state.refreshError,
  }),
};
if (runtimeDebugEnabled) window.__terrariumRuntime = runtimeApi;
loadWorld().then(() => {
  if (!state.refreshTimer) state.refreshTimer = window.setInterval(() => { refreshWorldSnapshot(); }, WORLD_REFRESH_MS);
});
window.addEventListener('beforeunload', () => {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
});
requestAnimationFrame(draw);
