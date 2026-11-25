// Prepares the KayKit Adventurers (CC0, Kay Lousberg) characters for Inkcity:
//  - strips weapons/shields/props so they read as townsfolk
//  - removes animations from the character files
//  - writes one shared clip file (all characters share the same rig)
// usage: node scripts/prep-characters.mjs <dir with KayKit .glb files>
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample, quantize, meshopt } from '@gltf-transform/functions';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = 'public/characters';
const CHARS = ['Rogue_Hooded', 'Rogue', 'Mage', 'Barbarian', 'Knight'];
const PROPS = /(Axe|Shield|Sword|Crossbow|Knife|Throwable|Wand|Staff|Spellbook|Mug)/; // hats, helmets and capes stay: they are swappable parts
const KEEP = ['Walking_A', 'Walking_B', 'Walking_C', 'Walking_Backwards', 'Idle', 'Unarmed_Idle', 'Interact', 'Cheer', 'PickUp', 'Use_Item', 'Throw',
  'Sit_Floor_Idle', 'Sit_Chair_Idle', 'Lie_Idle', 'Running_A', 'Running_B', 'Jump_Full_Short', 'Jump_Idle', 'Spellcasting',
  '1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Idle', '2H_Ranged_Aiming', '1H_Ranged_Aiming', 'Block', 'Dodge_Left'];
await MeshoptEncoder.ready;
const killAnim = (a) => { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); };
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
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
await doc.transform(resample(), prune({ keepLeaves: true }), dedup(), ...squeeze);
await io.write(path.join(out, 'anims.glb'), doc);

fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(out, 'LICENSE-KayKit.txt'));
for (const f of fs.readdirSync(out)) console.log(f, Math.round(fs.statSync(path.join(out, f)).size / 1024) + ' KB');
