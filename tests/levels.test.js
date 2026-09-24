import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, validateAllLevels, validateLevel, buildBricksForLevel } from "../src/engine/levels.js";

test("V3 : exactement 50 niveaux réellement présents", () => {
  assert.equal(LEVELS.length, 50, `${LEVELS.length} niveaux (attendu 50, cahier des charges V3)`);
});

test("V3 : aucun niveau n'est un copier-coller strict d'un autre (motifs de briques tous distincts)", () => {
  const seen = new Map();
  for (const level of LEVELS) {
    const key = level.rows.join("|");
    if (seen.has(key)) {
      assert.fail(`niveau ${level.id} a exactement le même motif de briques que le niveau ${seen.get(key)}`);
    }
    seen.set(key, level.id);
  }
});

test("V3 : aucun niveau généré ne dépasse le plafond d'impacts anti-marathon", () => {
  for (const level of LEVELS.slice(10)) {
    const totalHits = buildBricksForLevel(level).reduce((s, b) => s + b.hp, 0);
    assert.ok(totalHits <= 140, `niveau ${level.id} : ${totalHits} impacts, au-delà du plafond attendu`);
  }
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
