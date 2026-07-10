export const BUILDING_ART_VERSION = '2.0.0-hardcore';

const profile = (id, silhouette, roofFamily, landmark, materials, details, palette) => Object.freeze({
  id,
  silhouette,
  roofFamily,
  landmark,
  materials: Object.freeze(materials),
  details: Object.freeze(details),
  palette: Object.freeze(palette),
});

export const BUILDING_ART_PROFILES = Object.freeze({
  hearth: profile(
    'hearth',
    'tall-cross-gable-porch',
    'terracotta-cross-gable',
    'oversized-masonry-hearth-stack',
    ['cream plaster', 'oak timber', 'terracotta shingle', 'fieldstone'],
    ['deep front porch', 'flower boxes', 'lit bay window', 'split masonry chimney', 'hearth crest'],
    {
      roofDark: '#633a36', roof: '#985044', roofLight: '#cf7659', wallDark: '#b47d4d', wall: '#e7bd78', wallLight: '#ffe0a1',
      trim: '#fff0bd', window: '#ffe993', door: '#6b4032', stone: '#81705c', metal: '#bd7b42', accent: '#e56b5d', foliage: '#5b8247',
    },
  ),
  granary: profile(
    'granary',
    'wide-barn-with-round-silo',
    'red-gambrel-barn',
    'copper-silo-and-hayloft-hoist',
    ['red plank', 'fieldstone', 'copper', 'oak beam'],
    ['gambrel hayloft', 'double cross-braced doors', 'queue loading deck', 'grain vent', 'roof hoist'],
    {
      roofDark: '#5c302f', roof: '#8f4238', roofLight: '#bd5e49', wallDark: '#85472f', wall: '#c76f45', wallLight: '#dc8c55',
      trim: '#f2c67d', window: '#ffe59e', door: '#66402f', stone: '#7f7965', metal: '#b87948', accent: '#e3b35f', foliage: '#667c43',
    },
  ),
  sorting: profile(
    'sorting',
    'long-sawtooth-shed-awning',
    'charcoal-sawtooth-metal',
    'sorting-chute-and-color-bins',
    ['ochre brick', 'dark timber', 'sheet metal', 'canvas'],
    ['north-light sawtooth roof', 'loading awning', 'three sorting bins', 'parcel chute', 'ventilator'],
    {
      roofDark: '#493b36', roof: '#66534a', roofLight: '#9a765b', wallDark: '#9d633a', wall: '#cf8e4f', wallLight: '#e6aa68',
      trim: '#efd18e', window: '#c9eef0', door: '#5d4032', stone: '#807464', metal: '#59676a', accent: '#58a8a1', foliage: '#657c47',
    },
  ),
  workshop: profile(
    'workshop',
    'offset-forge-hall-gear-bay',
    'moss-shingle-half-hip',
    'forge-stack-and-exposed-gear-bay',
    ['river stone', 'moss shingle', 'iron', 'weathered timber'],
    ['forge stack', 'gear window', 'waterwheel dock', 'tool rack', 'iron brace'],
    {
      roofDark: '#354b46', roof: '#4f6c5f', roofLight: '#78947a', wallDark: '#7e5743', wall: '#b87954', wallLight: '#d69a68',
      trim: '#e5c187', window: '#b9e1c0', door: '#513b31', stone: '#687069', metal: '#414c4b', accent: '#d8954c', foliage: '#51744a',
    },
  ),
  library: profile(
    'library',
    'lookout-tower-reading-wing',
    'blue-slate-turret',
    'copper-telescope-and-book-window',
    ['blue slate', 'pale stone', 'dark oak', 'aged copper'],
    ['lookout turret', 'reading bay', 'telescope', 'arched book window', 'copper finial'],
    {
      roofDark: '#394d5e', roof: '#536e82', roofLight: '#8199a7', wallDark: '#9b825e', wall: '#d0af73', wallLight: '#ead08e',
      trim: '#f2dea9', window: '#b9dedd', door: '#584235', stone: '#8b8d83', metal: '#5d8d7f', accent: '#c58f52', foliage: '#5f7c50',
    },
  ),
  hall: profile(
    'hall',
    'broad-civic-hall-central-gable',
    'plum-tile-high-gable',
    'bell-cupola-and-steward-crest',
    ['plum tile', 'timber frame', 'dressed stone', 'brass'],
    ['bell cupola', 'raised central gable', 'civic crest', 'stone stair', 'paired lanterns'],
    {
      roofDark: '#493648', roof: '#704b68', roofLight: '#9a708f', wallDark: '#94684f', wall: '#c58d62', wallLight: '#dfad78',
      trim: '#efd4a1', window: '#f4deb0', door: '#5a3d37', stone: '#91877b', metal: '#c69b52', accent: '#9f5e70', foliage: '#607747',
    },
  ),
  mill: profile(
    'mill',
    'low-river-mill-flume-bay',
    'weathered-green-lean-gable',
    'undershot-wheel-and-timber-flume',
    ['river stone', 'green shingle', 'weathered plank', 'iron axle'],
    ['undershot wheel', 'timber flume', 'stone waterline', 'grain hatch', 'rope pulley'],
    {
      roofDark: '#3c5347', roof: '#58735b', roofLight: '#7f9871', wallDark: '#805840', wall: '#ad7650', wallLight: '#c99461',
      trim: '#dfc18a', window: '#c3e2ca', door: '#553d33', stone: '#6e7770', metal: '#46544d', accent: '#67a5a2', foliage: '#4c7449',
    },
  ),
  'tool-shed': profile(
    'tool-shed',
    'asymmetric-open-bay-lean-to',
    'corrugated-lean-to',
    'open-tool-bay-and-lumber-rack',
    ['cedar plank', 'corrugated metal', 'rope', 'fieldstone'],
    ['open work bay', 'pegboard tools', 'lumber rack', 'lean-to annex', 'coiled rope'],
    {
      roofDark: '#3d5143', roof: '#576c52', roofLight: '#7e8f72', wallDark: '#7c553d', wall: '#ae7b55', wallLight: '#c99968',
      trim: '#dec18c', window: '#dceab6', door: '#4e3a31', stone: '#7d796c', metal: '#66706b', accent: '#d49b50', foliage: '#56764a',
    },
  ),
  orchard: profile(
    'orchard',
    'trellis-rows-proof-house',
    'straw-proof-house-cap',
    'beehive-and-graded-fruit-crates',
    ['living canopy', 'oak trellis', 'straw', 'painted crate'],
    ['six fruit trees', 'proof house', 'beehive', 'trellis arch', 'graded fruit crates'],
    {
      roofDark: '#806037', roof: '#b78b49', roofLight: '#dfbd68', wallDark: '#855d3e', wall: '#bd8652', wallLight: '#dba96b',
      trim: '#f0d08a', window: '#e8efaa', door: '#5e4131', stone: '#7f8068', metal: '#a27846', accent: '#d95f54', foliage: '#4f8149',
    },
  ),
  shrine: profile(
    'shrine',
    'open-pavilion-steep-roof',
    'dark-cedar-steep-pavilion',
    'brass-bell-and-owner-notice-altar',
    ['dark cedar', 'cream paper', 'brass', 'river stone'],
    ['open arch', 'hanging bell', 'notice altar', 'stepping stones', 'paper streamers'],
    {
      roofDark: '#4b3035', roof: '#75424b', roofLight: '#a95d64', wallDark: '#79543d', wall: '#ad7952', wallLight: '#d2a169',
      trim: '#f2dfaa', window: '#fff0bc', door: '#4d332d', stone: '#89857a', metal: '#d3a84d', accent: '#e7d48b', foliage: '#5c7d4c',
    },
  ),
  'source-foundation': profile(
    'source-foundation',
    'subterranean-lineage-plinth',
    'earth-and-stone-cap',
    'exposed-teal-lineage-trace',
    ['fieldstone', 'packed earth', 'root wood', 'teal conduit'],
    ['foundation corners', 'root tendrils', 'lineage conduit', 'source seal', 'inspection hatch'],
    {
      roofDark: '#4f4a3d', roof: '#6c6652', roofLight: '#948a67', wallDark: '#55493b', wall: '#75634b', wallLight: '#9b815d',
      trim: '#c5ac72', window: '#75c9b7', door: '#49392e', stone: '#77786a', metal: '#4f716d', accent: '#63c7b5', foliage: '#4f7147',
    },
  ),
  cottage: profile(
    'cottage',
    'compact-offset-cottage',
    'warm-shingle-gable',
    'corner-lantern-and-window-box',
    ['warm plaster', 'wood shingle', 'oak trim', 'fieldstone'],
    ['offset door', 'window box', 'corner lantern', 'stone step', 'roof finial'],
    {
      roofDark: '#583c34', roof: '#7d5141', roofLight: '#a86c51', wallDark: '#a2764f', wall: '#d7aa6d', wallLight: '#efc788',
      trim: '#f3d99e', window: '#fff0b3', door: '#5f4032', stone: '#807c6e', metal: '#a87342', accent: '#e4b95d', foliage: '#597849',
    },
  ),
});

const EXACT_ARCHETYPES = Object.freeze({
  'aios-service-status': 'hearth',
  'workflow-queue': 'granary',
  'inbox-ingestion-gate': 'sorting',
  'agent-terrarium': 'workshop',
  'building-working-space-viewport': 'library',
  'real-game-constitution': 'hall',
  'event-bus': 'mill',
  'capability-map': 'tool-shed',
  'proof-orchard': 'orchard',
  'owner-ops-shrine': 'shrine',
});

const DISPLAY_LABELS = Object.freeze({
  'inbox-ingestion-gate': 'Sorting Shed',
  'agent-terrarium': 'Waterwheel Works',
  'building-working-space-viewport': 'Lookout Library',
  'real-game-constitution': "Steward's Hall",
  'owner-ops-shrine': 'Ops Shrine',
});

export function resolveBuildingArchetype(building = {}) {
  if (building.kind === 'source_root' || building.visible_as === 'source_root') return 'source-foundation';
  const exact = EXACT_ARCHETYPES[String(building.id || '')];
  if (exact) return exact;
  const text = `${building.id || ''} ${building.title || ''}`.toLowerCase();
  if (text.includes('proof-orchard') || text.includes('orchard')) return 'orchard';
  if (text.includes('workflow') || text.includes('granary') || text.includes('queue')) return 'granary';
  if (text.includes('inbox') || text.includes('sorting') || text.includes('refinery')) return 'sorting';
  if (text.includes('service') || text.includes('hearth')) return 'hearth';
  if (text.includes('mill stream') || text.includes('river mill')) return 'mill';
  if (text.includes('terrarium') || text.includes('workshop')) return 'workshop';
  if (text.includes('library') || text.includes('viewport')) return 'library';
  if (text.includes('constitution') || text.includes('steward')) return 'hall';
  if (text.includes('owner') || text.includes('guide') || text.includes('shrine')) return 'shrine';
  if (text.includes('capability') || text.includes('tool shed')) return 'tool-shed';
  return 'cottage';
}

export function getBuildingArtProfile(building = {}) {
  return BUILDING_ART_PROFILES[resolveBuildingArchetype(building)] || BUILDING_ART_PROFILES.cottage;
}

export function getBuildingDisplayLabel(building = {}) {
  const exact = DISPLAY_LABELS[String(building.id || '')];
  if (exact) return exact;
  const label = String(building.title || building.id || 'Building');
  return label.length <= 17 ? label : `${label.slice(0, 16)}…`;
}

export function getBuildingVisualState(building = {}) {
  const text = `${building.state || ''} ${building.proof?.status || building.proofStatus || ''}`.toLowerCase();
  if (/fail|missing|error|blocked|timeout/.test(text)) return Object.freeze({ tone: 'alert', beacon: '#d95866', windowGlow: '#ef9a8d', trimPulse: true });
  if (/locked|approval_required|hard_gate/.test(text)) return Object.freeze({ tone: 'locked', beacon: '#d69b43', windowGlow: '#e5bf69', trimPulse: false });
  if (/active|running|claimed|source_linked|exists|verified|calm/.test(text)) return Object.freeze({ tone: 'calm', beacon: '#67c8a2', windowGlow: '#ffe99a', trimPulse: false });
  return Object.freeze({ tone: 'watch', beacon: '#e2bd62', windowGlow: '#e8d597', trimPulse: false });
}
