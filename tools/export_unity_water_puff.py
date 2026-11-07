"""Export the RunPuff mesh used by Unity WaterSpray's jet and collision emitters."""
import json
import re
import struct
import sys
from pathlib import Path

source = Path(sys.argv[1]) / 'Assets/Recovered/particles/meshes/RunPuff.asset'
text = source.read_text()
count = int(re.search(r'm_VertexCount: (\d+)', text)[1])
raw = bytes.fromhex(re.search(r'_typelessdata: ([0-9a-fA-F]+)', text)[1])
assert len(raw) == count * 48, 'Unexpected RunPuff vertex layout'
index_data = bytes.fromhex(re.search(r'm_IndexBuffer: ([0-9a-fA-F]+)', text)[1])
indices = list(struct.unpack('<' + 'H' * (len(index_data) // 2), index_data))
positions, normals = [], []
for index in range(count):
    x, y, z, nx, ny, nz = struct.unpack_from('<6f', raw, index * 48)
    positions.extend((x, y, -z)); normals.extend((nx, ny, -nz))
for index in range(0, len(indices), 3): indices[index + 1], indices[index + 2] = indices[index + 2], indices[index + 1]
center = [(max(positions[d::3]) + min(positions[d::3])) / 2 for d in range(3)]
extent = max(max(positions[d::3]) - min(positions[d::3]) for d in range(3)) / 2
positions = [round((value - center[i % 3]) / extent, 6) for i, value in enumerate(positions)]
normals = [round(value, 6) for value in normals]
output = Path(__file__).resolve().parents[1] / 'client/assets/unity/water-puff.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'positions': positions, 'normals': normals, 'indices': indices}, separators=(',', ':')) + '\n')
print(f'{output}: {count} vertices, {len(indices) // 3} triangles')
