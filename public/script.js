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
    }

    const finalCtaBtn = document.getElementById('finalCtaBtn');
    if (finalCtaBtn && config.calendlyUrl) {
      finalCtaBtn.href = config.calendlyUrl;
    }

    const siteCtaBtn = document.getElementById('siteCtaBtn');
    if (siteCtaBtn && config.calendlyUrl) {
      siteCtaBtn.href = config.calendlyUrl;
    }

    // Le bouton "Demander un devis" (offre Sur-mesure) ouvre une discussion WhatsApp
    // avec un message pré-rempli, plutôt que Calendly, pour un premier contact plus direct.
    const quoteBtn = document.getElementById('surmesureQuoteBtn');
    if (quoteBtn && config.whatsappNumber) {
      const quoteMessage = encodeURIComponent('Je veux demander un devis pour mon site');
      quoteBtn.href = `https://wa.me/${config.whatsappNumber}?text=${quoteMessage}`;
      quoteBtn.target = '_blank';
      quoteBtn.rel = 'noopener';
    }

    const footerWhatsapp = document.getElementById('footerWhatsapp');
    if (footerWhatsapp) footerWhatsapp.href = waLink;

    const floatingWhatsapp = document.getElementById('floatingWhatsapp');
    if (floatingWhatsapp) floatingWhatsapp.href = waLink;
  } catch (err) {
    console.error('Impossible de charger la config:', err);
  }
}

// ---------- Pays / devise / tarifs dynamiques ----------

// Le site n'affiche que 2 devises : EUR (zone euro) et USD (reste du monde,
// y compris le Maroc, + repli par défaut si l'IP n'est pas détectée).
const SUPPORTED_COUNTRIES = ['EUR', 'USD'];
const DEFAULT_COUNTRY = 'USD';
const EUROZONE_COUNTRIES = [
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  'CH', 'AD', 'MC', 'SM', 'VA', 'ME', 'XK',
];
const pricingFileCache = {};

function getSavedCountry() {
  return localStorage.getItem('essoria-country');
}

function formatPrice(amount, entry) {
  const formatted = new Intl.NumberFormat('fr-FR').format(amount);
  return entry.symbolPosition === 'before'
    ? `${entry.symbol} ${formatted}`
    : `${formatted} ${entry.symbol}`;
}

async function loadPricingFile(file) {
  if (pricingFileCache[file]) return pricingFileCache[file];
  const res = await fetch(file);
  if (!res.ok) throw new Error(`Impossible de charger ${file}`);
  pricingFileCache[file] = await res.json();
  return pricingFileCache[file];
}

function setPriceText(id, amount, entry) {
  const el = document.getElementById(id);
  if (el) el.textContent = formatPrice(amount, entry);
}

async function detectCountryByIP() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) throw new Error('geo-IP indisponible');
    const data = await res.json();
    const code = (data.country_code || '').toUpperCase();
    if (EUROZONE_COUNTRIES.includes(code)) return 'EUR';
    // Pays non reconnu comme zone euro (Maroc inclus, ou tout le reste du monde) : prix en USD.
    return 'USD';
  } catch (err) {
    // IP non détectée : prix moyen en USD par défaut.
    console.warn('Détection pays par IP échouée, repli sur', DEFAULT_COUNTRY, err);
    return DEFAULT_COUNTRY;
  }
}

async function renderPricing(country) {
  if (!document.getElementById('priceStarter')) return;
  try {
    const pricing = await loadPricingFile('pricing.json');
    const entry = pricing[country] || pricing[DEFAULT_COUNTRY];
    setPriceText('priceStarter', entry.starter, entry);
    setPriceText('priceGrowth', entry.growth, entry);
    setPriceText('priceScale', entry.scale, entry);
  } catch (err) {
    console.error('Impossible d\'afficher les tarifs localisés:', err);
  }
}

async function renderSitePricing() {
  // "Votre site" affiche un prix fixe en USD pour tout le monde (pas de zone tarifaire),
  // pour eviter d'avoir plusieurs offres differentes selon le pays sur cette rubrique.
  if (!document.getElementById('priceSiteEssentiel')) return;
  try {
    const entry = await loadPricingFile('site-pricing.json');
    setPriceText('priceSiteEssentiel', entry.essentiel, entry);
    setPriceText('priceSitePro', entry.pro, entry);
    // "surmesure" est affiché "Sur devis" (texte statique traduit), pas de montant a injecter.
  } catch (err) {
    console.error('Impossible d\'afficher les tarifs "Votre site":', err);
  }
}

async function setCountry(country) {
  if (!SUPPORTED_COUNTRIES.includes(country)) country = DEFAULT_COUNTRY;
  localStorage.setItem('essoria-country', country);

  const switcher = document.getElementById('countrySwitcher');
  if (switcher) switcher.value = country;

  await Promise.all([renderPricing(country), renderSitePricing()]);
  document.dispatchEvent(new CustomEvent('essoria:countrychange', { detail: { country } }));
}

function initCountrySwitcher() {
  const switcher = document.getElementById('countrySwitcher');
  if (!switcher) return;
  switcher.addEventListener('change', (e) => setCountry(e.target.value));
}

async function initCountryDetection() {
  const saved = getSavedCountry();
  if (saved && SUPPORTED_COUNTRIES.includes(saved)) {
    await setCountry(saved);
    return;
  }
  const detected = await detectCountryByIP();
  await setCountry(detected);
}

// ---------- Checkout PayPal ----------

// Chaque plan est rattaché à son produit (fichier de tarifs, cle de traduction,
// type de facturation) pour permettre plusieurs offres payantes sur le site.
const CHECKOUT_PRODUCTS = {
  starter: { product: 'main', file: 'pricing.json', labelKey: 'pricing.starter.title', billing: 'monthly' },
  growth: { product: 'main', file: 'pricing.json', labelKey: 'pricing.growth.title', billing: 'monthly' },
  scale: { product: 'main', file: 'pricing.json', labelKey: 'pricing.scale.title', billing: 'monthly' },
  // "flat: true" = prix unique en USD, sans variation par pays/zone.
  essentiel: { product: 'site', file: 'site-pricing.json', labelKey: 'sitePage.pricing.essentiel.title', billing: 'once', flat: true },
  pro: { product: 'site', file: 'site-pricing.json', labelKey: 'sitePage.pricing.pro.title', billing: 'once', flat: true },
  // "surmesure" n'a pas de prix fixe (sur devis) : pas de checkout, bouton "Demander un devis" -> Calendly.
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
  const country = getSavedCountry() || DEFAULT_COUNTRY;
  const pricing = await loadPricingFile(productConfig.file);
  const entry = productConfig.flat ? pricing : (pricing[country] || pricing[DEFAULT_COUNTRY]);
  const amount = entry[planId];
  const perUnitKey = productConfig.billing === 'once' ? 'checkout.perOnceShort' : 'checkout.perMonthShort';

  // PayPal ne traite pas toutes les devises locales (ex: MAD). Si un "override" existe
  // pour ce pays, la commande PayPal reelle se fait dans cette devise/montant.
  const paypalOverride = entry.paypal && typeof entry.paypal.amounts[planId] === 'number'
    ? entry.paypal
    : null;
  const sdkCurrency = paypalOverride ? paypalOverride.currency : entry.currency;

  document.getElementById('checkoutModalTitle').textContent = getNested(dict, productConfig.labelKey) || planId;
  document.getElementById('checkoutModalPrice').textContent =
    `${formatPrice(amount, entry)}${getNested(dict, perUnitKey) || ''}`;

  if (currencyNote) {
    if (paypalOverride) {
      currencyNote.textContent = formatTemplate(getNested(dict, 'checkout.currencyNote'), {
        amount: paypalOverride.amounts[planId],
        currency: paypalOverride.currency,
      });
      currencyNote.hidden = false;
    } else {
      currencyNote.hidden = true;
    }
  }

  feedback.hidden = true;
  unavailable.hidden = true;
  buttonContainer.innerHTML = '';
  modal.hidden = false;

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();

    if (!config.paypalClientId) {
      unavailable.hidden = false;
      return;
    }

    await loadPayPalSdk(config.paypalClientId, sdkCurrency);

    if (!window.paypal) {
      unavailable.hidden = false;
      return;
    }

    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' },
      createOrder: async () => {
        const res = await fetch('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: planId, country, product: productConfig.product }),
        });
        const data = await res.json();
        if (!data.id) throw new Error('Commande PayPal non créée');
        return data.id;
      },
      onApprove: async (data) => {
        const res = await fetch('/api/paypal/capture-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderID }),
        });
        const result = await res.json();
        feedback.hidden = false;
        if (result.ok) {
          feedback.textContent = getNested(dict, 'checkout.success');
          feedback.className = 'form-feedback success';
          buttonContainer.innerHTML = '';
        } else {
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
  initCountrySwitcher();
  initCheckoutModal();
  setLanguage(getSavedLang());
  initCountryDetection();
});
