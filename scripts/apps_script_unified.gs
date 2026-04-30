/**
 * ════════════════════════════════════════════════════════════════════
 *  FLUÊNCIA CONTÁBIL — Apps Script unificado de captura de leads
 *  Projeto: "Leads Capture — Unified" (vinculado à planilha "LEADS Fluência Contábil")
 * ════════════════════════════════════════════════════════════════════
 *
 *  Como deployar:
 *  ───────────────────────────────────────────────────────────────────
 *  1. Abra a planilha "LEADS Fluência Contábil":
 *       https://docs.google.com/spreadsheets/d/1aT9moXjp5jNGMuLfqXeFJdu7XsxZDYJB199a5rvuaoU/edit
 *  2. Menu Extensões → Apps Script (abre o projeto "Leads Capture — Unified").
 *  3. Apague TODO o código atual e cole este arquivo inteiro. Ctrl+S.
 *  4. Implantar → Gerenciar implantações → editar (lápis) → Nova versão →
 *     Implantar. **A URL /exec permanece a mesma**, então as LPs e o site não quebram.
 *  5. (Opcional) Rode setupDashboard() uma vez pra recriar/atualizar o Dashboard.
 *
 *  Roteamento por origem:
 *  ───────────────────────────────────────────────────────────────────
 *    exit_intent, sticky_bar, blog_newsletter, newsletter        → Newsletter
 *    blog_inline_cta, lista_espera, site_lista_espera            → Lista de Espera
 *    dicionario_*                                                → Lead Magnet - Dicionário
 *    lives_*                                                     → Lives  ⭐ NOVO
 *    fallback (nome+whatsapp presentes)                          → Lista de Espera
 *    fallback (só email)                                         → Newsletter
 *
 *  Última atualização: 30/04/2026 — adicionada aba "Lives" (LP única das 5 lives).
 * ════════════════════════════════════════════════════════════════════ */

// ============= CONFIGURAÇÃO =============
var SHEETS = {
  newsletter:    'Newsletter',
  listaEspera:   'Lista de Espera',
  leadMagnet:    'Lead Magnet - Dicionário',
  lives:         'Lives',                        // ⭐ NOVO
  dashboard:     'Dashboard'
};

// Schemas (ordem das colunas e notas/tooltips dos headers)
var SCHEMAS = {
  newsletter: [
    { col: 'Data',         note: 'Quando o lead se inscreveu (timestamp do servidor).' },
    { col: 'E-mail',       note: 'Email validado server-side.' },
    { col: 'Origem',       note: 'Widget que capturou: exit_intent, sticky_bar, blog_newsletter, etc.' },
    { col: 'Ref',          note: 'Código de indicação se chegou via ?ref= na URL.' },
    { col: 'Página',       note: 'pathname + search da página onde se inscreveu.' },
    { col: 'Referrer',     note: 'document.referrer — de onde veio.' },
    { col: 'UTM Source',   note: 'utm_source da URL.' },
    { col: 'UTM Medium',   note: 'utm_medium da URL.' },
    { col: 'UTM Campaign', note: 'utm_campaign da URL.' },
    { col: 'Dispositivo',  note: 'Mobile (≤720px) ou Desktop.' }
  ],
  listaEspera: [
    { col: 'Data',         note: 'Quando o lead se inscreveu na Lista de Espera.' },
    { col: 'Nome',         note: 'Nome do lead (form completo).' },
    { col: 'E-mail',       note: 'Email validado server-side.' },
    { col: 'WhatsApp',     note: 'Telefone com DDD, somente dígitos.' },
    { col: 'Origem',       note: 'Widget/página que capturou: lista_espera, blog_inline_cta, site_lista_espera.' },
    { col: 'Ref',          note: 'Código de indicação se chegou via ?ref=.' },
    { col: 'Página',       note: 'pathname + search.' },
    { col: 'Referrer',     note: 'document.referrer.' },
    { col: 'UTM Source',   note: 'utm_source.' },
    { col: 'UTM Medium',   note: 'utm_medium.' },
    { col: 'UTM Campaign', note: 'utm_campaign.' },
    { col: 'Dispositivo',  note: 'Mobile ou Desktop.' }
  ],
  leadMagnet: [
    { col: 'Data',         note: 'Quando o lead baixou o Dicionário.' },
    { col: 'Nome',         note: 'Nome do lead.' },
    { col: 'E-mail',       note: 'Email validado.' },
    { col: 'WhatsApp',     note: 'Telefone com DDD, somente dígitos.' },
    { col: 'Origem',       note: 'dicionario_form_top, dicionario_form_bottom, dicionario_exit_intent, dicionario_sticky_bar.' },
    { col: 'Página',       note: 'pathname + search da LP do Dicionário.' },
    { col: 'Referrer',     note: 'document.referrer.' },
    { col: 'UTM Source',   note: 'utm_source.' },
    { col: 'UTM Medium',   note: 'utm_medium.' },
    { col: 'UTM Campaign', note: 'utm_campaign.' },
    { col: 'Dispositivo',  note: 'Mobile ou Desktop.' }
  ],
  // ⭐ NOVO — aba Lives
  lives: [
    { col: 'Data',         note: 'Quando o lead se inscreveu nas 5 lives.' },
    { col: 'Nome',         note: 'Nome do lead.' },
    { col: 'E-mail',       note: 'Email validado.' },
    { col: 'WhatsApp',     note: 'Telefone com DDD, somente dígitos.' },
    { col: 'Origem',       note: 'lives_form_top, lives_form_bottom (form da LP única). Outras origens lives_* possíveis.' },
    { col: 'Página',       note: 'pathname + search da LP de Lives.' },
    { col: 'Referrer',     note: 'document.referrer.' },
    { col: 'UTM Source',   note: 'utm_source.' },
    { col: 'UTM Medium',   note: 'utm_medium.' },
    { col: 'UTM Campaign', note: 'utm_campaign.' },
    { col: 'Dispositivo',  note: 'Mobile ou Desktop.' }
  ]
};

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============= ENDPOINT =============
function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};

    // Validação server-side de email — se não der, descarta silenciosamente
    var email = String(p.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ ok: false, error: 'invalid_email' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var origem = String(p.origem || '').toLowerCase().trim();
    var nome = String(p.nome || '').trim();
    var whats = String(p.telefone_digits || '').replace(/\D+/g, '') ||
                String(p.telefone || '').replace(/\D+/g, '');
    var dispositivo = String(p.dispositivo || '').trim() ||
                      ((Number(p.viewport_w) || 0) <= 720 ? 'Mobile' : 'Desktop');

    var ctx = {
      data:        new Date(),
      nome:        nome,
      email:       email,
      whatsapp:    whats,
      origem:      origem,
      ref:         String(p.ref || '').trim(),
      pagina:      String(p.pagina || '').trim(),
      referrer:    String(p.referrer || '').trim(),
      utmSource:   String(p.utm_source || '').trim(),
      utmMedium:   String(p.utm_medium || '').trim(),
      utmCampaign: String(p.utm_campaign || '').trim(),
      dispositivo: dispositivo
    };

    // Roteamento por origem
    var sheetKey = routeOrigin(origem, nome, whats);
    var sheetName = SHEETS[sheetKey];
    var sheet = ensureSheet(ss, sheetName, SCHEMAS[sheetKey]);

    // Monta a linha de acordo com o schema
    var row = buildRow(sheetKey, ctx);
    sheet.appendRow(row);

    return jsonResponse({ ok: true, sheet: sheetName });
  } catch (err) {
    logError(err, e);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Fluência Contábil — endpoint ativo · ' + new Date().toISOString())
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============= ROTEAMENTO =============
function routeOrigin(origem, nome, whats) {
  // Lives ⭐ NOVO
  if (origem.indexOf('lives_') === 0) return 'lives';

  // Lead Magnet Dicionário
  if (origem.indexOf('dicionario_') === 0) return 'leadMagnet';

  // Newsletter (baixo compromisso)
  var newsletterOrigins = ['exit_intent', 'sticky_bar', 'blog_newsletter', 'newsletter'];
  if (newsletterOrigins.indexOf(origem) !== -1) return 'newsletter';

  // Lista de Espera (alta intenção)
  var listaOrigins = ['blog_inline_cta', 'lista_espera', 'site_lista_espera'];
  if (listaOrigins.indexOf(origem) !== -1) return 'listaEspera';

  // Fallback: tem nome + whatsapp → trata como Lista; senão → Newsletter
  if (nome && whats) return 'listaEspera';
  return 'newsletter';
}

function buildRow(sheetKey, ctx) {
  switch (sheetKey) {
    case 'newsletter':
      return [ctx.data, ctx.email, ctx.origem, ctx.ref, ctx.pagina, ctx.referrer,
              ctx.utmSource, ctx.utmMedium, ctx.utmCampaign, ctx.dispositivo];
    case 'listaEspera':
      return [ctx.data, ctx.nome, ctx.email, ctx.whatsapp, ctx.origem, ctx.ref,
              ctx.pagina, ctx.referrer, ctx.utmSource, ctx.utmMedium, ctx.utmCampaign, ctx.dispositivo];
    case 'leadMagnet':
    case 'lives':
      return [ctx.data, ctx.nome, ctx.email, ctx.whatsapp, ctx.origem, ctx.pagina,
              ctx.referrer, ctx.utmSource, ctx.utmMedium, ctx.utmCampaign, ctx.dispositivo];
    default:
      return [ctx.data, ctx.email, ctx.origem];
  }
}

// ============= INFRAESTRUTURA =============
function ensureSheet(ss, sheetName, schema) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  // Garante header se a primeira linha estiver vazia
  if (sheet.getLastRow() === 0) {
    var headerRow = schema.map(function (s) { return s.col; });
    sheet.appendRow(headerRow);
    var range = sheet.getRange(1, 1, 1, headerRow.length);
    range.setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FBF6E9');
    sheet.setFrozenRows(1);
    // Aplica notas
    for (var i = 0; i < schema.length; i++) {
      sheet.getRange(1, i + 1).setNote(schema[i].note);
    }
    // Larguras automáticas
    for (var j = 1; j <= headerRow.length; j++) sheet.autoResizeColumn(j);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError(err, e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('_errors') || ss.insertSheet('_errors');
    if (log.getLastRow() === 0) {
      log.appendRow(['timestamp', 'error', 'payload']);
      log.getRange(1, 1, 1, 3).setFontWeight('bold');
      log.setFrozenRows(1);
    }
    log.appendRow([new Date(), String(err), JSON.stringify(e && e.parameter)]);
  } catch (_) { /* nunca propaga */ }
}

// ============= DASHBOARD =============
function setupDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = SHEETS.dashboard;
  var dash = ss.getSheetByName(name);
  if (dash) ss.deleteSheet(dash);
  dash = ss.insertSheet(name, 0); // Move pra primeira posição

  // Estilo geral
  dash.setHiddenGridlines(true);
  dash.getRange('A:Z').setFontFamily('Inter');

  // ── Cabeçalho do dashboard ──
  dash.getRange('A1').setValue('LEADS Fluência Contábil — Dashboard')
    .setFontSize(18).setFontWeight('bold').setFontColor('#1B2A4A');
  dash.getRange('A2').setValue('Atualização automática · Recarregue a planilha pra recalcular')
    .setFontSize(10).setFontColor('#6B7280').setFontStyle('italic');

  var row = 4;

  // Helper: seção
  function section(title) {
    dash.getRange(row, 1).setValue(title).setFontSize(13).setFontWeight('bold')
      .setFontColor('#FBF6E9').setBackground('#1B2A4A');
    dash.getRange(row, 1, 1, 4).merge().setHorizontalAlignment('left');
    dash.setRowHeight(row, 32);
    row++;
  }
  function metric(label, formula) {
    dash.getRange(row, 1).setValue(label).setFontWeight('bold').setFontColor('#1B2A4A');
    dash.getRange(row, 2).setFormula(formula).setFontColor('#C8A84B').setFontWeight('bold');
    row++;
  }
  function spacer() { row++; }

  // ── 1. TOTAIS POR ABA ──
  section('📊 TOTAIS POR ABA');
  metric('Newsletter',                  '=COUNTA(\'' + SHEETS.newsletter   + '\'!B2:B)');
  metric('Lista de Espera',             '=COUNTA(\'' + SHEETS.listaEspera  + '\'!C2:C)');
  metric('Lead Magnet (Dicionário)',    '=COUNTA(\'' + SHEETS.leadMagnet   + '\'!C2:C)');
  metric('Lives',                       '=COUNTA(\'' + SHEETS.lives        + '\'!C2:C)');  // ⭐ NOVO
  metric('TOTAL GERAL',
    '=COUNTA(\'' + SHEETS.newsletter + '\'!B2:B)+COUNTA(\'' + SHEETS.listaEspera + '\'!C2:C)+COUNTA(\'' + SHEETS.leadMagnet + '\'!C2:C)+COUNTA(\'' + SHEETS.lives + '\'!C2:C)');
  spacer();

  // ── 2. HOJE ──
  section('📅 HOJE');
  metric('Newsletter (hoje)',           '=COUNTIFS(\'' + SHEETS.newsletter   + '\'!A:A,">="&TODAY(),\'' + SHEETS.newsletter   + '\'!A:A,"<"&TODAY()+1)');
  metric('Lista de Espera (hoje)',      '=COUNTIFS(\'' + SHEETS.listaEspera  + '\'!A:A,">="&TODAY(),\'' + SHEETS.listaEspera  + '\'!A:A,"<"&TODAY()+1)');
  metric('Lead Magnet (hoje)',          '=COUNTIFS(\'' + SHEETS.leadMagnet   + '\'!A:A,">="&TODAY(),\'' + SHEETS.leadMagnet   + '\'!A:A,"<"&TODAY()+1)');
  metric('Lives (hoje)',                '=COUNTIFS(\'' + SHEETS.lives        + '\'!A:A,">="&TODAY(),\'' + SHEETS.lives        + '\'!A:A,"<"&TODAY()+1)');  // ⭐ NOVO
  spacer();

  // ── 3. ÚLTIMOS 7 DIAS ──
  section('📈 ÚLTIMOS 7 DIAS');
  metric('Newsletter (7d)',             '=COUNTIFS(\'' + SHEETS.newsletter   + '\'!A:A,">="&TODAY()-7)');
  metric('Lista de Espera (7d)',        '=COUNTIFS(\'' + SHEETS.listaEspera  + '\'!A:A,">="&TODAY()-7)');
  metric('Lead Magnet (7d)',            '=COUNTIFS(\'' + SHEETS.leadMagnet   + '\'!A:A,">="&TODAY()-7)');
  metric('Lives (7d)',                  '=COUNTIFS(\'' + SHEETS.lives        + '\'!A:A,">="&TODAY()-7)');  // ⭐ NOVO
  spacer();

  // ── 4. POR ORIGEM (todas as abas) ──
  section('🎯 POR ORIGEM (Top 10, todas as abas)');
  dash.getRange(row, 1).setValue('Origem').setFontWeight('bold');
  dash.getRange(row, 2).setValue('Total').setFontWeight('bold');
  row++;
  // Empilha origens das 4 abas e conta
  dash.getRange(row, 1).setFormula(
    '=QUERY({' +
      '\'' + SHEETS.newsletter   + '\'!C2:C;' +   // Origem na col C da Newsletter
      '\'' + SHEETS.listaEspera  + '\'!E2:E;' +   // Origem na col E da Lista
      '\'' + SHEETS.leadMagnet   + '\'!E2:E;' +   // Origem na col E do LM
      '\'' + SHEETS.lives        + '\'!E2:E' +    // Origem na col E das Lives
    '},"select Col1, count(Col1) where Col1 is not null group by Col1 order by count(Col1) desc limit 10 label count(Col1) \'\'",0)'
  );
  row += 12; // espaço pros resultados
  spacer();

  // ── 5. POR DISPOSITIVO ──
  section('📱 POR DISPOSITIVO');
  metric('Mobile (Newsletter)',         '=COUNTIF(\'' + SHEETS.newsletter   + '\'!J:J,"Mobile")');
  metric('Desktop (Newsletter)',        '=COUNTIF(\'' + SHEETS.newsletter   + '\'!J:J,"Desktop")');
  metric('Mobile (Lista)',              '=COUNTIF(\'' + SHEETS.listaEspera  + '\'!L:L,"Mobile")');
  metric('Desktop (Lista)',             '=COUNTIF(\'' + SHEETS.listaEspera  + '\'!L:L,"Desktop")');
  metric('Mobile (Lead Magnet)',        '=COUNTIF(\'' + SHEETS.leadMagnet   + '\'!K:K,"Mobile")');
  metric('Desktop (Lead Magnet)',       '=COUNTIF(\'' + SHEETS.leadMagnet   + '\'!K:K,"Desktop")');
  metric('Mobile (Lives)',              '=COUNTIF(\'' + SHEETS.lives        + '\'!K:K,"Mobile")');  // ⭐ NOVO
  metric('Desktop (Lives)',             '=COUNTIF(\'' + SHEETS.lives        + '\'!K:K,"Desktop")');  // ⭐ NOVO
  spacer();

  // ── 6. TOP UTM SOURCE ──
  section('🌐 TOP UTM SOURCE (todas as abas)');
  dash.getRange(row, 1).setFormula(
    '=QUERY({' +
      '\'' + SHEETS.newsletter   + '\'!G2:G;' +
      '\'' + SHEETS.listaEspera  + '\'!I2:I;' +
      '\'' + SHEETS.leadMagnet   + '\'!H2:H;' +
      '\'' + SHEETS.lives        + '\'!H2:H' +
    '},"select Col1, count(Col1) where Col1 is not null and Col1 != \'\' group by Col1 order by count(Col1) desc limit 8 label Col1 \'UTM Source\', count(Col1) \'Total\'",0)'
  );
  row += 10;
  spacer();

  // ── 7. TOP REFERRERS ──
  section('🔗 TOP REFERRERS (todas as abas)');
  dash.getRange(row, 1).setFormula(
    '=QUERY({' +
      '\'' + SHEETS.newsletter   + '\'!F2:F;' +
      '\'' + SHEETS.listaEspera  + '\'!H2:H;' +
      '\'' + SHEETS.leadMagnet   + '\'!G2:G;' +
      '\'' + SHEETS.lives        + '\'!G2:G' +
    '},"select Col1, count(Col1) where Col1 is not null and Col1 != \'\' group by Col1 order by count(Col1) desc limit 8 label Col1 \'Referrer\', count(Col1) \'Total\'",0)'
  );
  row += 10;
  spacer();

  // ── 8. GLOSSÁRIO ──
  section('📖 GLOSSÁRIO');
  var glossario = [
    ['Newsletter',        'Captura de baixo compromisso (sticky bar, exit-intent, blog).'],
    ['Lista de Espera',   'Captura de alta intenção (cursos.html, CTA inline blog). Inclui WhatsApp.'],
    ['Lead Magnet',       'LP do Dicionário — recebe tráfego pago. Canal principal.'],
    ['Lives',             'LP única das 5 lives gratuitas de pré-lançamento (mai-jun 2026).'],
    ['Origem',            'Identificador do widget/form que capturou. Ex: lives_form_top.'],
    ['Ref',               'Código de indicação (?ref=) — programa de referral light.'],
    ['UTM',               'Parâmetros de campanha na URL. Pra atribuição de tráfego.'],
    ['Dispositivo',       'Mobile (≤720px) ou Desktop, detectado no momento da inscrição.']
  ];
  for (var g = 0; g < glossario.length; g++) {
    dash.getRange(row, 1).setValue(glossario[g][0]).setFontWeight('bold').setFontColor('#1B2A4A');
    dash.getRange(row, 2, 1, 3).merge().setValue(glossario[g][1]).setFontColor('#374151').setWrap(true);
    row++;
  }

  // Formatação final
  dash.setColumnWidth(1, 240);
  dash.setColumnWidth(2, 180);
  dash.setColumnWidth(3, 180);
  dash.setColumnWidth(4, 180);
  dash.getRange('A:D').setVerticalAlignment('middle');

  SpreadsheetApp.getActiveSpreadsheet().toast('Dashboard atualizado ✓', 'Fluência Contábil', 5);
}

// ============= TESTE LOCAL (rodar manualmente pra validar) =============
function _test_doPost_lives() {
  var fakeEvent = {
    parameter: {
      nome: 'Teste Vinícius',
      email: 'teste+lives@example.com',
      telefone: '(11) 99999-0000',
      telefone_digits: '11999990000',
      origem: 'lives_form_top',
      pagina: '/lives.html',
      referrer: 'https://google.com',
      utm_source: 'instagram',
      utm_medium: 'bio',
      utm_campaign: 'pre_lancamento',
      dispositivo: 'Desktop',
      timestamp: new Date().toISOString()
    }
  };
  var resp = doPost(fakeEvent);
  Logger.log(resp.getContent());
}
