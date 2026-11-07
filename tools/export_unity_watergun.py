"""Export the existing readable Unity YAML mesh and TGA into a self-contained GLB.

Usage: python3 tools/export_unity_watergun.py /path/to/Unitygame/Wash
Requires Pillow for the TGA; uses no Unity/Blender installation.
"""
import io
import json
import re
import struct
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1]) / 'Assets/Recovered/downloadablecontent/dlc02/dlc_assets/models/shared kitchen'
text = (source / 'm_dlc2_watergun_01.asset').read_text()
vertices = int(re.search(r'm_VertexCount: (\d+)', text)[1])
raw = bytes.fromhex(re.search(r'_typelessdata: ([0-9a-fA-F]+)', text)[1])
indices = bytes.fromhex(re.search(r'm_IndexBuffer: ([0-9a-fA-F]+)', text)[1])
assert len(raw) == vertices * 40, 'Unexpected Unity vertex layout'
positions, normals, uvs = [], [], []
for index in range(vertices):
    x, y, z, nx, ny, nz = struct.unpack_from('<6f', raw, index * 40)
    u, v = struct.unpack_from('<2e', raw, index * 40 + 28)
    positions.extend((z * .8, y * .8 - .1, -x * .8))
    normals.extend((nz, ny, -nx))
    uvs.extend((u, 1 - v))
image = Image.open(source / 'textures/t_dlc2_watergun_01_d.tga').convert('RGBA')
image.thumbnail((512, 512))
png = io.BytesIO(); image.save(png, format='PNG', optimize=True)
binary = bytearray(); views = []; accessors = []
def view(data, target=None):
    while len(binary) % 4: binary.append(0)
    result = len(views); entry = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
    if target: entry['target'] = target
    views.append(entry); binary.extend(data); return result
def attribute(values, dimensions, kind, bounds=False):
    entry = {'bufferView': view(struct.pack('<' + 'f' * len(values), *values), 34962), 'componentType': 5126, 'count': vertices, 'type': kind}
    if bounds:
        entry['min'] = [min(values[d::dimensions]) for d in range(dimensions)]
        entry['max'] = [max(values[d::dimensions]) for d in range(dimensions)]
    accessors.append(entry); return len(accessors) - 1
attrs = {'POSITION': attribute(positions, 3, 'VEC3', True), 'NORMAL': attribute(normals, 3, 'VEC3'), 'TEXCOORD_0': attribute(uvs, 2, 'VEC2')}
index_view = view(indices, 34963)
submeshes = re.findall(r'firstByte: (\d+)\s+indexCount: (\d+)', text)
primitives = []
for submesh, (first, count) in enumerate(submeshes):
    accessors.append({'bufferView': index_view, 'byteOffset': int(first), 'componentType': 5123, 'count': int(count), 'type': 'SCALAR'})
    primitives.append({'attributes': attrs, 'indices': len(accessors) - 1, 'material': 1 if submesh == 1 else 0})
image_view = view(png.getvalue())
while len(binary) % 4: binary.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'WASH Unity watergun export'}, 'scene': 0,
        'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'UnityWaterGun'}], 'meshes': [{'primitives': primitives}],
        'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'accessors': accessors,
        'images': [{'bufferView': image_view, 'mimeType': 'image/png'}], 'textures': [{'source': 0}],
        'materials': [
            {'name': 'Unity watergun', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': .7}},
            {'name': 'Unity watergun glass', 'doubleSided': True, 'alphaMode': 'BLEND', 'pbrMetallicRoughness': {'baseColorFactor': [.5, .85, 1, .55], 'metallicFactor': 0, 'roughnessFactor': .3}}]}
payload = json.dumps(gltf, separators=(',', ':')).encode()
payload += b' ' * (-len(payload) % 4)
output = Path(__file__).resolve().parents[1] / 'client/assets/unity/watergun.glb'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(payload) + len(binary)) + struct.pack('<II', len(payload), 0x4E4F534A) + payload + struct.pack('<II', len(binary), 0x004E4942) + binary)
print(f'{output}: {vertices} vertices, {len(binary)} buffer bytes')
