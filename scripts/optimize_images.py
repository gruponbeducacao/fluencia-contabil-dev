"""Onda 5 - Otimização de imagens.

Para cada imagem PNG/JPG em IMAGES:
1. Se alguma dimensao > MAX_DIM, redimensiona preservando aspect.
2. Salva WebP lado a lado (mesma base, .webp), quality 85.
3. Reescreve o arquivo original otimizado (PNG optimize=True, JPG quality=85 progressive).
4. Reporta economia.

Depois, percorre HTMLs listados e substitui <img src="X.png|jpg"> por
<picture><source srcset="X.webp" type="image/webp"><img src="X.png|jpg"></picture>,
preservando todos os outros atributos (loading, decoding, alt, etc.).
"""
import re
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# Imagens a otimizar (caminhos relativos ao ROOT)
IMAGES = [
    "Logo_Completa_BrancoDourado_COM_TAGLINE_FUNDO_AZUL.png",   # nav
    "Logo_Completa_BrancoDourado_COM_TAGLINE.png",              # footer
    "assets/FC_Simbolo_BrancoDourado_FUNDO_AZUL.png",           # hero index
    "assets/foto-vinicius.jpg",                                  # bio professor
    "assets/prof-hero.jpg",                                      # hero professor
    "assets/favicon.png",                                        # favicon (super grande)
]

# Limite de dimensao: se a imagem passar disso, redimensiona.
# Valores escolhidos pra cobrir retina em exibicao maxima.
MAX_DIM = 1200  # pixels
WEBP_QUALITY = 85
JPG_QUALITY = 85

# Tamanhos especiais (logos renderizam pequenos, podem ser menores)
SPECIAL_MAX = {
    "Logo_Completa_BrancoDourado_COM_TAGLINE_FUNDO_AZUL.png": 400,   # nav altura max 48px desktop
    "Logo_Completa_BrancoDourado_COM_TAGLINE.png": 400,              # footer altura max 52px
    "assets/favicon.png": 128,                                        # favicon max 32px renderizado
}


def human_size(n: int) -> str:
    for unit in ["B", "KB", "MB"]:
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.0f} GB"


def optimize_one(rel: str) -> dict:
    path = ROOT / rel
    if not path.exists():
        return {"rel": rel, "skipped": "nao existe"}
    size_before = path.stat().st_size

    img = Image.open(path)
    orig_mode = img.mode
    w_orig, h_orig = img.size

    # Redimensiona se passar do max
    max_dim = SPECIAL_MAX.get(rel, MAX_DIM)
    if max(w_orig, h_orig) > max_dim:
        ratio = max_dim / max(w_orig, h_orig)
        new_w = int(w_orig * ratio)
        new_h = int(h_orig * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    else:
        new_w, new_h = w_orig, h_orig

    # Salva WebP
    webp_path = path.with_suffix(".webp")
    # WebP com alpha usa mode RGBA, sem alpha usa RGB
    if img.mode in ("RGBA", "LA"):
        img.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)
    else:
        if img.mode != "RGB":
            img_rgb = img.convert("RGB")
        else:
            img_rgb = img
        img_rgb.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)
    webp_size = webp_path.stat().st_size

    # Salva original otimizado
    if path.suffix.lower() == ".png":
        img.save(path, "PNG", optimize=True)
    else:  # jpg/jpeg
        save_img = img.convert("RGB") if img.mode in ("RGBA", "LA", "P") else img
        save_img.save(path, "JPEG", quality=JPG_QUALITY, progressive=True, optimize=True)
    size_after = path.stat().st_size

    return {
        "rel": rel,
        "dims": f"{w_orig}x{h_orig} -> {new_w}x{new_h}",
        "orig_before": size_before,
        "orig_after": size_after,
        "webp": webp_size,
        "savings_vs_before": size_before - min(webp_size, size_after),
    }


# Pattern pra capturar <img ...src="X.ext"...> sem estar dentro de <picture>
# Captura atributos antes e depois do src pra preservar loading, alt, decoding, etc.
IMG_TAG_RE = re.compile(
    r'<img\s+([^>]*?)src="([^"]+\.(?:png|jpg|jpeg))"([^>]*?)>',
    re.IGNORECASE,
)


def wrap_in_picture(html: str) -> tuple[str, int]:
    """Substitui <img src="X.png"> por <picture>...<img src="X.png">."""
    count = 0

    def replace(m):
        nonlocal count
        before, src, after = m.group(1), m.group(2), m.group(3)
        # Nao envolve se ja esta dentro de <picture> (checagem simples: look at preceding 40 chars)
        # Impreciso aqui; tratamos no nivel de ja-processado no HTML antes do apply.
        webp_src = re.sub(r"\.(png|jpg|jpeg)$", ".webp", src, flags=re.IGNORECASE)
        count += 1
        return (
            f'<picture>'
            f'<source srcset="{webp_src}" type="image/webp">'
            f'<img {before}src="{src}"{after}>'
            f'</picture>'
        )

    # Skip se <img> ja esta dentro de <picture> (procura "<picture>" nos 60 chars anteriores)
    # Jeito robusto: processar linha-a-linha checando contexto.
    new_html = []
    pos = 0
    for m in IMG_TAG_RE.finditer(html):
        # Checa se dentro de <picture>
        preceding = html[max(0, m.start() - 120) : m.start()]
        if "<picture>" in preceding and "</picture>" not in preceding:
            continue  # ja wrappado
        new_html.append(html[pos : m.start()])
        new_html.append(replace(m))
        pos = m.end()
    new_html.append(html[pos:])
    result = "".join(new_html)
    return result, count


def update_htmls() -> None:
    pages = []
    for p in sorted(ROOT.glob("*.html")):
        pages.append(p)
    for p in sorted((ROOT / "blog").glob("*.html")):
        pages.append(p)
    print("\n=== Atualizando HTMLs com <picture> ===\n")
    for p in pages:
        html = p.read_text(encoding="utf-8")
        new_html, n = wrap_in_picture(html)
        if new_html != html:
            p.write_text(new_html, encoding="utf-8")
            print(f"  [ok] {p.relative_to(ROOT)}: {n} <img> -> <picture>")


def main():
    print("=== Otimizacao de imagens ===\n")
    total_before = 0
    total_after_best = 0
    for rel in IMAGES:
        r = optimize_one(rel)
        if "skipped" in r:
            print(f"  [skip] {rel}: {r['skipped']}")
            continue
        best = min(r["orig_after"], r["webp"])
        total_before += r["orig_before"]
        total_after_best += best
        print(
            f"  [ok] {rel:<55} {r['dims']:<22} "
            f"orig: {human_size(r['orig_before'])} -> {human_size(r['orig_after'])}  "
            f"webp: {human_size(r['webp'])}"
        )
    print(
        f"\n  TOTAL: {human_size(total_before)} -> {human_size(total_after_best)} "
        f"(economia: {human_size(total_before - total_after_best)})"
    )
    update_htmls()
    return 0


if __name__ == "__main__":
    sys.exit(main())
