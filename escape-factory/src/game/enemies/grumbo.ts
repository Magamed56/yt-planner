/**
 * GRUMBO — the signature monster of ESCAPE FACTORY.
 *
 * A giant walking furnace with a pressure-gauge eye whose needle swings into
 * the red when he gets excited, a tiny hard hat, a chimney that puffs steam,
 * one claw hand and one plunger hand. Big, a bit silly, always RIGHT behind you.
 * Faces +Z, feet at y = 0, ~4.4 m tall.
 */
import type { EnemyDef } from '@engine/enemy/EnemyDef';
import type { ModelPart } from '@engine/character/ModelSpec';

const BODY = '#ff6b35';
const BODY_DARK = '#d94f1e';
const METAL = '#4a4e69';
const BRASS = '#d4a017';

const rivets: ModelPart[] = [];
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  rivets.push({
    parent: 'body',
    shape: 'sphere',
    size: [0.07, 0.07, 0.07],
    pos: [Math.sin(a) * 1.45, -0.52, Math.cos(a) * 1.4],
    color: BRASS,
    metalness: 0.8,
    roughness: 0.3,
    noShadow: true,
  });
}

const teeth: ModelPart[] = [-0.39, -0.13, 0.13, 0.39].map((x) => ({
  parent: 'jaw',
  shape: 'box',
  size: [0.17, 0.14, 0.08],
  pos: [x, 0.06, 0.18],
  color: '#fffaf0',
  noShadow: true,
}));

export const GRUMBO: EnemyDef = {
  id: 'grumbo',
  name: 'Grumbo',
  description: 'The factory foreman. Runs on coal, hugs, and a strict no-escape policy.',
  color: BODY,
  stats: { speedMul: 1, catchDistance: 1.35, nearDistance: 3.7, height: 4.4, width: 3.0 },
  anim: { stomp: 0.18, armSwing: 0.7, bodySway: 0.08 },
  voice: { pitch: 1, type: 'growl' },
  model: {
    parts: [
      // furnace belly (children are positioned in metres from the belly centre)
      { name: 'body', shape: 'sphere', size: [1.5, 1.38, 1.36], pos: [0, 2.35, 0], color: BODY, roughness: 0.45, metalness: 0.2 },
      { parent: 'body', shape: 'cylinder', size: [1.42, 1.42, 0.28], pos: [0, -0.52, 0], color: '#ffd23f', roughness: 0.5 },
      ...rivets,
      // glowing furnace grate (belly)
      { parent: 'body', shape: 'roundBox', size: [0.75, 0.3, 0.16], pos: [0, -0.82, 1.06], rot: [-0.6, 0, 0], color: '#ff9a1f', emissive: '#ff7b00', emissiveIntensity: 2.2, noShadow: true },
      // gauge eye
      { name: 'eye', parent: 'body', shape: 'cylinder', size: [0.56, 0.56, 0.18], pos: [0, 0.6, 1.14], rot: [Math.PI / 2 - 0.42, 0, 0], color: '#fffaf0', roughness: 0.25 },
      { parent: 'eye', shape: 'torus', size: [0.57, 0.08, 0], pos: [0, 0.07, 0], rot: [Math.PI / 2, 0, 0], color: BRASS, metalness: 0.85, roughness: 0.25 },
      { parent: 'eye', shape: 'cylinder', size: [0.46, 0.46, 0.02], pos: [0, 0.1, 0], color: '#fff0e8', noShadow: true },
      { parent: 'eye', shape: 'box', size: [0.42, 0.03, 0.17], pos: [0.19, 0.11, -0.17], rot: [0, 0.6, 0], color: '#ff3b30', noShadow: true },
      { name: 'gauge', parent: 'eye', shape: 'box', size: [0.055, 0.03, 0.42], pos: [0, 0.13, 0], offset: [0, 0, -0.18], color: '#14141a', noShadow: true },
      { parent: 'eye', shape: 'cylinder', size: [0.08, 0.08, 0.05], pos: [0, 0.14, 0], color: '#14141a', noShadow: true },
      // mouth (jaw opens when roaring)
      { parent: 'body', shape: 'roundBox', size: [1.15, 0.22, 0.36], pos: [0, -0.1, 1.24], rot: [-0.12, 0, 0], color: '#2b1d1a' },
      { name: 'jaw', parent: 'body', shape: 'roundBox', size: [1.08, 0.16, 0.32], pos: [0, -0.27, 1.18], offset: [0, -0.05, 0.08], color: BODY_DARK },
      ...teeth,
      // tiny hard hat
      { name: 'hat', parent: 'body', shape: 'sphere', size: [0.62, 0.36, 0.6], pos: [0, 1.32, 0.05], color: '#ffcc1f', roughness: 0.35 },
      { parent: 'hat', shape: 'cylinder', size: [0.74, 0.74, 0.07], pos: [0, -0.06, 0.07], color: '#ffcc1f', roughness: 0.35 },
      // chimney (steam source)
      { name: 'tail', parent: 'body', shape: 'cylinder', size: [0.3, 0.36, 1.05], pos: [-0.9, 1.15, -0.7], rot: [-0.25, 0, 0.22], color: METAL, metalness: 0.5, roughness: 0.4 },
      { parent: 'tail', shape: 'cylinder', size: [0.41, 0.41, 0.16], pos: [0, 0.56, 0], color: '#2b2d42', metalness: 0.5 },
      // arms: left claw, right plunger
      { name: 'armL', shape: 'capsule', size: [0.26, 1.3, 0], pos: [1.45, 2.85, 0.1], rot: [0, 0, 0.35], offset: [0, -0.85, 0], color: BODY_DARK },
      { parent: 'armL', shape: 'sphere', size: [0.36, 0.3, 0.36], pos: [0, -1.65, 0], color: METAL, metalness: 0.6 },
      { parent: 'armL', shape: 'cone', size: [0.13, 0.55, 0], pos: [0.16, -2.0, 0.05], rot: [0, 0, 2.8], color: '#9aa5b1', metalness: 0.7 },
      { parent: 'armL', shape: 'cone', size: [0.13, 0.55, 0], pos: [-0.16, -2.0, 0.05], rot: [0, 0, -2.8], color: '#9aa5b1', metalness: 0.7 },
      { name: 'armR', shape: 'capsule', size: [0.26, 1.3, 0], pos: [-1.45, 2.85, 0.1], rot: [0, 0, -0.35], offset: [0, -0.85, 0], color: BODY_DARK },
      { parent: 'armR', shape: 'cylinder', size: [0.07, 0.07, 0.55], pos: [0, -1.8, 0], color: '#c49a6c' },
      { parent: 'armR', shape: 'sphere', size: [0.42, 0.28, 0.42], pos: [0, -2.15, 0], color: '#e63946', roughness: 0.4 },
      // stubby legs + boots
      { name: 'legL', shape: 'cylinder', size: [0.38, 0.44, 0.85], pos: [0.7, 1.15, 0], offset: [0, -0.45, 0], color: METAL },
      { parent: 'legL', shape: 'roundBox', size: [0.95, 0.42, 1.25], pos: [0, -0.92, 0.18], color: '#2b2d42' },
      { name: 'legR', shape: 'cylinder', size: [0.38, 0.44, 0.85], pos: [-0.7, 1.15, 0], offset: [0, -0.45, 0], color: METAL },
      { parent: 'legR', shape: 'roundBox', size: [0.95, 0.42, 1.25], pos: [0, -0.92, 0.18], color: '#2b2d42' },
    ],
  },
  themeParts: {
    HALLOWEEN: [
      { parent: 'hat', shape: 'cone', size: [0.55, 1.0, 0], pos: [0, 0.55, 0], rot: [-0.15, 0, 0.1], color: '#2b2033' },
      { parent: 'hat', shape: 'cylinder', size: [0.6, 0.6, 0.08], pos: [0, 0.12, 0], color: '#f77f00' },
    ],
    CHRISTMAS: [
      { parent: 'hat', shape: 'cone', size: [0.6, 1.2, 0], pos: [0, 0.62, -0.12], rot: [-0.45, 0, 0], color: '#d62828' },
      { parent: 'hat', shape: 'torus', size: [0.6, 0.14, 0], pos: [0, 0.08, 0], rot: [Math.PI / 2, 0, 0], color: '#ffffff' },
      { parent: 'hat', shape: 'sphere', size: [0.2, 0.2, 0.2], pos: [0, 1.15, -0.6], color: '#ffffff' },
    ],
    WINTER: [
      { parent: 'body', shape: 'torus', size: [1.25, 0.2, 0], pos: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0], color: '#e63946' },
      { parent: 'body', shape: 'roundBox', size: [0.4, 0.95, 0.14], pos: [0.65, -0.25, 1.15], rot: [0, 0, 0.2], color: '#e63946' },
    ],
    CANDY: [
      { parent: 'hat', shape: 'sphere', size: [0.7, 0.35, 0.68], pos: [0, 0.12, 0], color: '#ff8fab' },
      { parent: 'hat', shape: 'sphere', size: [0.17, 0.17, 0.17], pos: [0, 0.48, 0], color: '#e63946' },
    ],
    UNDERWATER: [
      { parent: 'body', shape: 'torus', size: [0.72, 0.09, 0], pos: [0, 0.62, 1.12], rot: [-0.42, 0, 0], color: BRASS, metalness: 0.9 },
      { parent: 'tail', shape: 'cylinder', size: [0.14, 0.14, 1.0], pos: [0, 1.0, 0], color: '#ffd23f' },
    ],
    SPACE: [
      { parent: 'hat', shape: 'cylinder', size: [0.04, 0.04, 0.9], pos: [0, 0.75, 0], color: '#bbbbbb', metalness: 0.8 },
      { parent: 'hat', shape: 'sphere', size: [0.18, 0.18, 0.18], pos: [0, 1.25, 0], color: '#80ffdb', emissive: '#80ffdb', emissiveIntensity: 2 },
    ],
    VOLCANO: [
      { parent: 'body', shape: 'box', size: [0.14, 1.4, 0.06], pos: [0.95, 0.1, 0.95], rot: [0.3, 0.75, 0.4], color: '#ffb703', emissive: '#ff6d00', emissiveIntensity: 2.5, noShadow: true },
      { parent: 'body', shape: 'box', size: [0.12, 1.1, 0.06], pos: [-1.0, -0.15, 0.92], rot: [0.3, -0.75, -0.5], color: '#ffb703', emissive: '#ff6d00', emissiveIntensity: 2.5, noShadow: true },
    ],
    NIGHT: [
      { parent: 'hat', shape: 'cylinder', size: [0.13, 0.13, 0.25], pos: [0, 0.12, 0.62], rot: [Math.PI / 2, 0, 0], color: '#fff6c8', emissive: '#fff1a8', emissiveIntensity: 2.5, noShadow: true },
    ],
  },
};
