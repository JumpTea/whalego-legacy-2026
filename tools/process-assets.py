# -*- coding: utf-8 -*-
"""Process WhaleGo source art into Android assets.

Inputs (supply your own copies in materials/; not committed):
  materials/GIF/D390AEBD17906B20AB95AAA5C08E4329.gif   blue whale mark / tail, 36f x 20ms
  materials/background/5b74d8...jpeg                    default wallpaper 1048x1501
  materials/icon/gj-meme-268.jpg                        Q-version whale girl icon
  Override the materials directory with WHALEGO_MATERIALS, the icon with WHALEGO_ICON.

Outputs (committed):
  android/assets/splash-tail.gif                        720x720, 36f, 20ms, #DDEBFF bg
  android/assets/tail-sprite-blue.png                   36 x 180px horizontal sprite
  android/assets/tail-sprite-white.png                  same, white silhouette
  android/res/drawable-nodpi/splash_tail_static.png      first frame, system splash
  android/res/mipmap-xxxhdpi/ic_launcher_foreground.png  432px adaptive foreground
  android/res/mipmap-anydpi-v26/ic_launcher*.xml
  android/res/values/colors.xml
  android/assets/w00.jpg
  android/assets/t00.jpg
"""
from pathlib import Path
import os

import cv2
import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "android" / "assets"
RES = ROOT / "android" / "res"
MAT = Path(os.environ.get("WHALEGO_MATERIALS", ROOT / "materials"))

GIF_SRC = MAT / "GIF" / "D390AEBD17906B20AB95AAA5C08E4329.gif"
WALL_SRC = MAT / "background" / "5b74d8d49ba3f5d1657813c96a5fceb6.jpeg"
ICON_SRC = Path(os.environ.get("WHALEGO_ICON", MAT / "icon" / "gj-meme-268.jpg"))

SPLASH_BG = np.array([0xDD, 0xEB, 0xFF], dtype=np.float32)
ICON_BG = (0xEA, 0xF2, 0xFF, 255)


def ensure_dirs():
    for p in [
        ASSETS,
        RES / "drawable-nodpi",
        RES / "mipmap-xxxhdpi",
        RES / "mipmap-anydpi-v26",
        RES / "values",
        MAT / "icon",
        MAT / "previews",
    ]:
        p.mkdir(parents=True, exist_ok=True)


def color_to_alpha(rgb: np.ndarray):
    """Un-matte an image that was shot on pure white.

    p = a*f + (1-a)*255  ->  a = 1 - min(p)/255, f = (p-(1-a)*255)/a
    Returns (fg RGB float32, a float32 in 0..1).
    """
    p = rgb.astype(np.float32)
    mn = p.min(axis=2)
    a = 1.0 - mn / 255.0
    a = np.clip((a - 0.015) / 0.985, 0.0, 1.0)
    safe = np.maximum(a, 1e-4)[..., None]
    fg = (p - (1.0 - a[..., None]) * 255.0) / safe
    fg = np.clip(fg, 0, 255)
    return fg, a


def build_splash_and_tail():
    gif = Image.open(GIF_SRC)
    n = getattr(gif, "n_frames", 1)
    splash_frames = []
    sprite_blue = []
    sprite_white = []
    for i in range(n):
        gif.seek(i)
        frame = gif.convert("RGB").resize((720, 720), Image.LANCZOS)
        fg720, a720 = color_to_alpha(np.asarray(frame))
        out = fg720 * a720[..., None] + SPLASH_BG * (1.0 - a720[..., None])
        splash_frames.append(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)))

        small = frame.resize((180, 180), Image.LANCZOS)
        fg, a = color_to_alpha(np.asarray(small))
        alpha_img = Image.fromarray((a * 255).astype(np.uint8), "L")
        blue = Image.fromarray(np.clip(fg, 0, 255).astype(np.uint8), "RGB")
        blue.putalpha(alpha_img)
        white = Image.new("RGBA", (180, 180), (255, 255, 255, 255))
        white.putalpha(alpha_img)
        sprite_blue.append(blue)
        sprite_white.append(white)

    ASSETS.mkdir(parents=True, exist_ok=True)
    splash_frames[0].save(
        ASSETS / "splash-tail.gif",
        save_all=True,
        append_images=splash_frames[1:],
        duration=20,
        loop=0,
        disposal=2,
        optimize=False,
    )
    for name, frames in [("tail-sprite-blue.png", sprite_blue), ("tail-sprite-white.png", sprite_white)]:
        strip = Image.new("RGBA", (180 * len(frames), 180), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * 180, 0))
        strip.save(ASSETS / name, optimize=True)
    splash_frames[0].save(RES / "drawable-nodpi" / "splash_tail_static.png")
    print(f"[splash] {n} frames -> splash-tail.gif / sprites / splash_tail_static.png")


def build_icon():
    if not ICON_SRC.exists():
        raise SystemExit(f"icon source not found: {ICON_SRC} (set WHALEGO_ICON)")
    src = Image.open(ICON_SRC).convert("RGB")
    rgb = np.asarray(src).copy()
    h, w = rgb.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    tol = (20, 20, 20)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        cv2.floodFill(
            rgb.copy(),
            mask,
            seed,
            (0, 0, 0),
            tol,
            tol,
            4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY,
        )
    bgmask = mask[1:-1, 1:-1].astype(np.uint8)
    alpha = np.where(bgmask == 0, 255, 0).astype(np.uint8)
    # soften one pixel of the cut edge so the light-blue adaptive bg cannot show a white fringe
    a = alpha.astype(np.float32) / 255.0
    rgba = np.dstack([np.asarray(src).astype(np.uint8), alpha])
    icon = Image.fromarray(rgba, "RGBA")
    bbox = icon.getbbox()
    if bbox:
        icon = icon.crop(bbox)
    icon = ImageOps.contain(icon, (270, 270), Image.LANCZOS)
    fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    fg.alpha_composite(icon, ((432 - icon.width) // 2, (432 - icon.height) // 2))
    fg.save(RES / "mipmap-xxxhdpi" / "ic_launcher_foreground.png", optimize=True)
    preview = Image.new("RGBA", (432, 432), ICON_BG)
    preview.alpha_composite(fg)
    preview.save(MAT / "previews" / "icon.png")
    print(f"[icon] source={src.size} crop={bbox} -> 432 foreground; preview materials/previews/icon.png")


def build_default_wallpaper():
    src = Image.open(WALL_SRC).convert("RGB")
    src.thumbnail((1080, 1920), Image.LANCZOS)
    full = ASSETS / "w00.jpg"
    src.save(full, "JPEG", quality=90, optimize=True, progressive=True)
    thumb = ImageOps.fit(src, (360, 480), Image.LANCZOS, centering=(0.5, 0.42))
    thumb.save(ASSETS / "t00.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    print(f"[wallpaper] default {src.size} -> {full.stat().st_size} B + thumb")


def write_static_resources():
    (RES / "values" / "colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ink">#15243B</color>\n'
        '    <color name="brand_blue">#4D6BFE</color>\n'
        '    <color name="splash_bg">#DDEBFF</color>\n'
        '    <color name="ic_launcher_background">#EAF2FF</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        "</adaptive-icon>\n"
    )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(adaptive, encoding="utf-8")
    print("[xml] colors.xml + adaptive icon xml")


def cleanup_old():
    for p in [
        ASSETS / "background.jpeg",
        ASSETS / "tail.gif",
        RES / "drawable" / "ic_launcher.xml",
    ]:
        if p.exists():
            p.unlink()
            print(f"[clean] removed {p.relative_to(ROOT)}")


def write_manifest_fallback():
    manifest = ASSETS / "wallpapers.js"
    if not manifest.exists():
        manifest.write_text(
            'window.WALLPAPERS = [{"id":"00","src":"w00.jpg",'
            '"thumb":"t00.jpg","source":"default"}];\n',
            encoding="utf-8",
        )
        print("[manifest] wrote default-only fallback wallpapers.js")


def main():
    ensure_dirs()
    build_splash_and_tail()
    build_icon()
    build_default_wallpaper()
    write_static_resources()
    cleanup_old()
    write_manifest_fallback()
    print("[done] assets regenerated")


if __name__ == "__main__":
    main()
