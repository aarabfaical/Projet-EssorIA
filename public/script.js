// ===== Essoria — logique frontend commune (i18n, nav, formulaires) =====

const SUPPORTED_LANGS = ['fr', 'en', 'es', 'ar'];
const RTL_LANGS = ['ar'];

function getSavedLang() {
  const saved = localStorage.getItem('essoria-lang');
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const browserLang = (navigator.language || 'fr').slice(0, 2);
  return SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'fr';
}

function getNested(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

function formatTemplate(str, vars) {
  if (!str) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match));
}

async function loadLang(lang) {
  const res = await fetch(`locales/${lang}.json`);
  if (!res.ok) throw new Error(`Impossible de charger la langue ${lang}`);
  return res.json();
}

function applyTranslations(dict) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = getNested(dict, key);
    if (value) el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    const value = getNested(dict, key);
    if (value) el.setAttribute('aria-label', value);
  });
}

async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'fr';
  try {
    const dict = await loadLang(lang);
    applyTranslations(dict);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
    localStorage.setItem('essoria-lang', lang);

    const switcher = document.getElementById('langSwitcher');
    if (switcher) switcher.value = lang;

    document.dispatchEvent(new CustomEvent('essoria:langchange', { detail: { lang, dict } }));
  } catch (err) {
    console.error(err);
  }
}

function initLangSwitcher() {
  const switcher = document.getElementById('langSwitcher');
  if (!switcher) return;
  switcher.addEventListener('change', (e) => setLanguage(e.target.value));
}

function initMobileNav() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
}

function initFooterYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}

// ---------- Config (Calendly / WhatsApp) ----------

async function initConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    const waLink = config.whatsappNumber
      ? `https://wa.me/${config.whatsappNumber}`
      : '#';

    const calendlyBtn = document.getElementById('calendlyBtn');
    if (calendlyBtn && config.calendlyUrl) {
      calendlyBtn.href = config.calendlyUrl;
      calendlyBtn.addEventListener('click', () => track('generate_lead', { method: 'calendly' }));
    }

    // Le bouton "Réserver un appel" du hero ouvre directement Calendly
    // (au lieu de faire défiler jusqu'à la section Contact).
    const heroCalendlyBtn = document.getElementById('heroCalendlyBtn');
    if (heroCalendlyBtn && config.calendlyUrl) {
      heroCalendlyBtn.href = config.calendlyUrl;
      heroCalendlyBtn.addEventListener('click', () => track('generate_lead', { method: 'calendly_hero' }));
    }

    const finalCtaBtn = document.getElementById('finalCtaBtn');
    if (finalCtaBtn && config.calendlyUrl) {
      finalCtaBtn.href = config.calendlyUrl;
      finalCtaBtn.addEventListener('click', () => track('generate_lead', { method: 'calendly_final_cta' }));
    }

    const siteCtaBtn = document.getElementById('siteCtaBtn');
    if (siteCtaBtn && config.calendlyUrl) {
      siteCtaBtn.href = config.calendlyUrl;
      siteCtaBtn.addEventListener('click', () => track('generate_lead', { method: 'calendly_site' }));
    }

    // Le bouton "Demander un devis" (offre Sur-mesure) ouvre une discussion WhatsApp
    // avec un message pré-rempli, plutôt que Calendly, pour un premier contact plus direct.
    const quoteBtn = document.getElementById('surmesureQuoteBtn');
    if (quoteBtn && config.whatsappNumber) {
      const quoteMessage = encodeURIComponent('Je veux demander un devis pour mon site');
      quoteBtn.href = `https://wa.me/${config.whatsappNumber}?text=${quoteMessage}`;
      quoteBtn.target = '_blank';
      quoteBtn.rel = 'noopener';
      quoteBtn.addEventListener('click', () => track('whatsapp_click', { method: 'quote_surmesure' }));
    }

    // Le lien "Des questions avant de vous engager ?" sous la grille de tarifs
    // ouvre aussi une discussion WhatsApp avec un message pré-rempli.
    const pricingWhatsappBtn = document.getElementById('pricingWhatsappBtn');
    if (pricingWhatsappBtn && config.whatsappNumber) {
      const pricingMessage = encodeURIComponent("Bonjour, j'ai une question avant de m'engager sur une offre Essoria.");
      pricingWhatsappBtn.href = `https://wa.me/${config.whatsappNumber}?text=${pricingMessage}`;
      pricingWhatsappBtn.addEventListener('click', () => track('whatsapp_click', { method: 'pricing_question' }));
    }

    const footerWhatsapp = document.getElementById('footerWhatsapp');
    if (footerWhatsapp) {
      footerWhatsapp.href = waLink;
      footerWhatsapp.addEventListener('click', () => track('whatsapp_click', { method: 'footer' }));
    }

    const floatingWhatsapp = document.getElementById('floatingWhatsapp');
    if (floatingWhatsapp) {
      floatingWhatsapp.href = waLink;
      floatingWhatsapp.addEventListener('click', () => track('whatsapp_click', { method: 'floating_button' }));
    }
  } catch (err) {
    console.error('Impossible de charger la config:', err);
  }
}

// ---------- Tracking (GTM / GA4 / Meta / LinkedIn / Pinterest) + consentement cookies ----------
//
// Architecture : chaque outil de tracking est optionnel et pilote par variable
// d'environnement cote serveur (voir /api/config -> tracking.*). Tant qu'un identifiant
// n'est pas configure, le script correspondant n'est jamais charge. Aucun script de
// tracking n'est charge tant que le visiteur n'a pas explicitement accepte les cookies
// via le bandeau (pas de "consentement par defaut" a la Google Consent Mode : ici, rien
// ne se charge du tout avant acceptation, ce qui est plus protecteur).
//
// window.dataLayer recoit systematiquement tous les evenements (compatible GTM + GA4
// configures directement dans l'interface Google Tag Manager, sans code supplementaire
// a ecrire ici a chaque nouvel outil ajoute cote GTM).

const CONSENT_KEY = 'essoria-consent';
let trackingConfig = null;
let trackingLoaded = false;

window.dataLayer = window.dataLayer || [];

function getConsent() {
  return localStorage.getItem(CONSENT_KEY);
}

function setConsent(value) {
  localStorage.setItem(CONSENT_KEY, value);
}

// Point d'entree unique pour tout evenement de conversion/interaction. Alimente le
// dataLayer (GTM/GA4) et, si les pixels directs sont charges, les evenements standard
// correspondants (Meta / LinkedIn / Pinterest).
function track(eventName, params) {
  window.dataLayer.push({ event: eventName, ...params });

  if (window.fbq) {
    const metaEventMap = {
      purchase: 'Purchase',
      begin_checkout: 'InitiateCheckout',
      add_to_cart: 'AddToCart',
      generate_lead: 'Lead',
      whatsapp_click: 'Contact',
      newsletter_signup: 'Lead',
    };
    if (metaEventMap[eventName]) {
      window.fbq('track', metaEventMap[eventName], params);
    }
  }

  if (window.lintrk && eventName === 'purchase') {
    window.lintrk('track', { conversion_id: trackingConfig && trackingConfig.linkedinPartnerId });
  }

  if (window.pintrk) {
    const pinterestEventMap = {
      purchase: 'checkout',
      add_to_cart: 'addtocart',
      begin_checkout: 'checkout',
      generate_lead: 'lead',
    };
    if (pinterestEventMap[eventName]) {
      window.pintrk('track', pinterestEventMap[eventName], params);
    }
  }
}

function injectScript({ src, id, innerHTML, attrs }) {
  if (id && document.getElementById(id)) return;
  const script = document.createElement('script');
  if (id) script.id = id;
  if (src) script.src = src;
  if (innerHTML) script.innerHTML = innerHTML;
  if (attrs) Object.keys(attrs).forEach((key) => script.setAttribute(key, attrs[key]));
  document.head.appendChild(script);
}

function loadTrackingScripts(config) {
  if (trackingLoaded) return;
  trackingLoaded = true;
  const t = config.tracking || {};

  // Google Tag Manager (peut lui-meme piloter GA4 + d'autres pixels configures dans
  // l'interface GTM, sans code supplementaire ici).
  if (t.gtmId) {
    injectScript({
      id: 'gtmScript',
      innerHTML: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${t.gtmId}');`,
    });
    if (!document.getElementById('gtmNoscript')) {
      const noscript = document.createElement('noscript');
      noscript.id = 'gtmNoscript';
      noscript.innerHTML = `<iframe src="https://www.googletagmanager.com/ns.html?id=${t.gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;
      document.body.insertBefore(noscript, document.body.firstChild);
    }
  }

  // GA4 direct (optionnel : a laisser vide si GA4 est deja configure via GTM, pour
  // eviter un double comptage des pages vues et evenements).
  if (t.ga4Id) {
    injectScript({ id: 'ga4Lib', src: `https://www.googletagmanager.com/gtag/js?id=${t.ga4Id}` });
    injectScript({
      id: 'ga4Init',
      innerHTML: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${t.ga4Id}');`,
    });
  }

  // Meta Pixel (optionnel : a laisser vide si le pixel Meta est deja configure via GTM).
  if (t.metaPixelId) {
    injectScript({
      id: 'metaPixel',
      innerHTML: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${t.metaPixelId}');fbq('track','PageView');`,
    });
  }

  // LinkedIn Insight Tag (optionnel).
  if (t.linkedinPartnerId) {
    injectScript({
      id: 'linkedinInsight',
      innerHTML: `_linkedin_partner_id = "${t.linkedinPartnerId}";window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);`,
    });
  }

  // Pinterest Tag (optionnel).
  if (t.pinterestTagId) {
    injectScript({
      id: 'pinterestTag',
      innerHTML: `!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load', '${t.pinterestTagId}');pintrk('page');`,
    });
  }

  window.dataLayer.push({ event: 'tracking_ready' });
}

function showConsentBanner() {
  if (document.getElementById('cookieConsent')) return;
  const banner = document.createElement('div');
  banner.id = 'cookieConsent';
  banner.className = 'cookie-consent';
  banner.innerHTML = `
    <p class="cookie-consent-text" data-i18n="cookies.text">Nous utilisons des cookies pour mesurer l'audience du site et améliorer votre expérience. Vous pouvez accepter ou refuser ce suivi à tout moment.</p>
    <div class="cookie-consent-actions">
      <button type="button" class="btn btn-ghost" id="cookieDecline" data-i18n="cookies.decline">Refuser</button>
      <button type="button" class="btn btn-primary" id="cookieAccept" data-i18n="cookies.accept">Accepter</button>
    </div>
  `;
  document.body.appendChild(banner);

  loadLang(getSavedLang()).then((dict) => {
    banner.querySelectorAll('[data-i18n]').forEach((el) => {
      const value = getNested(dict, el.getAttribute('data-i18n'));
      if (value) el.textContent = value;
    });
  }).catch(() => {});

  document.getElementById('cookieAccept').addEventListener('click', async () => {
    setConsent('granted');
    banner.remove();
    if (trackingConfig) loadTrackingScripts(trackingConfig);
  });
  document.getElementById('cookieDecline').addEventListener('click', () => {
    setConsent('denied');
    banner.remove();
  });
}

async function initTracking() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    trackingConfig = config;

    const consent = getConsent();
    if (consent === 'granted') {
      loadTrackingScripts(config);
    } else if (consent !== 'denied') {
      showConsentBanner();
    }
  } catch (err) {
    console.error('Impossible de charger la config de tracking:', err);
  }
}

// ---------- Pays / devise / tarifs dynamiques ----------
//
// Le site affiche les prix en USD par defaut (devise unique et source de verite).
// La devise locale du visiteur n'est utilisee pour l'AFFICHAGE (et le paiement reel)
// que si le backend confirme (1) une correspondance pays -> devise connue et (2) que
// cette devise est acceptee par PayPal ET qu'un taux de change est disponible. Sinon
// tout reste en USD, sans aucun selecteur manuel de devise sur le site.

let detectedCountryCode = '';
const pricingResultCache = {};

async function detectCountryByIP() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) throw new Error('geo-IP indisponible');
    const data = await res.json();
    return (data.country_code || '').toUpperCase();
  } catch (err) {
    console.warn('Détection pays par IP échouée, prix en USD par défaut.', err);
    return '';
  }
}

function formatPrice(amount, priced) {
  const formatted = new Intl.NumberFormat(priced.currency === 'USD' ? 'en-US' : 'fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return priced.symbolPosition === 'before'
    ? `${priced.symbol} ${formatted}`
    : `${formatted} ${priced.symbol}`;
}

function setPriceText(id, amount, priced) {
  const el = document.getElementById(id);
  if (el) el.textContent = formatPrice(amount, priced);
}

async function fetchPricing(product, country) {
  const cacheKey = `${product}:${country}`;
  if (pricingResultCache[cacheKey]) return pricingResultCache[cacheKey];
  const res = await fetch(`/api/pricing?product=${encodeURIComponent(product)}&country=${encodeURIComponent(country || '')}`);
  if (!res.ok) throw new Error(`Impossible de charger les tarifs (${product})`);
  const data = await res.json();
  pricingResultCache[cacheKey] = data;
  return data;
}

async function renderPricing(country) {
  if (!document.getElementById('priceStarter')) return;
  try {
    const priced = await fetchPricing('main', country);
    setPriceText('priceStarter', priced.amounts.starter, priced);
    setPriceText('priceGrowth', priced.amounts.growth, priced);
    setPriceText('priceScale', priced.amounts.scale, priced);
  } catch (err) {
    console.error('Impossible d\'afficher les tarifs:', err);
  }
}

async function renderSitePricing(country) {
  if (!document.getElementById('priceSiteEssentiel')) return;
  try {
    const priced = await fetchPricing('site', country);
    setPriceText('priceSiteEssentiel', priced.amounts.essentiel, priced);
    setPriceText('priceSitePro', priced.amounts.pro, priced);
    // "surmesure" est affiché "Sur devis" (texte statique traduit), pas de montant a injecter.
  } catch (err) {
    console.error('Impossible d\'afficher les tarifs "Votre site":', err);
  }
}

async function initPricingDisplay() {
  detectedCountryCode = await detectCountryByIP();
  await Promise.all([renderPricing(detectedCountryCode), renderSitePricing(detectedCountryCode)]);
}

// ---------- Checkout PayPal (panier -> commande -> capture -> page merci) ----------

// Chaque plan est rattaché à son produit (backend) et a sa cle de traduction pour le
// libelle affiche dans la modale de paiement.
const CHECKOUT_PRODUCTS = {
  starter: { product: 'main', labelKey: 'pricing.starter.title', billing: 'monthly' },
  growth: { product: 'main', labelKey: 'pricing.growth.title', billing: 'monthly' },
  scale: { product: 'main', labelKey: 'pricing.scale.title', billing: 'monthly' },
  essentiel: { product: 'site', labelKey: 'sitePage.pricing.essentiel.title', billing: 'once' },
  pro: { product: 'site', labelKey: 'sitePage.pricing.pro.title', billing: 'once' },
  // "surmesure" n'a pas de prix fixe (sur devis) : pas de checkout, bouton "Demander un devis" -> WhatsApp.
};

let paypalSdkCurrency = null;

function loadPayPalSdk(clientId, currency) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('paypalSdk');
    if (existing && paypalSdkCurrency === currency) {
      resolve();
      return;
    }
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.id = 'paypalSdk';
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}`;
    script.onload = () => {
      paypalSdkCurrency = currency;
      resolve();
    };
    script.onerror = () => reject(new Error('Impossible de charger le SDK PayPal'));
    document.body.appendChild(script);
  });
}

async function openCheckout(planId) {
  const productConfig = CHECKOUT_PRODUCTS[planId];
  const modal = document.getElementById('checkoutModal');
  const feedback = document.getElementById('checkoutFeedback');
  const unavailable = document.getElementById('checkoutUnavailable');
  const currencyNote = document.getElementById('checkoutCurrencyNote');
  const buttonContainer = document.getElementById('paypalButtonContainer');
  if (!modal || !buttonContainer || !productConfig) return;

  const dict = await loadLang(getSavedLang());
  const perUnitKey = productConfig.billing === 'once' ? 'checkout.perOnceShort' : 'checkout.perMonthShort';

  feedback.hidden = true;
  unavailable.hidden = true;
  if (currencyNote) currencyNote.hidden = true;
  buttonContainer.innerHTML = '';
  buttonContainer.dataset.loading = 'true';
  modal.hidden = false;

  try {
    // 1) Creation du panier cote serveur (avant meme d'ouvrir le bouton PayPal) : permet
    // de tracer les paniers abandonnes et fige le prix/devise pour toute la suite du flux.
    const cartRes = await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: productConfig.product, plan: planId, country: detectedCountryCode }),
    });
    const cartData = await cartRes.json();
    if (!cartData.ok) throw new Error(cartData.error || 'Panier non créé');
    const cart = cartData.cart;

    track('add_to_cart', {
      currency: cart.currency,
      value: cart.amount,
      items: [{ item_id: planId, item_name: getNested(dict, productConfig.labelKey) || planId, price: cart.amount }],
    });

    document.getElementById('checkoutModalTitle').textContent = getNested(dict, productConfig.labelKey) || planId;
    document.getElementById('checkoutModalPrice').textContent =
      `${formatPrice(cart.amount, cart)}${getNested(dict, perUnitKey) || ''}`;

    const configRes = await fetch('/api/config');
    const config = await configRes.json();

    if (!config.paypalClientId) {
      unavailable.hidden = false;
      return;
    }

    await loadPayPalSdk(config.paypalClientId, cart.currency);

    if (!window.paypal) {
      unavailable.hidden = false;
      return;
    }

    track('begin_checkout', {
      currency: cart.currency,
      value: cart.amount,
      items: [{ item_id: planId, item_name: getNested(dict, productConfig.labelKey) || planId, price: cart.amount }],
    });

    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' },
      createOrder: async () => {
        const res = await fetch('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cartId: cart.id }),
        });
        const data = await res.json();
        if (!data.id) throw new Error('Commande PayPal non créée');
        return data.id;
      },
      onApprove: async (data) => {
        const res = await fetch('/api/paypal/capture-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderID, cartId: cart.id }),
        });
        const result = await res.json();
        if (result.ok) {
          track('purchase', {
            transaction_id: result.order.orderId,
            currency: result.order.currency,
            value: Number(result.order.amount),
            items: [{ item_id: planId, item_name: getNested(dict, productConfig.labelKey) || planId, price: Number(result.order.amount) }],
          });
          const params = new URLSearchParams({
            plan: planId,
            order: result.order.orderId,
            amount: result.order.amount || '',
            currency: result.order.currency || '',
          });
          window.location.href = `merci.html?${params.toString()}`;
        } else {
          feedback.hidden = false;
          feedback.textContent = getNested(dict, 'checkout.error');
          feedback.className = 'form-feedback error';
        }
      },
      onError: () => {
        feedback.hidden = false;
        feedback.textContent = getNested(dict, 'checkout.error');
        feedback.className = 'form-feedback error';
      },
    }).render('#paypalButtonContainer');
  } catch (err) {
    console.error('Checkout PayPal indisponible:', err);
    unavailable.hidden = false;
  } finally {
    delete buttonContainer.dataset.loading;
  }
}

function closeCheckout() {
  const modal = document.getElementById('checkoutModal');
  if (modal) modal.hidden = true;
}

function initCheckoutModal() {
  const modal = document.getElementById('checkoutModal');
  if (!modal) return;

  document.querySelectorAll('.checkout-btn').forEach((btn) => {
    btn.addEventListener('click', () => openCheckout(btn.dataset.plan));
  });

  const closeBtn = document.getElementById('checkoutModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeCheckout);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCheckout();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeCheckout();
  });
}

// ---------- Menu sophistiqué des valeurs (onglets) ----------

function initValuesMenu() {
  const tabs = document.querySelectorAll('#valuesList .value-tab');
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-value');

      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.value-panel-desc').forEach((p) => {
        p.classList.toggle('active', p.getAttribute('data-value-panel') === target);
      });
    });
  });
}

// ---------- Formulaire newsletter ----------

function initNewsletterForm() {
  const form = document.getElementById('newsletterForm');
  if (!form) return;

  const feedback = document.getElementById('newsletterFeedback');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    feedback.hidden = true;

    const dict = await loadLang(getSavedLang());

    const payload = {
      name: document.getElementById('newsletterName').value.trim(),
      email: document.getElementById('newsletterEmail').value.trim(),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        feedback.textContent = getNested(dict, 'newsletter.success');
        feedback.className = 'form-feedback success';
        track('newsletter_signup', { method: 'website_form' });
        form.reset();
      } else if (res.status === 409) {
        feedback.textContent = getNested(dict, 'newsletter.errorExists');
        feedback.className = 'form-feedback error';
      } else {
        feedback.textContent = data.error || getNested(dict, 'newsletter.errorGeneric');
        feedback.className = 'form-feedback error';
      }
    } catch (err) {
      feedback.textContent = 'Erreur réseau. Réessayez.';
      feedback.className = 'form-feedback error';
    } finally {
      feedback.hidden = false;
      submitBtn.disabled = false;
    }
  });
}

// ---------- Initialisation ----------

document.addEventListener('DOMContentLoaded', () => {
  initLangSwitcher();
  initMobileNav();
  initFooterYear();
  initConfig();
  initNewsletterForm();
  initValuesMenu();
  initCheckoutModal();
  setLanguage(getSavedLang());
  initPricingDisplay();
  initTracking();
  window.dataLayer.push({ event: 'page_view', page_path: window.location.pathname });
});
