#!/usr/bin/env python3
"""Переносит мясо с тёмного фона на светлый «бетон» с мягкой тенью.
Использование: python3 tools/lighten.py [--board] site/img/p/lb-*.jpg  → рядом файлы *-l.jpg
Нужно: pip install "rembg[cpu]" pillow numpy"""
import sys, numpy as np
from PIL import Image, ImageFilter
from rembg import remove, new_session

def background(S, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:S, 0:S] / S
    base = 238 - 16 * np.hypot(x - .45, y - .3)
    n = rng.normal(0, 1, (S // 3, S // 3))
    n = np.array(Image.fromarray(((n * 20) + 128).clip(0, 255).astype('uint8'))
                 .resize((S, S), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2)), float) - 128
    v = (base + n * .18 + rng.normal(0, 3.5, (S, S))).clip(0, 255)
    return Image.fromarray(np.stack([v, v, v - 1], -1).clip(0, 255).astype('uint8'))

def drop_board(im, cut):
    """Убирает остатки коричневой доски: красное мясо остаётся, коричневое тёмное дерево — нет."""
    from scipy import ndimage
    c = np.array(cut); hsv = np.array(im.convert('HSV'), float)
    h, v = hsv[..., 0] * 360 / 255, hsv[..., 2] / 255
    a = c[..., 3].copy(); a[(h > 9) & (h < 55) & (v < .72)] = 0
    m = ndimage.binary_opening(a > 60, iterations=7)
    lab, k = ndimage.label(m)
    if k:
        m = lab == (np.argmax(ndimage.sum(m, lab, range(1, k + 1))) + 1)
    m = ndimage.binary_fill_holes(m)
    c[..., 3] = np.array(Image.fromarray(np.where(m, c[..., 3], 0).astype('uint8')).filter(ImageFilter.GaussianBlur(1)))
    return Image.fromarray(c)

def lighten(src, session, S=900, board=False):
    im = Image.open(src).convert('RGB')
    cut = remove(im, session=session, post_process_mask=True)
    if board:
        cut = drop_board(im, cut)
    mask = cut.split()[3].point(lambda v: 255 if v > 60 else 0)
    c = cut.crop(mask.getbbox())
    sc = min(S * .88 / c.width, S * .72 / c.height)
    c = c.resize((int(c.width * sc), int(c.height * sc)), Image.LANCZOS)
    B = background(S, abs(hash(src)) % 1000).convert('RGBA')
    px, py = (S - c.width) // 2, (S - c.height) // 2 + 20
    sh = Image.new('L', (S, S), 0); sh.paste(c.split()[3], (px + 12, py + 30))
    sh = sh.filter(ImageFilter.GaussianBlur(28)).point(lambda v: int(v * .4))
    B = Image.composite(Image.new('RGBA', (S, S), (60, 50, 45, 255)), B, sh)
    B.alpha_composite(c, (px, py))
    return B.convert('RGB')

if __name__ == '__main__':
    s = new_session('isnet-general-use')
    board = '--board' in sys.argv   # для фото, где осталась доска
    for f in [a for a in sys.argv[1:] if not a.startswith('--')]:
        out = f[:-4] + '-l.jpg'
        lighten(f, s, board=board).save(out, quality=84, optimize=True, progressive=True)
        print(out)
