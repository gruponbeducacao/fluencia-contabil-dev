# 📧 Email Templates — Fluência Contábil

Templates HTML dos emails da campanha de lançamento (jun/2026). Todos email-safe, testados em Gmail/Outlook/mobile.

## Estrutura

```
email-templates/
├── index.html              ← preview local de todos os emails
├── README.md               ← este arquivo
├── sequencia-a/            ← Newsletter (5 emails automáticos)
├── sequencia-b/            ← Lista de Espera (6 emails automáticos)
├── sequencia-c/            ← Lead Magnet Dicionário (6 emails automáticos) ⭐ PRIORIDADE
├── sequencia-live/         ← Template reutilizável pras 5 lives (4 emails)
└── broadcasts/             ← Convite pras lives + lançamento (19 emails)
```

**Sequência C é o canal mais importante** — recebe tráfego pago na LP `dicionario.fluenciacontabil.com.br`. Trata o lead como primeira classe.

## Como testar localmente

Com o preview local rodando (`preview_start` com `site` na porta 3000):

```
http://localhost:3000/email-templates/
```

Abre o index com cards clicáveis. Cada card abre o email em tela cheia — igual como vai ficar no inbox.

## Como testar no MailerLite (envio real pro seu inbox)

1. Abre o arquivo `.html` do email que quer testar
2. Copia todo o conteúdo (Ctrl+A → Ctrl+C)
3. MailerLite → **Campaigns → Create campaign**
4. Modo: **Regular campaign**
5. Destinatário: qualquer group (será só pra teste)
6. Design step → escolhe **"Custom HTML"**
7. Cola o HTML
8. Subject: copia o **Assunto** do arquivo (primeiro comentário HTML)
9. Preview text: copia o **Preview** do arquivo
10. Clica em **"Send test email"** no topo direito
11. Digita seu email → envia
12. Vai chegar no inbox em ~30 segundos

## Identidade visual

- **Azul navy** `#1B2A4A` — header, texto principal
- **Dourado** `#C8A84B` — accent, CTAs secundários, separadores
- **Vermelho** `#C0392B` — CTA primário (Lista de Espera)
- **Cream** `#FBF6E9` — background
- **Fontes** — Montserrat (headings) + Source Serif 4 (corpo) com fallback Georgia/Arial

## Placeholders do MailerLite

Todos os templates usam `{$unsubscribe}` pra link de descadastro. O MailerLite substitui automaticamente quando envia. Se quiser personalizar com nome, basta trocar `Oi,` por `Oi, {$name|concurseiro(a)},` (fallback pra quem não tem nome).

## Checklist antes de publicar

- [ ] Trocar URLs de placeholder pelas URLs reais (blog posts específicos, LPs de live)
- [ ] Definir URL do PDF da Aula 01 (usado no B5)
- [ ] Substituir `{PRECO_*}` quando preço estiver definido (nos broadcasts)
- [ ] Adicionar depoimento real no L5 (placeholder atual)
- [ ] Testar visual em Gmail, Outlook (web), iPhone Mail, Android Gmail app

## Manutenção

Header e footer são idênticos em todos os templates — se precisar trocar logo/tagline/footer, é copy-paste nas 20+ arquivos. Preferi isso a montar sistema de templates porque:
1. MailerLite recebe HTML standalone (não tem como incluir partials)
2. Menos 1 camada de build
3. Cada arquivo é self-contained — fácil de debugar

Se for mudar algo estrutural no futuro, edita 1 arquivo primeiro (ex: A1), testa, e faz search-replace nos demais.
