require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const NEWSLETTER_FILE = path.join(DATA_DIR, 'newsletter.json');
const BLOG_DIR = path.join(__dirname, 'content', 'blog');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ---------- Config publique (pour le bouton Calendly) ----------

app.get('/api/config', (req, res) => {
  res.json({
    calendlyUrl: process.env.CALENDLY_URL || '',
    whatsappNumber: '212669069127',
  });
});

app.listen(PORT, () => {
  console.log(`Essoria en ligne sur http://localhost:${PORT}`);
  if (!emailEnabled) {
    console.warn('Attention : SMTP_USER/SMTP_PASS absents du .env - les emails ne seront pas envoyes (les donnees seront quand meme sauvegardees).');
  }
});
