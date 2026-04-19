#!/usr/bin/env python3
"""
Fluência Contábil — Gerador de RSS do blog.

Lê os posts em blog/*.html, extrai metadados do bloco JSON-LD 'BlogPosting'
de cada um (com fallback pra meta tags Open Graph) e gera blog/feed.xml
em RSS 2.0 válido, com posts ordenados do mais recente pro mais antigo.

Uso:
    python scripts/generate_rss.py

Sem dependências externas — usa apenas a stdlib do Python. Idempotente:
se nada mudou, o arquivo gerado é byte-a-byte igual ao anterior.

O arquivo resultante pode ser consumido por ferramentas de RSS Campaign
(ex: MailerLite) pra disparar emails automaticamente a cada novo post.
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import formatdate
from html import unescape

# ========== Config ==========
SITE_URL          = "https://fluenciacontabil.com.br"
BLOG_DIR          = "blog"
OUT_FILE          = os.path.join(BLOG_DIR, "feed.xml")
FEED_TITLE        = "Fluência Contábil — Blog"
FEED_DESCRIPTION  = "Artigos sobre contabilidade para concursos fiscais, de controle e tribunais de contas."
FEED_LANGUAGE     = "pt-br"
FEED_AUTHOR_EMAIL = "contato@fluenciacontabil.com.br"
FEED_AUTHOR_NAME  = "Equipe Fluência Contábil"


# ========== Helpers ==========
def extract_jsonld(html: str) -> dict | None:
    """Extrai o primeiro bloco JSON-LD do HTML (BlogPosting)."""
    match = re.search(
        r'<script\s+type=["\']application/ld\+json["\']\s*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    if not match:
        return None
    raw = match.group(1).strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            # Às vezes vem como array de múltiplos schemas
            for item in data:
                if isinstance(item, dict) and item.get("@type") in ("BlogPosting", "Article"):
                    return item
            return data[0] if data else None
        return data
    except json.JSONDecodeError:
        return None


def parse_date(s: str | None) -> datetime | None:
    """Parseia string ISO 8601 e retorna datetime timezone-aware (UTC)."""
    if not s:
        return None
    try:
        if len(s) == 10:  # "YYYY-MM-DD"
            dt = datetime.strptime(s, "%Y-%m-%d")
        else:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def rfc822(dt: datetime) -> str:
    """Formata datetime no formato RFC 822 exigido pelo RSS 2.0."""
    return formatdate(dt.timestamp(), usegmt=True)


def xml_escape(s: str | None) -> str:
    """Escape conservador pra XML (ampersand, < > " ')."""
    if s is None:
        return ""
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )


def extract_meta(html: str, attr: str, value: str) -> str | None:
    """Extrai o 'content' de uma meta tag por atributo (name, property)."""
    # Suporta ordem attr/content ou content/attr, aspas simples ou duplas
    pattern = (
        rf'<meta\s+[^>]*{attr}=["\']{re.escape(value)}["\'][^>]*content=["\']([^"\']+)["\']'
        rf'|<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*{attr}=["\']{re.escape(value)}["\']'
    )
    m = re.search(pattern, html, re.IGNORECASE)
    if m:
        return unescape(m.group(1) or m.group(2))
    return None


def extract_canonical(html: str) -> str | None:
    """Extrai rel=canonical do HTML."""
    m = re.search(
        r'<link\s+[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']'
        r'|<link\s+[^>]*href=["\']([^"\']+)["\'][^>]*rel=["\']canonical["\']',
        html, re.IGNORECASE
    )
    if m:
        return m.group(1) or m.group(2)
    return None


# ========== Core ==========
def load_posts() -> list[dict]:
    """Carrega e normaliza os metadados de todos os posts do blog."""
    posts: list[dict] = []
    pattern = os.path.join(BLOG_DIR, "*.html")

    for path in sorted(glob.glob(pattern)):
        basename = os.path.basename(path)
        if basename.lower() in ("index.html", "feed.xml"):
            continue

        with open(path, "r", encoding="utf-8") as f:
            html = f.read()

        jsonld = extract_jsonld(html) or {}

        # Título
        title = jsonld.get("headline") or extract_meta(html, "property", "og:title")
        if not title:
            m = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
            if m:
                title = unescape(m.group(1))
        if not title:
            print(f"  [skip] sem título: {path}", file=sys.stderr)
            continue

        # Descrição
        description = jsonld.get("description") or ""
        if not description:
            description = extract_meta(html, "property", "og:description") or ""
        if not description:
            description = extract_meta(html, "name", "description") or ""

        # Data
        date_str = jsonld.get("datePublished") or extract_meta(html, "property", "article:published_time")
        pub_date = parse_date(date_str)

        # Categoria / seção
        section = jsonld.get("articleSection")

        # Autor
        author = FEED_AUTHOR_NAME
        author_obj = jsonld.get("author")
        if isinstance(author_obj, dict):
            author = author_obj.get("name", author)
        elif isinstance(author_obj, str):
            author = author_obj

        # URL canônica
        canonical = extract_canonical(html)
        if not canonical:
            slug = basename.replace(".html", "")
            canonical = f"{SITE_URL}/blog/{slug}"

        posts.append({
            "title": title.strip(),
            "description": description.strip(),
            "date": pub_date,
            "section": section,
            "author": author,
            "url": canonical,
        })

    # Ordena do mais recente pro mais antigo (posts sem data vão pro fim)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    posts.sort(key=lambda p: p["date"] or epoch, reverse=True)
    return posts


def build_rss(posts: list[dict]) -> str:
    """Gera o XML RSS 2.0 a partir da lista de posts."""
    now_utc = datetime.now(timezone.utc)
    last_build = rfc822(now_utc)
    dates = [p["date"] for p in posts if p["date"]]
    latest_pub = rfc822(max(dates) if dates else now_utc)

    items_xml: list[str] = []
    for p in posts:
        pub_date_line = f"      <pubDate>{rfc822(p['date'])}</pubDate>\n" if p["date"] else ""
        category_line = f"      <category>{xml_escape(p['section'])}</category>\n" if p["section"] else ""

        items_xml.append(
            "    <item>\n"
            f"      <title>{xml_escape(p['title'])}</title>\n"
            f"      <link>{xml_escape(p['url'])}</link>\n"
            f"      <guid isPermaLink=\"true\">{xml_escape(p['url'])}</guid>\n"
            f"      <description>{xml_escape(p['description'])}</description>\n"
            f"{pub_date_line}"
            f"{category_line}"
            f"      <author>{xml_escape(FEED_AUTHOR_EMAIL)} ({xml_escape(p['author'])})</author>\n"
            "    </item>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        '  <channel>\n'
        f'    <title>{xml_escape(FEED_TITLE)}</title>\n'
        f'    <link>{SITE_URL}/blog.html</link>\n'
        f'    <atom:link href="{SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>\n'
        f'    <description>{xml_escape(FEED_DESCRIPTION)}</description>\n'
        f'    <language>{FEED_LANGUAGE}</language>\n'
        f'    <lastBuildDate>{last_build}</lastBuildDate>\n'
        f'    <pubDate>{latest_pub}</pubDate>\n'
        '    <ttl>60</ttl>\n'
        + "\n".join(items_xml) + "\n"
        '  </channel>\n'
        '</rss>\n'
    )


def main() -> int:
    posts = load_posts()
    if not posts:
        print("Nenhum post válido encontrado.", file=sys.stderr)
        return 1

    rss = build_rss(posts)

    with open(OUT_FILE, "w", encoding="utf-8", newline="\n") as f:
        f.write(rss)

    print(f"Gerado {OUT_FILE} com {len(posts)} posts:")
    for p in posts:
        date_str = p["date"].strftime("%Y-%m-%d") if p["date"] else "????-??-??"
        title = p["title"][:70] + ("…" if len(p["title"]) > 70 else "")
        print(f"  {date_str}  {title}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
