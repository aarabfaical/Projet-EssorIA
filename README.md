# Essoria — Site vitrine

Site vitrine multilingue (FR/EN/ES/AR) pour présenter et commercialiser les services Growth Marketing, Marketing Automation, CRM et Agents IA WhatsApp d'Essoria auprès des PME.

## Fonctionnalités

- Pages Accueil / Services / Tarifs / À propos / Contact / Newsletter, en 4 langues (avec support RTL en arabe)
- Blog statique (articles en Markdown)
- Arrière-plan animé (particules connectées, réactif à la souris) sur toutes les pages
- Contact : bouton de réservation directe d'un appel visio via Calendly (pas de formulaire)
- Formulaire newsletter : collecte les emails professionnels (+ nom optionnel) pour vos campagnes emailing
- Bouton WhatsApp flottant sur toutes les pages
- Pages CGU et Politique de Confidentialité (droit marocain)

## Installation locale

```bash
npm install
cp .env.example .env
# Remplissez .env avec vos identifiants SMTP réels
npm start
```

Le site est alors accessible sur http://localhost:3000

## Configuration email (.env)

Pour Gmail : activez la validation en 2 étapes sur le compte, puis créez un "mot de passe d'application"
(myaccount.google.com/apppasswords) à utiliser comme `SMTP_PASS`.

Sans configuration SMTP, le site fonctionne quand même : les inscrits à la newsletter sont sauvegardés dans
`data/newsletter.json`, mais aucun email n'est envoyé (un avertissement s'affiche dans les logs).

## Ajouter un article de blog

Ajoutez un fichier dans `content/blog/` nommé `mon-article.fr.md` (et `.en.md`, `.es.md`, `.ar.md` pour les
traductions), avec ce format :

```markdown
---
title: Titre de l'article
excerpt: Résumé court affiché dans la liste
date: 2026-07-01
---
Contenu de l'article en Markdown...
```

Si une traduction manque pour une langue, le site affiche automatiquement la version française.

## Déploiement (GitHub + Render)

1. Créez un dépôt GitHub et poussez ce projet (le fichier `.gitignore` exclut déjà `.env` et `node_modules/`).
2. Sur [render.com](https://render.com), créez un nouveau "Web Service" connecté à ce dépôt GitHub.
3. Render détecte Node.js automatiquement. Build command : `npm install`. Start command : `npm start`.
4. Dans l'onglet "Environment" de Render, ajoutez les variables du fichier `.env` (SMTP_HOST, SMTP_USER,
   SMTP_PASS, CONTACT_EMAIL, CALENDLY_URL...).
5. Déployez : Render redéploie automatiquement à chaque push sur la branche principale.

(Railway.app fonctionne de façon très similaire si vous préférez cette alternative.)

## Limites connues de ce MVP

- Les inscrits newsletter sont stockés en JSON local : adapté à un volume faible/moyen. Si le volume
  augmente, migrer vers une vraie base de données (PostgreSQL, MongoDB...) ou un outil emailing dédié
  (Mailchimp, Brevo...).
- Les traductions EN/ES/AR sont un premier jet généré automatiquement : à faire relire par un locuteur natif
  avant mise en production, en particulier l'arabe.
- Les pages CGU et Politique de Confidentialité sont un modèle de départ rédigé pour le contexte marocain :
  faites-les valider par un professionnel du droit avant publication, et complétez les informations légales
  de votre entreprise (ICE, RC...) marquées comme "à compléter".
- Le lien Calendly est configuré en dur dans `index.html` et via `.env` (`CALENDLY_URL`) ; mettez à jour
  les deux si vous changez de lien.
