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
import {
  getBuildingArtProfile,
  getBuildingDisplayLabel,
  getBuildingVisualState,
} from './terrarium-building-art.js';

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
  world.fog.forEach(drawFog);
  world.resources.forEach(drawResource);
  world.receipts.forEach(drawProofLantern);
  world.gates.forEach(drawGate);
  world.buildings.forEach(drawBuilding);
  drawQueueCrates(world);
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
  const profile = getBuildingArtProfile(building);
  const box = buildingRenderBox(building);
  ctx.save();
  drawBuildingSite(building, box, profile);
  switch (profile.id) {
    case 'source-foundation': drawSourceFoundation(building, box, profile); break;
    case 'hearth': drawHearthHouse(building, box, profile); break;
    case 'granary': drawWorkGranary(building, box, profile); break;
    case 'sorting': drawSortingShed(building, box, profile); break;
    case 'workshop': drawWaterwheelWorkshop(building, box, profile); break;
    case 'library': drawLookoutLibrary(building, box, profile); break;
    case 'hall': drawStewardsHall(building, box, profile); break;
    case 'mill': drawMillStream(building, box, profile); break;
    case 'tool-shed': drawToolShed(building, box, profile); break;
    case 'orchard': drawProofOrchard(building, box, profile); break;
    case 'shrine': drawOwnerOpsShrine(building, box, profile); break;
    default: drawCottage(building, box, profile); break;
  }
  if (profile.id !== 'source-foundation') {
    drawBuildingSign(building, box, profile);
    drawBuildingProofBeacon(building, box, profile);
  }
  drawBuildingSelection(building, box, profile);
  ctx.restore();
}

function buildingRenderBox(building) {
  const s = toScreen(building.x, building.y);
  const sourceW = building.w * TILE;
  const sourceH = building.h * TILE;
  const w = clamp(sourceW - 4, 96, 154);
  const h = clamp(sourceH - 2, 82, 122);
  return {
    x: Math.round(s.x + (sourceW - w) / 2),
    y: Math.round(s.y + sourceH - h),
    w: Math.round(w),
    h: Math.round(h),
    sourceW,
    sourceH,
  };
}

function drawBuildingSite(building, box, profile) {
  if (profile.id === 'source-foundation') return;
  const p = profile.palette;
  const { x, y, w, h } = box;
  const baseY = y + h;
  ctx.save();
  switch (profile.id) {
    case 'hearth': {
      ctx.fillStyle = p.stone;
      for (let i = 0; i < 4; i += 1) ctx.fillRect(x + Math.round(w * 0.61) + (i % 2) * 3, baseY - 2 + i * 7, 18, 5);
      ctx.fillStyle = p.foliage;
      ctx.fillRect(x + 9, baseY - 8, 31, 6);
      ctx.fillRect(x + w - 39, baseY - 8, 31, 6);
      ctx.fillStyle = p.accent;
      for (let i = 0; i < 6; i += 1) ctx.fillRect(x + 13 + (i % 3) * 9 + (i > 2 ? w - 49 : 0), baseY - 12 + (i % 2) * 3, 3, 3);
      break;
    }
    case 'granary': {
      ctx.fillStyle = '#b28d5d';
      ctx.fillRect(x + 3, baseY - 7, w + 18, 11);
      ctx.fillStyle = '#dcc083';
      for (let i = 0; i < 7; i += 1) ctx.fillRect(x + 8 + i * 18, baseY - 5, 11, 3);
      ctx.fillStyle = p.trim;
      ctx.fillRect(x - 7, baseY - 22, 5, 24);
      ctx.fillRect(x - 8, baseY - 19, 27, 4);
      ctx.fillStyle = '#d7aa4f';
      ctx.fillRect(x + w - 2, baseY - 20, 19, 16);
      ctx.fillStyle = '#f0ca6c';
      ctx.fillRect(x + w + 1, baseY - 17, 13, 4);
      break;
    }
    case 'sorting': {
      ctx.fillStyle = '#8f744f';
      ctx.fillRect(x + 3, baseY - 5, w + 17, 9);
      ctx.fillStyle = p.trim;
      for (let i = 0; i < 6; i += 1) ctx.fillRect(x + 9 + i * 20, baseY - 3, 12, 3);
      ctx.fillStyle = '#5d4c3c';
      ctx.fillRect(x + w + 2, baseY - 26, 19, 5);
      ctx.fillRect(x + w + 16, baseY - 26, 5, 26);
      break;
    }
    case 'workshop': {
      ctx.fillStyle = p.stone;
      ctx.fillRect(x - 2, baseY - 8, w + 22, 12);
      ctx.fillStyle = p.metal;
      for (let i = 0; i < 5; i += 1) ctx.fillRect(x + 10 + i * 24, baseY - 5, 11, 3);
      ctx.fillStyle = p.roofDark;
      ctx.fillRect(x + w + 3, baseY - 17, 19, 4);
      ctx.fillRect(x + w + 7, baseY - 25, 4, 25);
      break;
    }
    case 'library': {
      ctx.fillStyle = p.stone;
      for (let i = 0; i < 5; i += 1) ctx.fillRect(x + w - 36 + (i % 2) * 4, baseY - 3 + i * 6, 18, 4);
      ctx.fillStyle = p.metal;
      ctx.fillRect(x - 3, baseY - 13, 24, 4);
      ctx.fillRect(x, baseY - 23, 4, 14);
      ctx.fillRect(x + 17, baseY - 23, 4, 14);
      break;
    }
    case 'hall': {
      ctx.fillStyle = p.stone;
      ctx.fillRect(x - 7, baseY - 7, w + 14, 11);
      ctx.fillStyle = 'rgba(255,245,205,0.18)';
      for (let i = 0; i < 8; i += 1) ctx.fillRect(x - 3 + i * 20, baseY - 5, 13, 3);
      ctx.fillStyle = p.metal;
      ctx.fillRect(x - 3, baseY - 27, 4, 25);
      ctx.fillRect(x + w - 1, baseY - 27, 4, 25);
      ctx.fillStyle = p.window;
      ctx.fillRect(x - 5, baseY - 31, 8, 8);
      ctx.fillRect(x + w - 3, baseY - 31, 8, 8);
      break;
    }
    case 'mill': {
      ctx.fillStyle = '#4c8e8b';
      ctx.fillRect(x + w - 32, baseY - 12, 54, 14);
      ctx.fillStyle = '#7bc1b8';
      ctx.fillRect(x + w - 28, baseY - 8, 46, 4);
      ctx.fillStyle = p.wallDark;
      ctx.fillRect(x + w - 34, baseY - 18, 38, 5);
      ctx.fillRect(x + w, baseY - 18, 5, 19);
      break;
    }
    case 'tool-shed': {
      ctx.fillStyle = '#b99461';
      for (let i = 0; i < 14; i += 1) ctx.fillRect(x + 7 + ((i * 17) % Math.max(20, w - 12)), baseY - 4 + (i % 3) * 3, 4, 2);
      ctx.fillStyle = p.wallDark;
      for (let i = 0; i < 4; i += 1) ctx.fillRect(x + w - 5 + i * 4, baseY - 13 - i * 3, 22, 4);
      break;
    }
    case 'orchard': {
      ctx.fillStyle = '#6f8c4d';
      for (let row = 0; row < 3; row += 1) ctx.fillRect(x + 4, y + 17 + row * 34, w - 8, 3);
      ctx.fillStyle = '#8c6d43';
      ctx.fillRect(x - 4, baseY - 5, w + 8, 5);
      break;
    }
    case 'shrine': {
      ctx.fillStyle = p.stone;
      for (let i = 0; i < 4; i += 1) ctx.fillRect(x + Math.round(w / 2) - 8 + (i % 2) * 4, baseY - 3 + i * 7, 16, 5);
      ctx.fillStyle = p.foliage;
      ctx.fillRect(x + 5, baseY - 8, 25, 5);
      ctx.fillRect(x + w - 30, baseY - 8, 25, 5);
      break;
    }
    default: {
      ctx.fillStyle = p.stone;
      ctx.fillRect(x + Math.round(w / 2), baseY - 3, 20, 6);
    }
  }
  ctx.restore();
}

function drawContactShadow(box, inset = 3, lift = 0) {
  const { x, y, w, h } = box;
  ctx.fillStyle = 'rgba(43, 47, 31, 0.22)';
  ctx.fillRect(x + inset + 6, y + h - 5 + lift, w - inset * 2, 8);
  ctx.fillStyle = 'rgba(43, 47, 31, 0.13)';
  ctx.fillRect(x + inset + 12, y + h + 3 + lift, w - inset * 2 - 12, 4);
}

function drawMasonryTexture(x, y, w, h, palette, seed = 0) {
  ctx.fillStyle = palette.stone;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255, 242, 196, 0.16)';
  for (let row = 0; row < h; row += 8) {
    const offset = ((row / 8 + seed) % 2) * 7;
    for (let col = -offset; col < w; col += 15) ctx.fillRect(x + col, y + row, 11, 2);
  }
  ctx.fillStyle = 'rgba(50, 43, 39, 0.18)';
  for (let row = 6; row < h; row += 8) ctx.fillRect(x, y + row, w, 1);
}

function drawTimberFrame(x, y, w, h, palette) {
  ctx.fillStyle = palette.wallDark;
  ctx.fillRect(x, y, w, 4);
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.fillRect(x, y, 4, h);
  ctx.fillRect(x + w - 4, y, 4, h);
  ctx.fillRect(x + Math.round(w / 2) - 2, y, 4, h);
  ctx.strokeStyle = palette.wallDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 5);
  ctx.lineTo(x + Math.round(w / 2) - 3, y + h - 5);
  ctx.moveTo(x + w - 5, y + 5);
  ctx.lineTo(x + Math.round(w / 2) + 3, y + h - 5);
  ctx.stroke();
}

function drawPixelRoofTexture(x, y, w, h, palette, stagger = 0) {
  ctx.fillStyle = palette.roof;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = palette.roofLight;
  ctx.fillRect(x + 3, y + 3, Math.max(4, w - 6), 3);
  ctx.fillStyle = palette.roofDark;
  ctx.fillRect(x, y + h - 4, w, 4);
  for (let row = 10; row < h - 4; row += 7) {
    const shift = ((row / 7 + stagger) % 2) * 6;
    ctx.fillStyle = 'rgba(255,255,220,0.10)';
    for (let col = 4 - shift; col < w - 4; col += 13) ctx.fillRect(x + col, y + row, 9, 2);
  }
}

function drawSteppedGableRoof(cx, top, width, height, palette, stagger = 0) {
  const rows = Math.max(4, Math.floor(height / 4));
  for (let row = 0; row < rows; row += 1) {
    const half = Math.max(5, Math.round((((row + 1) / rows) * width) / 8) * 4);
    const ry = top + row * 4;
    ctx.fillStyle = row === rows - 1 ? palette.roofDark : palette.roof;
    ctx.fillRect(Math.round(cx - half), ry, half * 2, 5);
    if ((row + stagger) % 2 === 0 && row > 0) {
      ctx.fillStyle = palette.roofLight;
      ctx.fillRect(Math.round(cx - half + 5), ry, Math.max(3, half * 2 - 10), 2);
    }
  }
}

function drawWindow(x, y, w, h, profile, lit = true, mullion = true) {
  const p = profile.palette;
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = lit ? p.window : '#8ca8a3';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,226,0.36)';
  ctx.fillRect(x + 2, y + 2, Math.max(2, w - 4), 3);
  if (mullion) {
    ctx.fillStyle = p.wallDark;
    ctx.fillRect(x + Math.floor(w / 2) - 1, y, 2, h);
    ctx.fillRect(x, y + Math.floor(h / 2), w, 2);
  }
}

function drawDoor(x, y, w, h, profile, doubleDoor = false) {
  const p = profile.palette;
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x - 3, y - 4, w + 6, h + 4);
  ctx.fillStyle = p.door;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,220,0.12)';
  ctx.fillRect(x + 3, y + 3, Math.max(3, w - 6), 3);
  if (doubleDoor) {
    ctx.fillStyle = p.trim;
    ctx.fillRect(x + Math.floor(w / 2) - 1, y, 2, h);
  }
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + w - 5, y + Math.floor(h / 2), 3, 3);
}

function drawSmokePuffs(x, y, profile, seed = 0) {
  const t = reducedMotion ? 0 : state.tick * 0.09;
  for (let i = 0; i < 4; i += 1) {
    const rise = (t + i * 9 + seed) % 34;
    const drift = Math.round(Math.sin((t + i * 5) / 8) * 4);
    ctx.globalAlpha = 0.28 - i * 0.035;
    ctx.fillStyle = i % 2 ? '#eee2c3' : '#d4d2bd';
    const size = 5 + i * 2;
    ctx.fillRect(x + drift - Math.floor(size / 2), y - rise - size, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawHearthHouse(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 9, y + 10, 18, 66, profile.palette, 1);
  ctx.fillStyle = p.stone;
  ctx.fillRect(x + 7, y + 7, 22, 7);
  drawSmokePuffs(x + 18, y + 7, profile, 3);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 18, y + 42, w - 27, h - 42);
  ctx.fillStyle = p.wallLight;
  ctx.fillRect(x + 22, y + 47, w - 35, 5);
  drawTimberFrame(x + 18, y + 42, w - 27, h - 42, profile.palette);
  drawPixelRoofTexture(x + 8, y + 31, w - 12, 18, profile.palette, 1);
  drawSteppedGableRoof(x + Math.round(w * 0.62), y + 3, 78, 42, profile.palette, 1);
  ctx.fillStyle = p.wallLight;
  ctx.fillRect(x + Math.round(w * 0.62) - 27, y + 33, 54, 18);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + Math.round(w * 0.62) - 3, y + 34, 6, 15);
  drawWindow(x + 31, y + 59, 17, 19, profile, true);
  drawWindow(x + w - 40, y + 55, 18, 22, profile, true);
  drawDoor(x + Math.round(w * 0.57), y + h - 38, 21, 38, profile);
  ctx.fillStyle = p.stone;
  ctx.fillRect(x + 37, y + h - 12, w - 48, 8);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + 38, y + h - 27, 4, 21);
  ctx.fillRect(x + w - 20, y + h - 27, 4, 21);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x + 35, y + h - 29, w - 50, 5);
  ctx.fillStyle = p.foliage;
  ctx.fillRect(x + 22, y + h - 9, 23, 6);
  ctx.fillRect(x + w - 44, y + h - 9, 22, 6);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + 27, y + h - 13, 4, 4);
  ctx.fillRect(x + 36, y + h - 12, 4, 4);
  ctx.fillRect(x + w - 36, y + h - 13, 4, 4);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + Math.round(w * 0.62) - 4, y + 40, 8, 8);
  ctx.fillStyle = '#ffd879';
  ctx.fillRect(x + Math.round(w * 0.62) - 1, y + 37, 3, 8);
}

function drawWorkGranary(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 6, y + h - 24, w - 33, 24, p, 2);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 7, y + 39, w - 35, h - 58);
  ctx.fillStyle = p.wallLight;
  ctx.fillRect(x + 12, y + 45, w - 44, 4);
  drawTimberFrame(x + 7, y + 39, w - 35, h - 58, p);
  drawPixelRoofTexture(x + 4, y + 29, w - 30, 17, p, 0);
  drawPixelRoofTexture(x + 13, y + 17, w - 48, 15, p, 1);
  drawPixelRoofTexture(x + 27, y + 7, w - 74, 13, p, 0);
  const siloX = x + w - 32;
  ctx.fillStyle = p.stone;
  ctx.fillRect(siloX, y + 33, 27, h - 36);
  ctx.fillStyle = p.metal;
  ctx.fillRect(siloX + 4, y + 31, 19, h - 34);
  ctx.fillStyle = p.roofLight;
  ctx.fillRect(siloX + 7, y + 23, 13, 8);
  ctx.fillRect(siloX + 4, y + 27, 19, 5);
  ctx.fillStyle = p.trim;
  for (let sy = y + 43; sy < y + h - 10; sy += 17) ctx.fillRect(siloX + 2, sy, 23, 2);
  drawDoor(x + 31, y + h - 54, 42, 37, profile, true);
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 34, y + h - 51);
  ctx.lineTo(x + 70, y + h - 20);
  ctx.moveTo(x + 70, y + h - 51);
  ctx.lineTo(x + 34, y + h - 20);
  ctx.stroke();
  drawWindow(x + 45, y + 46, 16, 14, profile, true, false);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + 52, y + 3, 4, 15);
  ctx.fillRect(x + 52, y + 3, 17, 4);
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + 66, y + 7, 4, 10);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + 62, y + 17, 12, 5);
}

function drawSortingShed(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 6, y + 40, w - 12, h - 40, p, 1);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 9, y + 44, w - 18, h - 44);
  const bayW = Math.floor((w - 10) / 3);
  for (let i = 0; i < 3; i += 1) {
    drawSteppedGableRoof(x + 5 + bayW * i + Math.floor(bayW / 2), y + 8 + (i % 2) * 3, bayW + 8, 35, p, i);
    drawWindow(x + 17 + bayW * i, y + 43, 18, 14, profile, false, false);
  }
  ctx.fillStyle = p.roofDark;
  ctx.fillRect(x + 4, y + 59, w - 8, 6);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x + 7, y + 65, w - 30, 5);
  ctx.fillStyle = '#8f6a45';
  ctx.fillRect(x + 12, y + 70, w - 45, 7);
  ctx.fillRect(x + 14, y + 77, 5, 25);
  ctx.fillRect(x + w - 38, y + 77, 5, 25);
  drawDoor(x + w - 32, y + h - 39, 21, 39, profile);
  const bins = ['#5e9f96', '#d9a34f', '#b8675d'];
  bins.forEach((color, i) => {
    const bx = x + 13 + i * 26;
    const by = y + h - 21;
    ctx.fillStyle = '#5b4031';
    ctx.fillRect(bx - 2, by - 4, 23, 20);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, 19, 14);
    ctx.fillStyle = '#f1d18c';
    ctx.fillRect(bx + 5, by + 4, 9, 3);
  });
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + w - 18, y + 18, 9, 28);
  ctx.fillStyle = p.roofLight;
  ctx.fillRect(x + w - 21, y + 15, 15, 5);
}

function drawWaterwheelWorkshop(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 5, y + 67, w - 10, h - 67, p, 0);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 7, y + 39, w - 14, 37);
  drawTimberFrame(x + 7, y + 39, w - 14, 37, p);
  drawPixelRoofTexture(x + 1, y + 27, w - 2, 19, p, 1);
  drawPixelRoofTexture(x + 18, y + 15, w - 45, 15, p, 0);
  drawMasonryTexture(x + w - 35, y - 7, 17, 51, p, 2);
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + w - 38, y - 11, 23, 6);
  drawSmokePuffs(x + w - 26, y - 11, profile, 7);
  drawDoor(x + 18, y + h - 40, 24, 40, profile);
  drawWindow(x + 54, y + 49, 22, 19, profile, true);
  const gearX = x + w - 34;
  const gearY = y + 61;
  ctx.strokeStyle = p.metal;
  ctx.lineWidth = 5;
  ctx.strokeRect(gearX - 12, gearY - 12, 24, 24);
  ctx.fillStyle = p.accent;
  ctx.fillRect(gearX - 4, gearY - 4, 8, 8);
  ctx.fillStyle = p.metal;
  ctx.fillRect(gearX - 2, gearY - 17, 4, 34);
  ctx.fillRect(gearX - 17, gearY - 2, 34, 4);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x + 46, y + h - 13, 43, 5);
  ctx.fillStyle = p.metal;
  for (let i = 0; i < 4; i += 1) ctx.fillRect(x + 49 + i * 10, y + h - 22 + (i % 2) * 3, 4, 12);
}

function drawLookoutLibrary(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  const towerX = x + 8;
  ctx.fillStyle = p.wall;
  ctx.fillRect(towerX, y + 30, 48, h - 30);
  drawMasonryTexture(towerX, y + h - 24, 48, 24, p, 1);
  drawSteppedGableRoof(towerX + 24, y - 5, 58, 39, p, 1);
  ctx.fillStyle = p.wallLight;
  ctx.fillRect(towerX + 6, y + 35, 36, 5);
  drawWindow(towerX + 13, y + 45, 22, 27, profile, true);
  ctx.fillStyle = p.wallDark;
  for (let sy = y + 50; sy < y + 70; sy += 6) ctx.fillRect(towerX + 15, sy, 18, 2);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 51, y + 50, w - 57, h - 50);
  drawPixelRoofTexture(x + 47, y + 38, w - 49, 18, p, 0);
  drawTimberFrame(x + 51, y + 50, w - 57, h - 50, p);
  drawWindow(x + 66, y + 62, 23, 22, profile, true);
  drawDoor(x + w - 35, y + h - 37, 20, 37, profile);
  ctx.strokeStyle = p.metal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(towerX + 29, y - 2);
  ctx.lineTo(towerX + 41, y - 13);
  ctx.lineTo(towerX + 53, y - 11);
  ctx.stroke();
  ctx.fillStyle = p.metal;
  ctx.fillRect(towerX + 51, y - 15, 12, 7);
  ctx.fillStyle = p.accent;
  ctx.fillRect(towerX + 22, y + 10, 4, 8);
  ctx.fillRect(towerX + 19, y + 8, 10, 3);
}

function drawStewardsHall(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 5, y + h - 25, w - 10, 25, p, 0);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 7, y + 48, w - 14, h - 48);
  drawTimberFrame(x + 7, y + 48, w - 14, h - 48, p);
  drawPixelRoofTexture(x + 1, y + 35, w - 2, 19, p, 1);
  drawSteppedGableRoof(x + Math.round(w / 2), y + 3, 82, 48, p, 0);
  ctx.fillStyle = p.wallLight;
  ctx.fillRect(x + Math.round(w / 2) - 27, y + 40, 54, 20);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + Math.round(w / 2) - 3, y + 43, 6, 15);
  drawWindow(x + 19, y + 62, 18, 20, profile, true);
  drawWindow(x + w - 37, y + 62, 18, 20, profile, true);
  drawDoor(x + Math.round(w / 2) - 13, y + h - 39, 26, 39, profile, true);
  ctx.fillStyle = p.stone;
  ctx.fillRect(x + Math.round(w / 2) - 23, y + h - 7, 46, 7);
  ctx.fillRect(x + Math.round(w / 2) - 18, y + h - 12, 36, 5);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + 21, y + h - 33, 5, 29);
  ctx.fillRect(x + w - 26, y + h - 33, 5, 29);
  ctx.fillStyle = p.roofDark;
  ctx.fillRect(x + Math.round(w / 2) - 15, y - 13, 30, 16);
  ctx.fillStyle = p.roof;
  ctx.fillRect(x + Math.round(w / 2) - 20, y - 18, 40, 7);
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + Math.round(w / 2) - 5, y - 10, 10, 10);
  ctx.fillStyle = '#ffe092';
  ctx.fillRect(x + Math.round(w / 2) - 2, y - 8, 4, 6);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + Math.round(w / 2) - 6, y + 43, 12, 10);
}

function drawMillStream(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  drawMasonryTexture(x + 7, y + 63, w - 25, h - 63, p, 3);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 8, y + 43, w - 26, 30);
  drawTimberFrame(x + 8, y + 43, w - 26, 30, p);
  drawSteppedGableRoof(x + Math.round((w - 20) / 2), y + 7, w - 8, 40, p, 1);
  drawWindow(x + 22, y + 51, 18, 15, profile, true);
  drawDoor(x + 52, y + h - 38, 22, 38, profile);
  const wheelX = x + w - 18;
  const wheelY = y + 78;
  ctx.strokeStyle = p.roofDark;
  ctx.lineWidth = 5;
  ctx.strokeRect(wheelX - 17, wheelY - 17, 34, 34);
  ctx.fillStyle = p.metal;
  ctx.fillRect(wheelX - 3, wheelY - 3, 6, 6);
  ctx.fillRect(wheelX - 2, wheelY - 21, 4, 42);
  ctx.fillRect(wheelX - 21, wheelY - 2, 42, 4);
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wheelX - 15, wheelY - 15);
  ctx.lineTo(wheelX + 15, wheelY + 15);
  ctx.moveTo(wheelX + 15, wheelY - 15);
  ctx.lineTo(wheelX - 15, wheelY + 15);
  ctx.stroke();
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + w - 32, y + 43, 29, 6);
  ctx.fillRect(x + w - 5, y + 43, 6, 40);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + w - 7, y + 80, 10, 4);
}

function drawToolShed(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 8, y + 48, w - 18, h - 48);
  ctx.fillStyle = p.wallDark;
  for (let px = x + 12; px < x + w - 13; px += 11) ctx.fillRect(px, y + 50, 3, h - 52);
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + 2, y + 35, w - 8, 17);
  ctx.fillStyle = p.roofLight;
  for (let px = x + 7; px < x + w - 10; px += 9) ctx.fillRect(px, y + 38, 4, 10);
  ctx.fillStyle = p.roofDark;
  ctx.fillRect(x + 1, y + 49, w - 6, 5);
  const bayX = x + 16;
  ctx.fillStyle = '#3e3931';
  ctx.fillRect(bayX, y + 59, 48, h - 59);
  ctx.fillStyle = p.trim;
  ctx.fillRect(bayX + 4, y + 63, 40, 4);
  ctx.fillStyle = p.metal;
  ctx.fillRect(bayX + 9, y + 72, 4, 20);
  ctx.fillRect(bayX + 20, y + 71, 15, 4);
  ctx.fillRect(bayX + 26, y + 71, 4, 22);
  ctx.strokeStyle = p.metal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bayX + 38, y + 71);
  ctx.lineTo(bayX + 33, y + 91);
  ctx.stroke();
  drawDoor(x + w - 36, y + h - 37, 20, 37, profile);
  ctx.fillStyle = p.wallDark;
  for (let i = 0; i < 4; i += 1) ctx.fillRect(x + w - 11 + i * 5, y + h - 13 - i * 3, 22, 4);
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + w - 16, y + h - 28, 24, 28);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + w - 10, y + h - 22, 12, 4);
}

function drawProofOrchard(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  const cbr = Number(state.world?.fishbowl?.proof?.cbr_r || 0);
  const mesReal = state.world?.fishbowl?.proof?.mes_r_status === 'REAL';
  const ripe = clamp(Math.round(cbr * 5), 0, 10);
  drawContactShadow(box, 2, 2);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + 8, y + 23, w - 16, 4);
  ctx.fillRect(x + 8, y + 62, w - 16, 4);
  for (let col = 0; col < 4; col += 1) ctx.fillRect(x + 13 + col * 30, y + 17, 4, 72);
  for (let i = 0; i < 6; i += 1) {
    const tx = x + 18 + (i % 3) * 38;
    const ty = y + 20 + Math.floor(i / 3) * 45;
    ctx.fillStyle = '#68472f';
    ctx.fillRect(tx - 3, ty + 17, 7, 25);
    ctx.fillStyle = mesReal ? '#477b45' : p.foliage;
    ctx.fillRect(tx - 14, ty + 3, 29, 19);
    ctx.fillRect(tx - 9, ty - 6, 20, 31);
    ctx.fillStyle = '#78a356';
    ctx.fillRect(tx - 8, ty - 2, 12, 7);
    const fruitCount = clamp(ripe - i, 0, 3);
    ctx.fillStyle = mesReal ? '#dc6356' : '#e1b44f';
    for (let f = 0; f < fruitCount; f += 1) ctx.fillRect(tx - 8 + f * 8, ty + 8 + (f % 2) * 6, 4, 4);
  }
  const hutX = x + w - 45;
  ctx.fillStyle = p.wall;
  ctx.fillRect(hutX, y + h - 35, 37, 35);
  drawSteppedGableRoof(hutX + 18, y + h - 54, 44, 23, p, 1);
  drawDoor(hutX + 13, y + h - 24, 12, 24, profile);
  ctx.fillStyle = '#d6a84f';
  ctx.fillRect(x + 5, y + h - 27, 17, 27);
  ctx.fillStyle = p.roofDark;
  for (let sy = y + h - 22; sy < y + h - 4; sy += 6) ctx.fillRect(x + 8, sy, 11, 2);
  ctx.fillStyle = p.accent;
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x + 28 + i * 17, y + h - 14, 14, 10);
    ctx.fillStyle = p.trim;
    ctx.fillRect(x + 32 + i * 17, y + h - 11, 6, 3);
    ctx.fillStyle = p.accent;
  }
}

function drawOwnerOpsShrine(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box, 10, 1);
  ctx.fillStyle = p.stone;
  for (let i = 0; i < 5; i += 1) ctx.fillRect(x + Math.round(w / 2) - 8 + (i % 2) * 4, y + h - 8 + i * 7, 16, 5);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + 18, y + 43, 7, h - 45);
  ctx.fillRect(x + w - 25, y + 43, 7, h - 45);
  ctx.fillRect(x + 18, y + 45, w - 36, 6);
  drawSteppedGableRoof(x + Math.round(w / 2), y - 5, w - 4, 48, p, 1);
  ctx.fillStyle = p.roofDark;
  ctx.fillRect(x + 2, y + 39, w - 4, 6);
  ctx.fillStyle = '#4a382f';
  ctx.fillRect(x + 31, y + 54, w - 62, h - 61);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x + 35, y + 59, w - 70, 8);
  ctx.fillStyle = '#fff1bf';
  ctx.fillRect(x + 39, y + 70, w - 78, 20);
  ctx.fillStyle = p.wallDark;
  for (let sy = y + 74; sy < y + 87; sy += 5) ctx.fillRect(x + 43, sy, w - 86, 2);
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + Math.round(w / 2) - 2, y + 43, 4, 11);
  ctx.fillRect(x + Math.round(w / 2) - 7, y + 52, 14, 9);
  ctx.fillStyle = '#ffe08a';
  ctx.fillRect(x + Math.round(w / 2) - 3, y + 54, 6, 5);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x + 11, y + 51, 5, 20);
  ctx.fillRect(x + w - 16, y + 51, 5, 20);
  ctx.fillStyle = '#f5e6b2';
  ctx.fillRect(x + 7, y + 68, 11, 3);
  ctx.fillRect(x + w - 18, y + 68, 11, 3);
}

function drawSourceFoundation(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  ctx.fillStyle = 'rgba(60, 54, 42, 0.18)';
  ctx.fillRect(x - 4, y + h - 21, w + 8, 24);
  drawMasonryTexture(x - 2, y + h - 18, w + 4, 16, p, hash(building.id || '') % 3);
  ctx.fillStyle = '#5a4938';
  ctx.fillRect(x + 5, y + h - 22, w - 10, 5);
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.moveTo(x + 9, y + h - 8);
  ctx.lineTo(x + 24, y + h - 15);
  ctx.lineTo(x + Math.round(w / 2), y + h - 11);
  ctx.lineTo(x + w - 24, y + h - 15);
  ctx.lineTo(x + w - 8, y + h - 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.metal;
  ctx.fillRect(x + Math.round(w / 2) - 9, y + h - 18, 18, 12);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + Math.round(w / 2) - 4, y + h - 14, 8, 4);
  ctx.fillStyle = p.wallDark;
  for (let i = 0; i < 4; i += 1) {
    const rx = i < 2 ? x + 4 + i * 9 : x + w - 13 + (i - 2) * 9;
    ctx.fillRect(rx, y + h - 7, 4, 13);
  }
}

function drawCottage(building, box, profile) {
  const p = profile.palette;
  const { x, y, w, h } = box;
  drawContactShadow(box);
  ctx.fillStyle = p.wall;
  ctx.fillRect(x + 11, y + 45, w - 22, h - 45);
  drawTimberFrame(x + 11, y + 45, w - 22, h - 45, p);
  drawSteppedGableRoof(x + Math.round(w / 2) - 9, y + 7, w - 20, 43, p, 1);
  drawWindow(x + 25, y + 58, 18, 18, profile, true);
  drawWindow(x + w - 43, y + 58, 18, 18, profile, true);
  drawDoor(x + Math.round(w / 2) + 12, y + h - 37, 20, 37, profile);
  ctx.fillStyle = p.foliage;
  ctx.fillRect(x + 19, y + h - 9, 28, 6);
  ctx.fillStyle = p.accent;
  ctx.fillRect(x + 25, y + h - 12, 4, 4);
  ctx.fillRect(x + 37, y + h - 11, 4, 4);
}

function drawBuildingSign(building, box, profile) {
  const p = profile.palette;
  const label = getBuildingDisplayLabel(building);
  ctx.font = '900 9px "Segoe UI", sans-serif';
  const measured = Math.ceil(ctx.measureText(label).width);
  const signW = clamp(measured + 14, 52, box.w - 12);
  const signX = box.x + 6;
  const signY = box.y + box.h - 17;
  ctx.fillStyle = 'rgba(54, 41, 32, 0.88)';
  ctx.fillRect(signX, signY, signW, 14);
  ctx.fillStyle = p.trim;
  ctx.fillRect(signX + 2, signY + 2, signW - 4, 2);
  ctx.fillStyle = '#fff5d2';
  ctx.fillText(label, signX + 6, signY + 11, signW - 10);
}

function drawBuildingProofBeacon(building, box, profile) {
  const visual = getBuildingVisualState(building);
  const x = box.x + box.w - 13;
  const y = box.y + box.h - 27;
  const pulse = reducedMotion ? 0 : Math.round((Math.sin(state.tick / 15 + hash(building.id || '') % 7) + 1) * 1.5);
  ctx.fillStyle = profile.palette.metal;
  ctx.fillRect(x - 5, y - 6, 10, 13);
  ctx.fillStyle = visual.beacon;
  ctx.fillRect(x - 3, y - 4, 6, 7);
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = visual.beacon;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 6 - pulse, y - 7 - pulse, 12 + pulse * 2, 14 + pulse * 2);
  ctx.globalAlpha = 1;
}

function drawBuildingSelection(building, box, profile) {
  if (state.selected?.id !== building.id) return;
  const color = '#fff2a8';
  const x = box.x - 4;
  const y = box.y - 7;
  const w = box.w + 8;
  const h = box.h + 13;
  const corner = 13;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, corner, 3);
  ctx.fillRect(x, y, 3, corner);
  ctx.fillRect(x + w - corner, y, corner, 3);
  ctx.fillRect(x + w - 3, y, 3, corner);
  ctx.fillRect(x, y + h - 3, corner, 3);
  ctx.fillRect(x, y + h - corner, 3, corner);
  ctx.fillRect(x + w - corner, y + h - 3, corner, 3);
  ctx.fillRect(x + w - 3, y + h - corner, 3, corner);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = profile.palette.accent;
  ctx.fillRect(box.x + 7, box.y + box.h + 3, box.w - 14, 4);
  ctx.globalAlpha = 1;
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
