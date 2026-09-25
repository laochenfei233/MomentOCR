"""Export MomentOCR logo from the real app icon (no drawing needed)."""
from PIL import Image
import os

SRC = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'icon.png')

def export_logo(size, out_path):
    """Resize the real app icon to the requested pixel size."""
    img = Image.open(SRC).convert('RGBA')
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out_path)
    print(f'exported {out_path} ({size}x{size})')

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 32, 64, 128, 256, 512):
        export_logo(s, os.path.join(here, f'logo_{s}.png'))
