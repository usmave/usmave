#!/usr/bin/env python3
"""Erzeugt die App-Symbole: Markise oben, Sprechblase mit drei Zitronen-Punkten."""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024

TOP = (36, 102, 184)
BOTTOM = (24, 76, 146)
STRIPE_A = (255, 255, 255)
STRIPE_B = (20, 60, 116)
LEMON = (246, 199, 68)
WHITE = (255, 255, 255)


def draw(scale=1.0):
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    for y in range(S):
        t = y / (S - 1)
        c = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c)

    # Inhalt um die Mitte skalieren (für „maskable“ etwas kleiner)
    def P(x, y):
        return (S / 2 + (x - S / 2) * scale, S / 2 + (y - S / 2) * scale)

    def R(v):
        return v * scale

    # Markise
    top_y = 0 if scale == 1.0 else P(0, 120)[1]
    edge_y = P(0, 250)[1]
    w = R(128)
    x0 = P(0, 0)[0]
    n = int(S / w) + 2
    for i in range(-1, n):
        col = STRIPE_A if i % 2 == 0 else STRIPE_B
        x = x0 + i * w
        d.rectangle([x, top_y, x + w, edge_y], fill=col)
        d.ellipse([x, edge_y - w / 2, x + w, edge_y + w / 2], fill=col)

    # Sprechblase
    bx0, by0 = P(176, 420)
    bx1, by1 = P(848, 812)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=R(130), fill=WHITE)
    d.polygon([P(300, 790), P(450, 790), P(250, 930)], fill=WHITE)

    # Drei Punkte
    for cx in (362, 512, 662):
        x, y = P(cx, 616)
        r = R(50)
        d.ellipse([x - r, y - r, x + r, y + r], fill=LEMON)
    return img


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print(name, size)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    full = draw(1.0)
    save(full, "apple-touch-icon.png", 180)
    save(full, "icon-192.png", 192)
    save(full, "icon-512.png", 512)
    save(draw(0.78), "icon-maskable-512.png", 512)
