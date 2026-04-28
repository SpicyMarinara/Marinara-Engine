"""Generate app-icon.ico from logo.png for the NSIS installer."""
from PIL import Image
import struct, io, os

src = os.path.join(os.path.dirname(__file__), '..', 'packages', 'client', 'public', 'logo.png')
dst = os.path.join(os.path.dirname(__file__), 'app-icon.ico')

img = Image.open(src).convert('RGBA')
# Make square by centering on transparent canvas
max_dim = max(img.size)
square = Image.new('RGBA', (max_dim, max_dim), (0, 0, 0, 0))
offset = ((max_dim - img.width) // 2, (max_dim - img.height) // 2)
square.paste(img, offset)

sizes = [16, 32, 48, 64, 128, 256]
png_data_list = []
for s in sizes:
    resized = square.resize((s, s), Image.LANCZOS)
    buf = io.BytesIO()
    resized.save(buf, format='PNG')
    png_data_list.append(buf.getvalue())

# Build ICO file manually (PNG-compressed entries)
num_images = len(sizes)
header = struct.pack('<HHH', 0, 1, num_images)

dir_entries = b''
data_offset = 6 + num_images * 16
image_data = b''

for i, s in enumerate(sizes):
    png_bytes = png_data_list[i]
    w = 0 if s >= 256 else s
    h = 0 if s >= 256 else s
    entry = struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(png_bytes), data_offset + len(image_data))
    dir_entries += entry
    image_data += png_bytes

with open(dst, 'wb') as f:
    f.write(header + dir_entries + image_data)

print(f'Created {dst} ({os.path.getsize(dst)} bytes) with {num_images} sizes: {sizes}')
