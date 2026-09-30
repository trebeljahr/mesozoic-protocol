"""Run in Blender with a saved asset .blend open; see docs/BLENDER-ASSETS.md."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_glb import inspect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--kind', choices=['enemy', 'prop'], required=True)
    parser.add_argument('--collection', default='EXPORT')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output = args.output.resolve()
    if output.suffix.lower() != '.glb':
        raise ValueError('Output must end in .glb')
    if output.exists():
        raise ValueError('Output exists; choose a new versioned filename')
    collection = bpy.data.collections.get(args.collection)
    if collection is None:
        raise ValueError('Missing export collection: ' + args.collection)
    objects = list(collection.all_objects)
    rigs = [o for o in objects if o.type == 'ARMATURE']
    # The glTF importer can create hidden mesh widgets for bone display.
    # These belong to the editing rig, never to the runtime geometry.
    widgets = {bone.custom_shape for rig in rigs for bone in rig.pose.bones if bone.custom_shape}
    objects = [o for o in objects if o not in widgets]
    meshes = [o for o in objects if o.type == 'MESH']
    if not meshes:
        raise ValueError('EXPORT has no meshes')
    if args.kind == 'enemy' and len(rigs) != 1:
        raise ValueError('Enemy EXPORT must contain exactly one armature')
    if args.kind == 'prop' and rigs:
        raise ValueError('Instanced props must not contain armatures')
    for obj in meshes:
        for modifier in obj.modifiers:
            if modifier.type == 'ARMATURE' and modifier.object not in rigs:
                raise ValueError('Armature dependency outside EXPORT: ' + obj.name)
    if args.kind == 'prop' and any(o.animation_data for o in objects):
        raise ValueError('Instanced props must not contain animation data')
    for obj in objects:
        if obj.type not in {'MESH', 'ARMATURE', 'EMPTY'}:
            raise ValueError('Unsupported export object: ' + obj.name)
        if obj.parent and obj.parent not in objects:
            raise ValueError('Parent outside EXPORT: ' + obj.name)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
        if not obj.select_get():
            raise ValueError('Object cannot be selected; enable its collection: ' + obj.name)
    bpy.context.view_layer.objects.active = rigs[0] if rigs else meshes[0]
    if args.kind == 'enemy':
        tracks = rigs[0].animation_data.nla_tracks if rigs[0].animation_data else []
        if not tracks or any(len(t.strips) != 1 for t in tracks):
            raise ValueError('Use one action strip per NLA track, one track per clip')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='asset-export-', dir=output.parent) as tmp:
        candidate = Path(tmp) / output.name
        result = bpy.ops.export_scene.gltf(
            filepath=str(candidate), export_format='GLB', use_selection=True,
            export_yup=True, export_apply=False, export_cameras=False,
            export_lights=False, export_animations=args.kind == 'enemy',
            export_animation_mode='NLA_TRACKS', export_frame_range=False,
            export_force_sampling=True, export_skins=True,
            export_def_bones=False,
        )
        if 'FINISHED' not in result:
            raise RuntimeError('Blender export failed')
        report = inspect(candidate, args.kind)
        if report['errors']:
            raise ValueError(json.dumps(report, indent=2))
        # Exclusive creation preserves any file produced concurrently.
        with output.open('xb') as dest:
            dest.write(candidate.read_bytes())
    report['file'] = str(output)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
