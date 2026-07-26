require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { marked } = require('marked');
const { convertAmounts } = require('./currency');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const NEWSLETTER_FILE = path.join(DATA_DIR, 'newsletter.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CARTS_FILE = path.join(DATA_DIR, 'carts.json');
const BLOG_DIR = path.join(__dirname, 'content', 'blog');
const PRICING_FILE = path.join(__dirname, 'public', 'pricing.json');
const SITE_PRICING_FILE = path.join(__dirname, 'public', 'site-pricing.json');

app.use(express.json());
// Pas de cache navigateur sur les fichiers statiques : evite qu'un visiteur (ou vous-meme
// en test) voie une ancienne version des prix/textes apres une mise a jour du site.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));

// ---------- Helpers stockage JSON ----------

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Erreur de lecture ${filePath}:`, err.message);
    return [];
  }
}

function appendToJsonArray(filePath, entry) {
  const items = readJsonArray(filePath);
  items.push(entry);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
  return items;
}

// Met a jour un element existant (recherche par predicat) sans casser les autres
// entrees. Utilise pour marquer un panier comme "completed" une fois le paiement capture.
function updateJsonArrayItem(filePath, matchFn, updates) {
  const items = readJsonArray(filePath);
  const idx = items.findIndex(matchFn);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...updates };
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
  return items[idx];
}

// ---------- Email ----------

const emailEnabled = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = emailEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) !== 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

async function sendNotificationEmail(subject, text) {
  if (!emailEnabled) {
    console.warn('SMTP non configure : email non envoye (verifiez le fichier .env). Contenu :', subject);
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"Essoria - Site web" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('Erreur envoi email:', err.message);
    return false;
  }
}

// ---------- Validation simple ----------

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- Synchronisation Google Sheet (newsletter) ----------
// Chaque nouvel inscrit est ajoute en temps reel au Google Sheet "Inscription
// Newsletter EssorIA" via un webhook Google Apps Script. Best-effort : si la
// synchronisation echoue, l'inscription locale (fichier JSON + email) reste valide.

const sheetWebhookEnabled = !!(process.env.GOOGLE_SHEET_WEBHOOK_URL && process.env.GOOGLE_SHEET_WEBHOOK_TOKEN);

async function syncSubscriberToSheet(subscriber) {
  if (!sheetWebhookEnabled) return;
  try {
    const url = `${process.env.GOOGLE_SHEET_WEBHOOK_URL}?token=${encodeURIComponent(process.env.GOOGLE_SHEET_WEBHOOK_TOKEN)}`;
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        name: subscriber.name,
        email: subscriber.email,
        date: subscriber.subscribedAt,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('Erreur synchronisation Google Sheet (newsletter):', err.message);
  }
}

// ---------- Route : inscription newsletter (collecte d'emails professionnels) ----------

app.post('/api/newsletter', async (req, res) => {
  const { name, email } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Un email valide est requis.' });
  }

  const subscribers = readJsonArray(NEWSLETTER_FILE);
  const alreadyExists = subscribers.some((s) => s.email.toLowerCase() === String(email).toLowerCase());
  if (alreadyExists) {
    return res.status(409).json({ ok: false, error: 'Cet email est deja inscrit a la newsletter.' });
  }

  const subscriber = {
    name: name ? String(name).slice(0, 200) : '',
    email: String(email).slice(0, 200),
    subscribedAt: new Date().toISOString(),
  };

  appendToJsonArray(NEWSLETTER_FILE, subscriber);

  await sendNotificationEmail(
    `Nouvel inscrit newsletter Essoria`,
    `Nom: ${subscriber.name || 'non fourni'}\nEmail: ${subscriber.email}\nDate: ${subscriber.subscribedAt}`
  );

  // Ne bloque pas la reponse HTTP : la synchronisation Sheet se fait en arriere-plan.
  syncSubscriberToSheet(subscriber);

  res.json({ ok: true });
});

// ---------- Blog : lecture des fichiers Markdown ----------

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const [, frontmatterBlock, body] = match;
  const meta = {};
  frontmatterBlock.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  });

  return { meta, body };
}

function listBlogFiles() {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
}

// slug.lang.md -> { slug, lang }
function parseFilename(filename) {
  const parts = filename.replace(/\.md$/, '').split('.');
  const lang = parts.pop();
  const slug = parts.join('.');
  return { slug, lang };
}

app.get('/api/blog', (req, res) => {
  const lang = (req.query.lang || 'fr').toLowerCase();
  const files = listBlogFiles();

  const bySlug = {};
  files.forEach((filename) => {
    const { slug, lang: fileLang } = parseFilename(filename);
    if (!bySlug[slug]) bySlug[slug] = {};
    bySlug[slug][fileLang] = filename;
  });

  const posts = Object.keys(bySlug).map((slug) => {
    const variants = bySlug[slug];
    const chosenLang = variants[lang] ? lang : 'fr';
    const filename = variants[chosenLang] || Object.values(variants)[0];
    const raw = fs.readFileSync(path.join(BLOG_DIR, filename), 'utf-8');
    const { meta } = parseFrontmatter(raw);
    return {
      slug,
      lang: chosenLang,
      title: meta.title || slug,
      excerpt: meta.excerpt || '',
      date: meta.date || '',
    };
  });

  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ ok: true, posts });
});

app.get('/api/blog/:slug', (req, res) => {
  const lang = (req.query.lang || 'fr').toLowerCase();
  const { slug } = req.params;

  const candidates = [`${slug}.${lang}.md`, `${slug}.fr.md`];
  const filename = candidates.find((f) => fs.existsSync(path.join(BLOG_DIR, f)));

  if (!filename) {
    return res.status(404).json({ ok: false, error: 'Article introuvable.' });
  }

  const raw = fs.readFileSync(path.join(BLOG_DIR, filename), 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  const { lang: actualLang } = parseFilename(filename);

  res.json({
    ok: true,
    post: {
      slug,
      lang: actualLang,
      title: meta.title || slug,
      date: meta.date || '',
      html: marked.parse(body),
    },
  });
});

// ---------- Config publique (Calendly, SDK PayPal, identifiants de tracking) ----------
//
// Les identifiants de tracking (GTM/GA4/Meta/LinkedIn/Pinterest) sont optionnels et lus
// depuis des variables d'environnement : tant qu'ils ne sont pas definis, le frontend ne
// charge simplement aucun script de tracking correspondant (aucun code a redeployer pour
// activer un outil plus tard, il suffit d'ajouter la variable d'environnement sur Railway).

app.get('/api/config', (req, res) => {
  res.json({
    calendlyUrl: process.env.CALENDLY_URL || '',
    whatsappNumber: '212669069127',
    paypalClientId: paypalEnabled ? process.env.PAYPAL_CLIENT_ID : '',
    tracking: {
      gtmId: process.env.GTM_ID || '',
      ga4Id: process.env.GA4_ID || '',
      metaPixelId: process.env.META_PIXEL_ID || '',
      linkedinPartnerId: process.env.LINKEDIN_PARTNER_ID || '',
      pinterestTagId: process.env.PINTEREST_TAG_ID || '',
    },
  });
});

// ---------- Tarifs (affichage + conversion devise locale) ----------

function loadPricingTable(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Erreur de lecture ${path.basename(filePath)}:`, err.message);
    return {};
  }
}

// Chaque produit vendable sur le site a son propre fichier de tarifs (toujours en USD,
// source unique de verite) et ses propres identifiants de formule.
const CHECKOUT_PRODUCTS = {
  main: {
    file: PRICING_FILE,
    plans: ['starter', 'growth', 'scale'],
    billing: 'monthly',
    describe: (plan) => `Essoria - Formule ${plan} (abonnement mensuel)`,
  },
  site: {
    file: SITE_PRICING_FILE,
    // "surmesure" est une formule sur devis (pas de prix fixe) : volontairement exclue du checkout.
    plans: ['essentiel', 'pro'],
    billing: 'once',
    describe: (plan) => `Essoria - Site vitrine, formule ${plan}`,
  },
};

function extractUsdAmounts(productKey) {
  const productConfig = CHECKOUT_PRODUCTS[productKey];
  const table = loadPricingTable(productConfig.file);
  const amounts = {};
  productConfig.plans.forEach((plan) => {
    if (typeof table[plan] === 'number') amounts[plan] = table[plan];
  });
  return amounts;
}

// GET /api/pricing?product=main|site&country=FR
// Renvoie les prix (converti en devise locale si possible et accepte par PayPal, sinon
// USD) pour toutes les formules d'un produit en un seul appel.
app.get('/api/pricing', async (req, res) => {
  const productKey = CHECKOUT_PRODUCTS[req.query.product] ? req.query.product : 'main';
  const country = req.query.country || '';

  try {
    const usdAmounts = extractUsdAmounts(productKey);
    const result = await convertAmounts(usdAmounts, country);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Erreur /api/pricing:', err.message);
    const usdAmounts = extractUsdAmounts(productKey);
    res.json({ ok: true, currency: 'USD', symbol: '$', symbolPosition: 'before', converted: false, amounts: usdAmounts });
  }
});

// ---------- Panier (creation avant paiement, pour tracer les paniers abandonnes) ----------

// Un panier est cree des le clic sur "Payer maintenant" (avant meme l'ouverture du
// bouton PayPal). Il reste "pending" s'il n'est jamais suivi d'un paiement capture,
// ce qui permet de retrouver les paniers abandonnes dans data/carts.json.
app.post('/api/cart', async (req, res) => {
  const { product, plan, country } = req.body || {};
  const productConfig = CHECKOUT_PRODUCTS[product];

  if (!productConfig || !productConfig.plans.includes(plan)) {
    return res.status(400).json({ ok: false, error: 'Produit ou formule invalide.' });
  }

  try {
    const usdAmounts = extractUsdAmounts(product);
    const usdAmount = usdAmounts[plan];
    if (typeof usdAmount !== 'number') {
      return res.status(400).json({ ok: false, error: 'Tarif introuvable pour cette formule.' });
    }

    const priced = await convertAmounts({ [plan]: usdAmount }, country || '');

    const cart = {
      id: crypto.randomUUID(),
      product,
      plan,
      country: country || '',
      usdAmount,
      currency: priced.currency,
      amount: priced.amounts[plan],
      converted: priced.converted,
      status: 'pending',
      orderId: null,
      createdAt: new Date().toISOString(),
    };

    appendToJsonArray(CARTS_FILE, cart);

    res.json({
      ok: true,
      cart: {
        id: cart.id,
        currency: cart.currency,
        symbol: priced.symbol,
        symbolPosition: priced.symbolPosition,
        amount: cart.amount,
      },
    });
  } catch (err) {
    console.error('Erreur creation panier:', err.message);
    res.status(500).json({ ok: false, error: 'Impossible de creer le panier.' });
  }
});

// ---------- Paiement PayPal (cartes bancaires + compte PayPal) ----------

const paypalEnabled = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const PAYPAL_MODE = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
const PAYPAL_API_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Echec authentification PayPal (${res.status})`);
  }

  const data = await res.json();
  return data.access_token;
}

app.post('/api/paypal/create-order', async (req, res) => {
  if (!paypalEnabled) {
    return res.status(503).json({ ok: false, error: 'Paiement en ligne non configure.' });
  }

  const { cartId } = req.body || {};
  const carts = readJsonArray(CARTS_FILE);
  const cart = carts.find((c) => c.id === cartId);

  if (!cart || cart.status !== 'pending') {
    return res.status(400).json({ ok: false, error: 'Panier introuvable ou deja traite.' });
  }

  const productConfig = CHECKOUT_PRODUCTS[cart.product];
  if (!productConfig) {
    return res.status(400).json({ ok: false, error: 'Produit invalide.' });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: productConfig.describe(cart.plan),
            custom_id: cart.id,
            amount: {
              currency_code: cart.currency,
              value: Number(cart.amount).toFixed(2),
            },
          },
        ],
      }),
    });

    const order = await orderRes.json();
    if (!orderRes.ok || !order.id) {
      throw new Error(order.message || 'Creation de commande PayPal echouee');
    }

    updateJsonArrayItem(CARTS_FILE, (c) => c.id === cartId, { status: 'awaiting_payment', paypalOrderId: order.id });

    res.json({ ok: true, id: order.id });
  } catch (err) {
    console.error('Erreur create-order PayPal:', err.message);
    res.status(500).json({ ok: false, error: 'Impossible de creer la commande.' });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  if (!paypalEnabled) {
    return res.status(503).json({ ok: false, error: 'Paiement en ligne non configure.' });
  }

  const { orderId, cartId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ ok: false, error: 'Identifiant de commande manquant.' });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const capture = await captureRes.json();
    const status = capture.status;

    if (!captureRes.ok || status !== 'COMPLETED') {
      throw new Error(capture.message || `Statut de capture inattendu: ${status}`);
    }

    const purchaseUnit = capture.purchase_units && capture.purchase_units[0];
    const capturedAmount = purchaseUnit
      && purchaseUnit.payments
      && purchaseUnit.payments.captures
      && purchaseUnit.payments.captures[0]
      && purchaseUnit.payments.captures[0].amount;
    const payer = capture.payer || {};

    const carts = readJsonArray(CARTS_FILE);
    const cart = carts.find((c) => c.id === cartId) || carts.find((c) => c.paypalOrderId === orderId);

    const order = {
      orderId,
      cartId: cart ? cart.id : cartId || null,
      product: cart ? cart.product : null,
      plan: cart ? cart.plan : null,
      status,
      amount: capturedAmount ? capturedAmount.value : null,
      currency: capturedAmount ? capturedAmount.currency_code : null,
      payerEmail: payer.email_address || '',
      payerName: payer.name ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim() : '',
      capturedAt: new Date().toISOString(),
    };

    appendToJsonArray(ORDERS_FILE, order);

    if (cart) {
      updateJsonArrayItem(CARTS_FILE, (c) => c.id === cart.id, { status: 'completed', orderId });
    }

    await sendNotificationEmail(
      `Nouveau paiement Essoria - ${order.amount} ${order.currency}`,
      `Commande: ${order.orderId}\nFormule: ${order.plan || 'non identifiee'}\nMontant: ${order.amount} ${order.currency}\nClient: ${order.payerName || 'non fourni'} (${order.payerEmail || 'email non fourni'})\nDate: ${order.capturedAt}`
    );

    res.json({ ok: true, order });
  } catch (err) {
    console.error('Erreur capture-order PayPal:', err.message);
    res.status(500).json({ ok: false, error: 'Impossible de finaliser le paiement.' });
  }
});

app.listen(PORT, () => {
  console.log(`Essoria en ligne sur http://localhost:${PORT}`);
  if (!emailEnabled) {
    console.warn('Attention : SMTP_USER/SMTP_PASS absents du .env - les emails ne seront pas envoyes (les donnees seront quand meme sauvegardees).');
  }
  if (!paypalEnabled) {
    console.warn('Attention : PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET absents du .env - le paiement en ligne est desactive (message "indisponible" affiche aux visiteurs).');
  }
});
