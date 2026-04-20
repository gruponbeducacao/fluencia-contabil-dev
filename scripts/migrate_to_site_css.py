"""Migração Onda 2: consolida CSS base no site.css externo.

Para cada HTML listado:
1. Adiciona <link rel="preconnect"> antes do 1o Google Fonts link (se nao existir).
2. Garante que a URL do Google Fonts inclui Montserrat 800;900 e Source Serif 4
   (obrigatorios pelo site.css). Posts do blog que tinham so Montserrat 400-700
   ganham os pesos extras. Quattrocento+Sans dos posts e preservada.
3. Remove o 1o bloco <style>:root{--azul:...</style> (CSS base duplicado).
4. Insere <link rel="stylesheet" href="assets/site.css"> no lugar.
5. Padroniza #C9A84C -> var(--dourado).

Blocos <style> posteriores (CSS especifico da pagina) sao preservados.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = [
    # raiz (7) - index.html ja migrada manualmente
    "blog.html",
    "cursos.html",
    "contato.html",
    "depoimentos.html",
    "desafios.html",
    "institucional.html",
    "professor.html",
    # blog posts (9)
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

# URL canonica de fontes: cobre site.css (Montserrat 400-900 + Source Serif 4)
# e posts do blog (Quattrocento+Sans). Unica pra todas as paginas.
CANON_FONTS_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Montserrat:wght@400;500;600;700;800;900"
    "&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400"
    "&family=Quattrocento+Sans:ital,wght@0,400;0,700;1,400"
    "&display=swap"
)

FONTS_LINK_RE = re.compile(
    r'<link\s+href="https://fonts\.googleapis\.com/[^"]+"\s+rel="stylesheet">'
)

BASE_STYLE_RE = re.compile(
    r'<style>\s*:root\{--azul:.*?</style>',
    re.DOTALL,
)

PRECONNECT_BLOCK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
)

SITE_CSS_LINK = '<link rel="stylesheet" href="assets/site.css">'


def migrate_page(path: Path) -> tuple[bool, str]:
    content = path.read_text(encoding="utf-8")
    original = content
    changes = []

    # 1. Preconnect (antes do 1o Google Fonts link)
    if 'rel="preconnect" href="https://fonts.googleapis.com"' not in content:
        m = FONTS_LINK_RE.search(content)
        if m:
            content = content[: m.start()] + PRECONNECT_BLOCK + content[m.start() :]
            changes.append("preconnect")

    # 2. Padroniza URL de fontes (so se a atual nao cobre os pesos)
    m = FONTS_LINK_RE.search(content)
    if m:
        current_url = m.group(0)
        if (
            "Montserrat:wght@400;500;600;700;800;900" not in current_url
            or "Source+Serif+4" not in current_url
        ):
            new_link = f'<link href="{CANON_FONTS_URL}" rel="stylesheet">'
            content = content[: m.start()] + new_link + content[m.end() :]
            changes.append("fonts-url")

    # 3. Remove bloco <style>:root{--azul... + insere link pro site.css
    if SITE_CSS_LINK not in content:
        m = BASE_STYLE_RE.search(content)
        if m:
            content = content[: m.start()] + SITE_CSS_LINK + content[m.end() :]
            changes.append("css-base -> site.css")
        else:
            return False, "bloco CSS base nao encontrado"

    # 4. Padroniza dourado
    if "#C9A84C" in content:
        content = content.replace("#C9A84C", "var(--dourado)")
        changes.append("C9A84C -> var(--dourado)")

    if content == original:
        return False, "nada a mudar"

    path.write_text(content, encoding="utf-8")
    return True, ", ".join(changes)


def main():
    print(f"Migracao de {len(PAGES)} paginas para site.css externo\n")
    ok, skipped, errors = 0, 0, 0
    for rel in PAGES:
        p = ROOT / rel
        if not p.exists():
            print(f"  [err] {rel}: arquivo nao encontrado")
            errors += 1
            continue
        try:
            changed, msg = migrate_page(p)
            marker = "[ok]" if changed else "[..]"
            print(f"  {marker} {rel}: {msg}")
            if changed:
                ok += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  [err] {rel}: erro - {e}")
            errors += 1

    print(f"\nResultado: {ok} migradas | {skipped} puladas | {errors} erros")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
