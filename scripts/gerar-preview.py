# Gera a imagem de prévia do link (og:image), 1200x630 → public/preview.png
#
# Uso:  python -m pip install Pillow
#       python scripts/gerar-preview.py public/preview.png
#
# É o cartão que o WhatsApp mostra quando alguém manda o link do bolão — a
# primeira impressão de quem recebe o convite, muitas vezes antes de abrir
# qualquer coisa. Sem imagem, o WhatsApp exibe um cartão só de texto, que
# parece link duvidoso.
#
# Fica em script (e não numa imagem solta) para o texto e as cores poderem ser
# refeitos quando a marca mudar, sem depender de editor de imagem.
# Mesma identidade da landing: verde de campo em degradê, escudo com bola,
# nome em dois pesos e o dourado como assinatura.
from PIL import Image, ImageDraw, ImageFont
import math, sys

L, A = 1200, 630
VERDE_TOPO = (6, 42, 23)
VERDE_BASE = (4, 23, 13)
OURO = (255, 215, 0)
CLARO = (233, 238, 242)
VERDE_CLARO = (110, 231, 165)

img = Image.new('RGB', (L, A), VERDE_BASE)
d = ImageDraw.Draw(img, 'RGBA')

# Degradê vertical
for y in range(A):
    t = y / A
    c = tuple(int(VERDE_TOPO[i] + (VERDE_BASE[i] - VERDE_TOPO[i]) * min(1, t * 1.6)) for i in range(3))
    d.line([(0, y), (L, y)], fill=c)

# Brilho de refletor no canto superior esquerdo
for r in range(560, 0, -8):
    a = int(16 * (1 - r / 560))
    d.ellipse([-220 - r // 2, -320 - r // 2, -220 + r, -320 + r], fill=(16, 185, 87, a))

# Listras de gramado bem sutis
for x in range(0, L, 120):
    d.rectangle([x, 0, x + 60, A], fill=(255, 255, 255, 4))

def fonte(nome, tam):
    return ImageFont.truetype(f'C:/Windows/Fonts/{nome}', tam)

# ── Escudo ───────────────────────────────────────────────────────────────
cx, cy, s = 148, 232, 108
escudo = [
    (cx, cy - s), (cx + s * 0.86, cy - s * 0.74), (cx + s * 0.86, cy + s * 0.12),
    (cx, cy + s * 1.06), (cx - s * 0.86, cy + s * 0.12), (cx - s * 0.86, cy - s * 0.74),
]
d.polygon(escudo, fill=(0, 133, 66), outline=OURO)
# contorno mais grosso
for w in range(4):
    d.line(escudo + [escudo[0]], fill=OURO, width=5)

# Bola: círculo + pentágono central + costuras
bx, by, br = cx, cy + 6, 40
d.ellipse([bx - br, by - br, bx + br, by + br], fill=(11, 42, 24), outline=OURO, width=5)
pent = [(bx + 20 * math.cos(math.radians(-90 + i * 72)),
         by + 20 * math.sin(math.radians(-90 + i * 72))) for i in range(5)]
d.polygon(pent, fill=OURO)
for i in range(5):
    ang = math.radians(-90 + i * 72 + 36)
    d.line([(bx + 22 * math.cos(ang), by + 22 * math.sin(ang)),
            (bx + 38 * math.cos(ang), by + 38 * math.sin(ang))], fill=OURO, width=4)

# ── Textos ───────────────────────────────────────────────────────────────
x0 = 280

f_marca_a = fonte('seguibl.ttf', 58)
f_marca_b = fonte('seguibl.ttf', 58)
d.text((x0, 176), 'BRASIL', font=f_marca_a, fill=CLARO)
w = d.textlength('BRASIL', font=f_marca_a)
d.text((x0 + w, 176), 'BOLÃO', font=f_marca_b, fill=OURO)

f_sub = fonte('segoeuib.ttf', 30)
d.text((x0, 252), 'O bolão do Brasileirão, do jeito fácil', font=f_sub, fill=VERDE_CLARO)

# Linha divisória
d.line([(x0, 320), (L - 90, 320)], fill=(110, 231, 165, 60), width=2)

f_item = fonte('segoeuib.ttf', 34)
itens = [
    'Palpites pelo celular, sem instalar nada',
    'Ranking automático a cada rodada',
    'Cartelas por PIX, direto com o organizador',
]
y = 362
for it in itens:
    d.ellipse([x0, y + 12, x0 + 14, y + 26], fill=OURO)
    d.text((x0 + 32, y), it, font=f_item, fill=CLARO)
    y += 58

# Rodapé com o endereço
f_url = fonte('seguibl.ttf', 30)
d.text((x0, 548), 'brasilbolao.com.br', font=f_url, fill=OURO)

img.save(sys.argv[1], 'PNG', optimize=True)
print('gerado:', sys.argv[1], img.size)
