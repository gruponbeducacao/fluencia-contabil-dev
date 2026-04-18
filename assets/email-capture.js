/* Fluência Contábil — Email Capture
   Widgets: Exit-intent modal, Sticky bar, Share buttons (blog only)
   Endpoint: Google Apps Script (mesmo da newsletter existente)
   Persistência: localStorage com TTL
*/
(function () {
  'use strict';

  // Endpoint unificado: 1 URL, 1 Apps Script, 1 planilha com 2 abas
  // (Newsletter + Lista de Espera). O roteamento acontece no servidor
  // baseado no campo 'origem'.
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbx8lWrX5F0IByv0JEJ0iBGPjtLto7f2VxDHIh0uT0gZtvoj8EDVx0NFiriou-Dt0cxh/exec';

  var KEYS = {
    subscribed: 'fc_ec_subscribed',
    exitClosedAt: 'fc_ec_exit_closed_at',
    stickyClosedAt: 'fc_ec_sticky_closed_at',
    refIn: 'fc_ec_ref_in',          // ref que trouxe esse visitante
    myRef: 'fc_ec_my_ref'           // ref do próprio usuário após inscrição
  };

  var REF_SALT = 'fc-ref-v1';
  var SHARE_BASE = 'https://fluenciacontabil.com.br/';
  var WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/KWIP2oAR7KgCSAPW1Lqgtm?mode=gi_t';

  // Botão "Participe do grupo" no success do CTA inline — habilitado em
  // todos os posts do blog (rollout ampliado após validação no Balanço).
  function ctaShowsWhatsAppGroup() {
    return isBlogPost();
  }

  var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
  var ARM_DELAY_MS = 15000;   // tempo mínimo na página antes de armar exit-intent (desktop)
  var STICKY_DELAY_MS = 45000; // fallback de tempo pro sticky bar
  var STICKY_SCROLL_PCT = 0.5; // 50% da página

  function safeLocalGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeLocalSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) {}
  }

  function isSubscribed() {
    return safeLocalGet(KEYS.subscribed) === '1';
  }
  function recentlyClosed(key) {
    var ts = parseInt(safeLocalGet(key) || '0', 10);
    if (!ts) return false;
    return (Date.now() - ts) < COOLDOWN_MS;
  }
  function markSubscribed() {
    safeLocalSet(KEYS.subscribed, '1');
  }
  function markClosed(key) {
    safeLocalSet(key, String(Date.now()));
  }

  // O 3º parâmetro 'list' agora só é informativo — o roteamento entre as
  // abas Newsletter e Lista de Espera é feito server-side pelo Apps Script
  // com base no campo 'origem'.
  function submitEmail(email, origem, list) {
    var data = new URLSearchParams();
    data.append('email', email);
    data.append('origem', origem);

    // Campos de contexto (CRM futuro: funil + atribuição de tráfego)
    try {
      var urlParams = new URLSearchParams(window.location.search);
      data.append('pagina', window.location.pathname + window.location.search);
      data.append('referrer', document.referrer || '');
      data.append('utm_source',   urlParams.get('utm_source')   || '');
      data.append('utm_medium',   urlParams.get('utm_medium')   || '');
      data.append('utm_campaign', urlParams.get('utm_campaign') || '');
      data.append('dispositivo',
        window.matchMedia('(max-width: 720px)').matches ? 'Mobile' : 'Desktop');
    } catch (e) {}

    // Ref de indicação (se o usuário chegou via ?ref=<hash>)
    var refIn = safeLocalGet(KEYS.refIn);
    if (refIn) data.append('ref', refIn);

    return fetch(ENDPOINT, { method: 'POST', body: data, mode: 'no-cors' });
  }

  function isValidEmail(v) {
    return !!v && /\S+@\S+\.\S+/.test(v);
  }

  /* ================= REFERRAL ================= */
  function captureRefFromURL() {
    try {
      var params = new URLSearchParams(window.location.search);
      var ref = params.get('ref');
      if (ref && /^[a-f0-9]{6,16}$/i.test(ref)) {
        safeLocalSet(KEYS.refIn, ref.toLowerCase());
      }
    } catch (e) {}
  }

  function emailToRefCode(email) {
    // SHA-256(email + salt) -> primeiros 10 chars hex (~40 bits de entropia)
    try {
      var enc = new TextEncoder().encode(String(email).toLowerCase().trim() + REF_SALT);
      return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
        var arr = new Uint8Array(buf);
        var out = '';
        for (var i = 0; i < 5; i++) out += arr[i].toString(16).padStart(2, '0');
        return out; // 10 chars hex
      });
    } catch (e) {
      // Fallback simples (pior, mas não quebra): hash djb2
      var h = 5381;
      var s = String(email).toLowerCase().trim() + REF_SALT;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
      var hex = (h >>> 0).toString(16).padStart(8, '0') + '00';
      return Promise.resolve(hex.slice(0, 10));
    }
  }

  function buildShareURL(refCode) {
    return SHARE_BASE + '?ref=' + encodeURIComponent(refCode);
  }

  var SHARE_ICONS = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.05 0C5.5 0 .2 5.3.2 11.85c0 2.09.55 4.13 1.6 5.93L0 24l6.38-1.66a11.82 11.82 0 0 0 5.66 1.44h.01c6.55 0 11.85-5.3 11.85-11.84 0-3.16-1.23-6.13-3.38-8.46zM12.05 21.8h-.01a9.91 9.91 0 0 1-5.05-1.38l-.36-.21-3.78.99 1.01-3.69-.24-.38a9.88 9.88 0 0 1-1.52-5.28c0-5.45 4.43-9.88 9.95-9.88 2.65 0 5.15 1.03 7.03 2.91a9.82 9.82 0 0 1 2.9 7 9.89 9.89 0 0 1-9.93 9.92zm5.45-7.41c-.3-.15-1.76-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.18.2-.35.22-.65.07a8.17 8.17 0 0 1-2.4-1.48 8.95 8.95 0 0 1-1.66-2.06c-.17-.3 0-.45.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.5 0 1.47 1.08 2.9 1.23 3.1.15.2 2.1 3.2 5.08 4.48.71.31 1.26.5 1.7.64.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/></svg>',
    x:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.04c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>'
  };

  function shareMessage() {
    return 'Achei o curso de contabilidade do Prof. Vinícius Ferraz — o Fluência Contábil. Vale a pena entrar na lista de espera:';
  }

  function renderReferralPanel(container, email, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var waGroupHref = opts.waGroupHref || null;
    emailToRefCode(email).then(function (code) {
      safeLocalSet(KEYS.myRef, code);
      var url = buildShareURL(code);
      var encURL = encodeURIComponent(url);
      var encMsg = encodeURIComponent(shareMessage());
      var wa = 'https://api.whatsapp.com/send?text=' + encMsg + '%20' + encURL;
      var xt = 'https://twitter.com/intent/tweet?text=' + encMsg + '&url=' + encURL;
      var ln = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encURL;

      var waGroupBlock = waGroupHref
        ? '<a class="fc-ec-wa-group" href="' + waGroupHref + '" target="_blank" rel="noopener">&#128172; Participe do grupo exclusivo de pré-lançamento</a>'
        : '';

      var html;
      if (compact) {
        // Layout horizontal pra sticky bar
        html = ''
          + '<div class="fc-ec-referral">'
          +   '<div class="fc-ec-referral-icon">&#10003;</div>'
          +   '<div class="fc-ec-referral-text">'
          +     '<div class="fc-ec-referral-title">Inscrito(a)! Compartilhe e suba na fila.</div>'
          +     '<div class="fc-ec-referral-sub">Cada amigo(a) que entrar com seu link te aproxima das primeiras vagas.</div>'
          +   '</div>'
          +   '<div class="fc-ec-referral-link">'
          +     '<input type="text" readonly value="' + url + '">'
          +     '<button type="button" class="fc-ec-referral-copy">Copiar</button>'
          +   '</div>'
          + '</div>';
      } else {
        html = ''
          + '<div class="fc-ec-referral">'
          +   '<div class="fc-ec-referral-icon">&#10003;</div>'
          +   '<div class="fc-ec-referral-title">Inscrição confirmada!</div>'
          +   (waGroupHref
              ? '<div class="fc-ec-referral-sub">Receba avisos em primeira mão e tire dúvidas direto com o Prof. Vinícius:</div>'
                + waGroupBlock
                + '<div class="fc-ec-referral-divider"></div>'
                + '<div class="fc-ec-referral-sub">Quer subir na fila? Compartilhe o link com um(a) amigo(a) concurseiro(a) — cada inscrição pelo seu link te aproxima das primeiras vagas quando o curso abrir.</div>'
              : '<div class="fc-ec-referral-sub">Compartilhe o link abaixo com um(a) amigo(a) concurseiro(a). Cada inscrição pelo seu link te aproxima das primeiras vagas quando o curso abrir.</div>'
            )
          +   '<div class="fc-ec-referral-link">'
          +     '<input type="text" readonly value="' + url + '">'
          +     '<button type="button" class="fc-ec-referral-copy">Copiar</button>'
          +   '</div>'
          +   '<div class="fc-ec-referral-share">'
          +     '<a class="fc-ec-share-btn fc-ec-wa" href="' + wa + '" target="_blank" rel="noopener">' + SHARE_ICONS.wa + '<span>WhatsApp</span></a>'
          +     '<a class="fc-ec-share-btn fc-ec-x" href="' + xt + '" target="_blank" rel="noopener">' + SHARE_ICONS.x + '<span>X</span></a>'
          +     '<a class="fc-ec-share-btn fc-ec-in" href="' + ln + '" target="_blank" rel="noopener">' + SHARE_ICONS.in + '<span>LinkedIn</span></a>'
          +   '</div>'
          + '</div>';
      }
      container.innerHTML = html;

      // Copy button
      var copyBtn = container.querySelector('.fc-ec-referral-copy');
      var input = container.querySelector('.fc-ec-referral-link input');
      if (copyBtn && input) {
        copyBtn.addEventListener('click', function () {
          var done = function () {
            copyBtn.classList.add('fc-ec-copied');
            copyBtn.textContent = 'Copiado!';
            setTimeout(function () {
              copyBtn.classList.remove('fc-ec-copied');
              copyBtn.textContent = 'Copiar';
            }, 2000);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, fallback);
          } else {
            fallback();
          }
          function fallback() {
            try {
              input.select();
              var ok = document.execCommand('copy');
              if (ok) done();
            } catch (e) {}
          }
        });
      }
    });
  }

  /* ================= EXIT-INTENT MODAL ================= */
  function buildExitModal() {
    var html = ''
      + '<div class="fc-ec-overlay" id="fc-ec-exit-overlay" role="dialog" aria-modal="true" aria-labelledby="fc-ec-exit-title">'
      +   '<div class="fc-ec-modal">'
      +     '<button type="button" class="fc-ec-close" aria-label="Fechar">&times;</button>'
      +     '<div class="fc-ec-exit-body">'
      +       '<span class="fc-ec-eyebrow">Antes de ir</span>'
      +       '<div class="fc-ec-bar"></div>'
      +       '<h2 class="fc-ec-title" id="fc-ec-exit-title">Receba conteúdos gratuitos de contabilidade direto no seu e-mail</h2>'
      +       '<p class="fc-ec-desc">Artigos, dicas de estudo e resoluções de questões para concursos fiscais e de controle. Sem spam — só conteúdo útil.</p>'
      +       '<form class="fc-ec-form" novalidate>'
      +         '<input type="email" placeholder="Seu melhor e-mail" required autocomplete="email">'
      +         '<button type="submit">Quero receber</button>'
      +       '</form>'
      +       '<p class="fc-ec-fineprint">Você pode cancelar quando quiser.</p>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
  }

  function showExit() {
    var overlay = document.getElementById('fc-ec-exit-overlay');
    if (!overlay) return;
    overlay.classList.add('fc-ec-show');
    document.documentElement.style.overflow = 'hidden';
  }
  function hideExit() {
    var overlay = document.getElementById('fc-ec-exit-overlay');
    if (!overlay) return;
    overlay.classList.remove('fc-ec-show');
    document.documentElement.style.overflow = '';
  }

  function renderExitSuccess(email) {
    var body = document.querySelector('#fc-ec-exit-overlay .fc-ec-exit-body');
    if (!body) return;
    renderReferralPanel(body, email);
  }

  function initExitIntent() {
    if (isSubscribed()) return;
    if (recentlyClosed(KEYS.exitClosedAt)) return;

    buildExitModal();

    var overlay = document.getElementById('fc-ec-exit-overlay');
    var closeBtn = overlay.querySelector('.fc-ec-close');
    var form = overlay.querySelector('.fc-ec-form');

    var armed = false;
    setTimeout(function () { armed = true; }, ARM_DELAY_MS);

    var shown = false;
    function trigger() {
      if (shown || !armed) return;
      if (isSubscribed() || recentlyClosed(KEYS.exitClosedAt)) return;
      shown = true;
      showExit();
    }

    var isMobile = window.matchMedia('(max-width: 720px)').matches;

    if (!isMobile) {
      // Desktop: mouse saiu pelo topo (direção barra de endereço / fechar aba)
      document.addEventListener('mouseleave', function (e) {
        if (e.clientY <= 0) trigger();
      });
    } else {
      // Mobile: "engagement peak" — user rolou >70% do conteúdo e parou de
      // rolar por 4s (terminou de ler, provável saída em seguida).
      // Evita falso positivo do scroll-up rápido (usuário só voltando ao topo).
      var reachedDepth = false;
      var idleTimer = null;
      var READ_MIN_MS = 12000; // mínimo de permanência antes de armar
      var armedMobile = false;
      setTimeout(function () { armedMobile = true; }, READ_MIN_MS);

      window.addEventListener('scroll', function () {
        if (!armedMobile || shown) return;
        var scrollable = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable > 0 && (window.scrollY / scrollable) >= 0.7) {
          reachedDepth = true;
        }
        if (idleTimer) clearTimeout(idleTimer);
        if (reachedDepth) {
          idleTimer = setTimeout(function () {
            if (!shown) trigger();
          }, 4000);
        }
      }, { passive: true });
    }

    closeBtn.addEventListener('click', function () {
      hideExit();
      markClosed(KEYS.exitClosedAt);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        hideExit();
        markClosed(KEYS.exitClosedAt);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('fc-ec-show')) {
        hideExit();
        markClosed(KEYS.exitClosedAt);
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var btn = form.querySelector('button');
      var email = (input.value || '').trim();
      if (!isValidEmail(email)) {
        input.focus();
        input.style.borderColor = '#C0392B';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      submitEmail(email, 'exit_intent').finally(function () {
        markSubscribed();
        renderExitSuccess(email);
        hideStickyIfAny();
      });
    });
  }

  /* ================= STICKY BAR ================= */
  function buildSticky() {
    var html = ''
      + '<div class="fc-ec-sticky" id="fc-ec-sticky" role="complementary" aria-label="Inscrição na lista">'
      +   '<div class="fc-ec-sticky-text">'
      +     '<strong>Gostou do conteúdo?</strong> Receba nossos próximos artigos gratuitos por e-mail.'
      +   '</div>'
      +   '<form class="fc-ec-sticky-form" novalidate>'
      +     '<input type="email" placeholder="Seu melhor e-mail" required autocomplete="email">'
      +     '<button type="submit">Inscrever</button>'
      +   '</form>'
      +   '<button type="button" class="fc-ec-sticky-close" aria-label="Fechar barra">&times;</button>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
  }

  function showSticky() {
    var el = document.getElementById('fc-ec-sticky');
    if (!el) return;
    el.classList.add('fc-ec-show');
  }
  function hideStickyIfAny() {
    var el = document.getElementById('fc-ec-sticky');
    if (el) el.classList.remove('fc-ec-show');
  }

  function initSticky() {
    if (isSubscribed()) return;
    if (recentlyClosed(KEYS.stickyClosedAt)) return;

    buildSticky();

    var el = document.getElementById('fc-ec-sticky');
    var form = el.querySelector('.fc-ec-sticky-form');
    var closeBtn = el.querySelector('.fc-ec-sticky-close');

    var shown = false;
    function trigger() {
      if (shown) return;
      if (isSubscribed() || recentlyClosed(KEYS.stickyClosedAt)) return;
      shown = true;
      showSticky();
    }

    // 1) Scroll >= 50%
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h <= 0) return;
      if ((window.scrollY / h) >= STICKY_SCROLL_PCT) trigger();
    }, { passive: true });

    // 2) Tempo na página
    setTimeout(trigger, STICKY_DELAY_MS);

    closeBtn.addEventListener('click', function () {
      hideStickyIfAny();
      markClosed(KEYS.stickyClosedAt);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var btn = form.querySelector('button');
      var email = (input.value || '').trim();
      if (!isValidEmail(email)) {
        input.focus();
        input.style.borderColor = '#C0392B';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      submitEmail(email, 'sticky_bar').finally(function () {
        markSubscribed();
        // Preserva close button reinjetando-o junto do referral compact
        el.innerHTML = '<button type="button" class="fc-ec-sticky-close" aria-label="Fechar">&times;</button>';
        var panelWrap = document.createElement('div');
        panelWrap.style.flex = '1 1 auto';
        panelWrap.style.display = 'flex';
        panelWrap.style.alignItems = 'center';
        el.appendChild(panelWrap);
        renderReferralPanel(panelWrap, email, { compact: true });
        el.querySelector('.fc-ec-sticky-close').addEventListener('click', function () {
          hideStickyIfAny();
          markClosed(KEYS.stickyClosedAt);
        });
      });
    });
  }

  /* ================= SHARE BUTTONS (blog posts) ================= */
  function isBlogPost() {
    // Aceita /blog/slug, /blog/slug.html e /blog/slug/
    return /\/blog\/[^/]+(\.html?)?\/?$/i.test(window.location.pathname);
  }

  function buildShare() {
    // Inserir antes do <section class="newsletter-section"> se existir,
    // senão antes do <footer>
    var anchor = document.querySelector('section.newsletter-section')
              || document.querySelector('footer');
    if (!anchor) return;

    var url = window.location.href.split('#')[0];
    var title = document.title || 'Fluência Contábil';
    var encURL = encodeURIComponent(url);
    var encTitle = encodeURIComponent(title);

    var wa = 'https://api.whatsapp.com/send?text=' + encTitle + '%20' + encURL;
    var xt = 'https://twitter.com/intent/tweet?text=' + encTitle + '&url=' + encURL;
    var ln = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encURL;

    var icons = {
      wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.05 0C5.5 0 .2 5.3.2 11.85c0 2.09.55 4.13 1.6 5.93L0 24l6.38-1.66a11.82 11.82 0 0 0 5.66 1.44h.01c6.55 0 11.85-5.3 11.85-11.84 0-3.16-1.23-6.13-3.38-8.46zM12.05 21.8h-.01a9.91 9.91 0 0 1-5.05-1.38l-.36-.21-3.78.99 1.01-3.69-.24-.38a9.88 9.88 0 0 1-1.52-5.28c0-5.45 4.43-9.88 9.95-9.88 2.65 0 5.15 1.03 7.03 2.91a9.82 9.82 0 0 1 2.9 7 9.89 9.89 0 0 1-9.93 9.92zm5.45-7.41c-.3-.15-1.76-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.18.2-.35.22-.65.07a8.17 8.17 0 0 1-2.4-1.48 8.95 8.95 0 0 1-1.66-2.06c-.17-.3 0-.45.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.5 0 1.47 1.08 2.9 1.23 3.1.15.2 2.1 3.2 5.08 4.48.71.31 1.26.5 1.7.64.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
      in: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.04c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
    };

    var html = ''
      + '<aside class="fc-ec-share" aria-label="Compartilhar este artigo">'
      +   '<span class="fc-ec-share-label">Compartilhe</span>'
      +   '<h3 class="fc-ec-share-title">Achou útil? Ajude outro concurseiro a encontrar esse conteúdo.</h3>'
      +   '<div class="fc-ec-share-btns">'
      +     '<a class="fc-ec-share-btn fc-ec-wa" href="' + wa + '" target="_blank" rel="noopener">' + icons.wa + '<span>WhatsApp</span></a>'
      +     '<a class="fc-ec-share-btn fc-ec-x" href="' + xt + '" target="_blank" rel="noopener">' + icons.x + '<span>X</span></a>'
      +     '<a class="fc-ec-share-btn fc-ec-in" href="' + ln + '" target="_blank" rel="noopener">' + icons.in + '<span>LinkedIn</span></a>'
      +     '<button type="button" class="fc-ec-share-btn fc-ec-copy" data-url="' + url + '">' + icons.copy + '<span class="fc-ec-copy-feedback">Copiar link</span></button>'
      +   '</div>'
      + '</aside>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var el = wrap.firstChild;
    anchor.parentNode.insertBefore(el, anchor);

    var copyBtn = el.querySelector('.fc-ec-copy');
    var feedback = copyBtn.querySelector('.fc-ec-copy-feedback');
    copyBtn.addEventListener('click', function () {
      var u = copyBtn.getAttribute('data-url');
      var done = function () {
        copyBtn.classList.add('fc-ec-copied');
        feedback.textContent = 'Copiado!';
        setTimeout(function () {
          copyBtn.classList.remove('fc-ec-copied');
          feedback.textContent = 'Copiar link';
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(u).then(done, fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = u;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          if (ok) done();
        } catch (e) {}
      }
    });
  }

  /* ================= INLINE CTA (blog posts) ================= */
  function findArticleRoot() {
    // Cobre as 3 variações encontradas: <article>, .article-body, .article-content
    return document.querySelector('article, .article-body, .article-content');
  }

  function initInlineCTA() {
    if (!isBlogPost()) return;
    if (isSubscribed()) return;

    var root = findArticleRoot();
    if (!root) return;

    // Seleciona apenas blocos diretos (evita contar <p> dentro de outras caixas)
    var blocks = [];
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      var t = kids[i].tagName;
      if (t === 'P' || t === 'H2' || t === 'H3' || t === 'UL' || t === 'OL') {
        blocks.push(kids[i]);
      }
    }
    if (blocks.length < 6) return; // texto muito curto — não faz sentido interromper

    // Escolhe o bloco ~50% e procura um H2 próximo (ponto natural de pausa)
    var midIndex = Math.floor(blocks.length / 2);
    var anchor = blocks[midIndex];
    // Se o bloco do meio é H2, inserir antes; senão, procura H2 posterior em até 3 passos
    for (var j = 0; j < 3; j++) {
      var probe = blocks[midIndex + j];
      if (probe && probe.tagName === 'H2') { anchor = probe; break; }
    }

    var html = ''
      + '<aside class="fc-ec-inline-cta" aria-label="Lista de espera do curso">'
      +   '<div class="fc-ec-inline-body">'
      +     '<span class="fc-ec-eyebrow">Lista de espera</span>'
      +     '<div class="fc-ec-bar"></div>'
      +     '<h3 class="fc-ec-title">Enquanto você lê, o curso está sendo finalizado.</h3>'
      +     '<p class="fc-ec-desc">O <strong>Fluência Contábil</strong> — curso completo de contabilidade para concursos — abre vagas em junho de 2026. Entre na lista de espera e seja avisado antes de todo mundo.</p>'
      +     '<form class="fc-ec-form" novalidate>'
      +       '<input type="email" placeholder="Seu melhor e-mail" required autocomplete="email">'
      +       '<button type="submit">Quero a vaga garantida</button>'
      +     '</form>'
      +     '<p class="fc-ec-fineprint">Sem compromisso. Você pode cancelar quando quiser.</p>'
      +   '</div>'
      + '</aside>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var el = wrap.firstChild;

    // Insere antes do anchor (se for H2 = antes do próximo capítulo; se p = antes do parágrafo)
    anchor.parentNode.insertBefore(el, anchor);

    var form = el.querySelector('.fc-ec-form');
    var body = el.querySelector('.fc-ec-inline-body');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      var btn = form.querySelector('button');
      var email = (input.value || '').trim();
      if (!isValidEmail(email)) {
        input.focus();
        input.style.borderColor = '#C0392B';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      submitEmail(email, 'blog_inline_cta', 'lista_espera').finally(function () {
        markSubscribed();
        var opts = ctaShowsWhatsAppGroup() ? { waGroupHref: WHATSAPP_GROUP_URL } : {};
        renderReferralPanel(body, email, opts);
        hideStickyIfAny();
      });
    });
  }

  /* ================= INTERCEPTAÇÕES DE FORMS EXISTENTES ================= */

  // Lista de espera (cursos.html):
  // Fluxo atual: submitLista() → esconde #formEspera, mostra #formSuccess
  // que JÁ TEM o botão do grupo WhatsApp (crítico, não pode perder).
  // Estratégia: observer que, quando #formSuccess fica visible, ANEXA o
  // painel de referral ao final, sem tocar no conteúdo existente.
  function initListaEsperaEnhancement() {
    var success = document.getElementById('formSuccess');
    var emailInput = document.getElementById('fcEmail');
    if (!success || !emailInput) return;

    function maybeAppendReferral() {
      if (success.dataset.fcEcReferralAdded) return;
      // Visible se o inline style mudou pra block OU se getComputedStyle diz display != none
      var displayed = success.style.display === 'block'
                   || getComputedStyle(success).display !== 'none';
      if (!displayed) return;
      var email = (emailInput.value || '').trim();
      if (!isValidEmail(email)) return;
      success.dataset.fcEcReferralAdded = '1';
      markSubscribed();
      var footer = document.createElement('div');
      footer.className = 'fc-ec-referral-footer';
      success.appendChild(footer);
      renderReferralPanel(footer, email);
    }

    // Observador: dispara quando o atributo style do success muda
    try {
      var mo = new MutationObserver(maybeAppendReferral);
      mo.observe(success, { attributes: true, attributeFilter: ['style'] });
    } catch (e) {}

    // Também tenta após click no botão (fallback caso o MutationObserver falhe)
    var btn = document.getElementById('fcBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        setTimeout(maybeAppendReferral, 400);
        setTimeout(maybeAppendReferral, 1200);
      });
    }
  }

  // Newsletter forms (class="newsletter-form", usado no rodapé dos posts).
  // Fluxo atual: onsubmit inline chama subscribeNewsletter() que POST pro
  // mesmo endpoint e substitui innerHTML por "✅ Inscrito com sucesso".
  // Interceptamos antes (capture phase) pra trocar pelo painel de referral.
  function initNewsletterHijack() {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.classList || !form.classList.contains('newsletter-form')) return;
      if (form.dataset.fcEcHijacked === '1') return;
      form.dataset.fcEcHijacked = '1';

      e.preventDefault();
      e.stopImmediatePropagation();

      var input = form.querySelector('input[type="email"]');
      var btn = form.querySelector('button');
      var email = input ? (input.value || '').trim() : '';
      if (!isValidEmail(email)) {
        alert('Por favor, insira um e-mail válido.');
        form.dataset.fcEcHijacked = '';
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

      submitEmail(email, 'blog_newsletter').finally(function () {
        markSubscribed();
        // Troca o form inteiro pelo painel de referral (mantém o mesmo
        // visual que a newsletter-section do blog já tem)
        var panel = document.createElement('div');
        form.parentNode.replaceChild(panel, form);
        renderReferralPanel(panel, email);
      });
    }, true); // capture phase para rodar ANTES do onsubmit inline
  }

  /* ================= INIT ================= */
  function init() {
    captureRefFromURL();
    try { initExitIntent(); } catch (e) { /* silencioso */ }
    try { initSticky(); } catch (e) {}
    try { initListaEsperaEnhancement(); } catch (e) {}
    try { initNewsletterHijack(); } catch (e) {}
    if (isBlogPost()) {
      try { buildShare(); } catch (e) {}
      try { initInlineCTA(); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
