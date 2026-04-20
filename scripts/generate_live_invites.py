#!/usr/bin/env python3
"""
Gera os 8 broadcasts de convite pras Lives 2, 3, 4 e Final
a partir dos templates D-3 e D-0 da Live 1.

Lê:
  email-templates/broadcasts/convites-lives/live-1-debito-credito/D-3.html
  email-templates/broadcasts/convites-lives/live-1-debito-credito/D-0.html

Gera (8 arquivos):
  email-templates/broadcasts/convites-lives/live-2-cpcs/D-3.html, D-0.html
  email-templates/broadcasts/convites-lives/live-3-cpc-51/D-3.html, D-0.html
  email-templates/broadcasts/convites-lives/live-4-pegadinhas/D-3.html, D-0.html
  email-templates/broadcasts/convites-lives/live-final/D-3.html, D-0.html

Uso:
    python scripts/generate_live_invites.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ========== Config ==========
TEMPLATE_DIR = Path("email-templates/broadcasts/convites-lives/live-1-debito-credito")
OUTPUT_BASE  = Path("email-templates/broadcasts/convites-lives")
EMAILS = ["D-3.html", "D-0.html"]

# ========== Substituições ==========
LIVES = {
    "live-2-cpcs": {
        # Identidade
        "Live 1": "Live 2",
        "LIVE 1": "LIVE 2",
        "live-1-debito-credito": "live-2-cpcs",
        # Tema (ordem importa)
        "Por que você erra Débito e Crédito (e como parar)": "70 CPCs. Banca cobra 5. Quais?",
        "Por que você erra Débito e Crédito": "70 CPCs. Banca cobra 5. Quais?",
        "Débito e Crédito": "5 CPCs da fiscal",
        # Data
        "quinta-feira, 21 de maio": "quinta-feira, 28 de maio",
        "21 de maio": "28 de maio",
        # "Até quinta" mantém (Live 2 é quinta também)
        # Ganchos (3 bullets)
        "A lógica por trás de Débito e Crédito — sem decoreba": "Quais são os 5 CPCs que CEBRASPE, FGV e FCC mais cobram",
        "O erro mais comum em lançamentos (e como evitar)": "O padrão escondido que conecta esses 5 pronunciamentos",
        "Um macete pra nunca mais confundir os dois": "Priorização de estudo pras últimas semanas antes da prova",
    },
    "live-3-cpc-51": {
        "Live 1": "Live 3",
        "LIVE 1": "LIVE 3",
        "live-1-debito-credito": "live-3-cpc-51",
        "Por que você erra Débito e Crédito (e como parar)": "O CPC que matou o CPC 26. Será?",
        "Por que você erra Débito e Crédito": "O CPC que matou o CPC 26. Será?",
        "Débito e Crédito": "CPC 51",
        "quinta-feira, 21 de maio": "terça-feira, 2 de junho",
        "21 de maio": "2 de junho",
        "Até quinta": "Até terça",
        "A lógica por trás de Débito e Crédito — sem decoreba": "O que mudou do CPC 26 pro CPC 51 — na prática",
        "O erro mais comum em lançamentos (e como evitar)": "Por que algumas bancas chamam o CPC 51 de \"o CPC que matou o CPC 26\"",
        "Um macete pra nunca mais confundir os dois": "As armadilhas que já apareceram em provas recentes",
    },
    "live-4-pegadinhas": {
        "Live 1": "Live 4",
        "LIVE 1": "LIVE 4",
        "live-1-debito-credito": "live-4-pegadinhas",
        "Por que você erra Débito e Crédito (e como parar)": "7 pegadinhas que as bancas adoram. Erre 3 e reprove.",
        "Por que você erra Débito e Crédito": "7 pegadinhas que as bancas adoram",
        "Débito e Crédito": "7 Pegadinhas",
        "quinta-feira, 21 de maio": "quinta-feira, 11 de junho",
        "21 de maio": "11 de junho",
        "A lógica por trás de Débito e Crédito — sem decoreba": "As 7 pegadinhas clássicas que 90% dos concurseiros caem",
        "O erro mais comum em lançamentos (e como evitar)": "O padrão que as bancas usam pra construir essas armadilhas",
        "Um macete pra nunca mais confundir os dois": "Como desarmar cada uma em menos de 30 segundos",
    },
    "live-final": {
        "Live 1": "Live Final",
        "LIVE 1": "LIVE FINAL",
        "live-1-debito-credito": "live-final",
        "Por que você erra Débito e Crédito (e como parar)": "🚨 Lançamento oficial do Fluência Contábil",
        "Por que você erra Débito e Crédito": "🚨 Lançamento oficial do Fluência Contábil",
        "Débito e Crédito": "Lançamento",
        "Pré-lançamento": "Lançamento Oficial",
        "quinta-feira, 21 de maio": "quinta-feira, 18 de junho",
        "21 de maio": "18 de junho",
        "A lógica por trás de Débito e Crédito — sem decoreba": "Tudo que o Fluência Contábil entrega: 4 módulos, 40+ aulas, 1.000+ questões",
        "O erro mais comum em lançamentos (e como evitar)": "Como funciona a turma ao vivo exclusiva (70 vagas)",
        "Um macete pra nunca mais confundir os dois": "Condições exclusivas pra quem comprar no dia",
    },
}

# ========== Main ==========
def generate_live(live_slug: str, substitutions: dict[str, str]) -> None:
    output_dir = OUTPUT_BASE / live_slug
    output_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for email_file in EMAILS:
        source = TEMPLATE_DIR / email_file
        dest   = output_dir / email_file

        if not source.exists():
            print(f"  [skip] template não existe: {source}")
            continue

        with open(source, "r", encoding="utf-8") as f:
            content = f.read()

        for old, new in substitutions.items():
            content = content.replace(old, new)

        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)

        count += 1
        print(f"  ok {dest}")

    print(f"  -> {count} broadcasts gerados pra {live_slug}\n")


def main() -> int:
    missing = [f for f in EMAILS if not (TEMPLATE_DIR / f).exists()]
    if missing:
        print(f"ERRO: templates faltando em {TEMPLATE_DIR}:")
        for f in missing:
            print(f"  - {f}")
        return 1

    print(f"Gerando broadcasts de convite a partir de {TEMPLATE_DIR}...\n")
    for slug, subs in LIVES.items():
        print(f"-> {slug}")
        generate_live(slug, subs)

    total = len(LIVES) * len(EMAILS)
    print(f"Pronto. Total: {total} broadcasts gerados ({len(LIVES)} lives × {len(EMAILS)} emails).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
