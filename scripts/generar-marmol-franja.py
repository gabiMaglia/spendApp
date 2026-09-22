# Tercera variante de mármol (T-137-sexies, pedido del PO): mismo shader que
# generar-marmol.py/generar-marmol-distendido.py —misma forma de veta— pero
# con otra semilla de dominio (T distinto) y otra escala: para una franja
# angosta (el navegador de mes en Personal, el total de Grupos), donde repetir
# el patrón "header" o "distendida" se leería como la misma foto de nuevo.
# Uso: python3 scripts/generar-marmol-franja.py (requiere numpy y Pillow)
import os
import numpy as np
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W_OUT, H_OUT = 1290, 720
SS = 2
W, H = W_OUT*SS, H_OUT*SS
T, INTEN = 97.0, 1.30  # T distinto: dominio de vetas totalmente distinto
def fract(x): return x - np.floor(x)
def h(px, py): return fract(np.sin(px*127.1 + py*311.7) * 43758.5453)
def n(px, py):
    ix, iy = np.floor(px), np.floor(py); fx, fy = px-ix, py-iy
    fx, fy = fx*fx*(3-2*fx), fy*fy*(3-2*fy)
    a, b = h(ix,iy), h(ix+1,iy); c, d = h(ix,iy+1), h(ix+1,iy+1)
    return (a+(b-a)*fx) + ((c+(d-c)*fx) - (a+(b-a)*fx))*fy
def fbm(px, py):
    v, a = 0.0, 0.5
    for _ in range(6):
        v = v + a*n(px, py)
        px, py = (0.8*px - 0.6*py)*2.03, (0.6*px + 0.8*py)*2.03
        a *= 0.5
    return v
def veta(qx, qy, esc, filo):
    s = np.abs(np.sin(qx*esc + fbm(qx*1.7, qy*1.7)*6.0))
    return (1.0 - s) ** filo
ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
ux, uy = (xs+0.5)/H, ((H-1-ys)+0.5)/H
qx, qy = ux*1.6 + T*0.012, uy*1.6 + T*0.004
wx = fbm(qx, qy + T*0.01); wy = fbm(qx+5.2 - T*0.008, qy+1.3 - T*0.008)
dx, dy = qx + 1.3*wx, qy + 1.3*wy
# esc 3.2→2.2: entre "header" (denso) y "distendida" (espaciado) — a media
# altura, apropiado para una franja angosta.
grueso = veta(dx*1.0, dy*0.55, 2.2, 200.0)
finas = veta(dx*1.3+7.1, dy*0.8+7.1, 5.2, 340.0) * 0.7
nube = fbm(dx*0.9+3.0, dy*0.9+3.0)
v = np.clip((grueso*0.9 + finas) * INTEN, 0, 1)[..., None]
rng = np.random.default_rng(7)
grano = (rng.random((H, W, 1)) - 0.5) * 0.012
fade_start = 0.62
t = np.clip((ys/(H-1) - fade_start) / (1-fade_start), 0, 1)[..., None]
t = t*t*(3-2*t)
for nombre, base, vet, k, bg in [
    ('claro', np.array([.984,.980,.972]) - (1-nube)[...,None]*0.03, np.array([.36,.38,.40]), 0.95, np.array([0xFB,0xFA,0xF8])/255),
    ('oscuro', np.array([.059,.066,.071]) + (nube-0.5)[...,None]*0.035, np.array([.62,.64,.63]), 0.55, np.array([0x0F,0x11,0x12])/255),
]:
    col = base + (vet - base) * (v*k) + grano
    col = col + (bg - col) * t
    img = Image.fromarray((np.clip(col,0,1)*255).round().astype(np.uint8)).resize((W_OUT, H_OUT), Image.LANCZOS)
    out = os.path.join(RAIZ, 'assets', 'images', f'marmol-{nombre}-franja.jpg')
    img.save(out, quality=86, optimize=True, progressive=True)
    print(out)
