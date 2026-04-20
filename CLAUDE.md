# Fluência Contábil — Contexto do Projeto

> **Para futuras sessões:** este arquivo resume tudo que foi construído, decisões, endpoints, tags de rollback e o que está pendente. Leia antes de começar qualquer trabalho.

## Sobre o produto

**Fluência Contábil** — curso completo de contabilidade para concursos públicos (áreas fiscal, controle, tribunais de contas). Prof. Vinícius Ferraz (Auditor Fiscal). Posicionamento: "ensinar contabilidade como um idioma, pela lógica".

Lançamento previsto: **junho de 2026**. Hoje o site está em **pré-venda / lista de espera**. Distribuição inicial pela **Hotmart**; plataforma própria de alunos planejada pra médio prazo.

## Domínios

| Domínio | Serve | Branch/Repo |
|---|---|---|
| `fluenciacontabil.com.br` | produção principal | `origin/main` (repo `gruponbeducacao/fluencia-contabil`) |
| `dev.fluenciacontabil.com.br` | dev (validação antes de main) | `origin/dev` → GitHub Action replica pra `gruponbeducacao/fluencia-contabil-dev` (branch `main`) |
| `dicionario.fluenciacontabil.com.br` | LP de lead magnet (PDF gratuito) | repo separado `gruponbeducacao/dicionario-lp`, branch `main` |

**Fluxo de deploy do site principal:** commit em `dev` → Action `.github/workflows/deploy-dev.yml` replica pra repo de dev (subdomínio `dev.`). Depois, merge `dev → main` (via UI do GitHub ou CLI) publica em produção.

## Stack

- HTML/CSS/JS puro, sem build
- Google Fonts (Montserrat + Source Serif 4)
- GitHub Pages (servidor)
- Google Apps Script (backend de captura de leads)

## Paleta da marca

```css
--azul: #1B2A4A;         /* navy principal */
--azul-med: #2A3F6F;     /* hover */
--dourado: #C8A84B;      /* accent/CTA secundário */
--dourado-esc: #A68A3E;  /* hover do dourado */
--cream: #FBF6E9;
--texto: #1A1A1A;
--branco: #FFFFFF;
/* CTA primário (Lista de Espera, Newsletter): #C0392B (vermelho) */
```

Alguns posts mais novos usam `--azul-profundo: #1B2A4A` (mesma cor, nome diferente) e `--dourado: #C9A84C` (muito próximo). Há uma ligeira fragmentação de naming entre posts antigos e novos — ok por enquanto.

---

## Arquitetura de captura de leads (IMPLEMENTADO)

### Widgets

Todos implementados em `assets/email-capture.css` + `assets/email-capture.js`, injetados via `<link>` + `<script defer>` em cada HTML.

| Widget | Escopo | Gatilho | Endpoint / aba |
|---|---|---|---|
| **Exit-intent modal** | Todas as páginas | Desktop: `mouseleave` pelo topo (após 15s). Mobile: "engagement peak" (70% scroll + 4s idle, após 12s). No mobile, aparece como **bottom-sheet**. | Newsletter |
| **Sticky bar** | Todas as páginas | 50% de scroll OU 45s | Newsletter |
| **Share buttons** | Posts do blog (`/blog/*`) | Injetados antes da `.newsletter-section` | — (compartilhamento social) |
| **CTA inline** | Posts do blog (`/blog/*`) | Injetado no meio do `<article>` / `.article-body` / `.article-content` (antes de um H2 ~50%) | Lista de Espera |
| **Newsletter do blog** (interceptada) | Rodapé dos posts (form `.newsletter-form`) | Submit interceptado via capture-phase listener | Newsletter |
| **Lista de espera** (preservada) | `cursos.html` (form nativo com nome+email+whatsapp) | `submitLista()` — não interceptada, posta direto | Lista de Espera |

### Após submit — painel de referral

Substitui os success states de todos os widgets acima:
- Hash SHA-256(email + `fc-ref-v1`) → primeiros 10 caracteres hex = código de indicação
- Link único: `https://fluenciacontabil.com.br/?ref=<hash>`
- Botões de compartilhamento com cores oficiais: WhatsApp verde `#25D366`, X preto `#000`, LinkedIn `#0A66C2`
- Nos posts do blog, inclui botão extra verde "💬 Participe do grupo exclusivo de pré-lançamento" (WhatsApp group `https://chat.whatsapp.com/KWIP2oAR7KgCSAPW1Lqgtm`)
- Na lista de espera de `cursos.html`, o referral é **anexado abaixo** do success original — **preserva o botão do grupo WhatsApp intacto**
- Copy inclusivo: "amigo(a) concurseiro(a)", "inscrito(a)"

### Captura de ref (tracking de indicações)

- Qualquer página com `?ref=<hash>` (regex: `/^[a-f0-9]{6,16}$/i`) → salva em `localStorage.fc_ec_ref_in`
- Próximo submit em qualquer widget → envia o `ref` no payload
- Chega ao Apps Script na coluna `Ref`

### Endpoint unificado (Apps Script)

**URL atual em uso:**
```
https://script.google.com/macros/s/AKfycbx8lWrX5F0IByv0JEJ0iBGPjtLto7f2VxDHIh0uT0gZtvoj8EDVx0NFiriou-Dt0cxh/exec
```

Código está na planilha **"LEADS Fluência Contábil"** → Extensões → Apps Script (projeto "Leads Capture — Unified"). O script faz:
- Validação server-side de email (ignora inválidos)
- Roteamento por `origem`:
  - `exit_intent`, `sticky_bar`, `blog_newsletter`, `newsletter` → aba **Newsletter**
  - `blog_inline_cta`, `lista_espera`, `site_lista_espera` → aba **Lista de Espera**
  - Fallback: tem nome/whatsapp → Lista; senão → Newsletter
- Cria abas automaticamente se não existirem
- Aplica notas (tooltips) nos headers explicando cada coluna
- Grava data como `new Date()` nativo (permite fórmulas de tempo)
- `setupDashboard()` — função pra criar/recriar aba "Dashboard" com métricas agregadas e glossário. Executar manualmente quando quiser refresh.

**Endpoints antigos** (manter arquivados — não usar):
- Newsletter velha: `AKfycbzoQxsRFyD-6PjgBkzR8iC2jCQye6OtkdmYtOuXdrkGnlgkh4m-QaNUrAqZL64YoyM_`
- Lista de Espera velha: `AKfycbxDC5lbaNwmRr6bbR3ECo7WgamNgEJr5MyqkHGiMe2YE07P5PVixf_NY4bIleoZe88Z`

### Planilha "LEADS Fluência Contábil"

| Aba | Colunas |
|---|---|
| **Newsletter** | Data · E-mail · Origem · Ref · Página · Referrer · UTM Source · UTM Medium · UTM Campaign · Dispositivo |
| **Lista de Espera** | Data · Nome · E-mail · WhatsApp · Origem · Ref · Página · Referrer · UTM Source · UTM Medium · UTM Campaign · Dispositivo |
| **Lead Magnet - Dicionário** | Data · Nome · E-mail · WhatsApp · Origem · Página · Referrer · UTM Source · UTM Medium · UTM Campaign · Dispositivo |
| **Dashboard** | Métricas agregadas via fórmulas (TOTAIS · HOJE · ÚLTIMOS 7 DIAS · POR ORIGEM · POR DISPOSITIVO · TOP UTM · TOP REFERRERS · GLOSSÁRIO) |

Todos os headers têm `setNote()` com explicação (mouse hover).

### Campos de contexto (funil / CRM futuro)

Cada submit envia automaticamente:
- `pagina`: `pathname + search` (onde o lead se inscreveu)
- `referrer`: `document.referrer`
- `utm_source`, `utm_medium`, `utm_campaign`: extraídos de `location.search`
- `dispositivo`: Mobile (≤720px) ou Desktop
- `ref`: código de indicação se presente em `localStorage.fc_ec_ref_in`

### Persistência (localStorage)

```
fc_ec_subscribed       — "1" se o usuário já submeteu email (desativa todos os widgets)
fc_ec_exit_closed_at   — timestamp do último fechamento do exit-intent
fc_ec_sticky_closed_at — timestamp do último fechamento da sticky bar
fc_ec_ref_in           — ref capturado da URL (a enviar no próximo submit)
fc_ec_my_ref           — ref do próprio usuário, gerado após inscrição
```

**Cooldowns:** 7 dias após fechar (exit/sticky) antes de reaparecer. Se `fc_ec_subscribed=1`, nunca reaparece.

---

## LP do Dicionário (dicionario.fluenciacontabil.com.br)

Repo: `gruponbeducacao/dicionario-lp`, branch `main`.
Path local: `C:/Fluência_Contábil_OS_C/_MARKETING/Landing_Pages/Fluencia_LP/dicionario-v2`.

### Estado atual
- Copy: **"400+ definições"** (não mais "200+ termos") em 8 lugares
- Card de benefício: **"Baseado em fontes sólidas"** (doutrina + CPCs + Lei 6.404/76), substituiu "Baseado nas bancas"
- Card "Explicações didáticas": "sem transcrição seca de norma" (realinhado com card de fontes)
- PDF real do dicionário: `Dicionario_Contabil_Fluencia.pdf` (~5.4 MB, é a V2 real do conteúdo, fonte em `C:/Fluência_Contábil_OS_C/_CONTEUDO/Dicionario_Contabil_Fluencia_V2.pdf`)
- Widgets de captura: exit-intent + sticky bar com copy de lead magnet ("Baixe o Dicionário Contábil grátis"). Submit → redireciona pra `/obrigado.html` (que dispara download do PDF).
- Endpoint: **unificado** (19/04/2026) — usa o mesmo `AKfycbx8lWrX...` do site principal. Apps Script roteia por `origem` começando com `dicionario_` → aba **"Lead Magnet - Dicionário"** + MailerLite group `185179987559581196`. O endpoint antigo separado (`AKfycbzn...`) está arquivado.
- Origens padronizadas (todas começam com `dicionario_`):
  - `dicionario_form_top` · `dicionario_form_bottom` (forms completos com nome+whatsapp)
  - `dicionario_exit_intent` · `dicionario_sticky_bar` (widgets só email)

**Quando atualizar o PDF:** basta copiar o `V2.pdf` da pasta `_CONTEUDO` sobrescrevendo `Dicionario_Contabil_Fluencia.pdf` na raiz do repo, `git add/commit/push`. GitHub Pages serve automaticamente.

---

## MailerLite — groups e configuração

**Conta:** `contato@fluenciacontabil.com.br` (domínio autenticado via SPF/DKIM + DMARC em `fluenciacontabil.com.br`)

**DMARC:** ativo em modo `p=none` (monitor) desde 19/04/2026. Registro TXT em `_dmarc.fluenciacontabil.com.br`: `v=DMARC1; p=none; rua=mailto:contato@fluenciacontabil.com.br; fo=1`.

### Status das automações (19/04/2026 · fim do dia)

| Automation | Status | Emails | Cadência |
|---|---|---|---|
| 🟢 Sequência A — Newsletter | ✅ **ATIVA** | 5 (A1-A5) | 10 dias |
| 🔴 Sequência B — Lista de Espera | ✅ **ATIVA** | 6 (B1-B6) | 15 dias |
| 🟡 Sequência C — Lead Magnet Dicionário ⭐ | ✅ **ATIVA** | 6 (C1-C6) | 15 dias |
| 🎤 Sequência Live 1 — Débito e Crédito | ⏳ Pendente | 4 (E1-E4) | qui 21/05 · 20h |
| 🎤 Sequência Live 2 — 5 CPCs | ⏳ Pendente | 4 | qui 28/05 · 20h |
| 🎤 Sequência Live 3 — CPC 51 | ⏳ Pendente | 4 | ter 02/06 · 20h |
| 🎤 Sequência Live 4 — 7 Pegadinhas | ⏳ Pendente | 4 | qui 11/06 · 20h |
| 🚨 Sequência Live Final — Lançamento | ⏳ Pendente | 4 (c/ E4 variante) | qui 18/06 · 20h |
| 📰 RSS Campaign | ⏳ Pendente | 1/post | imediato |

**Total:** 3 de 9 automações ativas. 17 emails automáticos rodando. Leads reais entrando já recebem.

### Group IDs

| Group | ID |
|---|---|
| Newsletter | `185179968949454391` |
| Lista de Espera | `185179979081843871` |
| Lead Magnet — Dicionário | `185179987559581196` |
| **Live 1** (Débito/Crédito, qui 21/05) | `185203741114238022` |
| **Live 2** (5 CPCs, qui 28/05) | `185203748785620698` |
| **Live 3** (CPC 51, ter 02/06) | `185203753382578061` |
| **Live 4** (7 Pegadinhas, qui 11/06) | `185203758274184695` |
| **Live Final** (Lançamento, qui 18/06) | `185203765515650231` |

### Custom fields (configurados)
- `origem` · `pagina_captura` · `referrer` · `utm_source` · `utm_medium` · `utm_campaign` · `dispositivo` · `ref_in`

### Templates de email (em `email-templates/`)

**~57 emails HTML** prontos, email-safe (Gmail/Outlook/mobile), visual Fluência oficial. Preview local em `http://localhost:3000/email-templates/` ou `dev.fluenciacontabil.com.br/email-templates/`.

Organização:
- `sequencia-a/` — 5 emails Newsletter (A1-A5), automation
- `sequencia-b/` — 6 emails Lista de Espera (B1-B6), automation
- `sequencia-c/` — **6 emails Lead Magnet Dicionário (C1-C6), automation ⭐ CANAL PRINCIPAL**
- `sequencia-live/` — 19 emails (4 × 4 lives + 3 Live Final + E4 Final variante)
- `broadcasts/convites-lives/` — 10 broadcasts (D-3 + D-0 × 5 lives), scheduled
- `broadcasts/lancamento/` — 9 emails (L1-L8 + extra "última hora"), scheduled

Scripts auxiliares (em `scripts/`):
- `generate_live_emails.py` — regenera 15 emails das Lives 2/3/4/Final a partir da Live 1
- `generate_live_invites.py` — regenera 8 broadcasts de convite (D-3+D-0)

**Placeholders pendentes antes de ativar:** `{PRECO_*}`, `{LINK_VENDAS}`, `{VAGAS_RESTANTES}`, URL da Aula 01 PDF (B5 + C5 + extra).

### Segmentos de broadcast (atualizados 19/04/2026)

Com a criação da Sequência C, todos os broadcasts de convite pras lives e a maioria dos broadcasts de lançamento passam a **incluir o group Lead Magnet Dicionário**:

| Broadcast | Segmento |
|---|---|
| D-3 e D-0 (5 lives) | Newsletter + Lista + **Lead Magnet** |
| L1 (faltam 10 dias) | Lista + Newsletter engajada + **Lead Magnet engajada** |
| L2 (teaser modalidades) | Lista (interno) |
| L3 (DIA D) | Todos (Lista + Newsletter + Lead Magnet) |
| L4 (ROI) | Lista + **Lead Magnet** (excl. Live Final) |
| L5 (vagas + depoimento) | Lista (restrito — lead quase comprador) |
| L6 (5 dias) | Lista + **Lead Magnet engajada** |
| L7 (48h + FAQ) | Lista + Newsletter + **Lead Magnet** |
| L8 (último dia) | Todos |
| Extra "última hora" | Newsletter OU Live 4 OU **Lead Magnet** entre 13-17/06 |

---

## Rollback tags (remoto)

| Tag | Cobre |
|---|---|
| `backup/pre-email-capture` (em dev) | Antes da Fase 1 (exit-intent, sticky, share) |
| `backup/pre-email-capture-main` (em main) | Main antes da Fase 1 |
| `backup/pre-fase2` (em dev) | Antes da Fase 2 (CTA inline + referral) |
| `backup/pre-mobile-waall` (em main) | Antes do mobile engagement peak + WA em todos posts |
| `backup/pre-update` (repo dicionário, main) | Antes das mudanças no dicionário |

**Rollback típico:**
```bash
git reset --hard <tag>
git push origin main --force-with-lease   # cuidado: só se confiante
```

---

## Git — convenções e fluxo

- Branch de trabalho: **`dev`**
- Branch de produção: **`main`**
- Fluxo: commit em `dev` → push → (validar em `dev.fluenciacontabil.com.br`) → merge `dev → main` → push main → propaga em `fluenciacontabil.com.br`
- Commits em PT-BR, mensagem descritiva curta no título + corpo explicando o porquê
- **Sempre** criar `backup/<nome>` tag antes de mudanças grandes em `main` + push da tag
- `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` no rodapé do commit message

---

## Preview local

`.claude/launch.json` tem 2 servidores configurados:
- `site` (porta 3000) — serve `Site/Versão 3/` via `npx serve`
- `lp-dicionario` (porta 8765) — serve a LP do dicionário via `python -m http.server`

**Quirks conhecidos do `npx serve`:**
- Strip `.html` da URL (routes ficam `/blog/slug` sem extensão)
- Strip query string em algumas navegações
- Cache agressivo do CSS — às vezes precisa forçar reload com `?_=Date.now()` no href

**Regex `isBlogPost()`:** `/\/blog\/[^/]+(\.html?)?\/?$/i` — aceita slug com ou sem `.html`.

---

## Fases — status

### ✅ Fase 1 — Captura básica (em produção)
Exit-intent, sticky bar, share buttons, textos inclusivos, cores oficiais.

### ✅ Fase 2 — CTA inline + Referral light (em produção)
Card no meio dos posts pra lista de espera. Painel de referral após submit. Interceptação de newsletter e lista de espera preservando fluxo WhatsApp. Mobile engagement peak.

### ✅ Fase 2.5 — Endpoint unificado + CRM básico (em produção)
Consolidação em 1 planilha com 2 abas + Dashboard com 9 seções de métricas + glossário. Campos de contexto (pagina/referrer/UTM/dispositivo) em todos os submits. Validação server-side.

### ⏳ Fase 3a — Integração Hotmart (não iniciada)

**Bloqueio:** produto ainda não criado na Hotmart. Aguardando.

Plano quando retomar:
1. Configurar webhook da Hotmart → novo endpoint do Apps Script
2. Criar aba "Compras" na planilha
3. Quando compra chegar: casar pelo email com entradas na aba Lista de Espera / Newsletter. Se tiver `ref` associado, marcar a linha do indicador (futura coluna "Trouxe compras" na mesma planilha).
4. Email transacional de boas-vindas com link do curso na Hotmart (pode usar Google Apps Script + GmailApp ou serviço terceiro).

**Ponto de atenção mencionado pelo usuário:** preocupação com o fluxo do funil pós-compra (serviço ao aluno). Discussão aberta.

### ⏳ Fase 3b — Referral server-side completo (não iniciada)

Hoje o `ref` é gravado mas não "fecha o loop". Pra virar programa de indicação de verdade:
- Tabela/aba de `Indicadores` com email → ref_code + contador de indicados + contador de compras trazidas
- Função server-side que agrega: quando chega submit com `ref=X`, incrementa o contador de `X`
- Ranking público (ou privado) de indicadores
- Trigger de recompensa quando atingir N indicados/compras

Exige mais lógica no Apps Script. Factível sem backend externo.

### ⏳ Fase 3c — Plataforma de alunos própria (médio/longo prazo)

Saída da Hotmart pra plataforma própria.
- Stack sugerida (ainda a validar): **Supabase** (auth + DB) + **Vimeo ou Mux** (vídeos privados) + frontend estático. Baixo custo, boa escala, sem servidor próprio.
- Mesma base de leads/compras servindo referral e acesso.
- Funcionalidades: área logada, progresso de aulas, certificado, materiais, fórum (opcional).

### 📋 Pendências menores (não bloqueantes)

- Arquivar deploys antigos do Apps Script (evitar tráfego residual pros endpoints velhos). Acesso: Apps Script → Implantar → Gerenciar implantações → 3 pontinhos → Arquivar.
- Limpar linhas de teste (dev/debug) nas abas Newsletter e Lista de Espera.
- Migrar dados antigos das 2 planilhas velhas pra nova (se quiser manter histórico).
- Desambiguar `--azul` vs `--azul-profundo` e `#C8A84B` vs `#C9A84C` nos posts — fragmentação leve.

---

## Decisões importantes (registradas pra não repetir discussão)

1. **Endpoint único vs 2 scripts:** escolhido endpoint único (arquitetura CRM futuro, um lugar pra olhar).
2. **CTA inline aponta pra Lista de Espera** (não Newsletter). Intenção: quem clica ali está em modo "garantir vaga", não "receber newsletter".
3. **Sticky bar e exit-intent** apontam pra Newsletter (baixo compromisso).
4. **Preservar WhatsApp group no success da lista de espera** — crítico pro usuário, anexar referral abaixo com separador.
5. **Copy inclusiva global** — "amigo(a) concurseiro(a)", "inscrito(a)" em todos os widgets.
6. **Bottom-sheet no mobile** pro exit-intent (mais natural no polegar).
7. **Engagement peak** (70% scroll + 4s idle) em vez de scroll-up rápido como proxy de exit-intent no mobile (falso positivo demais).
8. **Cascata CSS dos posts** sobrescreve cores/paddings dos widgets. Sempre usar `!important` com seletores específicos (ex: `.fc-ec-referral a.fc-ec-wa-group`) pra garantir especificidade 0,2,1+ e vencer `.article-body a` (0,1,1).

---

## Como retomar em uma nova sessão

1. Leia este arquivo até aqui.
2. `git status` no repo (`Site/Versão 3`) pra ver se tem coisa não commitada.
3. Confira `git log --oneline -5 origin/main` e `origin/dev` pra ver o estado mais recente.
4. Se for tocar em widget de captura, edita `assets/email-capture.{css,js}`. Nunca edita os 17 HTMLs manualmente — o JS faz a injeção.
5. Se for mudar copy, geralmente é dentro do JS (textos dos widgets) ou direto nos HTMLs (conteúdo editorial).
6. Sempre valida visualmente no preview local (`preview_start` com `site`) ou em dev (`dev.fluenciacontabil.com.br`) antes de mergear pra main.
7. **Nunca faz push pra main sem autorização explícita** do usuário.
8. Cria tag `backup/<descritivo>` antes de mudanças grandes em main.

---

*Última atualização: 18/04/2026. Escrito por Claude Opus 4.7 ao final da sessão de construção do sistema de captura de leads + CRM básico.*
