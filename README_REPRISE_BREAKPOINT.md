# BREAKPOINT — Document de reprise (Projet 7, V0)

Ce document permet de reprendre le projet depuis zéro, sur n'importe quelle
machine, sans dépendre de cette session ni de cet environnement. Il ne
présuppose pas que le lecteur a suivi le développement.

## 1. État actuel

- **Version : V0** (Phase 2 — condition éliminatoire — validée par les tests
  automatisés ; Phase 3 — boucle de jeu complète — construite par-dessus).
- Dépôt : `https://github.com/scuillerjack-oss/breakpoint-v0`
- Branche de référence : **`main`**
- Commit de référence (HEAD de `main`, local = `origin/main`) :
  **`d9f1a48e4c34b24cf8f40be8757a4b6d48e2fd05`**
- `git status` sur `main` : propre.
- Suite de tests (`npm test`) : **27/27 verts** sur ce commit
  (collision/swept-AABB, angles de renvoi raquette, multiball, perforation,
  laser, briques renforcées, niveaux, scénario de stress).
- `npm run build` réussit.

## 2. Récupérer le projet sur une nouvelle machine

```bash
git clone https://github.com/scuillerjack-oss/breakpoint-v0.git
cd breakpoint-v0
npm install
```

Aucun compte, secret ou service externe n'est nécessaire pour le jeu
lui-même : tout l'état (progression, tutoriels vus, réglages) vit en
`localStorage` côté joueur (clé `breakpoint-v0-save`), il n'y a pas de
backend. Aucune monétisation n'est implémentée (voir section 8).

## 3. Lancer et vérifier le projet

```bash
npm run dev          # serveur de dev (Vite)
npm run dev:lan       # idem, accessible depuis un téléphone sur le même réseau
npm test              # suite unitaire (node:test) — doit rester 27/27
npm run build         # build de production -> dist/
npm run preview       # sert dist/ localement
npm run test:mobile   # Playwright : tactile réel, focus->pause, resize/rotation, sauvegarde après reload
npm run test:perf     # Playwright : stress multiball + grille complète, mesure FPS réelle -> docs/performance-results.json
```

`test:mobile` et `test:perf` lancent Chromium via Playwright. Si aucun
Chromium n'est installé, lancer d'abord `npx playwright install chromium`
(les scripts essaient un chemin pré-installé spécifique à l'environnement
Claude Code, `/opt/pw-browsers/...`, et retombent sur l'installation
standard si ce chemin n'existe pas).

## 4. Déploiement — état réel, y compris ce qui ne fonctionne PAS encore

- Déploiement automatique visé sur **GitHub Pages** via
  `.github/workflows/deploy.yml`, déclenché à chaque push sur `main`
  (`npm ci` → `npm test` → `npm run build` → install Chromium → `npm run
  test:mobile` → publication `dist/` → `actions/deploy-pages@v4`).
- **Premier run réel (id `35690584929`, commit `8fc5a9e`) : le job `build`
  a intégralement réussi** (tests, build, et les 5 checks mobiles verts —
  confirmation indépendante de mon environnement local, dans le runner
  Ubuntu réel de GitHub). **Le job `deploy` a échoué** avec
  `Error: Failed to create deployment (status: 404)... Ensure GitHub Pages
  has been enabled`.
- **Cause et action requise (action du propriétaire du dépôt, pas du
  code) :** pour un dépôt tout neuf, GitHub Pages doit être activé une
  fois manuellement : aller sur
  `https://github.com/scuillerjack-oss/breakpoint-v0/settings/pages` et
  choisir **Source = "GitHub Actions"** (au lieu de "Deploy from a
  branch" ou rien du tout). Aucun outil disponible dans cette session ne
  peut le faire à la place du propriétaire (ce n'est pas exposé par
  l'API utilisée ici). Une fois fait, relancer le workflow (nouveau push,
  ou "Re-run all jobs" sur le run existant) suffit — le code du
  workflow n'a besoin d'aucune modification.
- Tant que cette étape n'est pas faite, **le jeu n'est pas en ligne** —
  seul le code est en sécurité sur `origin/main`.
- URL attendue une fois activé (convention GitHub Pages) :
  `https://scuillerjack-oss.github.io/breakpoint-v0/`.

## 5. Emplacement des assets

- `public/manifest.webmanifest`, `public/sw.js`, `public/icons/icon.svg` +
  `icon-180.svg` : PWA (installable, icônes, service worker de cache).
  Icônes originales (motif de briques), aucun asset tiers.
- Rendu de jeu en **Canvas 2D** (`src/ui/render.js`), pas de DOM pour la
  scène de jeu.
- Audio **entièrement synthétisé** (WebAudio, oscillateurs + enveloppes de
  gain, `src/ui/audio.js`) — aucun fichier son externe.
- Aucun asset graphique bitmap (PNG/JPEG) n'est utilisé.

## 6. Ce qui est vérifié — et ce qui NE l'est PAS

Vérifié par tests automatisés + Playwright (local ET, pour le job
`build`, dans le vrai runner GitHub Actions) :

- Pas de tunneling à haute vitesse, pas de balle collée, rebonds
  déterministes (swept AABB), angle de renvoi influencé par le point
  d'impact sur la raquette.
- Multiball, perforation, laser, briques renforcées.
- Contrôle tactile réel (glisser + lancer) sans erreur console.
- Perte de focus → pause automatique.
- Redimensionnement/rotation sans casser le rendu.
- Sauvegarde (progression, tutoriels, réglages) persistée après
  rechargement complet.
- Performance sous stress (multiball + grille de briques complète) :
  FPS moyen ~59,8, FPS minimum ~8,6 (un seul creux transitoire),
  1 frame sur 235 sous 50fps, 0 erreur console
  (`docs/performance-results.json`).

**NON vérifié — et le cahier des charges est explicite sur ce point :
une suite de tests verte ne suffit pas à valider la sensation de jeu
réelle.** Ce qui reste à faire avant de considérer la Phase 2 (condition
éliminatoire) comme définitivement validée :

- Bêta réelle sur téléphone physique (Android au minimum), pas seulement
  en Chromium headless/Playwright.
- Vérification du bouton retour matériel Android une fois le wrapper
  Capacitor construit (le mécanisme `popstate`/`history.pushState` posé
  dans `src/main.js` est l'équivalent web déjà en place, mais n'a jamais
  été testé sur un vrai bouton retour matériel).

## 7. Trajectoire Android / Capacitor / AAB (documentée, non construite)

Conformément au cahier des charges (« Web/PWA maintenant, trajectoire
Android documentée mais pas nécessairement construite en V0 »), voici le
chemin prévu — **rien de cette section n'est fait, c'est un plan** :

1. **Ajouter Capacitor** (`@capacitor/core`, `@capacitor/cli`,
   `@capacitor/android`) par-dessus le build Vite existant — aucune
   réécriture du moteur de jeu n'est nécessaire, Capacitor enveloppe
   `dist/` dans une WebView native. Voir `rupture-v0` (même organisation
   scuillerjack-oss) qui utilise déjà cette stack pour référence de
   configuration (`capacitor.config.json`, dossier `android/`).
2. `npx cap init` puis `npx cap add android` génère le projet Android
   natif (dossier `android/`, à committer comme le fait `rupture-v0`).
3. Remplacer le mécanisme web `popstate` de pause par le vrai événement
   Android `onBackPressed` (Capacitor expose un listener `backButton` sur
   `App` — `App.addListener('backButton', ...)`) et **retester
   explicitement sur un vrai bouton retour matériel**, pas en émulateur
   seul si possible.
4. `npx cap sync android` après chaque build web, puis build de l'AAB via
   Android Studio ou Gradle en ligne de commande
   (`./gradlew bundleRelease`) une fois signé (keystore à générer et à
   garder en sécurité — **jamais committé dans le dépôt**, exactement
   comme documenté pour `rupture-v0`).
5. Nécessite Node ≥22 pour le CLI Capacitor le plus récent (contrainte
   déjà rencontrée et documentée sur `rupture-v0`, commit
   `214a8e6` « Corrige le build Android CI : Capacitor CLI exige Node
   >=22 ») — **à anticiper dans le workflow CI Android le jour où il sera
   créé**, distinct du workflow Pages actuel qui reste sur Node 20.
6. Compte développeur Google Play : 25$ (frais unique) — voir aussi
   l'étude économique (`docs/BREAKPOINT_Etude_Economique_V0.pdf`) pour
   les coûts associés.

Cette trajectoire n'est volontairement pas engagée en V0 : le cahier des
charges priorise la validation du cœur de jeu avant tout investissement
d'emballage natif.

## 8. Monétisation — rappel explicite

**Aucune monétisation (publicité, achat intégré) n'est implémentée dans
le code de BREAKPOINT V0.** L'étude chiffrée préalable existe
(`docs/BREAKPOINT_Etude_Economique_V0.pdf`) mais n'engage aucune
implémentation tant que le porteur du projet ne l'a pas validée
explicitement après lecture — conformément au cahier des charges.

## 9. Confirmation de récupérabilité

- `main` sur `origin` est identique à `main` en local
  (`d9f1a48e4c34b24cf8f40be8757a4b6d48e2fd05`), donc au contenu de ce
  document.
- Rien d'indispensable ne dépend de cette session ou de cet
  environnement : un `git clone` frais suivi de `npm install` restitue un
  projet complet, testable et buildable.
- Le seul élément non encore fonctionnel de bout en bout est le
  déploiement Pages, et la cause est connue et documentée en section 4
  (action manuelle du propriétaire du dépôt, pas un problème de code).
