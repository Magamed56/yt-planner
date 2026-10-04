/**
 * Seasonal & special themes. Each re-skins the SAME level data (palette,
 * lighting, particles, music, decorations, Grumbo costume) and adds its own
 * twist: special surfaces (ice, jelly), physics (low gravity in SPACE, floaty
 * UNDERWATER), falling-object looks, lethal-zone looks and module weights.
 */
import type { ThemeDef } from '@engine/theme/ThemeDef';

const BASE_DECOR = (extra: Array<[string, number]>): ThemeDef['decorations'] => extra.map(([kind, weight]) => ({ kind, weight }));

/** NORMAL — a bright, sunny daytime toy factory (the friendliest look). */
export const NORMAL: ThemeDef = {
  id: 'NORMAL',
  name: 'Sunny Factory',
  description: 'Blue skies, clean catwalks and potted plants. What could go wrong?',
  backdrop: 'lab',
  enemyVariant: 'default',
  palette: {
    skyTop: '#4ea8ff', skyHorizon: '#cfeaff', fog: '#bfe1ff',
    floor: '#e9edf5', floorAlt: '#d8dfeb', edge: '#ffb703', wall: '#8ecae6',
    metal: '#adb5bd', pipe: '#fb8500', platform: '#3a86ff', moving: '#06d6a0',
    vanish: '#c77dff', trap: '#ffb703', conveyor: '#495057', bridge: '#d4a373',
    hazard: '#ef233c', stripe: '#212529', laser: '#ff006e', danger: '#ef233c',
    accent: '#ffd23f', accent2: '#06d6a0', checkpoint: '#38b000', finish: '#ffffff',
    coin: '#ffd700', pillar: '#6c8ead', abyss: '#89c2d9',
    decor: ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'],
  },
  lighting: {
    hemiSky: '#ffffff', hemiGround: '#9bb7d4', hemiIntensity: 1.35,
    sunColor: '#fff7e6', sunIntensity: 2.6, sunDir: [-0.4, 1, 0.25],
    ambient: 0.2, exposure: 1.0, fogNear: 60, fogFar: 190,
  },
  particles: { kind: 'sparkles', color: '#ffffff', density: 0.25, speed: 0.3 },
  music: { bpm: 132, root: 48, scale: 'major', lead: 'square', bass: 'triangle', kit: 'soft', bounce: 0.9 },
  decorations: BASE_DECOR([['plant', 3], ['tree', 2], ['crate', 2], ['barrel', 1], ['lamp', 1], ['sign', 1], ['gear', 1]]),
  special: { fallerStyle: 'crate', zoneStyle: 'water' },
};

/** NIGHT — the night shift: dark navy, neon edges, street lamps, laser heavy. */
export const NIGHT: ThemeDef = {
  id: 'NIGHT',
  name: 'Night Shift',
  description: 'The factory never sleeps. Neither does Grumbo.',
  backdrop: 'night',
  enemyVariant: 'NIGHT',
  palette: {
    skyTop: '#05061a', skyHorizon: '#27215a', fog: '#1b1940',
    floor: '#2b3252', floorAlt: '#252b47', edge: '#00f5d4', wall: '#323a63',
    metal: '#6c7aa6', pipe: '#f15bb5', platform: '#4361ee', moving: '#00bbf9',
    vanish: '#9b5de5', trap: '#fee440', conveyor: '#151829', bridge: '#7b6d8d',
    hazard: '#ff4d6d', stripe: '#0b0c18', laser: '#ff2e63', danger: '#ff3b5c',
    accent: '#fee440', accent2: '#00f5d4', checkpoint: '#00f59b', finish: '#ffffff',
    coin: '#ffe45e', pillar: '#1f2442', abyss: '#060714',
    decor: ['#f15bb5', '#00bbf9', '#fee440', '#9b5de5', '#00f5d4'],
  },
  lighting: {
    hemiSky: '#8fa3ff', hemiGround: '#1a1433', hemiIntensity: 0.75,
    sunColor: '#b8c6ff', sunIntensity: 1.5, sunDir: [0.35, 1, -0.3],
    ambient: 0.12, exposure: 1.15, fogNear: 35, fogFar: 125,
  },
  particles: { kind: 'sparkles', color: '#9bf6ff', density: 0.35, speed: 0.25 },
  music: { bpm: 118, root: 43, scale: 'minor', lead: 'sawtooth', bass: 'square', kit: 'electro', bounce: 0.5 },
  decorations: BASE_DECOR([['neonSign', 3], ['streetLamp', 2], ['beacon', 2], ['pipe', 2], ['crate', 1], ['alarmLight', 1], ['vent', 1]]),
  special: { fallerStyle: 'barrel', zoneStyle: 'electric', moduleWeights: { LASER: 1.7, CRUSHER: 1.1 } },
};

/** WINTER — the frozen plant: snow, ice floors that slide, snowball rollers. */
export const WINTER: ThemeDef = {
  id: 'WINTER',
  name: 'Frozen Plant',
  description: 'Everything is frozen — especially the floor. Mind the slide!',
  backdrop: 'snow',
  enemyVariant: 'WINTER',
  palette: {
    skyTop: '#7aa6d8', skyHorizon: '#eaf4ff', fog: '#dceaf7',
    floor: '#e8f1fa', floorAlt: '#d5e5f3', edge: '#4cc9f0', wall: '#9db4cc',
    metal: '#a9bcd0', pipe: '#e63946', platform: '#5aa9e6', moving: '#7fd1ae',
    vanish: '#b8c0ff', trap: '#ffb4a2', conveyor: '#4a5a6a', bridge: '#b08968',
    hazard: '#e63946', stripe: '#1d3557', laser: '#ff006e', danger: '#e63946',
    accent: '#4cc9f0', accent2: '#ffffff', checkpoint: '#2ec27e', finish: '#ffffff',
    coin: '#ffd700', pillar: '#7d93ad', abyss: '#a8c5e0',
    decor: ['#e63946', '#457b9d', '#a8dadc', '#f1faee', '#1d3557'],
  },
  lighting: {
    hemiSky: '#f0f7ff', hemiGround: '#8aa4bf', hemiIntensity: 1.3,
    sunColor: '#ffffff', sunIntensity: 2.2, sunDir: [-0.3, 1, 0.45],
    ambient: 0.22, exposure: 0.98, fogNear: 40, fogFar: 140,
  },
  particles: { kind: 'snow', color: '#ffffff', density: 1, speed: 0.6 },
  music: { bpm: 120, root: 50, scale: 'pentatonic', lead: 'triangle', bass: 'sine', kit: 'soft', bounce: 0.6 },
  decorations: BASE_DECOR([['snowPile', 3], ['pineTree', 3], ['iceCrystal', 2], ['snowman', 1], ['lamp', 1], ['crate', 1]]),
  special: { floorSurface: 'ice', floorSurfaceChance: 0.3, fallerStyle: 'snowball', zoneStyle: 'water', moduleWeights: { NARROW_BRIDGE: 1.3, CONVEYOR: 0.5 } },
};

/** CANDY — the candy works: pastel sugar, bouncy jelly floors, spinning lollipops. */
export const CANDY: ThemeDef = {
  id: 'CANDY',
  name: 'Candy Works',
  description: 'Sweet, sticky and bouncy. Grumbo has a sugar rush.',
  backdrop: 'candy',
  enemyVariant: 'CANDY',
  palette: {
    skyTop: '#ff9ecf', skyHorizon: '#ffe5f1', fog: '#ffd1e8',
    floor: '#ffd6e8', floorAlt: '#ffc2dd', edge: '#ff5d8f', wall: '#cdb4db',
    metal: '#bde0fe', pipe: '#ff5d8f', platform: '#80ed99', moving: '#48cae4',
    vanish: '#c77dff', trap: '#ffbe0b', conveyor: '#8d6e97', bridge: '#f4a261',
    hazard: '#ff006e', stripe: '#6a4c93', laser: '#ff006e', danger: '#ff006e',
    accent: '#ffbe0b', accent2: '#48cae4', checkpoint: '#38b000', finish: '#ffffff',
    coin: '#ffd700', pillar: '#b28dff', abyss: '#ffb3d9',
    decor: ['#ff5d8f', '#ffbe0b', '#80ed99', '#48cae4', '#c77dff'],
  },
  lighting: {
    hemiSky: '#fff0f8', hemiGround: '#c49bbb', hemiIntensity: 1.35,
    sunColor: '#fff2e0', sunIntensity: 2.3, sunDir: [-0.45, 1, 0.2],
    ambient: 0.2, exposure: 1.0, fogNear: 50, fogFar: 160,
  },
  particles: { kind: 'sparkles', color: '#fff3b0', density: 0.6, speed: 0.4 },
  music: { bpm: 140, root: 52, scale: 'major', lead: 'square', bass: 'triangle', kit: 'jingle', bounce: 1 },
  decorations: BASE_DECOR([['lollipop', 3], ['gumdrop', 3], ['candyCane', 2], ['cupcake', 2]]),
  special: { floorSurface: 'jelly', floorSurfaceChance: 0.12, fallerStyle: 'candy', zoneStyle: 'syrup', moduleWeights: { SPINNER: 1.3, DISAPPEARING_PLATFORM: 1.3 } },
};

/** UNDERWATER — the sunken factory: floaty jumps, coral, bubbles, electric eels. */
export const UNDERWATER: ThemeDef = {
  id: 'UNDERWATER',
  name: 'Sunken Factory',
  description: 'Twenty thousand leagues under the conveyor belt. Floaty jumps!',
  backdrop: 'underwater',
  enemyVariant: 'UNDERWATER',
  palette: {
    skyTop: '#03256c', skyHorizon: '#2ec4b6', fog: '#137c8b',
    floor: '#e9d8a6', floorAlt: '#dcc48e', edge: '#ffb703', wall: '#2a6f97',
    metal: '#89c2d9', pipe: '#ee6c4d', platform: '#ff7f50', moving: '#90e0ef',
    vanish: '#b5e48c', trap: '#ffb703', conveyor: '#1b3a4b', bridge: '#a98467',
    hazard: '#ef476f', stripe: '#0b2545', laser: '#ff477e', danger: '#ef476f',
    accent: '#ffd166', accent2: '#90e0ef', checkpoint: '#52b788', finish: '#ffffff',
    coin: '#ffd700', pillar: '#1f4e5f', abyss: '#012a4a',
    decor: ['#ff7f50', '#ff9fb2', '#c77dff', '#ffd166', '#2a9d8f'],
  },
  lighting: {
    hemiSky: '#a8f0ff', hemiGround: '#0b3954', hemiIntensity: 1.1,
    sunColor: '#c8fff4', sunIntensity: 1.8, sunDir: [0.1, 1, 0.2],
    ambient: 0.2, exposure: 1.05, fogNear: 22, fogFar: 105,
  },
  particles: { kind: 'bubbles', color: '#dff9ff', density: 0.9, speed: 0.5 },
  music: { bpm: 100, root: 45, scale: 'dorian', lead: 'sine', bass: 'triangle', kit: 'soft', bounce: 0.4 },
  decorations: BASE_DECOR([['coral', 3], ['seaweed', 3], ['shell', 2], ['treasureChest', 1], ['barrel', 1]]),
  // floaty jumps; range stays within ~+12 % of the reference (generator fairness rule)
  physics: { gravityScale: 0.8 },
  special: { fallerStyle: 'shell', zoneStyle: 'electric', moduleWeights: { MOVING_PLATFORM: 1.3, CONVEYOR: 0.6 } },
};

/** VOLCANO — the lava foundry: basalt, embers, meteor showers, lava pits. */
export const VOLCANO: ThemeDef = {
  id: 'VOLCANO',
  name: 'Lava Foundry',
  description: 'The furnace is the whole mountain. The floor is (actually) lava.',
  backdrop: 'volcano',
  enemyVariant: 'VOLCANO',
  palette: {
    skyTop: '#2b0a0a', skyHorizon: '#ff6b35', fog: '#7a2e1d',
    floor: '#4a3c3c', floorAlt: '#3f3333', edge: '#ff9f1c', wall: '#5c4033',
    metal: '#8d7b70', pipe: '#ff6d00', platform: '#9a8c98', moving: '#f4a261',
    vanish: '#e5989b', trap: '#ffb703', conveyor: '#231a1a', bridge: '#7f5539',
    hazard: '#ff2a00', stripe: '#1a1010', laser: '#ffea00', danger: '#ff3b30',
    accent: '#ffb703', accent2: '#ff6d00', checkpoint: '#70e000', finish: '#ffffff',
    coin: '#ffd700', pillar: '#2e2222', abyss: '#ff4800',
    decor: ['#ff6d00', '#3b2f2f', '#9d0208', '#ffba08', '#6a040f'],
  },
  lighting: {
    hemiSky: '#ffd0a8', hemiGround: '#5a1f12', hemiIntensity: 1.05,
    sunColor: '#ffb27a', sunIntensity: 2.4, sunDir: [-0.5, 1, -0.2],
    ambient: 0.16, exposure: 1.05, fogNear: 35, fogFar: 130,
  },
  particles: { kind: 'embers', color: '#ffa94d', density: 0.9, speed: 0.7 },
  music: { bpm: 136, root: 40, scale: 'phrygian', lead: 'sawtooth', bass: 'sawtooth', kit: 'tribal', bounce: 0.55 },
  decorations: BASE_DECOR([['lavaRock', 3], ['obsidianSpike', 2], ['lavaVent', 2], ['pipe', 1], ['lamp', 1]]),
  special: { fallerStyle: 'meteor', zoneStyle: 'lava', moduleWeights: { FALLING_OBJECT: 1.6, CRUSHER: 1.2 } },
};

/** SPACE — the orbital plant: low gravity, starfield, meteors, glowing crystals. */
export const SPACE: ThemeDef = {
  id: 'SPACE',
  name: 'Orbital Plant',
  description: 'A factory in orbit. Low gravity, high stakes.',
  backdrop: 'space',
  enemyVariant: 'SPACE',
  palette: {
    skyTop: '#000004', skyHorizon: '#2a1b4d', fog: '#140c2b',
    floor: '#d7dbe8', floorAlt: '#c3c8d9', edge: '#7b2cbf', wall: '#4a4e69',
    metal: '#9aa5c0', pipe: '#4cc9f0', platform: '#7209b7', moving: '#4cc9f0',
    vanish: '#f72585', trap: '#ffb703', conveyor: '#22223b', bridge: '#8d99ae',
    hazard: '#f72585', stripe: '#10002b', laser: '#ff0a54', danger: '#ff0a54',
    accent: '#4cc9f0', accent2: '#b8f2e6', checkpoint: '#57cc99', finish: '#ffffff',
    coin: '#ffd700', pillar: '#2b2d42', abyss: '#03001c',
    decor: ['#4cc9f0', '#7209b7', '#f72585', '#b8f2e6', '#ffd166'],
  },
  lighting: {
    hemiSky: '#c8b6ff', hemiGround: '#100b26', hemiIntensity: 0.9,
    sunColor: '#ffffff', sunIntensity: 2.8, sunDir: [0.6, 0.8, 0.3],
    ambient: 0.14, exposure: 1.08, fogNear: 60, fogFar: 200,
  },
  particles: { kind: 'stars', color: '#ffffff', density: 0.7, speed: 0.15 },
  music: { bpm: 124, root: 46, scale: 'minor', lead: 'sawtooth', bass: 'square', kit: 'electro', bounce: 0.45 },
  decorations: BASE_DECOR([['antenna', 2], ['satDish', 2], ['crystal', 3], ['beacon', 1], ['crate', 1]]),
  // floaty, but jump RANGE stays within ~+12 % of the reference (generator fairness rule)
  physics: { gravityScale: 0.6, speedMul: 0.86 },
  special: { fallerStyle: 'meteor', zoneStyle: 'void', moduleWeights: { JUMP: 1.4, MOVING_PLATFORM: 1.3 } },
};

/** HALLOWEEN — the haunted factory: dusk purple, pumpkins, tombstones, trapdoors. */
export const HALLOWEEN: ThemeDef = {
  id: 'HALLOWEEN',
  name: 'Haunted Factory',
  description: 'Pumpkins glow, candles flicker and Grumbo wears a witch hat. Spooky (but friendly)!',
  backdrop: 'spooky',
  enemyVariant: 'HALLOWEEN',
  palette: {
    skyTop: '#1a0b2e', skyHorizon: '#ff7b00', fog: '#4a2650',
    floor: '#3d3450', floorAlt: '#352d46', edge: '#ff8500', wall: '#4b3a63',
    metal: '#7d6b91', pipe: '#7cb518', platform: '#6f2dbd', moving: '#ff8500',
    vanish: '#b5179e', trap: '#7cb518', conveyor: '#1e1529', bridge: '#6b4f3a',
    hazard: '#ff4800', stripe: '#120a1c', laser: '#7cff4f', danger: '#ff3b30',
    accent: '#ff8500', accent2: '#7cff4f', checkpoint: '#7cff4f', finish: '#ffffff',
    coin: '#ffd700', pillar: '#2a1f38', abyss: '#12081f',
    decor: ['#ff8500', '#6f2dbd', '#7cb518', '#2b2033', '#ffd166'],
  },
  lighting: {
    hemiSky: '#d0a6ff', hemiGround: '#2b1236', hemiIntensity: 0.9,
    sunColor: '#ffb070', sunIntensity: 1.9, sunDir: [-0.6, 0.8, 0.4],
    ambient: 0.14, exposure: 1.1, fogNear: 30, fogFar: 120,
  },
  particles: { kind: 'leaves', color: '#ff8c1a', density: 0.7, speed: 0.5 },
  music: { bpm: 112, root: 45, scale: 'harmonicMinor', lead: 'triangle', bass: 'square', kit: 'spooky', bounce: 0.65 },
  decorations: BASE_DECOR([['pumpkin', 3], ['tombstone', 2], ['deadTree', 2], ['candle', 2], ['barrel', 1]]),
  special: { fallerStyle: 'pumpkin', zoneStyle: 'acid', moduleWeights: { TRAP: 1.5, DOOR: 1.3 } },
};

/** CHRISTMAS — the toy workshop: festive red/green, presents, trees, assembly lines. */
export const CHRISTMAS: ThemeDef = {
  id: 'CHRISTMAS',
  name: 'Toy Workshop',
  description: 'The toy workshop runs at full speed. Presents everywhere — some of them falling.',
  backdrop: 'xmas',
  enemyVariant: 'CHRISTMAS',
  palette: {
    skyTop: '#0b1d3a', skyHorizon: '#5e7ab8', fog: '#3b4f7a',
    floor: '#f1f3f8', floorAlt: '#e3e7f0', edge: '#e63946', wall: '#2d6a4f',
    metal: '#c0c7d6', pipe: '#e63946', platform: '#e63946', moving: '#2a9d8f',
    vanish: '#ffd166', trap: '#ffd166', conveyor: '#3d2c2e', bridge: '#9c6644',
    hazard: '#d00000', stripe: '#1b4332', laser: '#ff006e', danger: '#d00000',
    accent: '#ffd166', accent2: '#2a9d8f', checkpoint: '#2ec27e', finish: '#ffffff',
    coin: '#ffd700', pillar: '#1b4332', abyss: '#0a1428',
    decor: ['#e63946', '#2a9d8f', '#ffd166', '#f1faee', '#4361ee'],
  },
  lighting: {
    hemiSky: '#e0ecff', hemiGround: '#24324f', hemiIntensity: 1.05,
    sunColor: '#fff4e0', sunIntensity: 2.1, sunDir: [-0.35, 1, 0.35],
    ambient: 0.18, exposure: 1.08, fogNear: 40, fogFar: 140,
  },
  particles: { kind: 'snow', color: '#ffffff', density: 0.8, speed: 0.45 },
  music: { bpm: 132, root: 50, scale: 'major', lead: 'square', bass: 'triangle', kit: 'jingle', bounce: 0.85 },
  decorations: BASE_DECOR([['xmasTree', 3], ['present', 3], ['candyCane', 2], ['snowman', 1], ['lamp', 1]]),
  special: { fallerStyle: 'present', zoneStyle: 'water', moduleWeights: { CONVEYOR: 1.5, FALLING_OBJECT: 1.3 } },
};
