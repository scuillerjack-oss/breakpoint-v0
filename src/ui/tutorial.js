// Tutoriel contextuel : jamais un gros écran initial, une phrase courte au
// moment précis où la mécanique devient utile — puis mémorisé pour ne
// jamais réapparaître (cahier des charges, section 11).
export const TUTORIAL_TEXTS = {
  first_move: "Glisse le doigt pour déplacer la raquette.",
  first_launch: "Touche l'écran pour lancer la balle.",
  first_powerup: "Rattrape les capsules avec la raquette : bonus !",
  first_multiball: "Multiball : plusieurs balles à surveiller à la fois.",
  first_reinforced_brick: "Cette brique encaisse plusieurs impacts avant de céder.",
  first_pause: "Pause disponible à tout moment en haut de l'écran.",
};

export function createTutorialController(save, toastEl) {
  let hideTimer = null;

  function show(key) {
    if (save.tutorialsSeen[key]) return false;
    const text = TUTORIAL_TEXTS[key];
    if (!text) return false;
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.style.opacity = "1";
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toastEl.style.opacity = "0";
      setTimeout(() => { toastEl.hidden = true; }, 300);
    }, 3200);
    save.tutorialsSeen[key] = true;
    return true;
  }

  return { show };
}
