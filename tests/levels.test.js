import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, validateAllLevels, validateLevel, buildBricksForLevel } from "../src/engine/levels.js";

test("les 5 à 10 niveaux V0 respectent le format attendu", () => {
  assert.ok(LEVELS.length >= 5 && LEVELS.length <= 10, `${LEVELS.length} niveaux (attendu 5-10)`);
});

test("aucun niveau ne déclenche d'alerte de validation", () => {
  const report = validateAllLevels();
  assert.deepEqual(report, {}, `niveaux problématiques détectés: ${JSON.stringify(report, null, 2)}`);
});

test("le niveau 1 est une démonstration simple (uniquement des briques standards)", () => {
  const level = LEVELS[0];
  const bricks = buildBricksForLevel(level);
  assert.ok(bricks.every((b) => b.hp === 1), "niveau 1 : que des briques à 1 impact, conforme au cahier des charges");
});

test("les briques renforcées/power-ups n'apparaissent qu'à partir d'un niveau ultérieur", () => {
  const hasReinforced = (level) => buildBricksForLevel(level).some((b) => b.hp > 1);
  assert.equal(hasReinforced(LEVELS[0]), false, "niveau 1 ne doit pas introduire de brique renforcée");
});

test("validateLevel détecte une rangée de longueur incohérente", () => {
  const bad = { id: 99, rows: ["111", "1111111111"], targetSeconds: [40, 100] };
  const errors = validateLevel(bad);
  assert.ok(errors.some((e) => e.includes("longueur")));
});

test("validateLevel détecte un niveau sans aucune brique", () => {
  const bad = { id: 99, rows: ["0000000000"], targetSeconds: [40, 100] };
  const errors = validateLevel(bad);
  assert.ok(errors.some((e) => e.includes("aucune brique")));
});
