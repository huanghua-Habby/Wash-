#!/usr/bin/env python3
"""Create the client cleaning-tool palette from the existing Unity gun texture.

Requires Pillow. Keeps original UVs, alpha, black details and baked shading; no mesh changes.
The body color comes from client/js/core/cleaningTheme.js.
"""
import io
import json
from pathlib import Path
import re
import struct
from PIL import Image

root = Path(__file__).resolve().parent.parent
palette = (root / 'client/js/core/cleaningTheme.js').read_text()
color = re.search(r"water: Object.freeze\(\{[^\n]*model: '(#[A-Fa-f0-9]+)'", palette).group(1)
body = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
data = (root / 'client/assets/unity/watergun.glb').read_bytes()
length, _ = struct.unpack_from('<II', data, 12)
gltf = json.loads(data[20:20+length])
view = gltf['bufferViews'][gltf['images'][0]['bufferView']]
offset = 20 + length + 8 + view.get('byteOffset', 0)
source = Image.open(io.BytesIO(data[offset:offset+view['byteLength']])).convert('RGBA')
pixels = []
for red, green, blue, alpha in source.getdata():
    target = None
    if max(red, green, blue) > 20:
        if blue > red * 1.2 and green > red * 1.15:
            target = body
        elif red > blue * 1.6 and green > blue * 1.4 and green > red * .75:
            target = (247, 235, 201)
        elif red > green * 1.35 and red > blue * 1.35:
            target = (92, 112, 111)
    if target:
        shade = min(1.15, max(red, green, blue) / 210)
        red, green, blue = (min(255, round(channel * shade)) for channel in target)
    pixels.append((red, green, blue, alpha))
source.putdata(pixels)
output = root / 'client/assets/unity/watergun-cleaning.png'
source.save(output, optimize=True)
print(output)
