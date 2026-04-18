/* Fluência Contábil — Email Capture
   Widgets: Exit-intent modal, Sticky bar, Share buttons (blog only)
   Endpoint: Google Apps Script (mesmo da newsletter existente)
   Persistência: localStorage com TTL
*/
(function () {
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbzoQxsRFyD-6PjgBkzR8iC2jCQye6OtkdmYtOuXdrkGnlgkh4m-QaNUrAqZL64YoyM_/exec';

  var KEYS = {
    subscribed: 'fc_ec_subscribed',
    exitClosedAt: 'fc_ec_exit_closed_at',
    stickyClosedAt: 'fc_ec_sticky_closed_at'
  };

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

  function submitEmail(email, origem) {
    var data = new URLSearchParams({ email: email, origem: origem });
    return fetch(ENDPOINT, { method: 'POST', body: data, mode: 'no-cors' });
  }

  function isValidEmail(v) {
    return !!v && /\S+@\S+\.\S+/.test(v);
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

  function renderExitSuccess() {
    var body = document.querySelector('#fc-ec-exit-overlay .fc-ec-exit-body');
    if (!body) return;
    body.innerHTML = ''
      + '<div class="fc-ec-success">'
      +   '<div class="fc-ec-success-icon">&#10003;</div>'
      +   '<div class="fc-ec-success-title">Inscrição confirmada!</div>'
      +   '<div class="fc-ec-success-desc">Você receberá nossos próximos conteúdos no e-mail informado.</div>'
      + '</div>';
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

    // Desktop: mouse saiu pelo topo (direção barra de endereço / fechar aba)
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY <= 0) trigger();
    });

    // Mobile: scroll-up rápido após tempo mínimo OU inatividade longa
    var lastY = window.scrollY;
    var lastT = Date.now();
    var mobileArmed = false;
    setTimeout(function () { mobileArmed = true; }, 20000); // 20s de leitura antes

    window.addEventListener('scroll', function () {
      if (!mobileArmed || shown) return;
      var y = window.scrollY;
      var t = Date.now();
      var dy = lastY - y;         // positivo = scroll-up
      var dt = t - lastT;
      if (dy > 400 && dt < 600 && y < 500) {
        // subiu rápido >400px em menos de 600ms e está perto do topo = sinal de saída
        trigger();
      }
      lastY = y;
      lastT = t;
    }, { passive: true });

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
        renderExitSuccess();
        hideStickyIfAny();
        setTimeout(function () {
          hideExit();
        }, 2800);
      });
    });
  }

  /* ================= STICKY BAR ================= */
  function buildSticky() {
    var html = ''
      + '<div class="fc-ec-sticky" id="fc-ec-sticky" role="complementary" aria-label="Inscrição na lista">'
      +   '<div class="fc-ec-sticky-text">'
      +     '<strong>Gostou do conteúdo?</strong> Receba nossos próximos artigos e aulas gratuitas por e-mail.'
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
        var inner = el;
        inner.innerHTML = '<div class="fc-ec-sticky-success">✓ Inscrito com sucesso! Obrigado.</div>';
        setTimeout(hideStickyIfAny, 3500);
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

  /* ================= INIT ================= */
  function init() {
    try { initExitIntent(); } catch (e) { /* silencioso */ }
    try { initSticky(); } catch (e) {}
    if (isBlogPost()) {
      try { buildShare(); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
