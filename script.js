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
    const calendlySoonNote = document.getElementById('calendlySoonNote');

    if (calendlyBtn) {
      if (config.calendlyUrl) {
        calendlyBtn.href = config.calendlyUrl;
      } else {
        calendlyBtn.href = waLink;
        if (calendlySoonNote) calendlySoonNote.hidden = false;
      }
    }

    const whatsappBtn = document.getElementById('whatsappBtn');
    if (whatsappBtn) whatsappBtn.href = waLink;

    const footerWhatsapp = document.getElementById('footerWhatsapp');
    if (footerWhatsapp) footerWhatsapp.href = waLink;

    const floatingWhatsapp = document.getElementById('floatingWhatsapp');
    if (floatingWhatsapp) floatingWhatsapp.href = waLink;
  } catch (err) {
    console.error('Impossible de charger la config:', err);
  }
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

// ---------- Formulaire de contact ----------

function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const feedback = document.getElementById('contactFeedback');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    feedback.hidden = true;

    const payload = {
      name: document.getElementById('contactName').value.trim(),
      email: document.getElementById('contactEmail').value.trim(),
      phone: document.getElementById('contactPhone').value.trim(),
      message: document.getElementById('contactMessage').value.trim(),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      const dict = await loadLang(getSavedLang());
      if (data.ok) {
        feedback.textContent = getNested(dict, 'contact.success');
        feedback.className = 'form-feedback success';
        form.reset();
      } else {
        feedback.textContent = data.error || getNested(dict, 'contact.error');
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
  initContactForm();
  initNewsletterForm();
  initValuesMenu();
  setLanguage(getSavedLang());
});
