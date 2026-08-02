#!/usr/bin/env python3
"""Erzeugt die App-Icons (Hantel auf blauem Verlauf) ohne externe Bibliotheken."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

BG_TOP = (43, 92, 153)
BG_BOTTOM = (79, 157, 255)
FG = (245, 249, 255)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    """True, wenn (x, y) in einem Rechteck mit abgerundeten Ecken liegt."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def dumbbell(x, y, n):
    """Hantel-Silhouette: Stange, innere Scheiben, äußere Scheiben."""
    u = n / 100.0
    parts = [
        (28, 46, 72, 54, 2),   # Stange
        (18, 32, 30, 68, 4),   # linke innere Scheibe
        (70, 32, 82, 68, 4),   # rechte innere Scheibe
        (10, 40, 18, 60, 3),   # linker Verschluss
        (82, 40, 90, 60, 3),   # rechter Verschluss
    ]
    for x0, y0, x1, y1, r in parts:
        if rounded_rect(x, y, x0 * u, y0 * u, x1 * u, y1 * u, r * u):
            return True
    return False


def render(n):
    rows = []
    for y in range(n):
        t = y / max(n - 1, 1)
        bg = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        row = bytearray([0])  # PNG-Filter: none
        for x in range(n):
            row += bytes(FG if dumbbell(x, y, n) else bg)
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, n):
    header = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)  # 8 Bit, Truecolor
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(render(n), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"{path.name}: {len(png)} Bytes")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", 192)
    write_png(OUT / "icon-512.png", 512)
    write_png(OUT / "apple-touch-icon.png", 180)
