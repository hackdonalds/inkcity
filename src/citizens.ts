import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Procedural townsfolk built from the KayKit Adventurers (CC0) parts. All five characters share one
 * 41-joint rig, so arms / body / head / legs / hat / cape can be mixed freely; every part is then
 * recoloured in the shader (clothes hue-shifted, skin kept but toned) and the body is reproportioned.
 */
export type Slot = 'arms' | 'body' | 'head' | 'legs' | 'hat' | 'cape';
export const SLOTS: Slot[] = ['arms', 'body', 'head', 'legs', 'hat', 'cape'];

export interface Look {
  pick: Record<Slot, number>; // index into kit options (-1 = none for hat/cape)
  recol: Record<Slot, [number, number, number, number]>; // hue shift, sat mul, val mul, tint-grey amount
  skin: number; // 0 light … 1 dark
  height: number; build: number; kid: boolean; elder: boolean;
  sig: string;
}

interface SkinPart { meshes: THREE.SkinnedMesh[] }
interface RigidPart { node: THREE.Object3D; bone: string }

const slotOf = (name: string): Slot | null => {
  if (/Arm(Left|Right)$/.test(name)) return 'arms';
  if (/_Body$/.test(name)) return 'body';
  if (/_Head(_Hooded)?$/.test(name)) return 'head';
  if (/Leg(Left|Right)$/.test(name)) return 'legs';
  if (/(Hat|Helmet)$/.test(name)) return 'hat';
  if (/Cape$/.test(name)) return 'cape';
  return null;
};

export class CitizenKit {
  private base!: THREE.Object3D;
  skinned: Record<'arms' | 'body' | 'head' | 'legs', SkinPart[]> = { arms: [], body: [], head: [], legs: [] };
  rigid: Record<'hat' | 'cape', RigidPart[]> = { hat: [], cape: [] };

  constructor(protos: THREE.Object3D[]) {
    this.base = protos[0];
    for (const proto of protos) {
      const groups = new Map<string, THREE.SkinnedMesh[]>();
      proto.traverse((o) => {
        const s = slotOf(o.name);
        if (!s || !(o as THREE.Mesh).isMesh) return;
        if (s === 'hat' || s === 'cape') this.rigid[s].push({ node: o, bone: o.parent!.name });
        else {
          const sm = o as THREE.SkinnedMesh;
          const key = s;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(sm);
        }
      });
      for (const [s, meshes] of groups) {
        const list = this.skinned[s as 'arms'];
        // the hooded rogue shares arms/body/legs with the plain rogue — skip exact duplicates
        if (!list.some((p) => p.meshes[0].geometry === meshes[0].geometry || p.meshes[0].name === meshes[0].name)) list.push({ meshes });
      }
    }
  }

  /** A random look, nudged until its signature is unused. */
  look(rand: () => number, taken: Set<string>, kid = false): Look {
    for (let tries = 0; ; tries++) {
      const pick = {
        arms: Math.floor(rand() * this.skinned.arms.length), body: Math.floor(rand() * this.skinned.body.length),
        head: Math.floor(rand() * this.skinned.head.length), legs: Math.floor(rand() * this.skinned.legs.length),
        hat: rand() < (kid ? 0.25 : 0.4) ? Math.floor(rand() * this.rigid.hat.length) : -1,
        cape: !kid && rand() < 0.45 ? Math.floor(rand() * this.rigid.cape.length) : -1,
      } as Record<Slot, number>;
      const recol = {} as Look['recol'];
      for (const s of SLOTS) recol[s] = [rand(), 0.55 + rand() * 0.75, 0.7 + rand() * 0.45, rand() < 0.6 ? 0.25 + rand() * 0.5 : 0];
      const elder = !kid && rand() < 0.15;
      const lk: Look = {
        pick, recol, skin: rand(), kid, elder,
        height: kid ? 0.55 + rand() * 0.12 : (elder ? 0.88 : 0.92) + rand() * 0.18,
        build: 0.88 + rand() * 0.28, sig: '',
      };
      lk.sig = [SLOTS.map((s) => pick[s]).join('.'), ...SLOTS.map((s) => Math.floor(recol[s][0] * 10)), Math.floor(lk.skin * 4), Math.floor(lk.height * 20)].join('|');
      if (!taken.has(lk.sig) || tries > 30) return lk;
    }
  }

  /** Assemble a citizen. `mat(src, slot, skinned)` makes the material for each part. */
  build(look: Look, mat: (src: THREE.Mesh, slot: Slot, skinned: boolean) => THREE.Material) {
    const root = SkeletonUtils.clone(this.base);
    let skeleton: THREE.Skeleton | null = null, holder: THREE.Object3D | null = null;
    const drop: THREE.Object3D[] = [];
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) { skeleton ??= m.skeleton; holder ??= m.parent; drop.push(m); }
      else if ((m as THREE.Mesh).isMesh) drop.push(m);
    });
    for (const d of drop) d.removeFromParent();
    const byName = new Map<string, THREE.Bone>();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone); });
    void skeleton;
    for (const s of ['arms', 'body', 'head', 'legs'] as const) {
      for (const src of this.skinned[s][look.pick[s]].meshes) {
        const m = new THREE.SkinnedMesh(src.geometry, mat(src, s, true));
        m.name = src.name;
        m.position.copy(src.position); m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
        // each source part carries its own inverse bind matrices (mesh quantization bakes into them),
        // so drive the shared bones through a skeleton that keeps the source's inverses
        const bones = src.skeleton.bones.map((b) => byName.get(b.name) ?? b);
        m.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
        m.frustumCulled = false;
        holder!.add(m);
      }
    }
    for (const s of ['hat', 'cape'] as const) {
      if (look.pick[s] < 0) continue;
      const part = this.rigid[s][look.pick[s]];
      const bone = root.getObjectByName(part.bone);
      if (!bone) continue;
      const m = (part.node as THREE.Mesh).clone() as THREE.Mesh;
      m.material = mat(part.node as THREE.Mesh, s, false);
      m.frustumCulled = false;
      bone.add(m);
    }
    const bones: Record<string, THREE.Bone> = {};
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
    return { root, bones };
  }
}

/** Skin tones from light to deep, multiplied onto the texture's pale skin. */
export function skinTone(t: number) {
  const stops = [[1.02, 0.98, 0.95], [0.95, 0.82, 0.7], [0.8, 0.62, 0.48], [0.6, 0.43, 0.32], [0.42, 0.3, 0.24]];
  const f = Math.min(0.999, Math.max(0, t)) * (stops.length - 1), i = Math.floor(f), k = f - i;
  return new THREE.Vector3(...stops[i].map((v, j) => v + (stops[i + 1][j] - v) * k));
}
