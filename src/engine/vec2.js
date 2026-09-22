// Petit vecteur 2D en objets plats { x, y } — jamais de classe, pour rester
// trivialement sérialisable (sauvegarde) et testable sans dépendance.

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

export function length(a) {
  return Math.hypot(a.x, a.y);
}

export function normalize(a) {
  const len = length(a);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

// Réflexion d'un vecteur v autour d'une normale n (normalisée) : v' = v - 2(v·n)n.
export function reflect(v, n) {
  const d = v.x * n.x + v.y * n.y;
  return { x: v.x - 2 * d * n.x, y: v.y - 2 * d * n.y };
}
