"""Onda 1 aplicada aos posts do blog (arquitetura diferente do site principal).

Nao unifica CSS (posts tem tokens/nav/fonte distintos). So aplica os
quick wins que nao dependem de arquitetura:

1. <link rel="preconnect"> antes do Google Fonts (se nao existir).
2. @media (prefers-reduced-motion: reduce) no final do <style> inline.
3. #C9A84C -> var(--dourado) (posts ja declaram --dourado no :root).
4. loading="lazy" + decoding="async" em todas as <img> (exceto a 1a do doc,
   que ganha loading="eager" + decoding="async" - evita regressao de LCP).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

POSTS = [
    "blog/balanco-patrimonial-estrutura.html",
    "blog/contabilidade-fcc-como-se-preparar.html",
    "blog/contabilidade-fgv-como-se-preparar.html",
    "blog/cpc-00-estrutura-conceitual.html",
    "blog/cpc-26-o-que-as-bancas-cobram.html",
    "blog/dre-como-montar-e-interpretar.html",
    "blog/o-que-e-contabilidade.html",
    "blog/pegadinhas-contabilidade-cebraspe.html",
    "blog/sefaz-sp-afre-contabilidade.html",
]

FONTS_LINK_RE = re.compile(
    r'<link\s+href="https://fonts\.googleapis\.com/[^"]+"\s+rel="stylesheet">'
)

IMG_RE = re.compile(r'<img\b[^>]*>', re.IGNORECASE)

PRECONNECT_BLOCK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
)

REDUCED_MOTION_CSS = """
/* Acessibilidade: respeita preferencia do sistema por menos movimento */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important;}
}
"""


def enrich_img(tag: str, is_first: bool) -> str:
    """Adiciona loading + decoding se nao tiver. 1a img = eager, resto = lazy."""
    if "loading=" in tag:
        return tag  # respeita marcacao existente
    loading = "eager" if is_first else "lazy"
    # Insere antes do > final
    if tag.endswith("/>"):
        return tag[:-2] + f' loading="{loading}" decoding="async"/>'
    return tag[:-1] + f' loading="{loading}" decoding="async">'


def apply_to_post(path: Path) -> tuple[bool, str]:
    content = path.read_text(encoding="utf-8")
    original = content
    changes = []

    # 1. Preconnect
    if 'rel="preconnect" href="https://fonts.googleapis.com"' not in content:
        m = FONTS_LINK_RE.search(content)
        if m:
            content = content[: m.start()] + PRECONNECT_BLOCK + content[m.start() :]
            changes.append("preconnect")

    # 2. prefers-reduced-motion no fim do 1o <style>
    if "prefers-reduced-motion" not in content:
        # Insere antes do 1o </style>
        idx = content.find("</style>")
        if idx != -1:
            content = content[:idx] + REDUCED_MOTION_CSS + content[idx:]
            changes.append("reduced-motion")

    # 3. Padroniza dourado - CUIDADO: nao tocar na declaracao do token
    # em :root{--dourado: #C9A84C}, senao vira ref circular.
    # Substitui so fora de contextos tipo "--dourado: ..." na declaracao.
    if "#C9A84C" in content:
        # Normaliza a declaracao de token pra #C8A84B (valor canonico do site.css)
        content = re.sub(
            r'(--dourado\s*:\s*)#C9A84C',
            r'\1#C8A84B',
            content,
        )
        # Substitui usos restantes (fora da declaracao) por var(--dourado)
        count = content.count("#C9A84C")
        if count > 0:
            content = content.replace("#C9A84C", "var(--dourado)")
            changes.append(f"C9A84C->var ({count}x) + --dourado->#C8A84B")
        else:
            changes.append("--dourado->#C8A84B")

    # 4. Lazy loading em imagens (1a eager, resto lazy)
    matches = list(IMG_RE.finditer(content))
    if matches:
        # Itera de tras pra frente pra nao bagunca offsets
        enriched = 0
        for i in range(len(matches) - 1, -1, -1):
            m = matches[i]
            is_first = (i == 0)
            new_tag = enrich_img(m.group(0), is_first)
            if new_tag != m.group(0):
                content = content[: m.start()] + new_tag + content[m.end() :]
                enriched += 1
        if enriched:
            changes.append(f"img loading ({enriched}x)")

    if content == original:
        return False, "nada a mudar"

    path.write_text(content, encoding="utf-8")
    return True, ", ".join(changes)


def main():
    print(f"Onda 1 aplicada a {len(POSTS)} posts do blog\n")
    ok, skipped, errors = 0, 0, 0
    for rel in POSTS:
        p = ROOT / rel
        if not p.exists():
            print(f"  [err] {rel}: arquivo nao encontrado")
            errors += 1
            continue
        try:
            changed, msg = apply_to_post(p)
            marker = "[ok]" if changed else "[..]"
            print(f"  {marker} {rel}: {msg}")
            if changed:
                ok += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  [err] {rel}: erro - {e}")
            errors += 1

    print(f"\nResultado: {ok} atualizados | {skipped} pulados | {errors} erros")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
