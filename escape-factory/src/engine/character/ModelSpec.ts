/**
 * Data-driven procedural model description shared by characters, enemies and
 * decorations. The renderer turns it into meshes; the animator drives parts by
 * their rig `name`. New characters therefore need data, not code.
 */
export type PartShape = 'box' | 'roundBox' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'torus' | 'disc';

export type RigSlot =
  | 'root'
  | 'body'
  | 'head'
  | 'armL'
  | 'armR'
  | 'legL'
  | 'legR'
  | 'tail'
  | 'eye'
  | 'gauge'
  | 'jaw'
  | 'hat'
  | 'extra';

export interface ModelPart {
  /** rig slot used by the animator; several parts may share a slot only if parented */
  name?: RigSlot | string;
  /** parent part name (default: root) */
  parent?: string;
  shape: PartShape;
  /**
   * Dimensions by shape: box/roundBox [w,h,d]; sphere [rx,ry,rz]; capsule [radius,length,_];
   * cylinder [rTop,rBottom,h]; cone [r,h,_]; torus [R,tube,_]; disc [r,_,_]
   */
  size: [number, number, number];
  pos: [number, number, number];
  rot?: [number, number, number];
  /**
   * When set, `pos` becomes a joint (pivot group) and the mesh is placed at this
   * offset inside it — used for limbs that rotate around shoulders/hips.
   */
  offset?: [number, number, number];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  /** don't cast shadows (tiny details) */
  noShadow?: boolean;
}

export interface ModelSpec {
  parts: ModelPart[];
  /** uniform scale applied to the whole model */
  scale?: number;
}
