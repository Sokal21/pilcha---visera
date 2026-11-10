"""Dibuja el plano de src/escenario/city-center.json, para revisarlo antes de armar la maqueta.

  python3 tools/plano/dibujar.py

Escribe tools/plano/plano.png (el plano en metros, con grilla cada 10 m) y, si está la foto
satelital en references/city-center/satelite.png, references/city-center/plano_sobre_satelite.png
(lo calcado encima de la foto, para ver que coincide; queda fuera de git como la foto).
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
PLANO = json.loads((RAIZ / 'src/escenario/city-center.json').read_text())
SATELITE = RAIZ / 'references/city-center/satelite.png'
PX_POR_METRO = 4
ROTULOS = {'hotel': 'Pullman', 'base_hotel': 'Base', 'deck': 'Bloque central', 'marquesina': 'Marq.', 'casino': 'Casino', 'techo_casino': 'Techo del casino'}

COLORES = {
    'verde': (88, 128, 72), 'calle': (78, 80, 88), 'zona': (255, 220, 60),
    'hotel': (205, 205, 215), 'base_hotel': (235, 230, 240), 'deck': (175, 170, 160),
    'marquesina': (240, 240, 245), 'casino': (150, 150, 160), 'techo_casino': (195, 195, 205),
    'luces': (255, 80, 200), 'palmera': (40, 170, 70), 'farola': (255, 200, 90), 'cartel': (255, 255, 255),
}


def fuente(tam: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', tam)
    except OSError:
        return ImageFont.load_default()


def elipse(centro, radios, n=48):
    return [(centro[0] + radios[0] * math.cos(2 * math.pi * i / n), centro[1] + radios[1] * math.sin(2 * math.pi * i / n)) for i in range(n)]


def dibujar(d: ImageDraw.ImageDraw, a, transparente: bool) -> None:
    """`a` pasa de píxeles del satélite a píxeles del dibujo."""
    alfa = 150 if transparente else 255

    def c(nombre, al=alfa):
        return COLORES[nombre] + (al,)

    if not transparente:
        for v in PLANO['verdes']:
            pts = elipse(**{k: v['elipse_px'][k] for k in ('centro', 'radios')}) if 'elipse_px' in v else v['poligono_px']
            d.polygon([a(p) for p in pts], fill=c('verde'))
    else:
        v = next(v for v in PLANO['verdes'] if 'elipse_px' in v)
        d.polygon([a(p) for p in elipse(v['elipse_px']['centro'], v['elipse_px']['radios'])], outline=c('verde', 255), width=3)
    for calle in PLANO['calles']:
        eje = calle['eje_px'] + (calle['eje_px'][:1] if calle.get('cerrada') else [])
        ancho = calle['ancho'] / PLANO['escala']
        largo = max(1, round(abs(a((ancho, 0))[0] - a((0, 0))[0])))
        d.line([a(p) for p in eje], fill=c('calle'), width=largo, joint='curve')
    for e in PLANO['edificios']:
        d.polygon([a(p) for p in e['poligono_px']], fill=c(e['id']), outline=(30, 30, 30, 255), width=2)
    for m in PLANO['muros_luces']:
        d.line([a(p) for p in m['linea_px']], fill=c('luces', 255), width=4)
    for p in PLANO['palmeras_px']:
        x, y = a(p)
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=c('palmera', 230), outline=(10, 60, 20, 255), width=2)
    for p in PLANO['farolas_px']:
        x, y = a(p)
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=c('farola', 255), outline=(60, 40, 0, 255))
    for p in PLANO['banderas_px']:
        x, y = a(p)
        d.rectangle([x - 2, y - 2, x + 2, y + 2], fill=(90, 160, 255, 255))
    z = PLANO['zona_jugable_px']
    d.line([a(p) for p in z + z[:1]], fill=c('zona', 255), width=3)


def plano() -> None:
    esc = PLANO['escala']
    ox, oy = PLANO['origen_px']
    # El dibujo cubre todo el satélite, en metros.
    ancho_m, alto_m = 986 * esc, 1210 * esc
    margen = 60
    W, H = round(ancho_m * PX_POR_METRO) + 2 * margen, round(alto_m * PX_POR_METRO) + 2 * margen + 40
    im = Image.new('RGBA', (W, H), (34, 38, 46, 255))
    d = ImageDraw.Draw(im)

    def a(p):
        return (margen + p[0] * esc * PX_POR_METRO, margen + p[1] * esc * PX_POR_METRO)

    # Grilla cada 10 m desde el origen (la marquesina).
    f = fuente(13)
    x0, y0 = a((ox, oy))
    for k in range(-40, 41):
        x = x0 + k * 10 * PX_POR_METRO
        if margen <= x <= W - margen:
            d.line([(x, margen), (x, H - margen - 40)], fill=(60, 66, 78, 255) if k else (110, 120, 140, 255))
            if k % 5 == 0:
                d.text((x + 3, margen - 18), f'{k * 10} m', font=f, fill=(150, 160, 180, 255))
        y = y0 + k * 10 * PX_POR_METRO
        if margen <= y <= H - margen - 40:
            d.line([(margen, y), (W - margen, y)], fill=(60, 66, 78, 255) if k else (110, 120, 140, 255))
            if k % 5 == 0:
                d.text((4, y + 3), f'{k * 10} m', font=f, fill=(150, 160, 180, 255))
    dibujar(d, a, transparente=False)

    rot = fuente(15)
    for e in PLANO['edificios']:
        xs = [a(p)[0] for p in e['poligono_px']]
        ys = [a(p)[1] for p in e['poligono_px']]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        if e['id'] == 'casino':  # el centro cae sobre el techo: el rótulo va en la punta de abajo
            cx, cy = a((660, 965))
        texto = f"{ROTULOS.get(e['id'], e['nombre'])}\n{e['alto']} m"
        d.multiline_text((cx, cy), texto, font=rot, fill=(20, 20, 25, 255), anchor='mm', align='center')
    for cartel in PLANO['carteles']:
        x, y = a(cartel['px'])
        d.text((x - 8, y), f"«{cartel['texto']}»", font=fuente(14), fill=(255, 255, 255, 255), anchor='rm', stroke_width=3, stroke_fill=(0, 0, 0, 255))
    d.text((x0, y0), '0', font=f, fill=(255, 255, 255, 255))

    # Norte, escala y leyenda.
    d.polygon([(W - 40, 20), (W - 50, 48), (W - 30, 48)], fill=(255, 255, 255, 255))
    d.text((W - 40, 52), 'N', font=fuente(16), fill=(255, 255, 255, 255), anchor='mt')
    yb = H - 30
    d.line([(margen, yb), (margen + 50 * PX_POR_METRO, yb)], fill=(255, 255, 255, 255), width=4)
    d.text((margen + 50 * PX_POR_METRO + 8, yb), '50 m', font=f, fill=(255, 255, 255, 255), anchor='lm')
    leyenda = [('palmera', 'palmera'), ('farola', 'farola'), ('luces', 'muro con luces rosas'), ('zona', 'zona jugable propuesta (paredes invisibles)')]
    x = margen + 50 * PX_POR_METRO + 80
    for clave, texto in leyenda:
        d.rectangle([x, yb - 6, x + 12, yb + 6], fill=COLORES[clave] + (255,))
        d.text((x + 18, yb), texto, font=f, fill=(220, 220, 230, 255), anchor='lm')
        x += 30 + d.textlength(texto, font=f)
    salida = RAIZ / 'tools/plano/plano.png'
    im.convert('RGB').save(salida)
    print(salida)


def sobre_satelite() -> None:
    if not SATELITE.exists():
        return
    foto = Image.open(SATELITE).convert('RGBA')
    capa = Image.new('RGBA', foto.size, (0, 0, 0, 0))
    dibujar(ImageDraw.Draw(capa), lambda p: (p[0], p[1]), transparente=True)
    salida = SATELITE.with_name('plano_sobre_satelite.png')
    Image.alpha_composite(foto, capa).convert('RGB').save(salida)
    print(salida)


plano()
sobre_satelite()
