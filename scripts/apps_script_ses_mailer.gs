/**
 * ═══════════════════════════════════════════════════════════════════════
 * FLUÊNCIA MAILER — Email marketing via AWS SES v2 (substitui MailerLite)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Arquivo NOVO no mesmo projeto Apps Script da planilha "LEADS Fluência
 * Contábil" (convive com apps_script_unified.gs — doPost NÃO muda).
 *
 * O que este arquivo faz:
 *   1. SYNC DE CONTATOS  — leads novos da planilha entram na contact list
 *      do SES (coluna "SES Sync", mesmo padrão da "ML Sync").
 *   2. SEQUÊNCIAS        — A/B/C/D enviadas pelo SES com cadência
 *      configurável na aba "Config Sequencias" (estado por linha do lead).
 *   3. BROADCASTS        — agendados na aba "Broadcasts" (assunto +
 *      template + tópicos + data/hora), enviados em lotes resumíveis.
 *   4. UNSUBSCRIBE       — gerenciado pelo PRÓPRIO SES (contact list +
 *      topics). O placeholder {$unsubscribe} dos templates vira
 *      {{amazonSESUnsubscribeUrl}}; quem clica é suprimido pelo SES
 *      automaticamente nos próximos envios.
 *
 * ─── PRÉ-REQUISITOS (Script Properties) ───────────────────────────────
 *   AWS_ACCESS_KEY_ID      = (IAM user fluencia-mailer)
 *   AWS_SECRET_ACCESS_KEY  = (…)
 *   SES_REGION             = us-east-1            (opcional, default)
 *   SES_FROM_MARKETING     = Fluência Contábil <contato@news.fluenciacontabil.com.br>
 *   SES_REPLY_TO           = contato@fluenciacontabil.com.br
 *   SES_CONFIG_SET         = fluencia-marketing   (opcional, default)
 *   SES_CONTACT_LIST       = fluencia             (opcional, default)
 *   TEMPLATE_SOURCE        = s3                   ('s3' = bucket privado via SigV4 [recomendado];
 *                                                   qualquer outro valor = fetch HTTP legado em TEMPLATE_BASE_URL,
 *                                                   público — mantido só pra rollback, ver migração de 01/07/2026)
 *   TEMPLATE_S3_BUCKET     = (nome do bucket privado — ver fluencia-email-templates/README.md)
 *   TEMPLATE_S3_REGION     = us-east-1            (opcional — default SES_REGION)
 *   TEMPLATE_BASE_URL      = https://fluenciacontabil.com.br/email-templates/  (LEGADO — só usado se TEMPLATE_SOURCE != 's3')
 *   MAILER_ENABLED         = true                 (kill switch — qualquer outro valor bloqueia envio)
 *   MAILER_CUTOVER_AT      = 2026-06-DD           (leads ANTERIORES não entram nas sequências — já passaram pelo MailerLite)
 *   ENSAIO_EMAIL           = (email NÃO descadastrado usado por ensaioBroadcastBolsao)
 *
 * ─── ORDEM DE ATIVAÇÃO (ver runbook-cutover-mailerlite-ses.md) ────────
 *   1. setupSesInfra()          — cria contact list + topics + config set (1×)
 *   2. setupMailerAfterDeploy() — colunas + abas de config + triggers (1×)
 *   3. testSesAuth()            — valida credenciais
 *   4. testSendMarketingEmail() — envia A1 pro seu email
 *   5. importMailerLiteContacts() / importMailerLiteUnsubs() — migração
 *   6. cutoverDisableMailerLite() — desliga o trigger do MailerLite
 * ═══════════════════════════════════════════════════════════════════════
 */

// ══════════════════════ CONFIG ══════════════════════

// Aba da planilha → tópico SES + sequência associada.
// Os nomes das abas vêm de SHEETS (apps_script_unified.gs).
const MAILER_TABS = [
  { sheet: 'Newsletter',               topic: 'newsletter',   sequencia: 'A',      hasNamePhone: false },
  { sheet: 'Lista de Espera',          topic: 'lista-espera', sequencia: 'B',      hasNamePhone: true  },
  { sheet: 'Lead Magnet - Dicionário', topic: 'dicionario',   sequencia: 'C',      hasNamePhone: true  },
  { sheet: 'Lives',                    topic: 'lives',        sequencia: 'D',      hasNamePhone: true  },
  { sheet: 'Bolsão',                   topic: 'bolsao',       sequencia: 'BOLSAO', hasNamePhone: true  }
];

const SES_TOPICS = [
  { TopicName: 'newsletter',   DisplayName: 'Newsletter — artigos e novidades',      DefaultSubscriptionStatus: 'OPT_IN' },
  { TopicName: 'lista-espera', DisplayName: 'Lista de Espera — curso e lançamento',  DefaultSubscriptionStatus: 'OPT_IN' },
  { TopicName: 'dicionario',   DisplayName: 'Dicionário Contábil — material e dicas', DefaultSubscriptionStatus: 'OPT_IN' },
  { TopicName: 'lives',        DisplayName: 'Lives de pré-lançamento',               DefaultSubscriptionStatus: 'OPT_IN' },
  { TopicName: 'bolsao',       DisplayName: 'Bolsão da Fluência — prova 28/06',      DefaultSubscriptionStatus: 'OPT_IN' }
];

// Colunas novas adicionadas a cada aba de leads (sem tocar nas ML Sync)
const MAILER_COLS = ['SES Sync', 'SES Sync At', 'Seq Passo', 'Seq Próximo Em'];

const MAILER_SHEETS = {
  CONFIG_SEQ: 'Config Sequencias',
  BROADCASTS: 'Broadcasts',
  IMPORT_ML:  'Import ML',
  UNSUBS_ML:  'Unsubs ML'
};

// Limites por execução (margem folgada sob as quotas SES 50k/dia e
// UrlFetchApp 20k/dia: sync 1min×10 + seq 1h×30 + broadcasts 5min×80)
const SES_SYNC_BATCH   = 10;  // contatos/run (trigger 1 min)
const SEQ_SEND_BATCH   = 30;  // emails de sequência/run (trigger 5 min)
const BCAST_SEND_BATCH = 250; // emails de broadcast/run (trigger 5 min ≈ 3.000/h) — calibrado p/ lançamento ago/2026 (SES 14/s aguenta; ~2/s aqui)


// ══════════════════════ AWS SIGV4 (SES v2 REST) ══════════════════════

/**
 * Chama a API SES v2 assinando com SigV4.
 * pathSegments: array de segmentos SEM encoding (ex: ['v2','email','contact-lists','fluencia','contacts','a@b.com'])
 */
function sesRequest_(method, pathSegments, payload) {
  var props  = PropertiesService.getScriptProperties();
  var akid   = props.getProperty('AWS_ACCESS_KEY_ID');
  var secret = props.getProperty('AWS_SECRET_ACCESS_KEY');
  if (!akid || !secret) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY não configurados em Script Properties');

  var region  = props.getProperty('SES_REGION') || 'us-east-1';
  var host    = 'email.' + region + '.amazonaws.com';
  var amzDate = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  var dateStamp = amzDate.substring(0, 8);

  // Path real (single-encoded) e path canônico (double-encoded — regra
  // SigV4 pra serviços não-S3; relevante quando há email no path)
  var encodedSegs   = pathSegments.map(rfc3986Encode_);
  var requestPath   = '/' + encodedSegs.join('/');
  var canonicalPath = '/' + encodedSegs.map(rfc3986Encode_).join('/');

  var body = payload ? JSON.stringify(payload) : '';
  var payloadHash = sha256Hex_(body);

  var canonicalRequest = [
    method,
    canonicalPath,
    '',                                          // query string (não usamos)
    'host:' + host + '\n' + 'x-amz-date:' + amzDate + '\n',
    'host;x-amz-date',
    payloadHash
  ].join('\n');

  var scope = dateStamp + '/' + region + '/ses/aws4_request';
  var stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex_(canonicalRequest)].join('\n');

  var kDate    = hmacBytes_(dateStamp, Utilities.newBlob('AWS4' + secret).getBytes());
  var kRegion  = hmacBytes_(region, kDate);
  var kService = hmacBytes_('ses', kRegion);
  var kSigning = hmacBytes_('aws4_request', kService);
  var signature = bytesToHex_(hmacBytes_(stringToSign, kSigning));

  var auth = 'AWS4-HMAC-SHA256 Credential=' + akid + '/' + scope +
             ', SignedHeaders=host;x-amz-date, Signature=' + signature;

  var options = {
    method: method.toLowerCase(),
    headers: { 'X-Amz-Date': amzDate, 'Authorization': auth },
    muteHttpExceptions: true
  };
  if (body) { options.contentType = 'application/json'; options.payload = body; }

  var res  = UrlFetchApp.fetch('https://' + host + requestPath, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  return { code: code, ok: code >= 200 && code < 300, body: text ? safeParse_(text) : null, raw: text };
}

/**
 * GetObject num bucket S3 privado, assinado SigV4. Diferente de
 * sesRequest_: a spec SigV4 tem uma EXCEÇÃO documentada pra S3 — o path
 * do canonical request usa o MESMO encoding do path real (single-encoded),
 * não o double-encode que os demais serviços AWS exigem. Por isso não
 * reaproveita sesRequest_ (que é genérico pros outros serviços).
 */
function s3GetObject_(bucket, region, key) {
  var props  = PropertiesService.getScriptProperties();
  var akid   = props.getProperty('AWS_ACCESS_KEY_ID');
  var secret = props.getProperty('AWS_SECRET_ACCESS_KEY');
  if (!akid || !secret) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY não configurados em Script Properties');

  var host = bucket + '.s3.' + region + '.amazonaws.com';
  var amzDate = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  var dateStamp = amzDate.substring(0, 8);

  var canonicalUri = '/' + key.split('/').map(rfc3986Encode_).join('/');
  var payloadHash = sha256Hex_(''); // GET sem corpo

  // S3 (diferente dos demais serviços AWS) EXIGE o header x-amz-content-sha256
  // de fato presente na requisição — não basta usar o hash só no cálculo da
  // assinatura. Por isso entra nos canonical headers/signed headers também.
  var canonicalRequest = [
    'GET',
    canonicalUri,
    '',
    'host:' + host + '\n' + 'x-amz-content-sha256:' + payloadHash + '\n' + 'x-amz-date:' + amzDate + '\n',
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash
  ].join('\n');

  var scope = dateStamp + '/' + region + '/s3/aws4_request';
  var stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex_(canonicalRequest)].join('\n');

  var kDate    = hmacBytes_(dateStamp, Utilities.newBlob('AWS4' + secret).getBytes());
  var kRegion  = hmacBytes_(region, kDate);
  var kService = hmacBytes_('s3', kRegion);
  var kSigning = hmacBytes_('aws4_request', kService);
  var signature = bytesToHex_(hmacBytes_(stringToSign, kSigning));

  var auth = 'AWS4-HMAC-SHA256 Credential=' + akid + '/' + scope +
             ', SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=' + signature;

  var res = UrlFetchApp.fetch('https://' + host + canonicalUri, {
    method: 'get',
    headers: { 'X-Amz-Date': amzDate, 'X-Amz-Content-Sha256': payloadHash, 'Authorization': auth },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('S3 GetObject HTTP ' + code + ' (key=' + key + '): ' + res.getContentText().substring(0, 300));
  }
  return res.getContentText();
}

function rfc3986Encode_(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function sha256Hex_(str) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}

function hmacBytes_(value, keyBytes) {
  return Utilities.computeHmacSha256Signature(Utilities.newBlob(value).getBytes(), keyBytes);
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function safeParse_(text) {
  try { return JSON.parse(text); } catch (_) { return { _raw: text }; }
}


// ══════════════════════ ENVIO ══════════════════════

/**
 * Envia 1 email de marketing via SES com list management (unsubscribe
 * automático + supressão de quem já saiu do tópico).
 */
function sesSendMarketing_(toEmail, subject, html, topicName) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MAILER_ENABLED') !== 'true') {
    throw new Error('MAILER_ENABLED != true — envio bloqueado (kill switch)');
  }
  var from = props.getProperty('SES_FROM_MARKETING');
  if (!from) throw new Error('SES_FROM_MARKETING não configurado');

  var payload = {
    FromEmailAddress: from,
    Destination: { ToAddresses: [toEmail] },
    ReplyToAddresses: [props.getProperty('SES_REPLY_TO') || 'contato@fluenciacontabil.com.br'],
    ConfigurationSetName: props.getProperty('SES_CONFIG_SET') || 'fluencia-marketing',
    ListManagementOptions: {
      ContactListName: props.getProperty('SES_CONTACT_LIST') || 'fluencia',
      TopicName: topicName
    },
    Content: { Simple: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } }
    } }
  };

  var res = sesRequest_('POST', ['v2', 'email', 'outbound-emails'], payload);
  if (!res.ok) throw new Error('SES SendEmail HTTP ' + res.code + ': ' + String(res.raw).substring(0, 300));
  return res.body && res.body.MessageId;
}

/**
 * Busca o template HTML (cache 6h) e aplica personalização:
 *   {$name|fallback} → primeiro nome ou fallback
 *   {$unsubscribe}   → {{amazonSESUnsubscribeUrl}} (o SES substitui no envio)
 *
 * relPath é o caminho relativo cru (ex: 'sequencia-a/A1-bem-vindo.html'),
 * o mesmo valor gravado nas abas Config Sequências/Broadcasts. A fonte de
 * busca depende de TEMPLATE_SOURCE (ver cabeçalho do arquivo):
 *   's3' (recomendado, privado)  → GetObject assinado SigV4 em TEMPLATE_S3_BUCKET
 *   qualquer outro valor (legado)→ fetch HTTP simples em TEMPLATE_BASE_URL (público)
 */
function renderTemplate_(relPath, nome) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var key = 'tpl:' + sha256Hex_(relPath).substring(0, 32);
  var html = cache.get(key);
  if (!html) {
    if ((props.getProperty('TEMPLATE_SOURCE') || 'pages') === 's3') {
      var bucket = props.getProperty('TEMPLATE_S3_BUCKET');
      if (!bucket) throw new Error('TEMPLATE_S3_BUCKET não configurado em Script Properties (TEMPLATE_SOURCE=s3)');
      var region = props.getProperty('TEMPLATE_S3_REGION') || props.getProperty('SES_REGION') || 'us-east-1';
      html = s3GetObject_(bucket, region, String(relPath).replace(/^\//, ''));
    } else {
      var templateUrl = templateUrl_(relPath);
      var res = UrlFetchApp.fetch(templateUrl, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) throw new Error('Template HTTP ' + res.getResponseCode() + ': ' + templateUrl);
      html = res.getContentText();
    }
    try { cache.put(key, html, 21600); } catch (_) {} // template >100KB não cabe no cache — segue sem
  }

  var firstName = String(nome || '').trim().split(/\s+/)[0] || '';
  html = html.replace(/\{\$name\|([^}]*)\}/g, function(_, fb) { return firstName || fb; });
  html = html.replace(/\{\$name\}/g, firstName);
  html = html.replace(/\{\$unsubscribe\}/g, '{{amazonSESUnsubscribeUrl}}');

  // Garantia: todo email de marketing PRECISA do link de descadastro.
  if (html.indexOf('{{amazonSESUnsubscribeUrl}}') === -1) {
    html = html.replace(/<\/body>/i,
      '<div style="text-align:center;font-size:11px;color:#888;padding:16px;">' +
      'Não quer mais receber? <a href="{{amazonSESUnsubscribeUrl}}">Cancelar inscrição</a></div></body>');
  }
  return html;
}

function templateUrl_(relPath) {
  var base = PropertiesService.getScriptProperties().getProperty('TEMPLATE_BASE_URL') ||
             'https://fluenciacontabil.com.br/email-templates/';
  if (/^https?:\/\//i.test(relPath)) return relPath;
  return base.replace(/\/$/, '') + '/' + String(relPath).replace(/^\//, '');
}


// ══════════════════════ 1. SYNC DE CONTATOS (planilha → SES) ══════════════════════

/**
 * Trigger 1 min. Leads com "SES Sync" vazio entram na contact list do SES
 * com o tópico da aba. Mesmo padrão da syncPendingToMailerLite.
 */
function syncPendingToSES() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var processed = 0;

    for (var t = 0; t < MAILER_TABS.length && processed < SES_SYNC_BATCH; t++) {
      var cfg = MAILER_TABS[t];
      var sheet = ss.getSheetByName(cfg.sheet);
      if (!sheet || sheet.getLastRow() < 2) continue;

      var cols = headerIndexes_(sheet);
      if (!cols['SES Sync']) continue; // setup ainda não rodou

      var lastRow = sheet.getLastRow();
      var syncVals = sheet.getRange(2, cols['SES Sync'], lastRow - 1, 1).getValues();

      for (var r = 0; r < syncVals.length && processed < SES_SYNC_BATCH; r++) {
        if (syncVals[r][0] !== '') continue;
        var rowNum = r + 2;
        var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
        var email = String(row[cols['E-mail'] - 1] || '').trim().toLowerCase();

        if (!isValidEmail(email)) {
          markCell_(sheet, rowNum, cols, 'SES Sync', 'err:invalid_email');
          processed++;
          continue;
        }
        try {
          sesUpsertContact_(email, cfg.topic, buildContactAttributes_(row, cols, cfg));
          markCell_(sheet, rowNum, cols, 'SES Sync', 'ok');
        } catch (err) {
          if (String(err).indexOf('RATE_LIMIT') >= 0) {
            console.log('SES rate limit — encerrando esta run (linha fica pendente)');
            return;
          }
          markCell_(sheet, rowNum, cols, 'SES Sync', 'err:' + String(err).substring(0, 180));
          logError('SES sync: ' + err, { parameter: { email: email, sheet: cfg.sheet } });
        }
        processed++;
        Utilities.sleep(300); // respeita o limite de TPS das APIs de contato do SES
      }
    }
    if (processed > 0) console.log('SES sync run: ' + processed + ' contatos');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cria o contato; se já existe, adiciona o tópico via update (preservando
 * opt-outs). Lança Error('RATE_LIMIT') em HTTP 429 — quem chama deixa a
 * linha PENDENTE (sem err:) pra re-tentar na próxima execução.
 */
function sesUpsertContact_(email, topicName, attributes) {
  var list = PropertiesService.getScriptProperties().getProperty('SES_CONTACT_LIST') || 'fluencia';
  var pref = [{ TopicName: topicName, SubscriptionStatus: 'OPT_IN' }];

  var res = sesRequest_('POST', ['v2', 'email', 'contact-lists', list, 'contacts'], {
    EmailAddress: email,
    TopicPreferences: pref,
    AttributesData: JSON.stringify(attributes || {})
  });
  if (res.ok) return;
  if (res.code === 429) throw new Error('RATE_LIMIT');

  // SES responde "<email> already exists in List." — tratar como upsert
  if (res.code === 400 && /already.{0,2}exists/i.test(res.raw)) {
    Utilities.sleep(250);
    var get = sesRequest_('GET', ['v2', 'email', 'contact-lists', list, 'contacts', email], null);
    if (get.code === 429) throw new Error('RATE_LIMIT');
    if (get.ok) {
      if (get.body && get.body.UnsubscribeAll) return; // respeita opt-out global
      var current = (get.body && get.body.TopicPreferences) || [];
      var has = current.some(function(p) { return p.TopicName === topicName; });
      if (has) return; // já está no tópico — nada a fazer
      current.push({ TopicName: topicName, SubscriptionStatus: 'OPT_IN' });
      Utilities.sleep(250);
      var upd = sesRequest_('PUT', ['v2', 'email', 'contact-lists', list, 'contacts', email], {
        TopicPreferences: current
      });
      if (upd.code === 429) throw new Error('RATE_LIMIT');
      if (!upd.ok) throw new Error('UpdateContact HTTP ' + upd.code + ': ' + String(upd.raw).substring(0, 200));
      return;
    }
  }
  throw new Error('CreateContact HTTP ' + res.code + ': ' + String(res.raw).substring(0, 200));
}

function buildContactAttributes_(row, cols, cfg) {
  var get = function(name) { return cols[name] ? String(row[cols[name] - 1] || '') : ''; };
  var attrs = {
    origem: get('Origem'), pagina_captura: get('Página'), referrer: get('Referrer'),
    utm_source: get('UTM Source'), utm_medium: get('UTM Medium'), utm_campaign: get('UTM Campaign'),
    dispositivo: get('Dispositivo'), ref_in: get('Ref')
  };
  if (cfg.hasNamePhone) {
    if (get('Nome')) attrs.name = get('Nome');
    if (get('WhatsApp')) attrs.phone = get('WhatsApp');
  }
  return attrs;
}


// ══════════════════════ 2. SEQUÊNCIAS ══════════════════════

/**
 * Trigger 1 h. Pra cada aba: inscreve leads novos (pós-cutover) e envia
 * o próximo passo de quem está com "Seq Próximo Em" vencido.
 */
function processSequences() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('MAILER_ENABLED') !== 'true') return;

    var cutover = props.getProperty('MAILER_CUTOVER_AT');
    var cutoverDate = cutover ? new Date(cutover) : null;
    if (!cutoverDate || isNaN(cutoverDate.getTime())) {
      console.log('MAILER_CUTOVER_AT ausente/inválida — sequências pausadas (proteção contra duplicar MailerLite)');
      return;
    }

    // Dedupe ANTES de inscrever: fecha a janela de quem submeteu 2× na última hora
    dedupePlanilha();

    var steps = loadSequenceConfig_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();
    var sent = 0;

    for (var t = 0; t < MAILER_TABS.length && sent < SEQ_SEND_BATCH; t++) {
      var cfg = MAILER_TABS[t];
      var seqSteps = steps[cfg.sequencia];
      if (!seqSteps || !seqSteps.length) continue;

      var sheet = ss.getSheetByName(cfg.sheet);
      if (!sheet || sheet.getLastRow() < 2) continue;
      var cols = headerIndexes_(sheet);
      if (!cols['Seq Passo']) continue;

      var lastRow = sheet.getLastRow();
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      for (var r = 0; r < data.length && sent < SEQ_SEND_BATCH; r++) {
        var rowNum = r + 2;
        var row = data[r];
        var sesSync = String(row[cols['SES Sync'] - 1] || '');
        var passoCell = row[cols['Seq Passo'] - 1];
        var leadDate = row[cols['Data'] - 1];

        // Inscrição: lead sincronizado, pós-cutover, ainda sem estado
        if (passoCell === '' && sesSync === 'ok') {
          if (!(leadDate instanceof Date) || leadDate < cutoverDate) {
            sheet.getRange(rowNum, cols['Seq Passo']).setValue('pre-cutover');
            continue;
          }
          sheet.getRange(rowNum, cols['Seq Passo']).setValue(0);
          sheet.getRange(rowNum, cols['Seq Próximo Em']).setValue(now); // passo 1 sai nesta ou na próxima run
          passoCell = 0;
          row[cols['Seq Próximo Em'] - 1] = now;
        }

        var passo = parseInt(passoCell, 10);
        if (isNaN(passo) || passo >= seqSteps.length) continue;
        var nextAt = row[cols['Seq Próximo Em'] - 1];
        if (!(nextAt instanceof Date) || nextAt > now) continue;

        var step = seqSteps[passo]; // próximo passo (0-based)
        var email = String(row[cols['E-mail'] - 1] || '').trim().toLowerCase();
        var nome = cols['Nome'] ? String(row[cols['Nome'] - 1] || '') : '';

        try {
          var html = renderTemplate_(step.template, nome);
          sesSendMarketing_(email, step.assunto, html, cfg.topic);
          var novoPasso = passo + 1;
          sheet.getRange(rowNum, cols['Seq Passo']).setValue(
            novoPasso >= seqSteps.length ? 'concluída' : novoPasso);
          if (novoPasso < seqSteps.length) {
            var diasAteProximo = seqSteps[novoPasso].dias - step.dias;
            sheet.getRange(rowNum, cols['Seq Próximo Em'])
              .setValue(new Date(now.getTime() + diasAteProximo * 86400000));
          }
          sent++;
        } catch (err) {
          // Não trava a fila: registra e tenta de novo na próxima run
          logError('Seq ' + cfg.sequencia + ' passo ' + (passo + 1) + ': ' + err,
                   { parameter: { email: email, sheet: cfg.sheet } });
          sent++;
        }
      }
    }
    if (sent > 0) console.log('Sequências: ' + sent + ' emails processados');
  } finally {
    lock.releaseLock();
  }
}

/** Lê a aba Config Sequencias → { A: [{passo, dias, assunto, template}], ... } */
function loadSequenceConfig_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAILER_SHEETS.CONFIG_SEQ);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var out = {};
  rows.forEach(function(r) {
    var seq = String(r[0] || '').trim().toUpperCase();
    if (!seq || String(r[5]).toLowerCase() === 'não' || String(r[5]).toLowerCase() === 'nao') return;
    if (!out[seq]) out[seq] = [];
    out[seq].push({ passo: Number(r[1]), dias: Number(r[2]), assunto: String(r[3]), template: String(r[4]) });
  });
  Object.keys(out).forEach(function(k) {
    out[k].sort(function(a, b) { return a.passo - b.passo; });
  });
  return out;
}


// ══════════════════════ 3. BROADCASTS ══════════════════════

/**
 * Trigger 5 min. Aba "Broadcasts": linhas agendadas com data vencida são
 * enviadas em lotes resumíveis (coluna Enviados = cursor de progresso).
 * Público = tópicos separados por vírgula; dedupe por email entre abas.
 */
function processBroadcasts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('MAILER_ENABLED') !== 'true') return;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MAILER_SHEETS.BROADCASTS);
    if (!sheet || sheet.getLastRow() < 2) return;

    var now = new Date();
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();

    for (var r = 0; r < rows.length; r++) {
      var status = String(rows[r][5] || '');
      if (status.indexOf('ok') === 0 || status.indexOf('err') === 0 || status === 'pausado') continue;
      var agendado = rows[r][4];
      if (!(agendado instanceof Date) || agendado > now) continue;

      var rowNum = r + 2;
      var assunto = String(rows[r][1] || '');
      var template = String(rows[r][2] || '');
      var topicos = String(rows[r][3] || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (!assunto || !template || !topicos.length) {
        sheet.getRange(rowNum, 6).setValue('err:config incompleta (assunto/template/tópicos)');
        continue;
      }

      var recipients = collectRecipients_(topicos);
      var cursor = parseInt(rows[r][6], 10) || 0;
      sheet.getRange(rowNum, 8).setValue(recipients.length);

      var sentThisRun = 0;
      var errors = 0;
      while (cursor < recipients.length && sentThisRun < BCAST_SEND_BATCH) {
        var rec = recipients[cursor];
        try {
          var html = renderTemplate_(template, rec.nome);
          sesSendMarketing_(rec.email, assunto, html, rec.topic);
        } catch (err) {
          errors++;
          logError('Broadcast linha ' + rowNum + ': ' + err, { parameter: { email: rec.email } });
        }
        cursor++;
        sentThisRun++;
      }

      sheet.getRange(rowNum, 6).setValue(
        cursor >= recipients.length
          ? 'ok (' + (recipients.length - errors) + '/' + recipients.length + ')'
          : 'enviando');
      sheet.getRange(rowNum, 7).setValue(cursor);
      sheet.getRange(rowNum, 9).setValue(new Date());

      return; // 1 broadcast por run — mantém ritmo previsível e dentro das quotas
    }
  } finally {
    lock.releaseLock();
  }
}

/** Coleta destinatários únicos das abas cujos tópicos foram pedidos (1º registro ganha o nome/tópico). */
function collectRecipients_(topicos) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var seen = {};
  var out = [];
  MAILER_TABS.forEach(function(cfg) {
    if (topicos.indexOf(cfg.topic) === -1) return;
    var sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    var cols = headerIndexes_(sheet);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    data.forEach(function(row) {
      var email = String(row[cols['E-mail'] - 1] || '').trim().toLowerCase();
      if (!isValidEmail(email) || seen[email]) return;
      // Só envia broadcast pra quem já está na contact list (SES Sync ok)
      if (String(row[cols['SES Sync'] - 1] || '') !== 'ok') return;
      seen[email] = true;
      out.push({
        email: email,
        nome: cols['Nome'] ? String(row[cols['Nome'] - 1] || '') : '',
        topic: cfg.topic
      });
    });
  });
  return out;
}


// ══════════════════════ MIGRAÇÃO DO MAILERLITE ══════════════════════

/**
 * Importa assinantes exportados do MailerLite (aba "Import ML":
 * Email | Nome | Tópico | SES Sync | SES Sync At). Rodar manualmente
 * quantas vezes precisar — processa 50 por execução.
 */
function importMailerLiteContacts() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAILER_SHEETS.IMPORT_ML);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Aba "Import ML" vazia.'); return; }
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var done = 0;
  for (var r = 0; r < data.length && done < 50; r++) {
    if (String(data[r][3] || '') !== '') continue;
    var email = String(data[r][0] || '').trim().toLowerCase();
    var topic = String(data[r][2] || '').trim() || 'newsletter';
    var rowNum = r + 2;
    if (!isValidEmail(email)) {
      sheet.getRange(rowNum, 4).setValue('err:invalid_email');
      sheet.getRange(rowNum, 5).setValue(new Date());
      done++;
      continue;
    }
    try {
      sesUpsertContact_(email, topic, { name: String(data[r][1] || ''), origem: 'import_mailerlite' });
      sheet.getRange(rowNum, 4).setValue('ok');
      sheet.getRange(rowNum, 5).setValue(new Date());
    } catch (err) {
      if (String(err).indexOf('RATE_LIMIT') >= 0) {
        Logger.log('⏳ SES rate limit — pausando esta run. Linha fica pendente; rode de novo em ~1 min.');
        return;
      }
      sheet.getRange(rowNum, 4).setValue('err:' + String(err).substring(0, 180));
      sheet.getRange(rowNum, 5).setValue(new Date());
    }
    done++;
    Utilities.sleep(300); // respeita o limite de TPS das APIs de contato do SES
  }
  var pendentes = data.filter(function(d) { return String(d[3] || '') === ''; }).length - done;
  Logger.log('Import ML: ' + done + ' processados nesta execução. Restam ~' + Math.max(0, pendentes) + ' — rode de novo se houver pendentes.');
}

/**
 * Importa DESCADASTRADOS do MailerLite (aba "Unsubs ML": Email | Status).
 * CRÍTICO pré-cutover: quem saiu lá NUNCA pode receber pelo SES (LGPD).
 */
function importMailerLiteUnsubs() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAILER_SHEETS.UNSUBS_ML);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Aba "Unsubs ML" vazia.'); return; }
  var list = PropertiesService.getScriptProperties().getProperty('SES_CONTACT_LIST') || 'fluencia';
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var done = 0;
  for (var r = 0; r < data.length && done < 50; r++) {
    if (String(data[r][1] || '') !== '') continue;
    var email = String(data[r][0] || '').trim().toLowerCase();
    var rowNum = r + 2;
    if (!isValidEmail(email)) { sheet.getRange(rowNum, 2).setValue('err:invalid_email'); done++; continue; }

    var res = sesRequest_('POST', ['v2', 'email', 'contact-lists', list, 'contacts'],
                          { EmailAddress: email, UnsubscribeAll: true });
    if (!res.ok && res.code === 400 && /already.{0,2}exists/i.test(res.raw)) {
      Utilities.sleep(250);
      res = sesRequest_('PUT', ['v2', 'email', 'contact-lists', list, 'contacts', email],
                        { UnsubscribeAll: true });
    }
    if (res.code === 429) {
      Logger.log('⏳ SES rate limit — pausando esta run. Rode de novo em ~1 min.');
      return;
    }
    sheet.getRange(rowNum, 2).setValue(res.ok ? 'ok' : 'err:HTTP ' + res.code);
    done++;
    Utilities.sleep(300);
  }
  Logger.log('Unsubs ML: ' + done + ' processados nesta execução — rode de novo se houver pendentes.');
}


/**
 * Limpa células err: (exceto err:invalid_email) na coluna SES Sync das 4
 * abas de leads e no status da "Import ML" — as linhas voltam a PENDENTE
 * e os workers/import reprocessam. Rodar 1× depois de corrigir bug/limite.
 */
function reprocessarErros() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var limpas = 0;

  MAILER_TABS.forEach(function(cfg) {
    var sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    var cols = headerIndexes_(sheet);
    if (!cols['SES Sync']) return;
    var range = sheet.getRange(2, cols['SES Sync'], sheet.getLastRow() - 1, 1);
    var vals = range.getValues();
    var mudou = false;
    for (var r = 0; r < vals.length; r++) {
      var v = String(vals[r][0] || '');
      if (v.indexOf('err:') === 0 && v !== 'err:invalid_email') {
        vals[r][0] = '';
        mudou = true;
        limpas++;
      }
    }
    if (mudou) range.setValues(vals);
  });

  var im = ss.getSheetByName(MAILER_SHEETS.IMPORT_ML);
  if (im && im.getLastRow() > 1) {
    var range2 = im.getRange(2, 4, im.getLastRow() - 1, 1);
    var vals2 = range2.getValues();
    var mudou2 = false;
    for (var r2 = 0; r2 < vals2.length; r2++) {
      var v2 = String(vals2[r2][0] || '');
      if (v2.indexOf('err:') === 0 && v2 !== 'err:invalid_email') {
        vals2[r2][0] = '';
        mudou2 = true;
        limpas++;
      }
    }
    if (mudou2) range2.setValues(vals2);
  }

  Logger.log('✅ ' + limpas + ' célula(s) err: limpas — voltam a pendente. O trigger de 1min e o importMailerLiteContacts reprocessam sozinhos.');
}


// ══════════════════════ SETUP ══════════════════════

/** 1× — cria contact list + topics + configuration set no SES. Idempotente. */
function setupSesInfra() {
  var props = PropertiesService.getScriptProperties();
  var list = props.getProperty('SES_CONTACT_LIST') || 'fluencia';
  var configSet = props.getProperty('SES_CONFIG_SET') || 'fluencia-marketing';

  var r1 = sesRequest_('POST', ['v2', 'email', 'contact-lists'], {
    ContactListName: list,
    Description: 'Leads Fluência Contábil (newsletter, lista de espera, dicionário, lives)',
    Topics: SES_TOPICS
  });
  Logger.log(r1.ok ? '✅ Contact list "' + list + '" criada'
    : (/AlreadyExists/i.test(r1.raw) ? 'ℹ️ Contact list já existia' : '❌ Contact list: HTTP ' + r1.code + ' ' + r1.raw));

  var r2 = sesRequest_('POST', ['v2', 'email', 'configuration-sets'], { ConfigurationSetName: configSet });
  Logger.log(r2.ok ? '✅ Configuration set "' + configSet + '" criado'
    : (/AlreadyExists/i.test(r2.raw) ? 'ℹ️ Configuration set já existia' : '❌ Config set: HTTP ' + r2.code + ' ' + r2.raw));

  Logger.log('Lembrete: a IDENTIDADE (news.fluenciacontabil.com.br) se verifica no console SES — ver runbook.');
}

/** 1× — colunas novas nas 4 abas + abas de config pré-preenchidas + triggers. Idempotente. */
function setupMailerAfterDeploy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Colunas novas (NÃO usa ensureSheet — aquele marca ML Sync='migrated' ao detectar coluna nova)
  MAILER_TABS.forEach(function(cfg) {
    var sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    MAILER_COLS.forEach(function(col) {
      if (headers.indexOf(col) === -1) {
        var c = sheet.getLastColumn() + 1;
        sheet.getRange(1, c).setValue(col).setFontWeight('bold')
          .setBackground('#1B2A4A').setFontColor('#FFFFFF');
        headers.push(col);
      }
    });
  });
  Logger.log('✅ Colunas ' + MAILER_COLS.join(' / ') + ' garantidas nas 4 abas');

  // 2. Aba Config Sequencias (pré-preenchida; A/B/C: CONFERIR delays no painel MailerLite antes do cutover)
  if (!ss.getSheetByName(MAILER_SHEETS.CONFIG_SEQ)) {
    var cs = ss.insertSheet(MAILER_SHEETS.CONFIG_SEQ);
    var rows = [
      ['Sequência', 'Passo', 'Dias após inscrição', 'Assunto', 'Template (relativo a TEMPLATE_BASE_URL)', 'Ativo'],
      ['A', 1, 0,  'Bem-vindo(a) à Fluência Contábil',                       'sequencia-a/A1-bem-vindo.html', 'sim'],
      ['A', 2, 2,  'A contabilidade é um idioma. Você só não sabia.',        'sequencia-a/A2-idioma.html', 'sim'],
      ['A', 3, 4,  'A pegadinha que 9 em cada 10 concurseiros caem',         'sequencia-a/A3-pegadinha.html', 'sim'],
      ['A', 4, 7,  'Quem está por trás da Fluência Contábil',                'sequencia-a/A4-quem-somos.html', 'sim'],
      ['A', 5, 10, 'Se o método faz sentido pra você, tem um próximo passo', 'sequencia-a/A5-lista-espera.html', 'sim'],
      ['B', 1, 0,  'Você está dentro. Bem-vindo(a) à Lista de Espera.',      'sequencia-b/B1-bem-vindo-lista.html', 'sim'],
      ['B', 2, 3,  'As 5 camadas do método Fluência Contábil',               'sequencia-b/B2-cinco-camadas.html', 'sim'],
      ['B', 3, 6,  'Quem vai te ensinar no Fluência Contábil',               'sequencia-b/B3-quem-te-ensina.html', 'sim'],
      ['B', 4, 9,  '[Você é VIP] As 4 lives gratuitas do Fluência Contábil', 'sequencia-b/B4-vip-lives.html', 'sim'],
      ['B', 5, 12, '[Aula 01 grátis] Método das Partidas Dobradas',          'sequencia-b/B5-aula-01.html', 'sim'],
      ['B', 6, 15, 'A rotina que separa quem passa de quem desiste',         'sequencia-b/B6-rotina.html', 'sim'],
      ['C', 1, 0,  'Seu Dicionário chegou — e tem mais história aí',         'sequencia-c/C1-bem-vindo-lead-magnet.html', 'sim'],
      ['C', 2, 3,  'O Dicionário é só metade. A outra metade é a chave.',    'sequencia-c/C2-dicionario-metade.html', 'sim'],
      ['C', 3, 6,  'A pegadinha que o Dicionário te salva de cair',          'sequencia-c/C3-pegadinha.html', 'sim'],
      ['C', 4, 9,  'Quem tá por trás desse Dicionário',                      'sequencia-c/C4-quem-tras-dicionario.html', 'sim'],
      ['C', 5, 12, '[Aula 01 grátis] Método das Partidas Dobradas',          'sequencia-c/C5-aula-01.html', 'sim'],
      ['C', 6, 15, 'Seu próximo passo depois de 3 semanas com a gente',      'sequencia-c/C6-lista-espera.html', 'sim'],
      ['D', 1, 0,  'Você está dentro: 4 lives + Dicionário grátis',          'sequencia-d/D1-bem-vindo-lives.html', 'sim'],
      ['D', 2, 2,  'Por que essas 4 lives, nessa ordem',                     'sequencia-d/D2-cinco-camadas.html', 'sim'],
      ['D', 3, 4,  'Quem vai te ensinar nas lives',                          'sequencia-d/D3-quem-te-ensina.html', 'sim'],
      ['D', 4, 6,  '[Aula 01 grátis] Método das Partidas Dobradas',          'sequencia-d/D4-aula-01.html', 'sim'],
      ['D', 5, 9,  'Como aproveitar as lives ao máximo',                     'sequencia-d/D5-proxima-live.html', 'sim']
    ];
    cs.getRange(1, 1, rows.length, 6).setValues(rows);
    cs.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
    cs.setFrozenRows(1);
    cs.getRange('H1').setValue('⚠️ Cadências A/B/C foram estimadas — conferir os delays reais no painel MailerLite antes do cutover. D é 0/+2/+4/+6/+9 (documentado).');
    Logger.log('✅ Aba "Config Sequencias" criada e pré-preenchida (22 emails A-D)');
  }

  // 3. Aba Broadcasts
  if (!ss.getSheetByName(MAILER_SHEETS.BROADCASTS)) {
    var bc = ss.insertSheet(MAILER_SHEETS.BROADCASTS);
    bc.getRange(1, 1, 1, 9).setValues([[
      'ID', 'Assunto', 'Template (relativo)', 'Tópicos (csv)', 'Agendado para',
      'Status', 'Enviados', 'Total', 'Última execução'
    ]]).setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
    bc.setFrozenRows(1);
    bc.getRange('K1').setValue('Tópicos válidos: newsletter, lista-espera, dicionario, lives. Status: vazio=aguardando · enviando · ok (n/total) · err:... · "pausado" (manual) interrompe.');
    Logger.log('✅ Aba "Broadcasts" criada');
  }

  // 4. Abas de migração
  if (!ss.getSheetByName(MAILER_SHEETS.IMPORT_ML)) {
    var im = ss.insertSheet(MAILER_SHEETS.IMPORT_ML);
    im.getRange(1, 1, 1, 5).setValues([['Email', 'Nome', 'Tópico', 'SES Sync', 'SES Sync At']])
      .setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
    im.setFrozenRows(1);
    Logger.log('✅ Aba "Import ML" criada');
  }
  if (!ss.getSheetByName(MAILER_SHEETS.UNSUBS_ML)) {
    var un = ss.insertSheet(MAILER_SHEETS.UNSUBS_ML);
    un.getRange(1, 1, 1, 2).setValues([['Email', 'Status']])
      .setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
    un.setFrozenRows(1);
    Logger.log('✅ Aba "Unsubs ML" criada');
  }

  // 5. Triggers
  recreateTrigger_('syncPendingToSES', function(b) { return b.timeBased().everyMinutes(1); });
  // 5min (não 1h): email de boas-vindas/confirmação precisa chegar em minutos, não em até 1h
  recreateTrigger_('processSequences', function(b) { return b.timeBased().everyMinutes(5); });
  recreateTrigger_('processBroadcasts', function(b) { return b.timeBased().everyMinutes(5); });
  recreateTrigger_('dedupeDiario', function(b) { return b.timeBased().everyDays(1).atHour(3); });
  Logger.log('✅ Triggers: syncPendingToSES (1min) · processSequences (5min) · processBroadcasts (5min) · dedupeDiario (diário ~3h)');
  Logger.log('');
  Logger.log('⚠️ O trigger do MailerLite continua ativo. Quando o SES estiver validado, rode cutoverDisableMailerLite().');
}

/**
 * 1× — habilita o grupo BOLSÃO (campanha 13–28/06).
 * Pré-requisito: policy IAM do fluencia-mailer precisa da action
 * ses:UpdateContactList (adicionar no console IAM antes de rodar).
 *
 * Faz: (a) adiciona o tópico 'bolsao' na contact list existente;
 * (b) garante a aba "Bolsão" com colunas SES/Seq/CRM; (c) adiciona a
 * sequência BOLSAO (1 email: confirmação imediata) na Config Sequencias;
 * (d) adiciona a linha Bolsão na Config CRM (se existir). Idempotente.
 */
function setupBolsao() {
  var props = PropertiesService.getScriptProperties();
  var list = props.getProperty('SES_CONTACT_LIST') || 'fluencia';

  // (a) tópico na contact list (UpdateContactList substitui o conjunto — manda TODOS)
  var upd = sesRequest_('PUT', ['v2', 'email', 'contact-lists', list], {
    Description: 'Leads Fluência Contábil (newsletter, lista de espera, dicionário, lives, bolsão)',
    Topics: SES_TOPICS
  });
  Logger.log(upd.ok ? '✅ Tópico "bolsao" adicionado à contact list'
    : '❌ UpdateContactList HTTP ' + upd.code + ': ' + String(upd.raw).substring(0, 250) +
      (upd.code === 403 ? ' → adicione ses:UpdateContactList na policy IAM fluencia-mailer' : ''));
  if (!upd.ok) return;

  // (b) colunas do mailer na aba Bolsão (a aba em si é criada pelo setupAfterDeploy do arquivo unificado)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Bolsão');
  if (!sheet) {
    Logger.log('⚠️ Aba "Bolsão" não existe ainda — rode setupAfterDeploy() (arquivo unificado) primeiro e rode setupBolsao() de novo.');
    return;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  MAILER_COLS.concat(['CRM Sync', 'CRM Sync At']).forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      var c = sheet.getLastColumn() + 1;
      sheet.getRange(1, c).setValue(col).setFontWeight('bold')
        .setBackground('#1B2A4A').setFontColor('#FFFFFF');
      headers.push(col);
    }
  });
  Logger.log('✅ Colunas SES/Seq/CRM garantidas na aba Bolsão');

  // (c) sequência BOLSAO: 1 email — confirmação imediata (véspera/prova/ranking são broadcasts com data fixa)
  var cs = ss.getSheetByName(MAILER_SHEETS.CONFIG_SEQ);
  if (cs) {
    var temBolsao = cs.getRange(2, 1, Math.max(1, cs.getLastRow() - 1), 1).getValues()
      .some(function(r) { return String(r[0]).toUpperCase() === 'BOLSAO'; });
    if (!temBolsao) {
      cs.appendRow(['BOLSAO', 1, 0, 'Inscrição confirmada! Agora é estudar até 28/06 🎯', 'bolsao/confirmacao.html', 'sim']);
      Logger.log('✅ Sequência BOLSAO adicionada na Config Sequencias (1 passo, imediato)');
    }
  }

  // (d) linha na Config CRM (preencher IDs depois de criar o funil no Mensageiro)
  var cc = ss.getSheetByName('Config CRM');
  if (cc) {
    var temLinha = cc.getRange(2, 1, Math.max(1, cc.getLastRow() - 1), 1).getValues()
      .some(function(r) { return String(r[0]) === 'Bolsão'; });
    if (!temLinha) {
      cc.appendRow(['Bolsão', '', '', 'bolsao']);
      Logger.log('✅ Linha Bolsão adicionada na Config CRM — preencher Pipeline/Stage ID');
    }
  }

  Logger.log('');
  Logger.log('Próximos: testRegressionAll() (unificado) pra validar o roteamento · migrateBolsaoLeads() pra mover os inscritos antigos.');
}

/**
 * 1× — move os inscritos ANTIGOS do Bolsão (origem bolsao_lp, que caíam na
 * "Lista de Espera" por fallback) pra aba "Bolsão". Eles ganham o tópico
 * 'bolsao' no SES (SES Sync resetado) e NÃO recebem a sequência de
 * confirmação (Seq Passo = pre-cutover) — só os broadcasts da prova.
 */
function migrateBolsaoLeads() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var origem = ss.getSheetByName('Lista de Espera');
    var destino = ss.getSheetByName('Bolsão');
    if (!origem || !destino) { Logger.log('❌ Aba Lista de Espera ou Bolsão não encontrada.'); return; }

    var colsO = headerIndexes_(origem);
    var colsD = headerIndexes_(destino);
    var data = origem.getRange(2, 1, origem.getLastRow() - 1, origem.getLastColumn()).getValues();

    var paraMover = [];
    for (var r = 0; r < data.length; r++) {
      if (String(data[r][colsO['Origem'] - 1] || '').toLowerCase().indexOf('bolsao') === 0) paraMover.push(r);
    }
    if (!paraMover.length) { Logger.log('ℹ️ Nenhum lead bolsao_lp na Lista de Espera.'); return; }

    paraMover.forEach(function(r) {
      var get = function(name) { return colsO[name] ? data[r][colsO[name] - 1] : ''; };
      var novaLinha = [];
      Object.keys(colsD).forEach(function(h) { novaLinha[colsD[h] - 1] = ''; });
      ['Data', 'Nome', 'E-mail', 'WhatsApp', 'Origem', 'Ref', 'Página', 'Referrer',
       'UTM Source', 'UTM Medium', 'UTM Campaign', 'Dispositivo'].forEach(function(h) {
        if (colsD[h]) novaLinha[colsD[h] - 1] = get(h);
      });
      if (colsD['Seq Passo']) novaLinha[colsD['Seq Passo'] - 1] = 'pre-cutover';
      // SES Sync fica vazio → trigger re-sincroniza adicionando o tópico bolsao
      destino.appendRow(novaLinha);
    });
    for (var i = paraMover.length - 1; i >= 0; i--) origem.deleteRow(paraMover[i] + 2);

    Logger.log('✅ ' + paraMover.length + ' lead(s) bolsao_lp movidos pra aba Bolsão. O trigger de 1min adiciona o tópico bolsao a todos.');
  } finally {
    lock.releaseLock();
  }
}

/** CUTOVER: remove o trigger do sync MailerLite (a função fica no código pra rollback). */
function cutoverDisableMailerLite() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(tr) {
    if (tr.getHandlerFunction() === 'syncPendingToMailerLite') { ScriptApp.deleteTrigger(tr); removed++; }
  });
  Logger.log(removed > 0
    ? '✅ Trigger do MailerLite removido. Leads novos agora só sincronizam com SES (e CRM).'
    : 'ℹ️ Nenhum trigger do MailerLite encontrado (já removido?).');
  Logger.log('Rollback: rodar setupAfterDeploy() do arquivo unificado recria o trigger do MailerLite.');
}

function recreateTrigger_(handler, builderFn) {
  ScriptApp.getProjectTriggers().forEach(function(tr) {
    if (tr.getHandlerFunction() === handler) ScriptApp.deleteTrigger(tr);
  });
  builderFn(ScriptApp.newTrigger(handler)).create();
}

/** Mapa header→índice 1-based da linha 1. */
function headerIndexes_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function(h, i) { if (h) map[String(h)] = i + 1; });
  return map;
}

function markCell_(sheet, rowNum, cols, colName, value) {
  sheet.getRange(rowNum, cols[colName]).setValue(value);
  var atCol = cols[colName + ' At'];
  if (atCol) sheet.getRange(rowNum, atCol).setValue(new Date());
}


// ══════════════════════ TESTES ══════════════════════

/** Valida credenciais AWS + estado da conta SES. */
function testSesAuth() {
  var res = sesRequest_('GET', ['v2', 'email', 'account'], null);
  if (res.ok) {
    Logger.log('✅ SES auth OK. ProductionAccess=' + (res.body && res.body.ProductionAccessEnabled) +
               ' · Quota 24h=' + (res.body && res.body.SendQuota && res.body.SendQuota.Max24HourSend));
  } else {
    Logger.log('❌ HTTP ' + res.code + ': ' + String(res.raw).substring(0, 400));
  }
}

/**
 * AGENDA OS 5 BROADCASTS REAIS DO BOLSÃO na aba Broadcasts — sem
 * copiar/colar, sem erro de digitação. Idempotente: pula IDs que já
 * existem (rodar 2× não duplica). Todos com tópico SÓ `bolsao`.
 *
 * ⚠️ Lembrete: prova.html e ranking.html têm placeholders
 * ({LINK_PDF_PROVA}, {LINK_FORMS}, {LINK_RANKING}) que precisam ser
 * preenchidos e PUBLICADOS até a noite de 26/06 (cache de 6h).
 */
function agendarBroadcastsBolsao() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bc = ss.getSheetByName(MAILER_SHEETS.BROADCASTS);
  if (!bc) { Logger.log('❌ Aba Broadcasts não existe — rode setupMailerAfterDeploy() primeiro.'); return; }

  // new Date(ano, mês-1, dia, hora, min) — junho = 5, julho = 6
  var planos = [
    ['BOLSAO-VESPERA',       'Amanhã 7h30: sua prova do Bolsão chega neste e-mail',  'bolsao/vespera.html',       'bolsao', new Date(2026, 5, 27, 18, 0, 0)],
    ['BOLSAO-PROVA',         '🔴 BOLSÃO: sua prova está aqui — envie até 13h00',     'bolsao/prova.html',         'bolsao', new Date(2026, 5, 28, 7, 30, 0)],
    ['BOLSAO-POS-PROVA',     'E aí, gostou da dinâmica? Tem um próximo passo',        'bolsao/pos-prova.html',     'bolsao', new Date(2026, 5, 28, 18, 0, 0)],
    ['BOLSAO-RANKING',       'O ranking do Bolsão saiu 🏆',                           'bolsao/ranking.html',       'bolsao', new Date(2026, 5, 29, 18, 0, 0)],
    ['BOLSAO-CONVITE-LISTA', 'As 5 bolsas foram entregues ontem. E o seu lugar?',     'bolsao/convite-lista.html', 'bolsao', new Date(2026, 6, 2, 9, 0, 0)]
  ];

  var existentes = bc.getLastRow() > 1
    ? bc.getRange(2, 1, bc.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0]); })
    : [];

  var criados = 0;
  planos.forEach(function(p) {
    if (existentes.indexOf(p[0]) >= 0) {
      Logger.log('↩️ ' + p[0] + ' já agendado — pulando');
      return;
    }
    bc.appendRow([p[0], p[1], p[2], p[3], p[4], '', '', '', '']);
    Logger.log('📅 ' + p[0] + ' agendado pra ' +
      Utilities.formatDate(p[4], 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'));
    criados++;
  });

  Logger.log('');
  Logger.log('✅ ' + criados + ' broadcast(s) agendado(s) (' + (planos.length - criados) + ' já existiam).');
  Logger.log('⚠️ Até 26/06 à noite: preencher {LINK_PDF_PROVA}/{LINK_FORMS} no prova.html e {LINK_RANKING} no ranking.html + publicar (cache de 6h).');
}

/**
 * AGENDA OS 27 BROADCASTS DO LANÇAMENTO (agosto/2026) — datas e assuntos
 * do plano vigente (confirmados pelo Vinícius em 11/06). Idempotente.
 *
 * Composição:
 *   12 convites das lives (D-3 09h · D-0 09h · AO VIVO 20h, por live)
 *    7 broadcasts de venda L1–L7 (janela Fundador 04/08→16/08 23h59)
 *    8 operacionais Sequência E (véspera 18h + AOVIVO 19h55, SÓ inscritos das lives)
 *
 * Decisão de público: AO VIVO dos convites NÃO inclui o tópico `lives` —
 * inscritos das lives recebem a versão própria (E) às 19h55; mandar as
 * duas seria duplicado. D-3/D-0 vão pra TODOS os grupos (incl. bolsao).
 *
 * Pode agendar com antecedência: as linhas DORMEM até a data/hora.
 * ⚠️ Antes de 27/07 (1º envio): garantir que os templates L1-L7 e dos
 * convites ATUALIZADOS estejam publicados em produção (≥6h antes — cache).
 */
function agendarBroadcastsLancamento() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bc = ss.getSheetByName(MAILER_SHEETS.BROADCASTS);
  if (!bc) { Logger.log('❌ Aba Broadcasts não existe — rode setupMailerAfterDeploy() primeiro.'); return; }

  var TODOS   = 'newsletter,lista-espera,dicionario,lives,bolsao';
  var SEMLIVE = 'newsletter,lista-espera,dicionario,bolsao';
  var SOLIVE  = 'lives';
  var CONV = 'broadcasts/convites-lives/';

  // new Date(ano, mês-1, dia, h, m) — julho = 6, agosto = 7
  var planos = [
    // ── Venda L1–L7 ──
    ['L1', 'Em 1 semana abrem as 4 lives gratuitas',                'broadcasts/lancamento/L1-anuncio.html',        TODOS, new Date(2026, 6, 27, 9, 0)],
    ['L2', 'Por que só anual? (e por que isso te interessa)',       'broadcasts/lancamento/L2-por-que-anual.html',  TODOS, new Date(2026, 6, 31, 9, 0)],
    ['L3', 'Amanhã 20h: começa a semana das 4 lives',               'broadcasts/lancamento/L3-vespera.html',        TODOS, new Date(2026, 7, 3, 18, 0)],
    ['L4', 'Acabou a semana de lives — restam 9d na janela',        'broadcasts/lancamento/L4-pos-lives-roi.html',  TODOS, new Date(2026, 7, 8, 9, 0)],
    ['L5', 'Amanhã encerra (alguns que já estão dentro)',           'broadcasts/lancamento/L5-depoimentos.html',    TODOS, new Date(2026, 7, 13, 18, 0)],
    ['L6', 'ÚLTIMO DIA · janela do Fundador encerra hoje 23h59',    'broadcasts/lancamento/L6-ultimo-dia.html',     TODOS, new Date(2026, 7, 16, 9, 0)],
    ['L7', '🚨 ÚLTIMA CHAMADA · 5h pra encerrar a janela',          'broadcasts/lancamento/L7-ultima-chamada.html', TODOS, new Date(2026, 7, 16, 19, 0)],
    // ── Convites Live 1 (ter 04/08 20h) ──
    ['CONV-L1-D3',     'Em 3 dias: Live 1 · Débito e Crédito',      CONV + 'live-1-debito-credito/D-3.html',    TODOS,   new Date(2026, 6, 31, 9, 0)],
    ['CONV-L1-D0',     'HOJE às 20h: Débito e Crédito',             CONV + 'live-1-debito-credito/D-0.html',    TODOS,   new Date(2026, 7, 4, 9, 0)],
    ['CONV-L1-AOVIVO', 'Começando agora · entra aqui',              CONV + 'live-1-debito-credito/AOVIVO.html', SEMLIVE, new Date(2026, 7, 4, 20, 0)],
    // ── Convites Live 2 (qua 05/08 20h) ──
    ['CONV-L2-D3',     'Em 3 dias: Live 2 · CPC 51',                CONV + 'live-2-cpc-51/D-3.html',            TODOS,   new Date(2026, 7, 1, 9, 0)],
    ['CONV-L2-D0',     'HOJE às 20h: CPC 51',                       CONV + 'live-2-cpc-51/D-0.html',            TODOS,   new Date(2026, 7, 5, 9, 0)],
    ['CONV-L2-AOVIVO', 'Começando agora · entra aqui',              CONV + 'live-2-cpc-51/AOVIVO.html',         SEMLIVE, new Date(2026, 7, 5, 20, 0)],
    // ── Convites Live 3 — Lançamento Oficial (qui 06/08 20h) ──
    ['CONV-L3-D3',     'Em 3 dias: a casa abre · Lançamento Oficial', CONV + 'live-3-lancamento/D-3.html',      TODOS,   new Date(2026, 7, 3, 9, 0)],
    ['CONV-L3-D0',     'HOJE 20h: A CASA ABRE — lançamento ao vivo',  CONV + 'live-3-lancamento/D-0.html',      TODOS,   new Date(2026, 7, 6, 9, 0)],
    ['CONV-L3-AOVIVO', 'Lançamento Oficial começando agora',          CONV + 'live-3-lancamento/AOVIVO.html',   SEMLIVE, new Date(2026, 7, 6, 20, 0)],
    // ── Convites Live 4 (sex 07/08 20h) ──
    ['CONV-L4-D3',     'Em 3 dias: Tour pela Plataforma',             CONV + 'live-4-plataforma/D-3.html',      TODOS,   new Date(2026, 7, 4, 9, 0)],
    ['CONV-L4-D0',     'HOJE 20h: Tour pela Plataforma — a casa por dentro', CONV + 'live-4-plataforma/D-0.html', TODOS, new Date(2026, 7, 7, 9, 0)],
    ['CONV-L4-AOVIVO', 'Tour ao vivo começando agora',                CONV + 'live-4-plataforma/AOVIVO.html',   SEMLIVE, new Date(2026, 7, 7, 20, 0)],
    // ── Sequência E operacional (SÓ inscritos das lives) ──
    ['E-L1-VESPERA', 'Amanhã 20h: Live 1 — Débito e Crédito',        'sequencia-e/live-1-vespera.html', SOLIVE, new Date(2026, 7, 3, 18, 30)],
    ['E-L1-AOVIVO',  '🔴 Live 1 começando agora: Débito e Crédito',  'sequencia-e/live-1-aovivo.html',  SOLIVE, new Date(2026, 7, 4, 19, 55)],
    ['E-L2-VESPERA', 'Amanhã 20h: Live 2 — CPC 51',                  'sequencia-e/live-2-vespera.html', SOLIVE, new Date(2026, 7, 4, 18, 0)],
    ['E-L2-AOVIVO',  '🔴 Live 2 começando agora: CPC 51',            'sequencia-e/live-2-aovivo.html',  SOLIVE, new Date(2026, 7, 5, 19, 55)],
    ['E-L3-VESPERA', 'Amanhã 20h: Live 3 — Lançamento Oficial',      'sequencia-e/live-3-vespera.html', SOLIVE, new Date(2026, 7, 5, 18, 0)],
    ['E-L3-AOVIVO',  '🔴 Live 3 começando agora: Lançamento Oficial','sequencia-e/live-3-aovivo.html',  SOLIVE, new Date(2026, 7, 6, 19, 55)],
    ['E-L4-VESPERA', 'Amanhã 20h: Live 4 — Tour pela Plataforma',    'sequencia-e/live-4-vespera.html', SOLIVE, new Date(2026, 7, 6, 18, 0)],
    ['E-L4-AOVIVO',  '🔴 Live 4 começando agora: Tour pela Plataforma','sequencia-e/live-4-aovivo.html', SOLIVE, new Date(2026, 7, 7, 19, 55)]
  ];

  var existentes = bc.getLastRow() > 1
    ? bc.getRange(2, 1, bc.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0]); })
    : [];

  var criados = 0;
  planos.forEach(function(p) {
    if (existentes.indexOf(p[0]) >= 0) { Logger.log('↩️ ' + p[0] + ' já agendado — pulando'); return; }
    bc.appendRow([p[0], p[1], p[2], p[3], p[4], '', '', '', '']);
    criados++;
  });

  Logger.log('✅ ' + criados + ' broadcast(s) do lançamento agendado(s) (' + (planos.length - criados) + ' já existiam). As linhas dormem até a data.');
  Logger.log('⚠️ Antes de 27/07: publicar em produção os templates L1-L7/convites ATUALIZADOS (hoje há versões novas não commitadas no repo).');
}

/**
 * SIMULA O PÚBLICO DE UM BROADCAST PRA TODOS OS GRUPOS — SEM ENVIAR NADA.
 * Roda o coletor real (5 abas + dedupe por email) e loga os números.
 * É a prova a seco do caminho multi-grupo: coleta provada aqui + envio
 * provado no ensaio = broadcast de agosto coberto de ponta a ponta.
 */
function simularPublicoBroadcast() {
  var TODOS = ['newsletter', 'lista-espera', 'dicionario', 'lives', 'bolsao'];
  var recipients = collectRecipients_(TODOS);

  var porGrupo = {};
  recipients.forEach(function(r) { porGrupo[r.topic] = (porGrupo[r.topic] || 0) + 1; });

  Logger.log('📊 SIMULAÇÃO de broadcast pra TODOS os grupos (nenhum email enviado):');
  TODOS.forEach(function(t) {
    Logger.log('   ' + t + ': ' + (porGrupo[t] || 0) + ' destinatário(s)');
  });
  Logger.log('   ─────────────────────────');
  Logger.log('   TOTAL (já deduplicado por email): ' + recipients.length);
  Logger.log('');
  Logger.log('⏱️ A ' + BCAST_SEND_BATCH + '/rodada de 5min, esse público é coberto em ~' +
    Math.ceil(recipients.length / BCAST_SEND_BATCH) * 5 + ' minuto(s).');
  Logger.log('Obs: quem está em 2+ grupos conta só no grupo de maior prioridade (1ª aba onde aparece) — é o mesmo dedupe do envio real.');
}

/**
 * ENSAIO COMPLETO DO MOTOR DE BROADCASTS — 1 clique, evidência em ~1 min.
 *
 * ⚠️ Configure ENSAIO_EMAIL em Script Properties antes de rodar (use um email
 * NÃO descadastrado — o que recebeu o B1 serve; o que clicou em
 * "Descadastrar" NÃO serve, o SES vai suprimir).
 *
 * O que faz, na ordem, pelo caminho REAL de produção:
 *   1. Cria 1 lead de ensaio na aba Bolsão
 *   2. Sincroniza ele com o SES (tópico bolsao)
 *   3. Cria a linha [ENSAIO] na aba Broadcasts agendada pra AGORA
 *   4. Roda o motor de broadcasts na hora
 *   5. Loga o resultado e como limpar
 */
function ensaioBroadcastBolsao() {
  // Email de ensaio vem de Script Properties (ENSAIO_EMAIL) pra não expor
  // endereço pessoal neste repositório público. Use um email NÃO descadastrado.
  var EMAIL_ENSAIO = PropertiesService.getScriptProperties().getProperty('ENSAIO_EMAIL') || '';

  if (EMAIL_ENSAIO.indexOf('@') === -1) {
    Logger.log('❌ Configure ENSAIO_EMAIL em Script Properties antes de rodar o ensaio.');
    return;
  }
  if (PropertiesService.getScriptProperties().getProperty('MAILER_ENABLED') !== 'true') {
    Logger.log('❌ MAILER_ENABLED != true — habilite antes do ensaio.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Lead de ensaio na aba Bolsão (Seq Passo já marcado pra NÃO receber a sequência —
  //    o ensaio é do broadcast; a sequência você testa com a inscrição real na LP)
  var bolsao = ss.getSheetByName('Bolsão');
  if (!bolsao) { Logger.log('❌ Aba Bolsão não existe — rode setupAfterDeploy() primeiro.'); return; }
  var cols = headerIndexes_(bolsao);
  var linha = [];
  Object.keys(cols).forEach(function(h) { linha[cols[h] - 1] = ''; });
  linha[cols['Data'] - 1] = new Date();
  if (cols['Nome']) linha[cols['Nome'] - 1] = 'ENSAIO (apagar)';
  linha[cols['E-mail'] - 1] = EMAIL_ENSAIO.toLowerCase();
  if (cols['Origem']) linha[cols['Origem'] - 1] = 'ensaio_broadcast';
  if (cols['Seq Passo']) linha[cols['Seq Passo'] - 1] = 'pre-cutover';
  bolsao.appendRow(linha);
  Logger.log('1/4 ✅ Lead de ensaio criado na aba Bolsão');

  // 2. Sync imediato com o SES
  try {
    sesUpsertContact_(EMAIL_ENSAIO.toLowerCase(), 'bolsao', { name: 'ENSAIO', origem: 'ensaio_broadcast' });
    bolsao.getRange(bolsao.getLastRow(), cols['SES Sync']).setValue('ok');
    if (cols['SES Sync At']) bolsao.getRange(bolsao.getLastRow(), cols['SES Sync At']).setValue(new Date());
    Logger.log('2/4 ✅ Contato sincronizado no SES (tópico bolsao)');
  } catch (err) {
    Logger.log('2/4 ❌ Sync falhou: ' + err);
    return;
  }

  // 3. Linha de ensaio na aba Broadcasts, agendada pra agora
  var bc = ss.getSheetByName(MAILER_SHEETS.BROADCASTS);
  bc.appendRow(['ENSAIO', '[ENSAIO] Teste do motor de broadcasts — pode apagar',
                'bolsao/vespera.html', 'bolsao', new Date(), '', '', '', '']);
  Logger.log('3/4 ✅ Broadcast [ENSAIO] agendado pra agora');

  // 4. Roda o motor imediatamente
  processBroadcasts();

  // 5. Resultado
  var ultima = bc.getRange(bc.getLastRow(), 1, 1, 9).getValues()[0];
  Logger.log('4/4 → Status do [ENSAIO]: "' + ultima[5] + '" · Enviados: ' + ultima[6] + '/' + ultima[7]);
  Logger.log('');
  if (String(ultima[5]).indexOf('ok') === 0) {
    Logger.log('🎖️ MOTOR DE BROADCASTS PROVADO — confira o email no inbox ' + EMAIL_ENSAIO);
    Logger.log('Limpeza: apague a linha ENSAIO da aba Broadcasts e a linha "ENSAIO (apagar)" da aba Bolsão.');
  } else {
    Logger.log('⚠️ Status inesperado — me mande este log completo.');
  }
}

/** Envia o email A1 pra um endereço de teste (edite o destino antes de rodar). */
function testSendMarketingEmail() {
  var to = 'vinicius.ferraz@gruponbeducacao.com'; // ← edite se quiser testar outro inbox
  var html = renderTemplate_('sequencia-a/A1-bem-vindo.html', 'Vinícius Teste');
  var id = sesSendMarketing_(to, '[TESTE SES] Bem-vindo(a) à Fluência Contábil', html, 'newsletter');
  Logger.log('✅ Enviado. MessageId=' + id + ' → confira o inbox ' + to +
             ' (inclusive o link de descadastro no rodapé).');
}

/**
 * DIAGNÓSTICO: "o SES devolveu MessageId mas o email não chegou".
 *
 * Todo envio passa por sesSendMarketing_ COM ListManagementOptions (contact
 * list + tópico). Isso liga a supressão automática do SES: se o destinatário
 * estiver (a) na suppression list DA CONTA [bounce/complaint] ou (b) marcado
 * OPT_OUT do tópico / UnsubscribeAll na contact list, o SES ACEITA a chamada,
 * devolve MessageId, e DESCARTA o email sem entregar — sem erro nenhum.
 *
 * Esta função consulta a API do SES pra dizer QUAL das duas (ou nenhuma).
 * Não envia nada. Edite EMAIL_DIAG se quiser checar outro endereço.
 */
function diagnosticarEntrega() {
  var EMAIL_DIAG = 'vinicius.ferraz@gruponbeducacao.com'; // ← edite pra checar outro
  var email = EMAIL_DIAG.trim().toLowerCase();
  var list = PropertiesService.getScriptProperties().getProperty('SES_CONTACT_LIST') || 'fluencia';
  var achouCausa = false;

  Logger.log('🔍 Diagnóstico de entrega — ' + email);
  Logger.log('────────────────────────────────────────');

  // (a) Suppression list DA CONTA (bounce/complaint). Precisa da permissão
  // IAM ses:GetSuppressedDestination — se não tiver, cai no 403 e a gente
  // avisa pra olhar no console (SES → Suppression list).
  var sup = sesRequest_('GET', ['v2', 'email', 'suppression', 'addresses', email], null);
  if (sup.code === 200) {
    var d = (sup.body && sup.body.SuppressedDestination) || {};
    Logger.log('❌ CAUSA A — está na SUPPRESSION LIST DA CONTA. Motivo: ' + d.Reason +
               ' · desde: ' + d.LastUpdateTime);
    Logger.log('   → Todo envio pra esse endereço é descartado. Correção: rodar');
    Logger.log('     removerDaSuppressionList() (edite o email lá) OU no console');
    Logger.log('     SES → Suppression list → selecionar o endereço → Remove.');
    achouCausa = true;
  } else if (sup.code === 404) {
    Logger.log('✅ (A) Não está na suppression list da conta.');
  } else if (sup.code === 403) {
    Logger.log('⚠️ (A) Sem permissão pra checar via API (falta ses:GetSuppressedDestination');
    Logger.log('   na policy do fluencia-mailer). Cheque no console: SES → Suppression list');
    Logger.log('   → buscar ' + email + '.');
  } else {
    Logger.log('⚠️ (A) GetSuppressedDestination HTTP ' + sup.code + ': ' + String(sup.raw).substring(0, 160));
  }

  // (b) Opt-out do tópico / UnsubscribeAll na contact list. Usa ses:GetContact,
  // que o fluencia-mailer JÁ tem — este check é definitivo.
  var c = sesRequest_('GET', ['v2', 'email', 'contact-lists', list, 'contacts', email], null);
  if (c.code === 200) {
    var b = c.body || {};
    var prefs = b.TopicPreferences || [];
    Logger.log('• Contato na lista "' + list + '": UnsubscribeAll=' + (b.UnsubscribeAll === true));
    prefs.forEach(function(p) { Logger.log('    tópico ' + p.TopicName + ' → ' + p.SubscriptionStatus); });
    if (b.UnsubscribeAll === true) {
      Logger.log('❌ CAUSA B — UnsubscribeAll=true → SES suprime TODOS os envios com list management.');
      Logger.log('   (foi um clique em "Cancelar inscrição" em algum teste anterior)');
      achouCausa = true;
    }
    var news = prefs.filter(function(p) { return p.TopicName === 'newsletter'; })[0];
    if (news && news.SubscriptionStatus === 'OPT_OUT') {
      Logger.log('❌ CAUSA B — OPT_OUT do tópico "newsletter" → o teste (que usa newsletter) é suprimido.');
      achouCausa = true;
    }
  } else if (c.code === 404) {
    Logger.log('✅ (B) Não existe como contato na lista "' + list + '" — não há opt-out a suprimir.');
    Logger.log('   (tópicos são OPT_IN por padrão, então um não-contato receberia normalmente)');
  } else {
    Logger.log('⚠️ (B) GetContact HTTP ' + c.code + ': ' + String(c.raw).substring(0, 160));
  }

  Logger.log('────────────────────────────────────────');
  Logger.log(achouCausa
    ? '🎯 Causa da não-entrega IDENTIFICADA acima — não é bug no código/migração S3.'
    : 'ℹ️ Nenhuma supressão encontrada via API. Próximo passo: checar o console SES → Suppression list (caso A tenha dado 403) e/ou testar com um email limpo (nunca inscrito).');
}

/**
 * Remove um endereço da suppression list DA CONTA (rodar após confirmar a
 * Causa A no diagnosticarEntrega). NÃO mexe em opt-out de tópico — isso é
 * escolha legítima do lead. Precisa de ses:DeleteSuppressedDestination na
 * policy IAM do fluencia-mailer. Edite EMAIL antes de rodar.
 */
function removerDaSuppressionList() {
  var EMAIL = 'vinicius.ferraz@gruponbeducacao.com'; // ← edite
  var email = EMAIL.trim().toLowerCase();
  var res = sesRequest_('DELETE', ['v2', 'email', 'suppression', 'addresses', email], null);
  if (res.ok || res.code === 404) {
    Logger.log('✅ Removido da suppression list (ou já não estava): ' + email);
    Logger.log('   Rode testSendMarketingEmail() de novo pra confirmar a entrega.');
  } else if (res.code === 403) {
    Logger.log('⚠️ Sem permissão (falta ses:DeleteSuppressedDestination na policy do');
    Logger.log('   fluencia-mailer). Alternativa: remover pelo console SES → Suppression list.');
  } else {
    Logger.log('❌ HTTP ' + res.code + ': ' + String(res.raw).substring(0, 200));
  }
}

/**
 * Reinscreve um endereço que estava com UnsubscribeAll=true / tópicos OPT_OUT
 * (ex: admin que clicou "Cancelar inscrição" testando). Zera UnsubscribeAll e
 * volta TODOS os tópicos pra OPT_IN. Usa ses:UpdateContact (já na policy).
 *
 * ⚠️ Use SÓ pro seu próprio endereço de teste. Reinscrever lead real que
 * pediu descadastro é violação de opt-out (LGPD/CAN-SPAM). Edite EMAIL.
 */
function reinscreverContato() {
  var EMAIL = 'vinicius.ferraz@gruponbeducacao.com'; // ← edite
  var email = EMAIL.trim().toLowerCase();
  var list = PropertiesService.getScriptProperties().getProperty('SES_CONTACT_LIST') || 'fluencia';
  var prefs = SES_TOPICS.map(function(t) {
    return { TopicName: t.TopicName, SubscriptionStatus: 'OPT_IN' };
  });
  var res = sesRequest_('PUT', ['v2', 'email', 'contact-lists', list, 'contacts', email], {
    UnsubscribeAll: false,
    TopicPreferences: prefs
  });
  if (res.ok) {
    Logger.log('✅ Reinscrito: ' + email);
    Logger.log('   UnsubscribeAll=false · todos os ' + prefs.length + ' tópicos OPT_IN.');
    Logger.log('   Agora rode testSendMarketingEmail() — o email deve chegar no inbox.');
  } else {
    Logger.log('❌ UpdateContact HTTP ' + res.code + ': ' + String(res.raw).substring(0, 250));
  }
}

/**
 * TESTE DE MIGRAÇÃO (rodar ANTES de virar TEMPLATE_SOURCE=s3 em produção):
 * valida que o bucket S3 privado responde e que o conteúdo bate com o
 * esperado. Não envia nenhum email — só busca e loga.
 */
function testFetchTemplateFromS3() {
  var props = PropertiesService.getScriptProperties();
  var bucket = props.getProperty('TEMPLATE_S3_BUCKET');
  if (!bucket) { Logger.log('❌ TEMPLATE_S3_BUCKET não configurado em Script Properties.'); return; }
  var region = props.getProperty('TEMPLATE_S3_REGION') || props.getProperty('SES_REGION') || 'us-east-1';
  try {
    var html = s3GetObject_(bucket, region, 'sequencia-a/A1-bem-vindo.html');
    Logger.log('✅ S3 GetObject OK — bucket=' + bucket + ' region=' + region +
               ' — ' + html.length + ' bytes recebidos.');
    Logger.log('Próximo passo: setar TEMPLATE_SOURCE=s3 em Script Properties pra cutover definitivo.');
  } catch (err) {
    Logger.log('❌ Falhou: ' + err);
    Logger.log('Confira: bucket existe? IAM do fluencia-mailer tem s3:GetObject nesse bucket? Region certa?');
  }
}


// ══════════════════════ ALARME DE SAÚDE DO ENVIO ══════════════════════

/**
 * Alarme de falha de envio. Trigger horário. Verifica 3 sinais e, se achar
 * problema, manda email de alerta pra ALERT_EMAIL (Script Property; default
 * vinicius.ferraz@gruponbeducacao.com). Silêncio = tudo certo.
 *
 * Sinais:
 *   1. Novos erros na aba "_errors" desde a última checagem — cobre falha de
 *      fetch de template do S3 ("S3 GetObject HTTP..."), erro de SES send, etc.
 *   2. Broadcast com status "err:..." na aba Broadcasts.
 *   3. Broadcast VENCIDO (agendado no passado +30min) ainda "aguardando" (nunca
 *      começou) — sinal de que os triggers do motor pararam de rodar.
 *
 * IMPORTANTE: envia via MailApp (Gmail do dono da planilha), NÃO via SES — o
 * alarme não pode depender do sistema que ele monitora. Rode setupAlarmeSaude()
 * 1× pra criar o trigger.
 */
function verificarSaudeEnvioEmail() {
  var props = PropertiesService.getScriptProperties();
  var alertEmail = props.getProperty('ALERT_EMAIL') || 'vinicius.ferraz@gruponbeducacao.com';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date();
  var problemas = [];

  var lastRaw = props.getProperty('HEALTH_LAST_CHECK');
  var lastCheck = lastRaw ? new Date(lastRaw) : new Date(now.getTime() - 90 * 60000);

  // 1. Novos erros em _errors
  var errSheet = ss.getSheetByName('_errors');
  if (errSheet && errSheet.getLastRow() > 1) {
    var errData = errSheet.getRange(2, 1, errSheet.getLastRow() - 1, Math.min(3, errSheet.getLastColumn())).getValues();
    var novos = errData.filter(function(r) { return r[0] instanceof Date && r[0] > lastCheck; });
    if (novos.length) {
      problemas.push('🔴 ' + novos.length + ' novo(s) erro(s) na aba _errors desde ' +
        Utilities.formatDate(lastCheck, 'America/Sao_Paulo', 'dd/MM HH:mm') + ':');
      novos.slice(-5).forEach(function(r) {
        problemas.push('   • ' + Utilities.formatDate(r[0], 'America/Sao_Paulo', 'dd/MM HH:mm') +
          ' — ' + String(r[1] || '').substring(0, 220));
      });
    }
  }

  // 2 e 3. Broadcasts com erro / travados
  var bc = ss.getSheetByName(MAILER_SHEETS.BROADCASTS);
  if (bc && bc.getLastRow() > 1) {
    var rows = bc.getRange(2, 1, bc.getLastRow() - 1, 9).getValues();
    rows.forEach(function(r) {
      var id = String(r[0] || '');
      var agendado = r[4];
      var status = String(r[5] || '');
      if (status.indexOf('err') === 0) {
        problemas.push('🔴 Broadcast "' + id + '" com erro: ' + status);
      } else if (status === '' && agendado instanceof Date && agendado < new Date(now.getTime() - 30 * 60000)) {
        // vencido há +30min e nunca começou → triggers do motor podem estar parados
        problemas.push('🟠 Broadcast "' + id + '" venceu ' +
          Utilities.formatDate(agendado, 'America/Sao_Paulo', 'dd/MM HH:mm') +
          ' e ainda está "aguardando" — o motor (processBroadcasts) pode não estar rodando.');
      }
    });
  }

  // Avança o marcador SEMPRE (mesmo sem problema) pra não re-alertar o mesmo erro
  props.setProperty('HEALTH_LAST_CHECK', now.toISOString());

  if (!problemas.length) {
    console.log('✅ Saúde do envio OK — nenhum erro novo desde a última checagem.');
    return;
  }

  var corpo = 'ALARME DE ENVIO — Fluência Contábil (SES)\n' +
    Utilities.formatDate(now, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') + '\n\n' +
    problemas.join('\n') + '\n\n' +
    '── Onde investigar ──\n' +
    '• Apps Script → Execuções (erros dos triggers)\n' +
    '• Planilha → aba _errors (detalhe) e aba Broadcasts (coluna Status)\n' +
    '• Se aparecer "S3 GetObject HTTP..." → o template não está no bucket, ou IAM/Script\n' +
    '  Properties mudaram. Rode testFetchTemplateFromS3() pra isolar.\n' +
    '• Rollback rápido de template: TEMPLATE_SOURCE=pages (só se os arquivos ainda\n' +
    '  existirem no repo público — hoje NÃO existem mais; a fonte é o S3/repo privado).\n';
  MailApp.sendEmail(alertEmail, '🔴 [Fluência] Falha no envio de e-mail detectada', corpo);
  console.log('📧 Alerta enviado pra ' + alertEmail + ' (' + problemas.length + ' item(ns)).');
}

/**
 * 1× — cria o trigger horário do alarme de saúde do envio. Idempotente.
 * Pra mudar o destinatário do alerta, crie a Script Property ALERT_EMAIL.
 */
function setupAlarmeSaude() {
  recreateTrigger_('verificarSaudeEnvioEmail', function(b) { return b.timeBased().everyHours(1); });
  var dest = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') ||
             'vinicius.ferraz@gruponbeducacao.com (default)';
  Logger.log('✅ Alarme criado: verificarSaudeEnvioEmail roda a cada 1h.');
  Logger.log('   Alertas vão pra: ' + dest);
  Logger.log('   Teste agora rodando verificarSaudeEnvioEmail() manualmente (deve logar "Saúde OK").');
}


// ══════════════════════ DEDUPLICAÇÃO ══════════════════════

/**
 * Marca linhas DUPLICADAS (mesmo email, mesma aba) pra que os motores as
 * ignorem. A PRIMEIRA ocorrência (mais antiga) permanece ativa — é a
 * âncora da sequência. As demais recebem:
 *   SES Sync   = 'dup'        (se ainda pendente — não re-importa)
 *   Seq Passo  = 'duplicado'  (nunca recebe sequência; interrompe se já recebia)
 *   CRM Sync   = 'dup'        (se a coluna existir e estiver pendente)
 *
 * NÃO apaga linhas — preserva origem/UTM pra análise. Duplicatas ENTRE
 * abas diferentes (ex: Newsletter + Lista) são legítimas e ficam intactas.
 * Idempotente: rodar de novo só pega duplicatas novas. Rodar 1×/semana
 * ou após picos de captura.
 */
function dedupePlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var totalMarcadas = 0;

  MAILER_TABS.forEach(function(cfg) {
    var sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet || sheet.getLastRow() < 3) return;
    var cols = headerIndexes_(sheet);
    if (!cols['E-mail']) return;

    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var seen = {};
    var marcadas = 0;

    for (var r = 0; r < data.length; r++) {
      var email = String(data[r][cols['E-mail'] - 1] || '').trim().toLowerCase();
      if (!isValidEmail(email)) continue;
      if (!seen[email]) { seen[email] = true; continue; }

      var rowNum = r + 2;

      if (cols['SES Sync'] && String(data[r][cols['SES Sync'] - 1] || '') === '') {
        sheet.getRange(rowNum, cols['SES Sync']).setValue('dup');
      }
      if (cols['Seq Passo']) {
        var passo = String(data[r][cols['Seq Passo'] - 1] || '');
        if (passo !== 'duplicado' && passo !== 'concluída') {
          sheet.getRange(rowNum, cols['Seq Passo']).setValue('duplicado');
        }
      }
      if (cols['CRM Sync'] && String(data[r][cols['CRM Sync'] - 1] || '') === '') {
        sheet.getRange(rowNum, cols['CRM Sync']).setValue('dup');
      }
      marcadas++;
    }

    if (marcadas > 0) Logger.log('🧹 ' + cfg.sheet + ': ' + marcadas + ' duplicata(s) marcada(s)');
    totalMarcadas += marcadas;
  });

  Logger.log(totalMarcadas === 0
    ? '✅ Nenhuma duplicata encontrada nas 4 abas'
    : '✅ Dedupe concluído: ' + totalMarcadas + ' linha(s) marcada(s). A 1ª ocorrência de cada email segue ativa.');
}

/**
 * MOVE as linhas marcadas como duplicadas pra aba de arquivo "_duplicatas"
 * e as remove das abas principais — Dashboard volta a contar certo, sem
 * perder os dados de origem/UTM. Roda sob lock (não colide com os workers).
 */
function arquivarDuplicatas() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var arquivo = ss.getSheetByName('_duplicatas');
    if (!arquivo) {
      arquivo = ss.insertSheet('_duplicatas');
      arquivo.getRange(1, 1, 1, 3).setValues([['Aba origem', 'Arquivado em', 'Dados da linha (ordem original das colunas) →']])
        .setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
      arquivo.setFrozenRows(1);
    }

    var totalMovidas = 0;
    MAILER_TABS.forEach(function(cfg) {
      var sheet = ss.getSheetByName(cfg.sheet);
      if (!sheet || sheet.getLastRow() < 2) return;
      var cols = headerIndexes_(sheet);
      var lastRow = sheet.getLastRow();
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      // Coleta de cima pra baixo, deleta de baixo pra cima (índices não mudam)
      var paraMover = [];
      for (var r = 0; r < data.length; r++) {
        var passo = cols['Seq Passo'] ? String(data[r][cols['Seq Passo'] - 1] || '') : '';
        var sync = cols['SES Sync'] ? String(data[r][cols['SES Sync'] - 1] || '') : '';
        if (passo === 'duplicado' || sync === 'dup') paraMover.push(r);
      }
      if (!paraMover.length) return;

      paraMover.forEach(function(r) {
        arquivo.appendRow([cfg.sheet, new Date()].concat(data[r].map(String)));
      });
      for (var i = paraMover.length - 1; i >= 0; i--) {
        sheet.deleteRow(paraMover[i] + 2);
      }
      Logger.log('📦 ' + cfg.sheet + ': ' + paraMover.length + ' duplicata(s) movida(s) pra _duplicatas');
      totalMovidas += paraMover.length;
    });

    Logger.log(totalMovidas === 0
      ? '✅ Nada a arquivar'
      : '✅ ' + totalMovidas + ' linha(s) arquivada(s) — Dashboard atualizado automaticamente (fórmulas recalculam sozinhas)');
  } finally {
    lock.releaseLock();
  }
}

/** Trigger diário (madrugada): marca duplicatas novas e arquiva. */
function dedupeDiario() {
  dedupePlanilha();
  arquivarDuplicatas();
}
