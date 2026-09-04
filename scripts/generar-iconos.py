#!/usr/bin/env python3
"""
Genera la iconografía de spendApp a partir de la marca del login.

La fuente de verdad del dibujo es `src/components/AppLogoMark.tsx`: dos
cuadrados redondeados superpuestos —petróleo arriba-izquierda, verde salvia
abajo-derecha con 85% de opacidad— y una «S» blanca centrada sobre los dos.
Las proporciones de acá salen de ahí y no se inventaron: si la marca del login
cambia, este script se actualiza y se vuelve a correr.

Por qué un script y no PNGs sueltos: los íconos que había eran los del template
de Expo (20 de mayo, nunca tocados). Un asset binario sin forma de regenerarlo
es exactamente lo que no se puede revisar ni ajustar después.

    python3 scripts/generar-iconos.py

Salidas en assets/images/ (todas 1024 salvo el favicon):
  icon.png                     iOS + general. Opaco y a sangre: iOS aplica su
                               propia máscara, así que NO lleva esquinas
                               redondeadas ni transparencia propias.
  android-icon-foreground.png  Capa de frente del ícono adaptativo. Android
                               recorta con la forma que quiera el launcher y
                               sólo garantiza un CÍRCULO del 66% del lienzo. La
                               marca es cuadrada, así que lo que tiene que
                               entrar en ese círculo es su DIAGONAL: un cuadrado
                               del 56% tiene diagonal 79% y se le comen las
                               esquinas. Por eso va al 46% (46 × 1,414 ≈ 65%).
  android-icon-background.png  Capa de fondo, color plano.
  android-icon-monochrome.png  Silueta para los íconos temáticos de Android 13+.
  splash-icon.png              Marca sola sobre transparente.
  favicon.png                  96×96 para la web.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "assets" / "images"

# --- Valores tomados de src/components/AppLogoMark.tsx --------------------
PETROLEO = (10, 110, 143, 255)      # #0A6E8F
SALVIA = (143, 188, 148, 217)       # #8FBC94 al 85%
BLANCO = (255, 255, 255, 255)

CUADRADO_A = 0.78                   # lado, sobre el lado de la marca
RADIO_A = 0.26
CUADRADO_B = 0.68
RADIO_B = 0.22
TIPO_S = 0.31                       # fontSize relativo a la marca

# La «S» se centra en la INTERSECCIÓN de los dos cuadrados, no en la caja de la
# marca. El cuadrado A ocupa [0, 0.78] y el B [0.32, 1.0]: se cruzan en
# [0.32, 0.78], cuyo centro es 0.55 — no 0.5. Centrarla en la caja (que es lo
# que hacía el login) la deja visiblemente corrida hacia arriba-izquierda
# respecto de la figura que el ojo lee como centro.
CENTRO_S = (0.32 + CUADRADO_A) / 2   # = 0.55

# Fondo: el mismo que app.json ya declara para el ícono adaptativo de Android,
# así el ícono de iOS y el de Android no son dos marcas distintas.
FONDO = (230, 244, 254, 255)        # #E6F4FE

SUPERMUESTREO = 4                   # se dibuja a 4× y se baja: bordes limpios

# Lado de la marca en el ícono adaptativo de Android, sobre el lienzo. Sale de
# la zona segura circular del 66%: 0.46 × √2 ≈ 0.65, entra justo.
ADAPTATIVO = 0.46


def fuente(px: int) -> ImageFont.FreeTypeFont:
    """La «S» necesita un peso pesado (en el login es weight 800)."""
    intentos = [
        ("/System/Library/Fonts/SFNS.ttf", ["Black", "Heavy", "Bold"]),
        ("/System/Library/Fonts/Supplemental/Arial Black.ttf", []),
        ("/System/Library/Fonts/Helvetica.ttc", []),
    ]
    for ruta, variantes in intentos:
        if not Path(ruta).exists():
            continue
        f = ImageFont.truetype(ruta, px)
        for v in variantes:
            try:
                f.set_variation_by_name(v)
                return f
            except Exception:
                continue
        return f
    return ImageFont.load_default()


def dibujar_marca(lienzo: int, lado_marca: float, con_letra: bool = True,
                  color_a=PETROLEO, color_b=SALVIA, color_s=BLANCO) -> Image.Image:
    """La marca centrada sobre un lienzo transparente de `lienzo`×`lienzo`."""
    px = lienzo * SUPERMUESTREO
    m = lado_marca * SUPERMUESTREO
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ox = oy = (px - m) / 2

    # Cada cuadrado en su propia capa: el verde va con alfa y tiene que
    # componer sobre el petróleo, no pisarlo.
    capa_a = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(capa_a).rounded_rectangle(
        [ox, oy, ox + m * CUADRADO_A, oy + m * CUADRADO_A],
        radius=m * RADIO_A, fill=color_a)
    img = Image.alpha_composite(img, capa_a)

    capa_b = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(capa_b).rounded_rectangle(
        [ox + m * (1 - CUADRADO_B), oy + m * (1 - CUADRADO_B), ox + m, oy + m],
        radius=m * RADIO_B, fill=color_b)
    img = Image.alpha_composite(img, capa_b)

    if con_letra:
        d = ImageDraw.Draw(img)
        f = fuente(int(m * TIPO_S))
        # anchor "mm" centra por el medio real del glifo, no por su caja de texto:
        # una «S» centrada "a ojo" queda descolgada hacia abajo.
        d.text((ox + m * CENTRO_S, oy + m * CENTRO_S), "S",
               font=f, fill=color_s, anchor="mm")

    return img.resize((lienzo, lienzo), Image.LANCZOS)


def guardar(img: Image.Image, nombre: str) -> None:
    ruta = SALIDA / nombre
    img.save(ruta, "PNG")
    print(f"  {nombre:32} {img.size[0]}×{img.size[1]}")


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    print(f"Generando en {SALIDA}")

    # iOS y general: opaco, a sangre. La marca al 60% deja aire para que la
    # máscara redondeada de iOS no se coma nada.
    base = Image.new("RGBA", (1024, 1024), FONDO)
    guardar(Image.alpha_composite(base, dibujar_marca(1024, 1024 * 0.60)), "icon.png")

    # Android adaptativo: el frente va sobre transparente y bastante más chico.
    # Ver la nota del encabezado: manda la diagonal, no el lado.
    guardar(dibujar_marca(1024, 1024 * ADAPTATIVO), "android-icon-foreground.png")
    guardar(Image.new("RGBA", (1024, 1024), FONDO), "android-icon-background.png")

    # Monocromo (Android 13+): silueta sólida, la letra calada. El sistema la
    # tiñe con el color del tema, así que sólo importa el alfa.
    mono = dibujar_marca(1024, 1024 * ADAPTATIVO, con_letra=True,
                         color_a=(0, 0, 0, 255), color_b=(0, 0, 0, 255),
                         color_s=(0, 0, 0, 0))
    guardar(mono, "android-icon-monochrome.png")

    guardar(dibujar_marca(1024, 1024 * 0.82), "splash-icon.png")
    guardar(Image.alpha_composite(
        Image.new("RGBA", (96, 96), FONDO), dibujar_marca(96, 96 * 0.66)), "favicon.png")


if __name__ == "__main__":
    main()
