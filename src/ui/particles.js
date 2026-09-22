// Particules purement décoratives (jamais lues par le moteur ni par les
// tests de collision) : petites, brèves, jamais assez nombreuses ou larges
// pour masquer la balle/la raquette/la trajectoire utile (cahier des
// charges, section 8). Un simple tableau, pas de dépendance externe.
export function createParticleSystem() {
  let particles = [];

  function burst(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 60 + Math.random() * 90;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.15,
        age: 0,
        color,
      });
    }
  }

  function update(dt) {
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt; // légère gravité pour un mouvement plus naturel
    }
    particles = particles.filter((p) => p.age < p.life);
  }

  function draw(ctx) {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      const size = 2.5 * t + 0.5;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  return { burst, update, draw, get count() { return particles.length; } };
}
