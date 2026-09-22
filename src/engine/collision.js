// Collision balle <-> rectangle (mur, raquette, brique), en "swept AABB"
// (David Glenn, "Swept AABB Collision Detection and Response") : donne un
// temps d'entrée EXACT dans [0,1] à l'intérieur du pas de simulation, jamais
// une simple détection "après coup" — c'est ce qui élimine le tunneling à
// haute vitesse (une balle rapide qui traverserait une brique fine en un
// seul pas naïf) sans avoir besoin de sous-pas à pas de temps fixe minuscule.
//
// Simplification assumée et documentée (voir le rapport technique) : la
// balle est traitée comme un carré englobant (AABB) pour la collision, pas
// un vrai cercle. Elle reste DESSINÉE comme un cercle. Pour une balle petite
// par rapport aux briques/à la raquette, la différence n'est pas perceptible
// en jeu, et cette simplification donne une math parfaitement déterministe
// et facile à couvrir par des tests unitaires (jamais d'approximation de
// coin de cercle). Si la bêta réelle révèle un rebond de coin peu naturel,
// c'est le point exact à raffiner en premier.

export function aabbFromCircle(cx, cy, r) {
  return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
}

export function aabbFromRect(x, y, w, h) {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

/**
 * @param {{minX,minY,maxX,maxY}} moving boîte au DÉBUT du pas
 * @param {{x,y}} velocity déplacement total prévu sur le pas (dx, dy)
 * @param {{minX,minY,maxX,maxY}} target boîte statique testée
 * @returns {{collided:boolean, entryTime:number, normal:{x:number,y:number}}}
 *   entryTime === 1 signifie "pas de collision sur ce pas" (déplacement
 *   complet autorisé), par convention de l'algorithme source.
 */
export function sweptAABB(moving, velocity, target) {
  let xInvEntry, xInvExit;
  if (velocity.x > 0) {
    xInvEntry = target.minX - moving.maxX;
    xInvExit = target.maxX - moving.minX;
  } else {
    xInvEntry = target.maxX - moving.minX;
    xInvExit = target.minX - moving.maxX;
  }

  let yInvEntry, yInvExit;
  if (velocity.y > 0) {
    yInvEntry = target.minY - moving.maxY;
    yInvExit = target.maxY - moving.minY;
  } else {
    yInvEntry = target.maxY - moving.minY;
    yInvExit = target.minY - moving.maxY;
  }

  // Vitesse nulle sur un axe : cet axe ne peut jamais, à lui seul, ni
  // provoquer ni empêcher une collision SAUF si les boîtes ne se
  // chevauchent déjà pas du tout sur cet axe — auquel cas aucune collision
  // n'est géométriquement possible, quoi qu'il se passe sur l'autre axe
  // (sans ce garde-fou, une balle strictement horizontale passant à une
  // hauteur qui ne croise jamais une brique donnée serait quand même
  // détectée en collision si sa seule composante X l'amenait à temps —
  // un vrai bug, pas une approximation acceptable).
  let xEntry, xExit;
  if (velocity.x === 0) {
    const overlapsX = moving.maxX > target.minX && moving.minX < target.maxX;
    xEntry = overlapsX ? -Infinity : Infinity;
    xExit = overlapsX ? Infinity : -Infinity;
  } else {
    xEntry = xInvEntry / velocity.x;
    xExit = xInvExit / velocity.x;
  }

  let yEntry, yExit;
  if (velocity.y === 0) {
    const overlapsY = moving.maxY > target.minY && moving.minY < target.maxY;
    yEntry = overlapsY ? -Infinity : Infinity;
    yExit = overlapsY ? Infinity : -Infinity;
  } else {
    yEntry = yInvEntry / velocity.y;
    yExit = yInvExit / velocity.y;
  }

  const entryTime = Math.max(xEntry, yEntry);
  const exitTime = Math.min(xExit, yExit);

  // Note : entryTime peut être négatif si les boîtes se chevauchent déjà au
  // début du pas (ex. la balle touche déjà la raquette) — c'est un cas
  // valide et voulu, résolu immédiatement (entryTime réel exposé ci-dessous
  // à 0). Seul un exitTime négatif signifie que toute la fenêtre de contact
  // est déjà entièrement dans le passé : là, plus aucune collision réelle.
  const noCollision = entryTime > exitTime || entryTime > 1 || exitTime < 0;

  if (noCollision) {
    return { collided: false, entryTime: 1, normal: { x: 0, y: 0 } };
  }

  // La normale de sortie pointe toujours à l'opposé de la composante de
  // vitesse qui a provoqué le contact sur cet axe ("retour vers d'où l'on
  // vient") : c'est la seule définition qui reste correcte à la fois pour
  // la réflexion physique (reflect() est en fait indifférent au signe) ET
  // pour la correction positionnelle qui repousse la balle hors de la boîte
  // heurtée (voir simulation.js) — une déduction depuis le signe de
  // xInvEntry/yInvEntry paraissait équivalente mais donnait le sens
  // opposé pour certains cas, un bug réel trouvé par les tests.
  let normal;
  if (xEntry > yEntry) {
    normal = { x: velocity.x > 0 ? -1 : 1, y: 0 };
  } else {
    normal = { x: 0, y: velocity.y > 0 ? -1 : 1 };
  }
  return { collided: true, entryTime: Math.max(0, entryTime), normal };
}
