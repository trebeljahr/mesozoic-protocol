"""Inspect an embedded glTF 2 binary and check the game's asset contract.

This is a structural preflight, not a renderer or a full glTF validator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def inspect(path, kind='prop'):
    path = Path(path)
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError('Truncated GLB header')
    magic, version, size = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or size != len(data):
        raise ValueError('Expected a complete glTF 2 binary')
    length, chunk_type = struct.unpack_from('<II', data, 12)
    if chunk_type != 0x4E4F534A or 20 + length > len(data):
        raise ValueError('Missing or truncated JSON chunk')
    doc = json.loads(data[20:20 + length])
    accessors = doc.get('accessors', [])
    errors = []
    for item in doc.get('buffers', []) + doc.get('images', []):
        if item.get('uri') and not item['uri'].startswith('data:'):
            errors.append('External resource: ' + item['uri'])
    triangles = 0
    primitives = 0
    for mesh in doc.get('meshes', []):
        for primitive in mesh['primitives']:
            primitives += 1
            if primitive.get('mode', 4) != 4:
                errors.append('Only triangle primitives are supported by this preflight')
                continue
            attributes = primitive.get('attributes', {})
            if 'POSITION' not in attributes:
                errors.append('Primitive is missing POSITION')
                continue
            count = accessors[primitive.get('indices', attributes['POSITION'])]['count']
            if count % 3:
                errors.append('Triangle index/vertex count is not divisible by three')
            triangles += count // 3
    if not primitives:
        errors.append('No mesh primitives')
    clips = []
    for animation in doc.get('animations', []):
        duration = max((accessors[s['input']].get('max', [0])[0] for s in animation['samplers']), default=0)
        clips.append({'name': animation.get('name', ''), 'endSeconds': duration})
        if not animation.get('channels') or duration <= 0:
            errors.append('Empty or zero-duration animation: ' + animation.get('name', ''))
    if kind == 'enemy':
        if not doc.get('skins'):
            errors.append('Enemy requires a skin')
        names = [clip['name'].lower() for clip in clips]
        for label, candidates in [('locomotion', ['run', 'walk']), ('attack', ['attack', 'bite', 'roar']), ('death', ['death', 'die', 'dead'])]:
            if not any(c in n for n in names for c in candidates):
                errors.append('Missing ' + label + ' clip')
    elif doc.get('skins') or clips:
        errors.append('Props must be static for the current instanced tree/decor pipeline')
    return {
        'file': str(path), 'sha256': hashlib.sha256(data).hexdigest(),
        'bytes': len(data), 'triangles': triangles, 'meshPrimitives': primitives,
        'materials': len(doc.get('materials', [])),
        'jointsPerSkin': [len(s['joints']) for s in doc.get('skins', [])],
        'clips': clips, 'extensionsRequired': doc.get('extensionsRequired', []),
        'errors': errors,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', type=Path, nargs='+')
    parser.add_argument('--kind', choices=['enemy', 'prop'], default='prop')
    args = parser.parse_args()
    reports = []
    for path in args.files:
        try:
            reports.append(inspect(path, args.kind))
        except (ValueError, KeyError, IndexError, OSError, struct.error) as error:
            reports.append({'file': str(path), 'errors': [str(error)]})
    print(json.dumps(reports, indent=2))
    raise SystemExit(int(any(r['errors'] for r in reports)))
