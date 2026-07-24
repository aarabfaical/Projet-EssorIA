// ===== Essoria — logique de la page blog =====

async function fetchBlogList(lang) {
  const res = await fetch(`/api/blog?lang=${lang}`);
  const data = await res.json();
  return data.ok ? data.posts : [];
}

async function fetchBlogPost(slug, lang) {
  const res = await fetch(`/api/blog/${encodeURIComponent(slug)}?lang=${lang}`);
  const data = await res.json();
  return data.ok ? data.post : null;
}

async function renderBlogList(lang, dict) {
  const listEl = document.getElementById('blogList');
  const emptyEl = document.getElementById('blogEmpty');
  if (!listEl) return;

  listEl.innerHTML = '';
  const posts = await fetchBlogList(lang);

  if (posts.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  posts.forEach((post) => {
    const card = document.createElement('div');
    card.className = 'card blog-card';
    card.innerHTML = `
      <p class="blog-date">${post.date}</p>
      <h3>${post.title}</h3>
      <p>${post.excerpt}</p>
      <a href="#" class="btn btn-ghost" data-slug="${post.slug}">${getNested(dict, 'blog.readMore') || 'Lire'}</a>
    `;
    card.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      showArticle(post.slug);
    });
    listEl.appendChild(card);
  });
}

async function showArticle(slug) {
  const lang = getSavedLang();
  const post = await fetchBlogPost(slug, lang);
  if (!post) return;

  document.getElementById('blogListView').hidden = true;
  const articleView = document.getElementById('blogArticleView');
  articleView.hidden = false;

  document.getElementById('articleDate').textContent = post.date;
  document.getElementById('articleTitle').textContent = post.title;
  document.getElementById('articleContent').innerHTML = post.html;

  window.scrollTo({ top: 0, behavior: 'smooth' });
  history.replaceState(null, '', `blog.html?post=${encodeURIComponent(slug)}`);
}

function showList() {
  document.getElementById('blogArticleView').hidden = true;
  document.getElementById('blogListView').hidden = false;
  history.replaceState(null, '', 'blog.html');
}

document.addEventListener('DOMContentLoaded', () => {
  const backLink = document.getElementById('blogBackLink');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      showList();
    });
  }

  document.addEventListener('essoria:langchange', (e) => {
    renderBlogList(e.detail.lang, e.detail.dict);
  });

  const params = new URLSearchParams(window.location.search);
  const postSlug = params.get('post');
  if (postSlug) showArticle(postSlug);
});
