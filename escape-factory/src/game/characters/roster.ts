/**
 * ESCAPE FACTORY character roster. Pure data: adding a character never touches
 * gameplay code. All models face +Z with feet at y = 0 (≈1.4 m tall).
 */
import type { CharacterDef } from '@engine/character/CharacterDef';
import { DEFAULT_ANIM } from '@engine/character/CharacterDef';
import type { ModelPart } from '@engine/character/ModelSpec';

/** Shared limb rig: arms pivot at shoulders, legs at hips. */
function limbs(o: {
  arm: string;
  hand: string;
  leg: string;
  boot: string;
  shoulderY: number;
  shoulderX: number;
  hipX: number;
  hipY: number;
  armLen?: number;
  legLen?: number;
  thick?: number;
}): ModelPart[] {
  const al = o.armLen ?? 0.26;
  const ll = o.legLen ?? 0.14;
  const th = o.thick ?? 0.075;
  return [
    { name: 'armL', shape: 'capsule', size: [th, al, 0], pos: [o.shoulderX, o.shoulderY, 0], offset: [0, -al / 2 - 0.04, 0], color: o.arm, rot: [0, 0, 0.12] },
    { parent: 'armL', shape: 'sphere', size: [0.09, 0.09, 0.09], pos: [0, -al - 0.1, 0], color: o.hand, noShadow: true },
    { name: 'armR', shape: 'capsule', size: [th, al, 0], pos: [-o.shoulderX, o.shoulderY, 0], offset: [0, -al / 2 - 0.04, 0], color: o.arm, rot: [0, 0, -0.12] },
    { parent: 'armR', shape: 'sphere', size: [0.09, 0.09, 0.09], pos: [0, -al - 0.1, 0], color: o.hand, noShadow: true },
    { name: 'legL', shape: 'capsule', size: [th + 0.02, ll, 0], pos: [o.hipX, o.hipY, 0], offset: [0, -ll / 2 - 0.05, 0], color: o.leg },
    { parent: 'legL', shape: 'roundBox', size: [0.18, 0.1, 0.26], pos: [0, -ll - 0.1, 0.04], color: o.boot },
    { name: 'legR', shape: 'capsule', size: [th + 0.02, ll, 0], pos: [-o.hipX, o.hipY, 0], offset: [0, -ll / 2 - 0.05, 0], color: o.leg },
    { parent: 'legR', shape: 'roundBox', size: [0.18, 0.1, 0.26], pos: [0, -ll - 0.1, 0.04], color: o.boot },
  ];
}

/** Big cartoon eyes on a face plane at z. */
function eyes(y: number, z: number, spacing: number, size = 0.065, color = '#15171f'): ModelPart[] {
  return [
    { name: 'eyeL', parent: 'head', shape: 'sphere', size: [size, size * 1.25, size * 0.7], pos: [spacing, y, z], color, roughness: 0.2, noShadow: true },
    { name: 'eyeR', parent: 'head', shape: 'sphere', size: [size, size * 1.25, size * 0.7], pos: [-spacing, y, z], color, roughness: 0.2, noShadow: true },
    { parent: 'eyeL', shape: 'sphere', size: [size * 0.32, size * 0.32, size * 0.32], pos: [size * 0.3, size * 0.45, size * 0.5], color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, noShadow: true },
    { parent: 'eyeR', shape: 'sphere', size: [size * 0.32, size * 0.32, size * 0.32], pos: [size * 0.3, size * 0.45, size * 0.5], color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, noShadow: true },
  ];
}

/** PIP — the factory intern. Teal bean, yellow hard hat, headlamp, huge eyes. */
export const PIP: CharacterDef = {
  id: 'pip',
  name: 'Pip',
  description: 'Factory intern on day one. Tiny, brave, terrible sense of direction.',
  color: '#19c3b0',
  unlockCost: 0,
  voice: { pitch: 1.0, type: 'squeak' },
  anim: { ...DEFAULT_ANIM, bob: 0.07, waddle: 0.06 },
  model: {
    parts: [
      { name: 'body', shape: 'capsule', size: [0.38, 0.5, 0], pos: [0, 0.78, 0], color: '#19c3b0', roughness: 0.55 },
      { name: 'head', shape: 'box', size: [0.01, 0.01, 0.01], pos: [0, 1.0, 0], color: '#19c3b0', noShadow: true },
      { parent: 'body', shape: 'sphere', size: [0.27, 0.23, 0.14], pos: [0, 0.2, 0.27], color: '#ffe8c4', roughness: 0.6 },
      ...eyes(0, 0.41, 0.095),
      { parent: 'body', shape: 'disc', size: [0.035, 0, 0], pos: [0.18, 0.13, 0.36], rot: [0, 0.5, 0], color: '#ff8fa3', noShadow: true },
      { parent: 'body', shape: 'disc', size: [0.035, 0, 0], pos: [-0.18, 0.13, 0.36], rot: [0, -0.5, 0], color: '#ff8fa3', noShadow: true },
      { parent: 'body', shape: 'roundBox', size: [0.3, 0.16, 0.06], pos: [0, -0.18, 0.35], color: '#0f8f82' },
      { parent: 'body', shape: 'cylinder', size: [0.392, 0.392, 0.07], pos: [0, -0.08, 0], color: '#2d3142' },
      { name: 'hat', parent: 'body', shape: 'sphere', size: [0.41, 0.3, 0.41], pos: [0, 0.48, 0], color: '#ffcc1f', roughness: 0.35 },
      { parent: 'hat', shape: 'cylinder', size: [0.47, 0.47, 0.04], pos: [0, -0.02, 0.03], color: '#ffcc1f', roughness: 0.35 },
      { parent: 'hat', shape: 'cylinder', size: [0.07, 0.07, 0.12], pos: [0, 0.12, 0.36], rot: [Math.PI / 2, 0, 0], color: '#fff6c8', emissive: '#fff1a8', emissiveIntensity: 1.2, noShadow: true },
      ...limbs({ arm: '#13a596', hand: '#ffe8c4', leg: '#2d3142', boot: '#e85d2a', shoulderY: 0.78, shoulderX: 0.4, hipX: 0.15, hipY: 0.32 }),
    ],
  },
};

/** BOLT — boxy robot with a screen face. */
export const ROBOT: CharacterDef = {
  id: 'robot',
  name: 'Bolt',
  description: 'Retired assembly-line robot. Slightly slower, jumps on hydraulics.',
  color: '#8fa7c9',
  unlockCost: 40,
  voice: { pitch: 0.8, type: 'beep' },
  statMods: { runSpeed: 0.96, jumpVelocity: 1.03 },
  anim: { ...DEFAULT_ANIM, bob: 0.03, waddle: 0.0, lean: 0.08, squash: 0.08 },
  model: {
    parts: [
      { name: 'body', shape: 'roundBox', size: [0.62, 0.55, 0.45], pos: [0, 0.62, 0], color: '#8fa7c9', metalness: 0.5, roughness: 0.35 },
      { name: 'head', shape: 'roundBox', size: [0.55, 0.42, 0.45], pos: [0, 1.14, 0], color: '#a9bedc', metalness: 0.5, roughness: 0.3 },
      { parent: 'head', shape: 'roundBox', size: [0.44, 0.28, 0.04], pos: [0, 0, 0.22], color: '#10161f', roughness: 0.15 },
      { name: 'eyeL', parent: 'head', shape: 'box', size: [0.09, 0.09, 0.02], pos: [0.1, 0.02, 0.25], color: '#42f5e0', emissive: '#42f5e0', emissiveIntensity: 2, noShadow: true },
      { name: 'eyeR', parent: 'head', shape: 'box', size: [0.09, 0.09, 0.02], pos: [-0.1, 0.02, 0.25], color: '#42f5e0', emissive: '#42f5e0', emissiveIntensity: 2, noShadow: true },
      { parent: 'head', shape: 'cylinder', size: [0.02, 0.02, 0.25], pos: [0, 0.32, 0], color: '#555' },
      { parent: 'head', shape: 'sphere', size: [0.06, 0.06, 0.06], pos: [0, 0.46, 0], color: '#ff3b3b', emissive: '#ff3b3b', emissiveIntensity: 1.5 },
      { parent: 'body', shape: 'cylinder', size: [0.1, 0.1, 0.05], pos: [0, 0.05, 0.23], rot: [Math.PI / 2, 0, 0], color: '#ffb000', emissive: '#ffb000', emissiveIntensity: 0.6 },
      ...limbs({ arm: '#6d84a6', hand: '#3b4a60', leg: '#55657e', boot: '#3b4a60', shoulderY: 0.82, shoulderX: 0.38, hipX: 0.17, hipY: 0.34, thick: 0.08 }),
    ],
  },
};

/** MITTENS — factory cat. */
export const CAT: CharacterDef = {
  id: 'cat',
  name: 'Mittens',
  description: 'The factory cat. Fast paws, zero respect for safety rules.',
  color: '#ff9f43',
  unlockCost: 60,
  voice: { pitch: 1.35, type: 'meow' },
  statMods: { runSpeed: 1.04, jumpVelocity: 1.0 },
  anim: { ...DEFAULT_ANIM, bob: 0.05, lean: 0.25, waddle: 0.02 },
  model: {
    parts: [
      { name: 'body', shape: 'capsule', size: [0.32, 0.35, 0], pos: [0, 0.66, 0], color: '#ff9f43' },
      { parent: 'body', shape: 'sphere', size: [0.22, 0.25, 0.12], pos: [0, -0.05, 0.24], color: '#fff3e0' },
      { name: 'head', shape: 'sphere', size: [0.36, 0.31, 0.32], pos: [0, 1.12, 0.02], color: '#ff9f43' },
      { parent: 'head', shape: 'cone', size: [0.11, 0.2, 0], pos: [0.2, 0.28, 0], rot: [0, 0, -0.35], color: '#ff9f43' },
      { parent: 'head', shape: 'cone', size: [0.11, 0.2, 0], pos: [-0.2, 0.28, 0], rot: [0, 0, 0.35], color: '#ff9f43' },
      { parent: 'head', shape: 'cone', size: [0.06, 0.12, 0], pos: [0.2, 0.27, 0.03], rot: [0, 0, -0.35], color: '#ffc4d0' },
      { parent: 'head', shape: 'cone', size: [0.06, 0.12, 0], pos: [-0.2, 0.27, 0.03], rot: [0, 0, 0.35], color: '#ffc4d0' },
      { parent: 'head', shape: 'sphere', size: [0.2, 0.13, 0.1], pos: [0, -0.1, 0.25], color: '#fff3e0' },
      { parent: 'head', shape: 'sphere', size: [0.035, 0.03, 0.03], pos: [0, -0.04, 0.34], color: '#ff6f91' },
      ...eyes(0.04, 0.28, 0.12, 0.06, '#1d3b2a'),
      { name: 'tail', shape: 'capsule', size: [0.06, 0.45, 0], pos: [0, 0.55, -0.28], rot: [-0.9, 0, 0], offset: [0, 0.25, 0], color: '#ff9f43' },
      ...limbs({ arm: '#ff9f43', hand: '#fff3e0', leg: '#ff9f43', boot: '#fff3e0', shoulderY: 0.78, shoulderX: 0.33, hipX: 0.14, hipY: 0.34 }),
    ],
  },
};

/** TICK-TOCK — wind-up tin toy with a key on its back. */
export const TOY: CharacterDef = {
  id: 'toy',
  name: 'Tick-Tock',
  description: 'A wind-up tin soldier that escaped the toy line. Never stops ticking.',
  color: '#e63946',
  unlockCost: 80,
  voice: { pitch: 1.1, type: 'boing' },
  anim: { ...DEFAULT_ANIM, bob: 0.02, legSwing: 0.6, armSwing: 0.4, waddle: 0.08, lean: 0.05, squash: 0.12 },
  model: {
    parts: [
      { name: 'body', shape: 'cylinder', size: [0.3, 0.33, 0.6], pos: [0, 0.68, 0], color: '#e63946', metalness: 0.4, roughness: 0.35 },
      { parent: 'body', shape: 'cylinder', size: [0.335, 0.335, 0.06], pos: [0, -0.15, 0], color: '#ffd166', metalness: 0.6, roughness: 0.3 },
      { parent: 'body', shape: 'sphere', size: [0.045, 0.045, 0.045], pos: [0, 0.12, 0.3], color: '#ffd166', metalness: 0.6 },
      { parent: 'body', shape: 'sphere', size: [0.045, 0.045, 0.045], pos: [0, 0.0, 0.31], color: '#ffd166', metalness: 0.6 },
      { name: 'head', shape: 'sphere', size: [0.27, 0.27, 0.27], pos: [0, 1.15, 0], color: '#ffe0bd' },
      { name: 'hat', parent: 'head', shape: 'cylinder', size: [0.24, 0.27, 0.38], pos: [0, 0.3, 0], color: '#1d3557' },
      { parent: 'hat', shape: 'sphere', size: [0.07, 0.07, 0.07], pos: [0, 0.22, 0.12], color: '#ffd166', metalness: 0.7 },
      { parent: 'head', shape: 'disc', size: [0.05, 0, 0], pos: [0.14, -0.06, 0.23], rot: [0, 0.5, 0], color: '#ff6b6b', noShadow: true },
      { parent: 'head', shape: 'disc', size: [0.05, 0, 0], pos: [-0.14, -0.06, 0.23], rot: [0, -0.5, 0], color: '#ff6b6b', noShadow: true },
      ...eyes(0.03, 0.24, 0.09, 0.045),
      { name: 'tail', shape: 'torus', size: [0.12, 0.03, 0], pos: [0, 0.75, -0.42], color: '#ffd166', metalness: 0.8, roughness: 0.25 },
      { parent: 'tail', shape: 'cylinder', size: [0.03, 0.03, 0.18], pos: [0, 0, 0.1], rot: [Math.PI / 2, 0, 0], color: '#ffd166', metalness: 0.8 },
      ...limbs({ arm: '#e63946', hand: '#ffffff', leg: '#1d3557', boot: '#111111', shoulderY: 0.86, shoulderX: 0.36, hipX: 0.14, hipY: 0.38 }),
    ],
  },
};

/** CRUMBS — a brave chocolate-chip cookie. */
export const COOKIE: CharacterDef = {
  id: 'cookie',
  name: 'Crumbs',
  description: 'A fresh-baked cookie that refused to be packaged. Slightly crumbly.',
  color: '#d4a373',
  unlockCost: 100,
  voice: { pitch: 1.2, type: 'crunch' },
  anim: { ...DEFAULT_ANIM, bob: 0.08, waddle: 0.1, lean: 0.1, squash: 0.28 },
  model: {
    parts: [
      { name: 'body', shape: 'cylinder', size: [0.5, 0.5, 0.2], pos: [0, 0.82, 0], rot: [Math.PI / 2, 0, 0], color: '#d4a373', roughness: 0.9 },
      { name: 'head', shape: 'box', size: [0.01, 0.01, 0.01], pos: [0, 0.82, 0], color: '#d4a373', noShadow: true },
      ...[[0.25, 0.2], [-0.3, 0.05], [0.1, -0.25], [-0.15, 0.3], [0.32, -0.12], [-0.28, -0.25]].map(
        ([x, y]): ModelPart => ({ parent: 'body', shape: 'sphere', size: [0.06, 0.05, 0.06], pos: [x, 0.11, y], color: '#4a2c17', noShadow: true }),
      ),
      ...eyes(0.08, 0.11, 0.12, 0.07),
      { parent: 'head', shape: 'torus', size: [0.08, 0.018, 0], pos: [0, -0.1, 0.11], rot: [0, 0, Math.PI], color: '#4a2c17', noShadow: true },
      ...limbs({ arm: '#c08552', hand: '#ffffff', leg: '#c08552', boot: '#7f5539', shoulderY: 0.82, shoulderX: 0.5, hipX: 0.18, hipY: 0.36, armLen: 0.22 }),
    ],
  },
};

/** JACK — a jolly pumpkin. */
export const PUMPKIN: CharacterDef = {
  id: 'pumpkin',
  name: 'Jack',
  description: 'A pumpkin with a candle inside and a grin that never fades.',
  color: '#f77f00',
  unlockCost: 120,
  voice: { pitch: 0.9, type: 'hollow' },
  anim: { ...DEFAULT_ANIM, bob: 0.08, waddle: 0.07, squash: 0.25 },
  model: {
    parts: [
      { name: 'body', shape: 'sphere', size: [0.48, 0.42, 0.46], pos: [0, 0.78, 0], color: '#f77f00', roughness: 0.6 },
      ...[0, 1, 2, 3, 4, 5].map(
        (i): ModelPart => ({
          parent: 'body',
          shape: 'sphere',
          size: [0.18, 0.4, 0.18],
          pos: [Math.sin((i * Math.PI) / 3 + Math.PI / 6) * 0.31, 0, Math.cos((i * Math.PI) / 3 + Math.PI / 6) * 0.31],
          color: '#e36414',
          roughness: 0.6,
        }),
      ),
      { name: 'head', shape: 'box', size: [0.01, 0.01, 0.01], pos: [0, 0.78, 0], color: '#f77f00', noShadow: true },
      { name: 'eyeL', parent: 'head', shape: 'cone', size: [0.07, 0.1, 0], pos: [0.14, 0.1, 0.47], rot: [Math.PI / 2, 0, 0], color: '#ffe066', emissive: '#ffb703', emissiveIntensity: 2, noShadow: true },
      { name: 'eyeR', parent: 'head', shape: 'cone', size: [0.07, 0.1, 0], pos: [-0.14, 0.1, 0.47], rot: [Math.PI / 2, 0, 0], color: '#ffe066', emissive: '#ffb703', emissiveIntensity: 2, noShadow: true },
      { parent: 'head', shape: 'box', size: [0.3, 0.06, 0.05], pos: [0, -0.1, 0.45], color: '#ffe066', emissive: '#ffb703', emissiveIntensity: 2, noShadow: true },
      { name: 'hat', parent: 'body', shape: 'cylinder', size: [0.05, 0.07, 0.2], pos: [0, 0.48, 0], rot: [0.2, 0, 0.1], color: '#386641' },
      { parent: 'hat', shape: 'sphere', size: [0.12, 0.03, 0.08], pos: [0.1, 0.05, 0], color: '#6a994e' },
      ...limbs({ arm: '#386641', hand: '#6a994e', leg: '#386641', boot: '#283618', shoulderY: 0.8, shoulderX: 0.48, hipX: 0.16, hipY: 0.38 }),
    ],
  },
};

/** ZIP — a small three-eyed alien. */
export const ALIEN: CharacterDef = {
  id: 'alien',
  name: 'Zip',
  description: 'Crash-landed on the factory roof. Floaty jumps, very confused.',
  color: '#80ed99',
  unlockCost: 150,
  voice: { pitch: 1.5, type: 'warble' },
  statMods: { jumpVelocity: 1.04, airAccel: 1.08, runSpeed: 0.98 },
  anim: { ...DEFAULT_ANIM, bob: 0.06, waddle: 0.03 },
  model: {
    parts: [
      { name: 'body', shape: 'capsule', size: [0.27, 0.3, 0], pos: [0, 0.62, 0], color: '#80ed99' },
      { name: 'head', shape: 'sphere', size: [0.38, 0.33, 0.35], pos: [0, 1.1, 0], color: '#80ed99' },
      { name: 'eyeL', parent: 'head', shape: 'sphere', size: [0.07, 0.09, 0.05], pos: [0.13, 0.02, 0.31], color: '#111', roughness: 0.1, noShadow: true },
      { name: 'eyeR', parent: 'head', shape: 'sphere', size: [0.07, 0.09, 0.05], pos: [-0.13, 0.02, 0.31], color: '#111', roughness: 0.1, noShadow: true },
      { parent: 'head', shape: 'sphere', size: [0.06, 0.08, 0.05], pos: [0, 0.14, 0.32], color: '#111', roughness: 0.1, noShadow: true },
      { parent: 'head', shape: 'cylinder', size: [0.015, 0.015, 0.3], pos: [0.15, 0.38, 0], rot: [0, 0, -0.3], color: '#57cc99' },
      { parent: 'head', shape: 'cylinder', size: [0.015, 0.015, 0.3], pos: [-0.15, 0.38, 0], rot: [0, 0, 0.3], color: '#57cc99' },
      { parent: 'head', shape: 'sphere', size: [0.05, 0.05, 0.05], pos: [0.2, 0.52, 0], color: '#ff70a6', emissive: '#ff70a6', emissiveIntensity: 1.2 },
      { parent: 'head', shape: 'sphere', size: [0.05, 0.05, 0.05], pos: [-0.2, 0.52, 0], color: '#ff70a6', emissive: '#ff70a6', emissiveIntensity: 1.2 },
      { parent: 'body', shape: 'torus', size: [0.28, 0.04, 0], pos: [0, -0.05, 0], rot: [Math.PI / 2, 0, 0], color: '#c7f9cc', metalness: 0.6 },
      ...limbs({ arm: '#57cc99', hand: '#80ed99', leg: '#57cc99', boot: '#22577a', shoulderY: 0.74, shoulderX: 0.3, hipX: 0.12, hipY: 0.34, thick: 0.06 }),
    ],
  },
};

export const ROSTER: CharacterDef[] = [PIP, ROBOT, CAT, TOY, COOKIE, PUMPKIN, ALIEN];
