// Agent Terrarium reusable game engine core.
// Pure browser/Node module: no DOM, no network, no AI-OS mutation.
// The canvas runtime renders this state; this module owns world normalization,
// player/camera physics, hit testing, provenance enforcement, and render scenes.

export const TILE = 32;

const DEFAULT_POSITIONS = [
  [5, 7], [16, 5], [28, 7], [24, 19], [12, 20], [33, 23], [7, 22], [34, 12],
  [19, 22], [6, 15], [14, 9], [22, 8], [30, 21], [10, 26], [36, 17],
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function joystickMagnitudeForDistance(distance, deadZone = 12, maxReach = 58) {
  const safeDeadZone = Math.max(0, finiteNumber(deadZone, 12));
  const safeMaxReach = Math.max(safeDeadZone + 1, finiteNumber(maxReach, 58));
  const linear = clamp((finiteNumber(distance, 0) - safeDeadZone) / (safeMaxReach - safeDeadZone), 0, 1);
  return linear * linear * (3 - 2 * linear);
}

function placeByIndex(index, width, height) {
  const pair = DEFAULT_POSITIONS[index % DEFAULT_POSITIONS.length];
  return {
    x: clamp(pair[0], 1, Math.max(1, width - 4)),
    y: clamp(pair[1], 1, Math.max(1, height - 4)),
  };
}

function normalizeMode(mode, raw) {
  if (mode) return String(mode);
  const sourceMode = String(raw?.meta?.source_mode || raw?.meta?.sourceMode || '').toLowerCase();
  return sourceMode.includes('fixture') ? 'fixture' : 'live';
}

function normalizeLoopArchitecture(raw) {
  const viewport = raw?.viewport || {};
  const arch = viewport.loop_architecture || viewport.loopArchitecture || {};
  const eventBus = viewport.event_bus || viewport.eventBus || {};
  const meta = raw?.meta || {};
  const activeLoops = Array.isArray(viewport.active_loops)
    ? viewport.active_loops
    : Array.isArray(viewport.activeLoops)
      ? viewport.activeLoops
      : [];
  const routedLoops = Array.isArray(viewport.routed_loops)
    ? viewport.routed_loops
    : Array.isArray(viewport.routedLoops)
      ? viewport.routedLoops
      : [];
  return {
    name: String(arch.name || 'event-driven loops'),
    fabric: String(arch.fabric || 'multi-loop event fabric'),
    currentEventId: String(arch.current_event_id || arch.currentEventId || eventBus.current_event_id || eventBus.currentEventId || meta.event_id || meta.eventId || 'event pending'),
    currentEventType: String(arch.current_event_type || arch.currentEventType || eventBus.current_event_type || eventBus.currentEventType || meta.event_type || meta.eventType || 'event_type pending'),
    contract: String(arch.contract || 'problem-path-specific loops over one shared event bus with per-loop receipt trails and downstream event suggestions'),
    invalidDriverShape: String(arch.invalid_driver_shape || arch.invalidDriverShape || 'slow scheduled work loop or timer-driven worker as the Terrarium work engine'),
    activeLoops: [...new Set(activeLoops.map(String).filter(Boolean))],
    routedLoops: [...new Set(routedLoops.map(String).filter(Boolean))],
  };
}

function moodFromState(state, proofStatus = '') {
  const text = `${state || ''} ${proofStatus || ''}`.toLowerCase();
  if (text.includes('fail') || text.includes('missing') || text.includes('blocked')) return 'red';
  if (text.includes('lock') || text.includes('gate')) return 'gold';
  if (text.includes('wait') || text.includes('pending') || text.includes('listen')) return 'blue';
  if (text.includes('active') || text.includes('pass') || text.includes('exists') || text.includes('source')) return 'green';
  return 'blue';
}

function visibleKind(visibleAs) {
  switch (visibleAs) {
    case 'agent_sprite': return 'agent_sprite';
    case 'locked_door': return 'locked_door';
    case 'receipt_light': return 'receipt_light';
    case 'resource_light': return 'resource_light';
    case 'fog_alarm': return 'fog_alarm';
    case 'source_root': return 'source_root';
    case 'quest': return 'quest';
    case 'owner_guide': return 'owner_guide';
    default: return 'building';
  }
}

function buildingKind(visibleAs) {
  switch (visibleAs) {
    case 'locked_door': return 'gate';
    case 'receipt_light': return 'proof';
    case 'resource_light': return 'north_star';
    case 'fog_alarm': return 'proof_gap';
    case 'source_root': return 'source_root';
    case 'quest': return 'quest';
    case 'owner_guide': return 'owner_ops';
    default: return 'viewport';
  }
}

function proofFrom(source, raw, mode) {
  const p = source?.proof || source || {};
  const sourcePath = p.source_path || p.sourcePath || p.path || source?.source_path || source?.sourcePath || source?.path || raw?.meta?.source_path || '';
  const timestamp = p.timestamp || p.mtime_iso || p.mtimeIso || p.created_at || p.createdAt || source?.timestamp || source?.mtime_iso || raw?.meta?.created_at || '';
  const proofStatus = p.status || p.proof_status || p.proofStatus || source?.proof_status || source?.proofStatus || (sourcePath && timestamp ? 'source_linked' : 'missing_provenance');
  const eventId = p.event_id || p.eventId || source?.event_id || source?.eventId || raw?.meta?.event_id || raw?.viewport?.event_bus?.current_event_id || 'event pending';
  const sha256 = p.sha256 || p.hash || source?.sha256 || source?.hash || 'sha256 pending';
  const hashScope = p.hash_scope || p.hashScope || source?.hash_scope || source?.hashScope || 'source_content_sha256';
  return {
    sourcePath: sourcePath || 'source path pending',
    timestamp: timestamp || 'timestamp pending',
    proofStatus,
    eventId,
    sha256,
    hashScope,
    legacy: {
      source_path: sourcePath || 'source path pending',
      timestamp: timestamp || 'timestamp pending',
      status: proofStatus,
      event_id: eventId,
      sha256,
      hash_scope: hashScope,
    },
  };
}

function activityFor({ mode, visibleAs, state, proofStatus, sourcePath, timestamp }) {
  const text = `${state || ''} ${proofStatus || ''}`.toLowerCase();
  const hasProvenance = Boolean(sourcePath && timestamp && !String(sourcePath).includes('pending') && !String(timestamp).includes('pending'));
  if (!hasProvenance) return { activity: 'no_activity', activityScale: 0 };
  if (mode !== 'live') return { activity: 'fixture_limited', activityScale: 0.2 };
  if (visibleAs === 'locked_door' || text.includes('lock') || text.includes('gate')) return { activity: 'locked', activityScale: 0.1 };
  if (text.includes('fail') || text.includes('missing') || text.includes('fog')) return { activity: 'proof_gap', activityScale: 0.15 };
  if (text.includes('pending') || text.includes('waiting') || text.includes('listen')) return { activity: 'listening', activityScale: 0.35 };
  if (text.includes('active') || text.includes('exists') || text.includes('source') || text.includes('pass')) return { activity: 'source_backed', activityScale: 1 };
  return { activity: 'source_backed', activityScale: 0.55 };
}

function verbsFor(entity) {
  const verbs = ['inspect', 'proofTrail', 'emitNextEvent'];
  if (entity.sourcePath && !String(entity.sourcePath).includes('pending')) verbs.push('openSource');
  if (entity.visible_as === 'agent_sprite') verbs.push('follow');
  if (entity.visible_as === 'locked_door') verbs.push('approvalBlocked');
  if (entity.visible_as === 'receipt_light') verbs.push('readReceipt');
  if (entity.visible_as === 'fog_alarm') verbs.push('explainBlocker');
  if (entity.visible_as === 'owner_guide') verbs.push('openOwnerGuide');
  return [...new Set(verbs)];
}

export function defaultOwnerGuideObject() {
  return {
    entity_id: 'owner-ops-shrine',
    title: 'Terrarium Keeper',
    visible_as: 'owner_guide',
    source_path: 'Repos/Agent-Terrarium-Prototype/public/owner_guide.json',
    timestamp: '2026-07-08T23:40:00Z',
    proof_status: 'owner_guide_encounter_v1',
    state: 'source_backed',
    next_event: 'owner_guide_opened',
    x: 8,
    y: 14,
    w: 5,
    h: 4,
    body: 'Meet the Keeper for a short field lesson, then return to the world with one clear quest.',
    owner_guide: {
      say: [
        'Plain intent: what you want done or decided — not command lists.',
        'Hard gates only: one short APPROVE line when spend/send/deploy/delete/public tunnel is real.',
        'Corrections: still not a game / I have no link / this still feels like a dashboard.',
        'Outcomes language: open the link, show proof, what needs me?',
      ],
      ignore: [
        'Process IDs, loop heartbeats, and silent cron noise.',
        'Green technical PASS without a phone-openable artifact or screenshot.',
        'Raw vault paths as the primary handoff when you are on phone.',
        'Asking you to run scripts the agent can run itself.',
      ],
      approve: [
        'Credentials / API keys / auth login.',
        'Spend, live trades, paid generation beyond agreed caps.',
        'External send, publish, deploy, push/merge, public tunnels.',
        'Deletes and permanent theme/canon changes.',
        'Curated vault writes outside Inbox / Logs / Social Archives.',
      ],
      outcomes: [
        'Quest banner + game message = current objective and last consequence.',
        'Proof meter rises when you gather receipt lights (not when a model claims PASS).',
        'Follow agent mirrors a real worker; Gate check never auto-unlocks hard gates.',
        'Owner Cockpit: Start here → Now → Timeline → Proof → Gates.',
        'If autonomy is blind: demand the cockpit link before more loop work.',
      ],
      first_30_seconds: [
        'Move with pad/WASD through the working room.',
        'Meet the Terrarium Keeper at the guidepost, or press G from anywhere.',
        'Follow an agent, gather one proof light, gate-check a locked door.',
        'Only approve if a real hard gate appears with a copyable APPROVE line.',
      ],
    },
  };
}

function normalizeViewportEntity(obj, index, raw, mode, width, height) {
  const visibleAs = obj.visible_as || obj.visibleAs || obj.kind || 'building';
  const kind = visibleKind(visibleAs);
  const fallback = placeByIndex(index, width, height);
  const proof = proofFrom(obj, raw, mode);
  const state = obj.state || obj.status || proof.proofStatus;
  const activity = activityFor({
    mode,
    visibleAs,
    state,
    proofStatus: proof.proofStatus,
    sourcePath: proof.sourcePath,
    timestamp: proof.timestamp,
  });
  const guide = obj.owner_guide || obj.ownerGuide || null;
  const entity = {
    id: obj.entity_id || obj.entityId || obj.id || `viewport-${index}`,
    title: obj.title || obj.entity_id || obj.entityId || obj.id || `Viewport ${index + 1}`,
    visible_as: visibleAs,
    visibleAs,
    kind: buildingKind(visibleAs),
    engineKind: kind,
    role: obj.role || obj.entity_id || obj.id || kind,
    state,
    mood: obj.mood || (visibleAs === 'owner_guide' ? 'gold' : moodFromState(state, proof.proofStatus)),
    x: finiteNumber(obj.x, fallback.x),
    y: finiteNumber(obj.y, fallback.y),
    w: finiteNumber(obj.w || obj.width, visibleAs === 'source_root' ? 6 : visibleAs === 'owner_guide' ? 5 : 5),
    h: finiteNumber(obj.h || obj.height, visibleAs === 'locked_door' ? 5 : 4),
    body: obj.body || obj.summary || `Compiled from ${proof.sourcePath}.`,
    proof: proof.legacy,
    sourcePath: proof.sourcePath,
    timestamp: proof.timestamp,
    proofStatus: proof.proofStatus,
    eventId: proof.eventId,
    sha256: proof.sha256,
    hashScope: proof.hashScope,
    nextEvent: obj.next_event || obj.nextEvent || 'optimal_action_requested',
    next_event: obj.next_event || obj.nextEvent || 'optimal_action_requested',
    amount: finiteNumber(obj.amount || obj.value, visibleAs === 'resource_light' ? 1 : visibleAs === 'receipt_light' ? 1 : 0),
    locked: visibleAs === 'locked_door' || String(state).toLowerCase().includes('locked'),
    collected: Boolean(obj.collected),
    cleared: Boolean(obj.cleared),
    gateChecked: Boolean(obj.gateChecked || obj.gate_checked),
    ownerGuide: guide,
    activity: activity.activity,
    activityScale: activity.activityScale,
    wobble: (hash(obj.entity_id || obj.entityId || obj.id || index) % 100) / 100,
    renderX: finiteNumber(obj.x, fallback.x),
    renderY: finiteNumber(obj.y, fallback.y),
  };
  entity.verbs = verbsFor(entity);
  entity.sprite = spriteFor(entity);
  return entity;
}

function normalizeLegacyEntity(item, index, visibleAs, raw, mode, width, height) {
  return normalizeViewportEntity(
    {
      ...item,
      visible_as: visibleAs,
      entity_id: item.id || `${visibleAs}-${index}`,
      source_path: item.proof?.source_path || item.path,
      timestamp: item.proof?.timestamp || item.timestamp,
      proof_status: item.proof?.status || item.status,
      next_event: item.next_event || item.nextEvent,
    },
    index,
    raw,
    mode,
    width,
    height,
  );
}

function spriteFor(entity) {
  const palette = {
    green: '#69f2a8',
    blue: '#6eb7ff',
    red: '#ff697c',
    gold: '#ffd76b',
    violet: '#c392ff',
  };
  return {
    shape: entity.visible_as,
    palette: palette[entity.mood] || palette.blue,
    pixelated: true,
    animation: entity.activity,
    activityScale: entity.activityScale,
  };
}

function sortEntities(entities) {
  return [...entities].sort((a, b) => (a.y - b.y) || String(a.id).localeCompare(String(b.id)));
}

export function normalizeWorldForEngine(rawWorld, options = {}) {
  const raw = rawWorld || {};
  const mode = normalizeMode(options.mode, raw);
  const tilemap = raw.tilemap || {};
  const width = finiteNumber(tilemap.width || raw.width, 42);
  const height = finiteNumber(tilemap.height || raw.height, 30);
  const tileSize = finiteNumber(tilemap.tile_size || tilemap.tileSize, TILE);
  const viewportObjects = raw.viewport && Array.isArray(raw.viewport.objects) ? raw.viewport.objects : [];
  let entities = viewportObjects.map((obj, index) => normalizeViewportEntity(obj, index, raw, mode, width, height));

  if (!entities.length) {
    const legacy = [];
    (Array.isArray(raw.organs) ? raw.organs : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'building', raw, mode, width, height)));
    (Array.isArray(raw.agents) ? raw.agents : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'agent_sprite', raw, mode, width, height)));
    (Array.isArray(raw.gates) ? raw.gates : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'locked_door', raw, mode, width, height)));
    (Array.isArray(raw.resources) ? raw.resources : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'resource_light', raw, mode, width, height)));
    (Array.isArray(raw.fog) ? raw.fog : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'fog_alarm', raw, mode, width, height)));
    (Array.isArray(raw.receipts) ? raw.receipts : []).forEach((item, index) => legacy.push(normalizeLegacyEntity(item, index, 'receipt_light', raw, mode, width, height)));
    entities = legacy;
  }

  // Diegetic Keeper guidepost: always present so campaign literacy lives in play.
  if (!entities.some((entity) => entity.visible_as === 'owner_guide')) {
    const guideRaw = raw.owner_guide || raw.ownerGuide || defaultOwnerGuideObject();
    entities.push(
      normalizeViewportEntity(
        { ...defaultOwnerGuideObject(), ...guideRaw, visible_as: 'owner_guide' },
        entities.length,
        raw,
        mode,
        width,
        height,
      ),
    );
  }

  const agents = entities.filter((entity) => entity.visible_as === 'agent_sprite');
  const gates = entities.filter((entity) => entity.visible_as === 'locked_door');
  const resources = entities.filter((entity) => entity.visible_as === 'resource_light');
  const fog = entities.filter((entity) => entity.visible_as === 'fog_alarm');
  const receipts = entities.filter((entity) => entity.visible_as === 'receipt_light');
  const buildings = entities.filter((entity) => !['agent_sprite', 'resource_light', 'fog_alarm', 'quest', 'locked_door', 'receipt_light'].includes(entity.visible_as));
  const fishbowl = raw.fishbowl && typeof raw.fishbowl === 'object'
    ? deepClone(raw.fishbowl)
    : {
        schema: 'agent_terrarium_fishbowl.v1',
        health: { ok: false, label: 'Snapshot unavailable', tone: 'watch' },
        work: { status: 'OFFLINE_FIXTURE', label: 'Local fixture only' },
        queue: { queued: 0, claimed: 0, receipted: 0, pressure: 'UNKNOWN' },
        owner: { needed: false, label: 'Nothing needs you', gate_count: gates.length },
        proof: { cbr_r: null, mes_r_status: 'UNKNOWN', tqs_r_status: 'UNKNOWN', token_value: null },
        freshness: { latest_at: raw.meta?.created_at || 'timestamp pending', label: 'Fixture snapshot' },
      };

  return {
    meta: raw.meta || {},
    viewport: raw.viewport || {},
    viewportObjects: entities,
    entities: sortEntities(entities),
    tilemap: {
      width,
      height,
      tileSize,
      tile_size: tileSize,
      biome: tilemap.biome || 'terrarium',
      weather: tilemap.weather || 'still',
    },
    buildings,
    agents,
    gates,
    resources,
    fog,
    quests: Array.isArray(raw.quests) ? raw.quests : entities.filter((entity) => entity.visible_as === 'quest'),
    receipts,
    fishbowl,
    sourceLedger: raw.source_ledger || raw.sourceLedger || null,
    loopArchitecture: normalizeLoopArchitecture(raw),
  };
}

function bootEvent(raw, world) {
  const eventId = raw?.meta?.event_id || raw?.viewport?.event_bus?.current_event_id || 'manual-local-engine';
  return {
    id: `engine_boot_${eventId}`,
    type: 'engine_boot',
    source: 'terrarium-engine',
    eventId,
    createdAt: raw?.meta?.created_at || raw?.meta?.createdAt || 'source_timestamp_derived',
    payload: {
      entities: world.entities.length,
      sourceMode: raw?.meta?.source_mode || raw?.meta?.sourceMode || 'unknown',
      viewportDefinition: world.viewport?.definition || 'unknown',
      loopArchitecture: deepClone(world.loopArchitecture),
    },
  };
}

function entityById(world, id) {
  return world.entities.find((entity) => entity.id === id) || null;
}

function chooseDefaultSelectedId(world) {
  for (const preferredId of ['aios-service-status', 'agent-terrarium', 'workflow-queue']) {
    const preferred = entityById(world, preferredId);
    if (preferred) return preferred.id;
  }
  const activeLoops = Array.isArray(world.viewport?.active_loops)
    ? world.viewport.active_loops.map(String)
    : [];
  for (const loopId of activeLoops) {
    const entity = entityById(world, loopId);
    if (entity) return entity.id;
  }
  const activeAgent = world.agents.find((entity) => {
    const text = `${entity.state || ''} ${entity.activity || ''}`.toLowerCase();
    return text.includes('active') || text.includes('source_backed') || text.includes('following');
  });
  if (activeAgent) return activeAgent.id;
  return world.entities[0]?.id || null;
}

function createInitialPlayer(world, selectedId) {
  const selected = (selectedId && entityById(world, selectedId)) || world.entities[0] || null;
  const center = selected ? entityCenter(selected) : { x: 8.5, y: 12.5 };
  const approachY = selected
    ? (finiteNumber(selected.y, center.y) + Math.max(1, finiteNumber(selected.h, 1)) + 0.75)
    : center.y;
  const worldW = world.tilemap.width * TILE;
  const worldH = world.tilemap.height * TILE;
  return {
    x: clamp(center.x * TILE, 16, Math.max(16, worldW - 16)),
    y: clamp(approachY * TILE, 16, Math.max(16, worldH - 16)),
    speed: 120,
    facing: 'up',
  };
}

function idList(value) {
  if (!value) return [];
  if (value instanceof Set) return [...value].map(String);
  if (Array.isArray(value)) return [...new Set(value.map(String))];
  return [];
}

function hasId(list, id) {
  return idList(list).includes(String(id));
}

function addId(list, id) {
  const out = idList(list);
  if (id && !out.includes(String(id))) out.push(String(id));
  return out;
}

function entityCenter(entity) {
  if (['agent_sprite', 'resource_light', 'receipt_light'].includes(entity.visible_as)) {
    return {
      x: finiteNumber(entity.renderX ?? entity.x, 0),
      y: finiteNumber(entity.renderY ?? entity.y, 0),
    };
  }
  return {
    x: finiteNumber(entity.renderX ?? entity.x, 0) + finiteNumber(entity.w, 0) / 2,
    y: finiteNumber(entity.renderY ?? entity.y, 0) + finiteNumber(entity.h, 0) / 2,
  };
}

function distanceTilesToPlayer(engine, entity) {
  const center = entityCenter(entity);
  return Math.hypot(center.x * TILE - engine.player.x, center.y * TILE - engine.player.y) / TILE;
}

function nearestEntityForAction(engine, filter, radiusTiles = 2.8) {
  const candidates = engine.world.entities.filter(filter);
  if (!candidates.length) return null;
  const ranked = candidates
    .map((entity) => ({ entity, dist: distanceTilesToPlayer(engine, entity) }))
    .filter((item) => item.dist <= radiusTiles)
    .sort((a, b) => a.dist - b.dist || String(a.entity.id).localeCompare(String(b.entity.id)));
  return ranked[0]?.entity || null;
}

function baseQuestLog(world, game) {
  const quests = [
    {
      id: 'follow-agent',
      title: 'Meet a worker',
      body: 'Assign nearby.',
      completed: Boolean(game.followedAgentId),
      progress: game.followedAgentId ? '1/1' : '0/1',
    },
    {
      id: 'collect-proof',
      title: 'Gather proof light',
      body: 'Collect a receipt or resource light to turn source proof into usable game energy.',
      completed: idList(game.collectedIds).length >= 1,
      progress: `${idList(game.collectedIds).length}/1`,
    },
    {
      id: 'inspect-agent',
      title: 'Read a living worker',
      body: 'Inspect a source-backed agent sprite and verify its path, timestamp, proof, and next event.',
      completed: idList(game.inspectedIds).some((id) => world.agents.some((agent) => agent.id === id)),
      progress: `${idList(game.inspectedIds).filter((id) => world.agents.some((agent) => agent.id === id)).length}/1`,
    },
  ];
  if (world.fog.length) {
    quests.push({
      id: 'clear-fog',
      title: 'Clear red-team fog',
      body: 'Spend one proof to clear a proof-gap fog patch. Fog clearing is local game state, not a claim that risk disappeared.',
      completed: idList(game.clearedFogIds).length >= 1,
      progress: `${idList(game.clearedFogIds).length}/1`,
    });
  }
  if (world.gates.length) {
    quests.push({
      id: 'respect-gate',
      title: 'Touch a hard gate without bypassing it',
      body: 'Check a locked gate and see the approval boundary stay locked.',
      completed: finiteNumber(game.gateChecks, 0) >= 1,
      progress: `${finiteNumber(game.gateChecks, 0)}/1`,
    });
  }
  for (const quest of world.quests || []) {
    const id = quest.id || quest.entity_id || quest.title;
    if (!id || quests.some((item) => item.id === id)) continue;
    quests.push({
      id: String(id),
      title: quest.title || String(id),
      body: quest.body || quest.description || `World quest from ${quest.next_event || 'working-space source'}.`,
      completed: hasId(game.completedQuestIds, id),
      progress: hasId(game.completedQuestIds, id) ? 'done' : 'open',
    });
  }
  return quests;
}

function refreshQuestLog(world, game) {
  const log = baseQuestLog(world, game).map((quest) => ({
    ...quest,
    completed: Boolean(quest.completed || hasId(game.completedQuestIds, quest.id)),
  }));
  for (const quest of log) {
    if (quest.completed) game.completedQuestIds = addId(game.completedQuestIds, quest.id);
  }
  game.questLog = log.map((quest) => ({
    ...quest,
    completed: Boolean(quest.completed || hasId(game.completedQuestIds, quest.id)),
  }));
  const active = game.questLog.find((quest) => !quest.completed) || game.questLog[game.questLog.length - 1] || null;
  game.activeQuestId = active?.id || null;
  return game;
}

function createInitialGameState(world, prior = {}) {
  const game = {
    schema: 'agent_terrarium_game_state_v1',
    proof: finiteNumber(prior.proof, 0),
    signal: finiteNumber(prior.signal, 0),
    collectedIds: idList(prior.collectedIds),
    clearedFogIds: idList(prior.clearedFogIds),
    inspectedIds: idList(prior.inspectedIds),
    assignedIds: idList(prior.assignedIds),
    completedQuestIds: idList(prior.completedQuestIds),
    followedAgentId: prior.followedAgentId || null,
    gateChecks: finiteNumber(prior.gateChecks, 0),
    ownerGuideOpen: Boolean(prior.ownerGuideOpen),
    message: prior.message || 'Wake in the working room: meet the Terrarium Keeper (G), gather proof, inspect workers, clear fog, respect hard gates.',
    activeQuestId: prior.activeQuestId || null,
    nearbyEntityId: prior.nearbyEntityId || null,
    questLog: [],
  };
  return refreshQuestLog(world, game);
}

function proximityRadiusFor(entity) {
  switch (entity?.visible_as) {
    case 'agent_sprite': return 5.5;
    case 'building':
    case 'source_root': return 5;
    case 'owner_guide': return 5.5;
    case 'receipt_light':
    case 'resource_light': return 3.2;
    case 'fog_alarm': return 4.2;
    case 'locked_door': return 5;
    case 'quest': return 4.5;
    default: return 4;
  }
}

function proximityDistanceTiles(engine, entity) {
  const playerX = engine.player.x / TILE;
  const playerY = engine.player.y / TILE;
  if (['agent_sprite', 'receipt_light', 'resource_light'].includes(entity.visible_as)) {
    const center = entityCenter(entity);
    return Math.hypot(center.x - playerX, center.y - playerY);
  }
  const left = finiteNumber(entity.renderX ?? entity.x, 0);
  const top = finiteNumber(entity.renderY ?? entity.y, 0);
  const right = left + Math.max(1, finiteNumber(entity.w, 1));
  const bottom = top + Math.max(1, finiteNumber(entity.h, 1));
  const nearestX = clamp(playerX, left, right);
  const nearestY = clamp(playerY, top, bottom);
  return Math.hypot(nearestX - playerX, nearestY - playerY);
}

function proximityAnchor(entity) {
  const x = finiteNumber(entity.renderX ?? entity.x, 0);
  const y = finiteNumber(entity.renderY ?? entity.y, 0);
  if (entity.visible_as === 'agent_sprite') return { x, y: y - 1.15 };
  if (['receipt_light', 'resource_light'].includes(entity.visible_as)) return { x, y: y - 0.8 };
  return {
    x: x + Math.max(1, finiteNumber(entity.w, 1)) / 2,
    y: y - 0.3,
  };
}

function proximityStateLabel(engine, entity) {
  if (entity.collected || hasId(engine.game?.collectedIds, entity.id)) return 'Proof gathered';
  if (entity.cleared || hasId(engine.game?.clearedFogIds, entity.id)) return 'Fog cleared';
  if (engine.game?.followedAgentId === entity.id || entity.following) return 'Following you';
  if (entity.locked || entity.visible_as === 'locked_door') return 'Locked';
  const raw = String(entity.state || entity.role || 'Nearby').replace(/^following_player_/, '').replace(/[_-]+/g, ' ').trim();
  return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Nearby';
}

function proximityTone(engine, entity) {
  if (entity.collected || hasId(engine.game?.collectedIds, entity.id)) return 'quiet';
  if (entity.cleared || hasId(engine.game?.clearedFogIds, entity.id)) return 'calm';
  if (entity.locked || entity.visible_as === 'locked_door') return 'blocked';
  if (entity.visible_as === 'fog_alarm') return 'warning';
  if (['receipt_light', 'resource_light'].includes(entity.visible_as)) return 'ready';
  if (engine.game?.followedAgentId === entity.id || entity.following) return 'active';
  if (/missing|stale|blocked|failed|warn/i.test(`${entity.state || ''} ${entity.proofStatus || ''}`)) return 'warning';
  return engine.selectedId === entity.id ? 'focus' : 'calm';
}

function proximityHint(engine, entity) {
  switch (entity.visible_as) {
    case 'agent_sprite': return engine.game?.followedAgentId === entity.id || entity.following ? 'Following you' : 'Follow worker';
    case 'building':
    case 'source_root': return 'Inspect place';
    case 'owner_guide': return 'Open guide';
    case 'receipt_light':
    case 'resource_light': return entity.collected || hasId(engine.game?.collectedIds, entity.id) ? 'Proof gathered' : 'Gather proof';
    case 'fog_alarm': return entity.cleared || hasId(engine.game?.clearedFogIds, entity.id) ? 'Fog cleared' : 'Clear with proof';
    case 'locked_door': return 'Owner approval required';
    case 'quest': return 'View objective';
    default: return 'Inspect nearby';
  }
}

export function getProximityInfo(engine, options = {}) {
  if (!engine?.world || !engine?.player) return [];
  const requestedLimit = Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : 3;
  const limit = clamp(requestedLimit, 0, 50);
  if (limit === 0) return [];
  const overrideRadius = Number.isFinite(Number(options.radiusTiles)) ? Math.max(0, Number(options.radiusTiles)) : null;
  const ranked = engine.world.entities
    .map((entity) => ({ entity, distance: proximityDistanceTiles(engine, entity) }))
    .filter(({ entity, distance }) => distance <= (overrideRadius ?? proximityRadiusFor(entity)))
    .sort((a, b) => a.distance - b.distance || String(a.entity.id).localeCompare(String(b.entity.id)))
    .slice(0, limit)
    .map(({ entity, distance }, index) => ({
      id: String(entity.id),
      title: String(entity.title || entity.id),
      kind: String(entity.visible_as || entity.engineKind || entity.kind || 'entity'),
      stateLabel: proximityStateLabel(engine, entity),
      hint: proximityHint(engine, entity),
      tone: proximityTone(engine, entity),
      distanceTiles: Number(distance.toFixed(2)),
      anchor: proximityAnchor(entity),
      primary: index === 0,
      selected: engine.selectedId === entity.id,
      following: engine.game?.followedAgentId === entity.id || Boolean(entity.following),
    }));
  return ranked;
}

function updateNearby(engine) {
  if (!engine?.game) return null;
  const near = getProximityInfo(engine, { limit: 1 })[0] || null;
  engine.game.nearbyEntityId = near?.id || null;
  return near?.id ? entityById(engine.world, near.id) : null;
}

function pushGameEvent(engine, type, payload = {}) {
  engine.eventQueue.push({
    id: `${type}_${payload.entityId || payload.questId || engine.eventQueue.length}_${engine.tickMs}`,
    type,
    source: 'terrarium-engine-gameplay',
    eventId: engine.world.meta.event_id || engine.world.viewport?.event_bus?.current_event_id || 'event pending',
    entityId: payload.entityId,
    questId: payload.questId,
    createdAt: engine.world.meta.created_at || 'source_timestamp_derived',
    payload,
  });
}

export function getGameHud(engine) {
  if (!engine?.game) throw new Error('getGameHud requires an engine with game state');
  refreshQuestLog(engine.world, engine.game);
  const activeQuest = engine.game.questLog.find((quest) => quest.id === engine.game.activeQuestId) || null;
  const fishbowl = engine.world.fishbowl || {};
  return {
    schema: 'agent_terrarium_game_hud_v1',
    morningBrief: {
      health: fishbowl.health?.label || 'Snapshot unavailable',
      working: fishbowl.work?.label || 'Local work state unavailable',
      owner: fishbowl.owner?.label || 'Nothing needs you',
      tone: fishbowl.health?.tone || 'watch',
      fresh: fishbowl.freshness?.label || 'Snapshot time unavailable',
    },
    queue: deepClone(fishbowl.queue || { queued: 0, claimed: 0, receipted: 0, pressure: 'UNKNOWN' }),
    proof: engine.game.proof,
    signal: engine.game.signal,
    activeQuest,
    questLog: engine.game.questLog.map((quest) => ({ ...quest })),
    completedQuestIds: idList(engine.game.completedQuestIds),
    collectedIds: idList(engine.game.collectedIds),
    clearedFogIds: idList(engine.game.clearedFogIds),
    collectedCount: idList(engine.game.collectedIds).length,
    clearedFogCount: idList(engine.game.clearedFogIds).length,
    assignedIds: idList(engine.game.assignedIds),
    followedAgentId: engine.game.followedAgentId || null,
    nearbyEntityId: engine.game.nearbyEntityId,
    message: engine.game.message,
    ownerGuideOpen: Boolean(engine.game.ownerGuideOpen),
    controls: ['followAgent', 'inspectNearest', 'collectProof', 'clearFog', 'unlockGate', 'openOwnerGuide', 'closeOwnerGuide'],
  };
}

export function createTerrariumEngine(rawWorld, options = {}) {
  const mode = normalizeMode(options.mode, rawWorld || {});
  const world = normalizeWorldForEngine(rawWorld, { mode });
  const viewportSize = options.viewportSize || { width: 960, height: 640 };
  const camera = options.camera ? deepClone(options.camera) : { x: 0, y: 0 };
  const selectedId = options.selectedId && entityById(world, options.selectedId) ? options.selectedId : chooseDefaultSelectedId(world);
  const player = options.player ? deepClone(options.player) : createInitialPlayer(world, selectedId);
  const engine = {
    schema: 'agent_terrarium_engine_v1',
    mode,
    rawMeta: deepClone((rawWorld || {}).meta || {}),
    world,
    player,
    camera,
    selectedId,
    game: createInitialGameState(world, options.game || {}),
    tickMs: finiteNumber(options.tickMs, 0),
    viewportSize: { width: finiteNumber(viewportSize.width, 960), height: finiteNumber(viewportSize.height, 640) },
    eventQueue: [bootEvent(rawWorld || {}, world)],
  };
  clampPlayer(engine);
  updateCamera(engine);
  updateNearby(engine);
  refreshQuestLog(engine.world, engine.game);
  return engine;
}

const PLAYER_COLLISION_RADIUS = 10;
export const POND_LAYOUT = Object.freeze({ x: 18, y: 11, w: 7, h: 4 });
const POND_COLLIDER = {
  x: POND_LAYOUT.x * TILE,
  y: POND_LAYOUT.y * TILE,
  w: POND_LAYOUT.w * TILE,
  h: POND_LAYOUT.h * TILE,
};

function clampPlayer(engine) {
  const worldW = engine.world.tilemap.width * TILE;
  const worldH = engine.world.tilemap.height * TILE;
  engine.player.x = clamp(engine.player.x, 16, Math.max(16, worldW - 16));
  engine.player.y = clamp(engine.player.y, 16, Math.max(16, worldH - 16));
}

function circleIntersectsRect(x, y, radius, rect) {
  const nearestX = clamp(x, rect.left, rect.right);
  const nearestY = clamp(y, rect.top, rect.bottom);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function buildingCollisionRects(building) {
  const left = finiteNumber(building.x, 0) * TILE + 4;
  const top = finiteNumber(building.y, 0) * TILE + 4;
  const right = (finiteNumber(building.x, 0) + Math.max(1, finiteNumber(building.w, 1))) * TILE - 4;
  const bottom = (finiteNumber(building.y, 0) + Math.max(1, finiteNumber(building.h, 1))) * TILE;
  const center = (left + right) / 2;
  const doorwayHalf = clamp((right - left) * 0.13, 15, 24);
  const doorwayTop = bottom - 22;
  return [
    { left, top, right, bottom: doorwayTop },
    { left, top: doorwayTop, right: center - doorwayHalf, bottom },
    { left: center + doorwayHalf, top: doorwayTop, right, bottom },
  ].filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
}

function pondCollisionRects() {
  const { x, y, w, h } = POND_COLLIDER;
  return [
    { left: x, top: y + 10, right: x + w, bottom: y + h - 10 },
    { left: x + 10, top: y, right: x + w - 10, bottom: y + h },
  ];
}

function canPlayerOccupy(engine, x, y) {
  const worldW = engine.world.tilemap.width * TILE;
  const worldH = engine.world.tilemap.height * TILE;
  const radius = PLAYER_COLLISION_RADIUS;
  if (x - radius < 0 || y - radius < 0 || x + radius > worldW || y + radius > worldH) return false;

  for (const building of engine.world.buildings || []) {
    if (building.visible_as === 'source_root' || building.kind === 'source_root') continue;
    if (buildingCollisionRects(building).some((rect) => circleIntersectsRect(x, y, radius, rect))) return false;
  }
  if (pondCollisionRects().some((rect) => circleIntersectsRect(x, y, radius, rect))) return false;
  return true;
}

function movePlayerWithCollision(engine, dx, dy) {
  const startX = engine.player.x;
  const startY = engine.player.y;
  const nextX = startX + dx;
  if (canPlayerOccupy(engine, nextX, startY)) engine.player.x = nextX;
  const nextY = startY + dy;
  if (canPlayerOccupy(engine, engine.player.x, nextY)) engine.player.y = nextY;
}

function updateCamera(engine, offset = null) {
  const worldW = engine.world.tilemap.width * TILE;
  const worldH = engine.world.tilemap.height * TILE;
  const width = finiteNumber(engine.viewportSize.width, 960);
  const height = finiteNumber(engine.viewportSize.height, 640);
  const offsetX = finiteNumber(offset?.x, 0);
  const offsetY = finiteNumber(offset?.y, 0);
  const smoothing = 0.18;
  engine.camera.x += (engine.player.x - width / 2 + offsetX - engine.camera.x) * smoothing;
  engine.camera.y += (engine.player.y - height / 2 + offsetY - engine.camera.y) * smoothing;
  engine.camera.x = clamp(engine.camera.x, 0, Math.max(0, worldW - width));
  engine.camera.y = clamp(engine.camera.y, 0, Math.max(0, worldH - height));
}

function keySet(input) {
  const keys = input instanceof Set ? [...input] : Array.isArray(input) ? input : [];
  return new Set(keys.map((key) => String(key).toLowerCase()));
}

function updateAgentRenderPositions(engine) {
  const followedId = engine.game?.followedAgentId || '';
  const playerTileX = engine.player.x / TILE;
  const playerTileY = engine.player.y / TILE;
  const followOffset = {
    left: { x: 1.15, y: 0.15 },
    right: { x: -1.15, y: 0.15 },
    up: { x: 0.15, y: 1.15 },
    down: { x: -0.15, y: -1.15 },
  }[engine.player.facing] || { x: -0.15, y: -1.15 };
  for (const agent of engine.world.agents) {
    if (followedId && agent.id === followedId) {
      const targetX = clamp(playerTileX + followOffset.x, 1, Math.max(1, engine.world.tilemap.width - 1));
      const targetY = clamp(playerTileY + followOffset.y, 1, Math.max(1, engine.world.tilemap.height - 1));
      agent.renderX = finiteNumber(agent.renderX, agent.x) + (targetX - finiteNumber(agent.renderX, agent.x)) * 0.42;
      agent.renderY = finiteNumber(agent.renderY, agent.y) + (targetY - finiteNumber(agent.renderY, agent.y)) * 0.42;
      agent.following = true;
      if (!String(agent.state).startsWith('following_player')) agent.state = `following_player_${agent.state || 'source_backed'}`;
      agent.activity = 'following_player';
      agent.activityScale = Math.max(1, finiteNumber(agent.activityScale, 0.5));
      continue;
    }
    agent.renderX = agent.x;
    agent.renderY = agent.y;
    agent.following = false;
  }
}

export function stepTerrariumEngine(engine, input = {}) {
  if (!engine || !engine.world) throw new Error('stepTerrariumEngine requires an engine created by createTerrariumEngine()');
  if (input.viewportSize) {
    engine.viewportSize = {
      width: finiteNumber(input.viewportSize.width, engine.viewportSize.width),
      height: finiteNumber(input.viewportSize.height, engine.viewportSize.height),
    };
  }
  const keys = keySet(input.keys);
  let dx = finiteNumber(input.moveVector?.x, 0);
  let dy = finiteNumber(input.moveVector?.y, 0);
  if (keys.has('arrowleft') || keys.has('a') || keys.has('left')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d') || keys.has('right')) dx += 1;
  if (keys.has('arrowup') || keys.has('w') || keys.has('up')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s') || keys.has('down')) dy += 1;

  const deltaMs = clamp(finiteNumber(input.deltaMs, 1000 / 60), 0, 250);
  engine.tickMs += deltaMs;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 0) {
    if (magnitude > 1) {
      dx /= magnitude;
      dy /= magnitude;
    }
    const distance = finiteNumber(engine.player.speed, 120) * (deltaMs / 1000);
    movePlayerWithCollision(engine, dx * distance, dy * distance);
    engine.player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  clampPlayer(engine);
  updateCamera(engine, input.cameraOffset);
  updateAgentRenderPositions(engine);
  updateNearby(engine);
  refreshQuestLog(engine.world, engine.game);
  return engine;
}

export function performTerrariumAction(engine, action) {
  if (!engine?.world || !engine.game) throw new Error('performTerrariumAction requires an engine with game state');
  const verb = String(action || '').trim();
  updateNearby(engine);

  if (['inspectNearest', 'inspect', 'look'].includes(verb)) {
    const entity = nearestEntityForAction(engine, () => true, 3.3);
    if (!entity) {
      engine.game.message = 'No source-backed thing is close enough to inspect.';
      return { ok: false, action: verb, reason: 'nothing_nearby', message: engine.game.message };
    }
    engine.selectedId = entity.id;
    engine.game.inspectedIds = addId(engine.game.inspectedIds, entity.id);
    if (entity.sourcePath && !String(entity.sourcePath).includes('pending')) engine.game.signal += 1;
    engine.game.message = `Inspected ${entity.title}: proof=${entity.proofStatus}; next=${entity.nextEvent}.`;
    pushGameEvent(engine, 'entity_inspected', { entityId: entity.id, proofStatus: entity.proofStatus, nextEvent: entity.nextEvent });
    refreshQuestLog(engine.world, engine.game);
    return { ok: true, action: verb, entityId: entity.id, gainedSignal: 1, message: engine.game.message };
  }

  if (['followAgent', 'follow', 'assignAgent', 'assign'].includes(verb)) {
    const entity = nearestEntityForAction(engine, (item) => item.visible_as === 'agent_sprite', 4.5);
    if (!entity) {
      engine.game.message = 'No living worker is close enough to follow yet.';
      return { ok: false, action: verb, reason: 'no_agent_nearby', message: engine.game.message };
    }
    engine.game.followedAgentId = entity.id;
    engine.game.assignedIds = addId(engine.game.assignedIds, entity.id);
    engine.game.inspectedIds = addId(engine.game.inspectedIds, entity.id);
    if (entity.sourcePath && !String(entity.sourcePath).includes('pending')) engine.game.signal += 1;
    entity.following = true;
    if (!String(entity.state).startsWith('following_player')) entity.state = `following_player_${entity.state || 'source_backed'}`;
    entity.activity = 'following_player';
    entity.activityScale = Math.max(1, finiteNumber(entity.activityScale, 0.5));
    engine.selectedId = entity.id;
    engine.game.message = `Assigned ${entity.title} to follow you. Move and the worker mirrors the proof run.`;
    pushGameEvent(engine, 'agent_follow_assigned', { entityId: entity.id, signal: engine.game.signal, nextEvent: entity.nextEvent });
    refreshQuestLog(engine.world, engine.game);
    return { ok: true, action: verb, entityId: entity.id, followedAgentId: entity.id, gainedSignal: 1, message: engine.game.message };
  }

  if (['collectProof', 'collect', 'gather'].includes(verb)) {
    const collectible = (item) => ['receipt_light', 'resource_light'].includes(item.visible_as);
    const entity = nearestEntityForAction(
      engine,
      (item) => collectible(item) && !hasId(engine.game.collectedIds, item.id),
      1.8,
    );
    if (!entity) {
      const already = nearestEntityForAction(engine, (item) => collectible(item) && hasId(engine.game.collectedIds, item.id), 1.8);
      if (already) {
        engine.game.message = `${already.title} was already collected.`;
        return { ok: false, action: verb, entityId: already.id, reason: 'already_collected', message: engine.game.message };
      }
      engine.game.message = 'No proof light is close enough to gather.';
      return { ok: false, action: verb, reason: 'no_collectible_nearby', message: engine.game.message };
    }
    if (hasId(engine.game.collectedIds, entity.id)) {
      engine.game.message = `${entity.title} was already collected.`;
      return { ok: false, action: verb, entityId: entity.id, reason: 'already_collected', message: engine.game.message };
    }
    const gained = Math.max(1, Math.floor(finiteNumber(entity.amount, entity.visible_as === 'resource_light' ? 1 : 1)));
    engine.game.proof += gained;
    engine.game.collectedIds = addId(engine.game.collectedIds, entity.id);
    entity.collected = true;
    entity.state = 'collected_source_backed';
    entity.activity = 'collected';
    entity.activityScale = 0.1;
    engine.selectedId = entity.id;
    engine.game.message = `Collected ${gained} proof from ${entity.title}.`;
    pushGameEvent(engine, 'proof_collected', { entityId: entity.id, gained, proof: engine.game.proof });
    refreshQuestLog(engine.world, engine.game);
    return { ok: true, action: verb, entityId: entity.id, gained, proof: engine.game.proof, message: engine.game.message };
  }

  if (['clearFog', 'clear', 'purify'].includes(verb)) {
    const entity = nearestEntityForAction(engine, (item) => item.visible_as === 'fog_alarm', 3.6);
    if (!entity) {
      engine.game.message = 'No red-team fog is close enough to clear.';
      return { ok: false, action: verb, reason: 'no_fog_nearby', message: engine.game.message };
    }
    if (hasId(engine.game.clearedFogIds, entity.id)) {
      engine.game.message = `${entity.title} is already marked cleared in this local run.`;
      return { ok: false, action: verb, entityId: entity.id, reason: 'already_cleared', message: engine.game.message };
    }
    if (engine.game.proof < 1) {
      engine.game.message = 'Need one proof light before clearing fog.';
      return { ok: false, action: verb, entityId: entity.id, reason: 'not_enough_proof', message: engine.game.message };
    }
    engine.game.proof -= 1;
    engine.game.clearedFogIds = addId(engine.game.clearedFogIds, entity.id);
    entity.cleared = true;
    entity.state = 'cleared_by_player_proof_spent';
    entity.activity = 'cleared';
    entity.activityScale = 0.05;
    engine.selectedId = entity.id;
    engine.game.message = `Cleared ${entity.title} for this run by spending one proof. Risk is not erased; it is now visible.`;
    pushGameEvent(engine, 'fog_cleared', { entityId: entity.id, cost: 1, proof: engine.game.proof });
    refreshQuestLog(engine.world, engine.game);
    return { ok: true, action: verb, entityId: entity.id, cost: 1, proof: engine.game.proof, message: engine.game.message };
  }

  if (['unlockGate', 'gate', 'gateCheck'].includes(verb)) {
    const entity = nearestEntityForAction(engine, (item) => item.visible_as === 'locked_door' || item.locked, 4.2);
    if (!entity) {
      engine.game.message = 'No hard gate is close enough to check.';
      return { ok: false, action: verb, reason: 'no_gate_nearby', message: engine.game.message };
    }
    engine.game.gateChecks += 1;
    engine.selectedId = entity.id;
    entity.gateChecked = true;
    entity.state = 'approval_checked_locked';
    entity.activity = 'gate_checked';
    entity.activityScale = Math.max(0.25, finiteNumber(entity.activityScale, 0.1));
    engine.game.message = `${entity.title} stays locked: owner approval required before ${entity.nextEvent || 'this side effect'}.`;
    pushGameEvent(engine, 'hard_gate_checked', { entityId: entity.id, reason: 'approval_required' });
    refreshQuestLog(engine.world, engine.game);
    return { ok: false, action: verb, entityId: entity.id, reason: 'approval_required', message: engine.game.message };
  }

  if (['openOwnerGuide', 'ownerGuide', 'guide'].includes(verb)) {
    const entity = nearestEntityForAction(engine, (item) => item.visible_as === 'owner_guide', 5.5)
      || engine.world.entities.find((item) => item.visible_as === 'owner_guide')
      || null;
    if (!entity) {
      engine.game.message = 'The Terrarium Keeper is missing from this world.';
      return { ok: false, action: verb, reason: 'no_owner_guide', message: engine.game.message };
    }
    engine.selectedId = entity.id;
    engine.game.inspectedIds = addId(engine.game.inspectedIds, entity.id);
    engine.game.ownerGuideOpen = true;
    engine.game.signal += 1;
    engine.game.message = 'The Terrarium Keeper has a field lesson for you.';
    pushGameEvent(engine, 'owner_guide_opened', {
      entityId: entity.id,
      sections: ['say', 'ignore', 'approve', 'outcomes', 'first_30_seconds'],
    });
    refreshQuestLog(engine.world, engine.game);
    return {
      ok: true,
      action: verb,
      entityId: entity.id,
      ownerGuide: entity.ownerGuide || defaultOwnerGuideObject().owner_guide,
      gainedSignal: 1,
      message: engine.game.message,
    };
  }

  if (['closeOwnerGuide', 'closeGuide'].includes(verb)) {
    engine.game.ownerGuideOpen = false;
    engine.game.message = 'Guide closed. The world is yours again.';
    pushGameEvent(engine, 'owner_guide_closed', { entityId: engine.selectedId || null });
    return { ok: true, action: verb, message: engine.game.message };
  }

  engine.game.message = `Unknown verb: ${verb || 'empty'}.`;
  return { ok: false, action: verb, reason: 'unknown_action', message: engine.game.message };
}

function hitBox(entity) {
  if (entity.visible_as === 'agent_sprite') {
    return { x1: entity.renderX ?? entity.x, y1: entity.renderY ?? entity.y, x2: (entity.renderX ?? entity.x), y2: (entity.renderY ?? entity.y), radius: 1.2 };
  }
  return { x1: entity.x, y1: entity.y, x2: entity.x + finiteNumber(entity.w, 1), y2: entity.y + finiteNumber(entity.h, 1), radius: 0 };
}

export function selectAtWorldPoint(engine, point, options = {}) {
  if (!engine?.world) return null;
  const tx = finiteNumber(point?.x, 0) / TILE;
  const ty = finiteNumber(point?.y, 0) / TILE;
  const ordered = [
    ...[...engine.world.agents].reverse(),
    ...engine.world.entities.filter((entity) => entity.visible_as !== 'agent_sprite').reverse(),
  ];
  const hits = ordered.filter((entity) => {
    const box = hitBox(entity);
    if (box.radius) return Math.hypot(tx - box.x1, ty - box.y1) <= box.radius;
    return tx >= box.x1 && tx <= box.x2 && ty >= box.y1 && ty <= box.y2;
  });
  if (!hits.length) return null;
  const cycleAfterId = String(options.cycleAfterId || '');
  const priorIndex = cycleAfterId ? hits.findIndex((entity) => entity.id === cycleAfterId) : -1;
  const hit = priorIndex >= 0 ? hits[(priorIndex + 1) % hits.length] : hits[0];
  engine.selectedId = hit.id;
  return hit;
}

export function findNearestEntity(engine, options = {}) {
  if (!engine?.world) return null;
  const kind = options.kind || options.visibleAs;
  let candidates = engine.world.entities;
  if (kind === 'agent') candidates = engine.world.agents;
  else if (kind) candidates = candidates.filter((entity) => entity.visible_as === kind || entity.engineKind === kind || entity.kind === kind);
  if (!candidates.length) return null;
  return candidates
    .map((entity) => ({ entity, dist: Math.hypot(entity.x * TILE - engine.player.x, entity.y * TILE - engine.player.y) }))
    .sort((a, b) => a.dist - b.dist || String(a.entity.id).localeCompare(String(b.entity.id)))[0].entity;
}

export function inspectEntity(engine, id = engine?.selectedId) {
  const entity = engine?.world ? entityById(engine.world, id) : null;
  if (!entity) return null;
  return {
    id: entity.id,
    title: entity.title,
    state: entity.state,
    body: entity.body,
    kind: entity.visible_as,
    locked: Boolean(entity.locked),
    nextEvent: entity.nextEvent,
    verbs: [...entity.verbs],
    ownerGuide: entity.ownerGuide || (entity.visible_as === 'owner_guide' ? defaultOwnerGuideObject().owner_guide : null),
    proof: {
      sourcePath: entity.sourcePath,
      timestamp: entity.timestamp,
      proofStatus: entity.proofStatus,
      eventId: entity.eventId,
      sha256: entity.sha256,
      hashScope: entity.hashScope,
    },
    architecture: deepClone(engine.world.loopArchitecture),
    provenanceFields: ['sourcePath', 'timestamp', 'proofStatus', 'eventId', 'sha256', 'hashScope', 'nextEvent'],
  };
}

export function getRenderScene(engine) {
  if (!engine?.world) throw new Error('getRenderScene requires an engine');
  const commands = engine.world.entities.map((entity) => ({
    id: entity.id,
    title: entity.title,
    kind: entity.visible_as,
    engineKind: entity.engineKind,
    x: entity.renderX ?? entity.x,
    y: entity.renderY ?? entity.y,
    w: ['agent_sprite', 'receipt_light', 'resource_light'].includes(entity.visible_as) ? 1 : entity.w,
    h: ['agent_sprite', 'receipt_light', 'resource_light'].includes(entity.visible_as) ? 1 : entity.h,
    amount: entity.amount,
    state: entity.state,
    mood: entity.mood,
    proofStatus: entity.proofStatus,
    timestamp: entity.timestamp,
    sha256: entity.sha256,
    locked: entity.locked,
    collected: Boolean(entity.collected || hasId(engine.game?.collectedIds, entity.id)),
    cleared: Boolean(entity.cleared || hasId(engine.game?.clearedFogIds, entity.id)),
    gateChecked: Boolean(entity.gateChecked),
    selected: engine.selectedId === entity.id,
    nearby: engine.game?.nearbyEntityId === entity.id,
    following: engine.game?.followedAgentId === entity.id || Boolean(entity.following),
    sourcePath: entity.sourcePath,
    proofStatus: entity.proofStatus,
    nextEvent: entity.nextEvent,
    sprite: entity.sprite,
  }));
  const hud = getGameHud(engine);
  return {
    schema: 'agent_terrarium_render_scene_v1',
    mode: engine.mode,
    fishbowl: deepClone(engine.world.fishbowl),
    loopArchitecture: deepClone(engine.world.loopArchitecture),
    tilemap: deepClone(engine.world.tilemap),
    player: deepClone(engine.player),
    camera: deepClone(engine.camera),
    selectedId: engine.selectedId,
    layers: [
      { id: 'tilemap', order: 0, role: 'working-space terrain' },
      { id: 'workspace-entities', order: 10, role: 'source-backed buildings, agents, gates, receipts, fog' },
      { id: 'gameplay-overlays', order: 18, role: 'proof pickups, fog-cleared state, quest markers, nearby prompts' },
      { id: 'proof-overlays', order: 20, role: 'proof status, hard gates, next events' },
    ],
    commands,
    game: {
      proof: hud.proof,
      signal: hud.signal,
      activeQuestId: hud.activeQuest?.id || null,
      completedQuestCount: hud.completedQuestIds.length,
      nearbyEntityId: hud.nearbyEntityId,
    },
    provenanceMissingCount: engine.world.entities.filter((entity) => entity.proofStatus === 'missing_provenance' || String(entity.sourcePath).includes('pending') || String(entity.timestamp).includes('pending')).length,
    hardGateCount: engine.world.entities.filter((entity) => entity.locked).length,
  };
}

export function snapshotEngine(engine) {
  if (!engine?.world) throw new Error('snapshotEngine requires an engine');
  return {
    schema: engine.schema,
    mode: engine.mode,
    tickMs: Number(engine.tickMs.toFixed(4)),
    selectedId: engine.selectedId,
    player: {
      x: Number(engine.player.x.toFixed(4)),
      y: Number(engine.player.y.toFixed(4)),
      speed: Number(engine.player.speed),
      facing: engine.player.facing,
    },
    camera: {
      x: Number(engine.camera.x.toFixed(4)),
      y: Number(engine.camera.y.toFixed(4)),
    },
    world: {
      eventId: engine.world.meta.event_id || engine.world.viewport?.event_bus?.current_event_id || null,
      loopArchitecture: deepClone(engine.world.loopArchitecture),
      entities: engine.world.entities.map((entity) => ({
        id: entity.id,
        state: entity.state,
        x: Number(entity.x.toFixed(4)),
        y: Number(entity.y.toFixed(4)),
        renderX: Number((entity.renderX ?? entity.x).toFixed(4)),
        renderY: Number((entity.renderY ?? entity.y).toFixed(4)),
        proofStatus: entity.proofStatus,
        locked: Boolean(entity.locked),
        collected: Boolean(entity.collected || hasId(engine.game?.collectedIds, entity.id)),
        cleared: Boolean(entity.cleared || hasId(engine.game?.clearedFogIds, entity.id)),
        gateChecked: Boolean(entity.gateChecked),
      })),
    },
    game: {
      proof: engine.game.proof,
      signal: engine.game.signal,
      collectedIds: idList(engine.game.collectedIds),
      clearedFogIds: idList(engine.game.clearedFogIds),
      inspectedIds: idList(engine.game.inspectedIds),
      assignedIds: idList(engine.game.assignedIds),
      completedQuestIds: idList(engine.game.completedQuestIds),
      followedAgentId: engine.game.followedAgentId || null,
      gateChecks: engine.game.gateChecks,
      ownerGuideOpen: Boolean(engine.game.ownerGuideOpen),
      activeQuestId: engine.game.activeQuestId,
      nearbyEntityId: engine.game.nearbyEntityId,
      message: engine.game.message,
    },
    eventQueue: deepClone(engine.eventQueue),
  };
}

export function applyWorldSnapshot(engine, rawWorld, options = {}) {
  if (!engine) return createTerrariumEngine(rawWorld, options);
  const next = createTerrariumEngine(rawWorld, {
    mode: options.mode || engine.mode,
    player: engine.player,
    camera: engine.camera,
    game: engine.game,
    viewportSize: engine.viewportSize,
    selectedId: engine.selectedId,
    tickMs: engine.tickMs,
  });
  if (engine.selectedId && entityById(next.world, engine.selectedId)) {
    next.selectedId = engine.selectedId;
  }
  next.eventQueue = [
    ...deepClone(engine.eventQueue),
    {
      id: `world_snapshot_applied_${next.world.meta.event_id || next.world.viewport?.event_bus?.current_event_id || 'manual'}`,
      type: 'world_snapshot_applied',
      source: 'terrarium-engine',
      eventId: next.world.meta.event_id || next.world.viewport?.event_bus?.current_event_id || 'event pending',
      createdAt: next.world.meta.created_at || 'source_timestamp_derived',
      payload: {
        entities: next.world.entities.length,
        preservedSelection: next.selectedId,
      },
    },
  ];
  return next;
}
