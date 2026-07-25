// ===== Essoria — arrière-plan interactif "IA" (particules connectées) =====
// Canvas fixe en fond de page : reseau de points relies par des lignes,
// qui reagit a la position de la souris. Purement decoratif (pointer-events: none).

(function () {
  const canvas = document.getElementById('aiBackground');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLORS = ['#3E7BFA', '#F5B93E'];
  const LINK_DISTANCE = 130;
  const MOUSE_RADIUS = 160;

  let particles = [];
  let width, height;
  let mouse = { x: -9999, y: -9999 };
  let animationId = null;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function particleCount() {
    const area = window.innerWidth * window.innerHeight;
    return Math.max(30, Math.min(90, Math.round(area / 16000)));
  }

  function createParticles() {
    const count = particleCount();
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      radius: Math.random() * 1.6 + 0.8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    // Deplacement + rebond sur les bords
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      // Legere repulsion autour du curseur
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS) {
        const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
        p.x += (dx / (dist || 1)) * force * 1.2;
        p.y += (dy / (dist || 1)) * force * 1.2;
      }
    });

    // Lignes entre particules proches
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DISTANCE) {
          ctx.strokeStyle = `rgba(62, 123, 250, ${0.12 * (1 - dist / LINK_DISTANCE)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Ligne vers le curseur si proche
      const dxm = particles[i].x - mouse.x;
      const dym = particles[i].y - mouse.y;
      const distm = Math.sqrt(dxm * dxm + dym * dym);
      if (distm < MOUSE_RADIUS) {
        ctx.strokeStyle = `rgba(245, 185, 62, ${0.25 * (1 - distm / MOUSE_RADIUS)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    // Points
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    animationId = requestAnimationFrame(step);
  }

  function drawStaticFrame() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function init() {
    resize();
    createParticles();
    if (prefersReducedMotion) {
      drawStaticFrame();
    } else {
      if (animationId) cancelAnimationFrame(animationId);
      step();
    }
  }

  window.addEventListener('resize', () => {
    resize();
    createParticles();
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  document.addEventListener('DOMContentLoaded', init);
})();
