#!/usr/bin/env python3
"""
Gera os emails das sequências de Live 2, 3, 4 e Final a partir
dos templates da Live 1.

Lê os 4 arquivos de email-templates/sequencia-live/live-1-debito-credito/
e aplica substituições de string pra gerar as outras 4 lives.

Uso:
    python scripts/generate_live_emails.py

Idempotente: rodar de novo gera os mesmos arquivos (overrides). Depois
de ajustar manualmente a Live 1, rode o script pra propagar mudanças
estruturais pras outras lives — depois aplique ajustes específicos.

IMPORTANTE — ordem das substituições:
Pra cada live, o dict tem duas seções:
  1) "Próxima live" — troca o que era a próxima no template (Live 2)
     pelo que vai ser a próxima dessa nova live (Live 3, por ex).
     Essa seção roda PRIMEIRO.
  2) "Própria live" — troca o que era a própria no template (Live 1)
     pelo que vai ser a nova (Live 2, por ex).
     Essa seção roda DEPOIS.

Essa ordem evita que "Live 1 → Live 2" interfira com "Live 2 → Live 3"
(pois Live 2 já virou Live 3 antes de Live 1 virar Live 2).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Força UTF-8 no stdout pra rodar no Windows sem erro de encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ========== Config ==========
TEMPLATE_DIR = Path("email-templates/sequencia-live/live-1-debito-credito")
OUTPUT_BASE  = Path("email-templates/sequencia-live")

# Arquivos de template (fonte) — estrutura de 5 emails por live
# (E4 "AO VIVO" adicionado em 20/04/2026 — dispara na hora exata da live)
EMAILS = [
    "E1-confirmacao.html",
    "E2-lembrete-1d.html",
    "E3-lembrete-1h.html",
    "E4-ao-vivo.html",
    "E5-replay.html",
]

# ========== Substituições pra cada live ==========
# ORDEM CRÍTICA:
#   1) Primeiro as substituições da PRÓXIMA LIVE (muda Live 2 → Live 3, etc)
#   2) Depois as substituições da PRÓPRIA LIVE (muda Live 1 → Live 2, etc)

LIVES = {
    "live-2-cpcs": {
        # === 1. PRÓXIMA LIVE (Live 2 no template → Live 3 no output) ===
        "Live 2 · Próxima": "Live 3 · Próxima",
        "GARANTIR VAGA NA LIVE 2": "GARANTIR VAGA NA LIVE 3",
        "70 CPCs. Banca cobra 5. Quais?": "O CPC que matou o CPC 26. Será?",
        "quinta-feira, <strong>28 de maio</strong>": "terça-feira, <strong>2 de junho</strong>",
        "live-2-cpcs.html": "live-3-cpc-51.html",
        "Se perdeu, assiste agora. Se viu, vem pra Live 2.": "Se perdeu, assiste agora. Se viu, vem pra Live 3.",

        # === 2. PRÓPRIA LIVE (Live 1 no template → Live 2 no output) ===
        "Live 1": "Live 2",
        "LIVE 1": "LIVE 2",
        "live-1-debito-credito": "live-2-cpcs",
        "LINK_DA_LIVE_1": "LINK_DA_LIVE_2",
        # Tema (ordem importa: versão com <br> antes da sem)
        "Por que você erra Débito e Crédito<br>(e como parar)": "70 CPCs.<br>Banca cobra 5. Quais?",
        "Por que você erra Débito e Crédito (e como parar)": "70 CPCs. Banca cobra 5. Quais?",
        "Por que você erra Débito e Crédito": "70 CPCs. Banca cobra 5. Quais?",
        "Débito e Crédito": "5 CPCs da fiscal",
        # Data
        "quinta-feira, 21 de maio": "quinta-feira, 28 de maio",
        "21 de maio": "28 de maio",
        # "Até quinta" — Live 2 também é quinta, mantém
    },
    "live-3-cpc-51": {
        # === 1. PRÓXIMA LIVE (Live 2 → Live 4) ===
        "Live 2 · Próxima": "Live 4 · Próxima",
        "GARANTIR VAGA NA LIVE 2": "GARANTIR VAGA NA LIVE 4",
        "70 CPCs. Banca cobra 5. Quais?": "7 pegadinhas que as bancas adoram. Erre 3 e reprove.",
        "quinta-feira, <strong>28 de maio</strong>": "quinta-feira, <strong>11 de junho</strong>",
        "live-2-cpcs.html": "live-4-pegadinhas.html",
        "Se perdeu, assiste agora. Se viu, vem pra Live 2.": "Se perdeu, assiste agora. Se viu, vem pra Live 4.",

        # === 2. PRÓPRIA LIVE (Live 1 → Live 3) ===
        "Live 1": "Live 3",
        "LIVE 1": "LIVE 3",
        "live-1-debito-credito": "live-3-cpc-51",
        "LINK_DA_LIVE_1": "LINK_DA_LIVE_3",
        "Por que você erra Débito e Crédito<br>(e como parar)": "O CPC que matou<br>o CPC 26. Será?",
        "Por que você erra Débito e Crédito (e como parar)": "O CPC que matou o CPC 26. Será?",
        "Por que você erra Débito e Crédito": "O CPC que matou o CPC 26. Será?",
        "Débito e Crédito": "CPC 51",
        "quinta-feira, 21 de maio": "terça-feira, 2 de junho",
        "21 de maio": "2 de junho",
        "Até quinta": "Até terça",
    },
    "live-4-pegadinhas": {
        # === 1. PRÓXIMA LIVE (Live 2 → Live Final) ===
        "Live 2 · Próxima": "Live Final · Lançamento",
        "GARANTIR VAGA NA LIVE 2": "GARANTIR VAGA NA LIVE FINAL",
        "70 CPCs. Banca cobra 5. Quais?": "🚨 Lançamento oficial do Fluência Contábil",
        "quinta-feira, <strong>28 de maio</strong>": "quinta-feira, <strong>18 de junho</strong>",
        "live-2-cpcs.html": "live-final.html",
        "Se perdeu, assiste agora. Se viu, vem pra Live 2.": "Se perdeu, assiste agora. Se viu, vem pra Live Final.",

        # === 2. PRÓPRIA LIVE (Live 1 → Live 4) ===
        "Live 1": "Live 4",
        "LIVE 1": "LIVE 4",
        "live-1-debito-credito": "live-4-pegadinhas",
        "LINK_DA_LIVE_1": "LINK_DA_LIVE_4",
        "Por que você erra Débito e Crédito<br>(e como parar)": "7 pegadinhas que as bancas<br>adoram. Erre 3 e reprove.",
        "Por que você erra Débito e Crédito (e como parar)": "7 pegadinhas que as bancas adoram. Erre 3 e reprove.",
        "Por que você erra Débito e Crédito": "7 pegadinhas que as bancas adoram",
        "Débito e Crédito": "7 Pegadinhas",
        "quinta-feira, 21 de maio": "quinta-feira, 11 de junho",
        "21 de maio": "11 de junho",
    },
    "live-final": {
        # Live Final só tem E1, E2, E3 — o E4 é variante separada
        # (gerada manualmente nos broadcasts de lançamento)
        # Não tem "próxima live" — pula o passo 1

        # === PRÓPRIA LIVE (Live 1 → Live Final) ===
        "Live 1": "Live Final",
        "LIVE 1": "LIVE FINAL",
        "live-1-debito-credito": "live-final",
        "LINK_DA_LIVE_1": "LINK_DA_LIVE_FINAL",
        "Por que você erra Débito e Crédito<br>(e como parar)": "🚨 Lançamento oficial<br>do Fluência Contábil",
        "Por que você erra Débito e Crédito (e como parar)": "🚨 Lançamento oficial do Fluência Contábil",
        "Por que você erra Débito e Crédito": "Lançamento do Fluência Contábil",
        "Débito e Crédito": "Lançamento",
        "quinta-feira, 21 de maio": "quinta-feira, 18 de junho",
        "21 de maio": "18 de junho",
        "Pré-lançamento": "Lançamento Oficial",
    },
}

# ========== Main ==========
def generate_live(live_slug: str, substitutions: dict[str, str]) -> None:
    """Gera os arquivos da live destino aplicando substitutions."""
    output_dir = OUTPUT_BASE / live_slug
    output_dir.mkdir(parents=True, exist_ok=True)

    # Live Final pula o E4 (variante própria com broadcasts)
    emails_to_process = EMAILS[:-1] if live_slug == "live-final" else EMAILS

    count = 0
    for email_file in emails_to_process:
        source = TEMPLATE_DIR / email_file
        dest   = output_dir / email_file

        if not source.exists():
            print(f"  [skip] template não existe: {source}")
            continue

        with open(source, "r", encoding="utf-8") as f:
            content = f.read()

        # Aplica substituições na ordem fornecida (dict preserva ordem no Python 3.7+)
        for old, new in substitutions.items():
            content = content.replace(old, new)

        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)

        count += 1
        print(f"  ok {dest}")

    print(f"  -> {count} emails gerados pra {live_slug}\n")


def main() -> int:
    # Valida que os templates existem
    missing = [f for f in EMAILS if not (TEMPLATE_DIR / f).exists()]
    if missing:
        print(f"ERRO: templates faltando em {TEMPLATE_DIR}:")
        for f in missing:
            print(f"  - {f}")
        return 1

    print(f"Gerando emails de Live a partir de {TEMPLATE_DIR}...\n")
    for slug, subs in LIVES.items():
        print(f"-> {slug}")
        generate_live(slug, subs)

    print("Pronto. Emails gerados:")
    for slug in LIVES:
        count = 3 if slug == "live-final" else 4
        print(f"  - {slug}: {count} emails")
    total = sum(3 if s == "live-final" else 4 for s in LIVES)
    print(f"\nTotal: {total} emails gerados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
