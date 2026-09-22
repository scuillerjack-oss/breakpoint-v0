import { test } from "node:test";
import assert from "node:assert/strict";
import { sweptAABB, aabbFromCircle, aabbFromRect } from "../src/engine/collision.js";

test("aucune collision : trajectoire qui ne croise jamais la cible", () => {
  const moving = aabbFromCircle(0, 0, 5);
  const target = aabbFromRect(100, 100, 20, 20);
  const result = sweptAABB(moving, { x: 1, y: 0 }, target);
  assert.equal(result.collided, false);
  assert.equal(result.entryTime, 1);
});

test("collision horizontale directe : normale verticale... non, normale horizontale", () => {
  // Balle allant vers la droite, cible juste à droite.
  const moving = aabbFromCircle(0, 50, 5);
  const target = aabbFromRect(20, 40, 20, 20); // x:20-40, y:40-60
  const result = sweptAABB(moving, { x: 40, y: 0 }, target);
  assert.equal(result.collided, true);
  assert.equal(result.normal.x, -1);
  assert.equal(result.normal.y, 0);
  assert.ok(result.entryTime > 0 && result.entryTime < 1);
});

test("collision verticale directe (mur du haut) : normale vers le bas", () => {
  const moving = aabbFromCircle(50, 20, 5);
  const target = aabbFromRect(0, -1000, 400, 1000); // mur au-dessus de y=0
  const result = sweptAABB(moving, { x: 0, y: -40 }, target);
  assert.equal(result.collided, true);
  assert.equal(result.normal.x, 0);
  assert.equal(result.normal.y, 1);
});

test("pas de tunneling : trajectoire très rapide traversant une cible fine", () => {
  // Une brique fine de 4 unités de large ; la balle se déplace de 500
  // unités en un seul pas (grande vitesse) — un test naïf "position finale
  // hors de la brique" laisserait passer un vrai bug de tunneling, alors
  // que sweptAABB doit détecter la traversée.
  const moving = aabbFromCircle(-100, 50, 5);
  const target = aabbFromRect(0, 40, 4, 20);
  const result = sweptAABB(moving, { x: 500, y: 0 }, target);
  assert.equal(result.collided, true, "la traversée rapide d'une cible fine doit être détectée");
  assert.ok(result.entryTime >= 0 && result.entryTime <= 1);
});

test("entrée exacte au bord (tangente) ne doit pas planter", () => {
  const moving = aabbFromCircle(0, 0, 5);
  const target = aabbFromRect(5, -5, 10, 10);
  const result = sweptAABB(moving, { x: 10, y: 0 }, target);
  assert.equal(typeof result.collided, "boolean");
});

test("vitesse nulle sur un axe ne casse pas le calcul", () => {
  const moving = aabbFromCircle(50, 0, 5);
  const target = aabbFromRect(40, 40, 20, 20);
  const result = sweptAABB(moving, { x: 0, y: 40 }, target);
  assert.equal(result.collided, true);
  assert.equal(result.normal.y, -1);
});
