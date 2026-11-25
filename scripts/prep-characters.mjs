// Prepares the KayKit Adventurers (CC0, Kay Lousberg) characters for Inkcity:
//  - strips weapons/shields/props so they read as townsfolk
//  - removes animations from the character files
//  - writes one shared clip file (all characters share the same rig), adding tool / leisure clips
//    from KayKit Character Animations 1.1 (Rig_Medium, CC0 — same bone names, minus the IK helpers)
// usage: node scripts/prep-characters.mjs [dir with KayKit Adventurers .glb files] [dir with the 1.1 Rig_Medium .glb files]
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample, quantize, meshopt } from '@gltf-transform/functions';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2] ?? 'assets-src/kaykit-adventurers';
const src11 = process.argv[3] ?? 'assets-src/kaykit-anims-1.1';
const out = 'public/characters';
const CHARS = ['Rogue_Hooded', 'Rogue', 'Mage', 'Barbarian', 'Knight'];
const PROPS = /(Axe|Shield|Sword|Crossbow|Knife|Throwable|Wand|Staff|Spellbook|Mug)/; // hats, helmets and capes stay: they are swappable parts
const KEEP = ['Walking_A', 'Walking_B', 'Walking_C', 'Walking_Backwards', 'Idle', 'Unarmed_Idle', 'Interact', 'Cheer', 'PickUp', 'Use_Item', 'Throw',
  'Sit_Floor_Idle', 'Sit_Chair_Idle', 'Lie_Idle', 'Running_A', 'Running_B', 'Jump_Full_Short', 'Jump_Idle', 'Spellcasting',
  '1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Idle', '2H_Ranged_Aiming', '1H_Ranged_Aiming', 'Block', 'Dodge_Left'];
/** clips taken from Character Animations 1.1, per source file */
const KEEP11 = {
  Rig_Medium_Tools: ['Chopping', 'Digging', 'Hammering', 'Pickaxing', 'Sawing', 'Working_A', 'Working_B', 'Working_C', 'Holding_A', 'Holding_B', 'Holding_C',
    'Fishing_Cast', 'Fishing_Idle', 'Fishing_Bite', 'Fishing_Reeling', 'Fishing_Catch'],
  Rig_Medium_Simulation: ['Sit_Chair_Down', 'Sit_Chair_StandUp', 'Sit_Floor_Down', 'Sit_Floor_StandUp', 'Waving', 'Cheering'],
  Rig_Medium_General: ['Idle_A', 'Idle_B'],
  Rig_Medium_MovementAdvanced: ['Crouching', 'Sneaking'],
};
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const killAnim = (a) => { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); };
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const squeeze = [quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' })];
fs.mkdirSync(out, { recursive: true });

for (const name of CHARS) {
  const doc = await io.read(path.join(src, `${name}.glb`));
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (PROPS.test(n.getName())) n.dispose();
  for (const a of root.listAnimations()) killAnim(a);
  // normals are derived in the shader from screen derivatives
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
  await doc.transform(prune(), dedup(), ...squeeze);
  await io.write(path.join(out, `${name}.glb`), doc);
}

const doc = await io.read(path.join(src, 'Rogue_Hooded.glb'));
const root = doc.getRoot();
for (const a of root.listAnimations()) if (!KEEP.includes(a.getName())) killAnim(a);
for (const n of root.listNodes()) if (n.getMesh()) n.dispose();
for (const t of root.listTextures()) t.dispose();

// copy the 1.1 clips onto the Adventurers rig (bones matched by name)
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
const floats = (acc) => {
  const n = acc.getCount(), k = acc.getElementSize(), arr = new Float32Array(n * k), el = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let j = 0; j < k; j++) arr[i * k + j] = el[j]; }
  return arr;
};
for (const [file, names] of Object.entries(KEEP11)) {
  const sdoc = await io.read(path.join(src11, `${file}.glb`));
  for (const sa of sdoc.getRoot().listAnimations()) {
    if (!names.includes(sa.getName())) continue;
    if (root.listAnimations().some((a) => a.getName() === sa.getName())) continue;
    const anim = doc.createAnimation(sa.getName());
    for (const ch of sa.listChannels()) {
      const node = byName.get(ch.getTargetNode()?.getName() ?? '');
      if (!node) continue;
      const ss = ch.getSampler();
      const inp = doc.createAccessor().setType('SCALAR').setArray(floats(ss.getInput())).setBuffer(buffer);
      const outp = doc.createAccessor().setType(ss.getOutput().getType()).setArray(floats(ss.getOutput())).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(inp).setOutput(outp).setInterpolation(ss.getInterpolation());
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
  }
}
await doc.transform(resample({ tolerance: 2e-3 }));
// channels that only hold the rest pose are no-ops for three's mixer (unanimated bones blend back
// to rest) — dropping them, and the unweighted IK helpers, keeps the JSON (one accessor each) small
let dropped = 0;
for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
  const node = ch.getTargetNode(), pth = ch.getTargetPath(), o = ch.getSampler().getOutput();
  const rest = pth === 'translation' ? node.getTranslation() : pth === 'rotation' ? node.getRotation() : pth === 'scale' ? node.getScale() : null;
  let still = !!rest;
  const el = [];
  for (let i = 0; still && i < o.getCount(); i++) {
    o.getElement(i, el);
    const d = Math.max(...el.map((v, j) => Math.abs(v - rest[j])));
    const dn = pth === 'rotation' ? Math.max(...el.map((v, j) => Math.abs(v + rest[j]))) : d;
    if (Math.min(d, dn) > 1e-4) still = false;
  }
  if (still || /IK|control-/.test(node.getName())) { const s = ch.getSampler(); ch.dispose(); s.dispose(); dropped++; }
}
console.log('dropped', dropped, 'rest-pose / IK channels');
await doc.transform(prune({ keepLeaves: true }), dedup(), ...squeeze);
await io.write(path.join(out, 'anims.glb'), doc);

fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(out, 'LICENSE-KayKit.txt'));
fs.copyFileSync(path.join(src11, 'License.txt'), path.join(out, 'LICENSE-KayKit-Animations.txt'));
for (const f of fs.readdirSync(out)) console.log(f, Math.round(fs.statSync(path.join(out, f)).size / 1024) + ' KB');
