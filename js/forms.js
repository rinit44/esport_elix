/* Formulaires (connexion + inscription au tournoi).
   Pour l'instant tout est visuel : rien n'est envoyé ni enregistré. */

(function () {
  // ── Validation générique ────────────────────────────────
  function validateField(el) {
    let ok = el.checkValidity();
    if (ok && el.dataset.match) ok = el.value === document.getElementById(el.dataset.match).value;
    const field = el.closest('.field');
    if (field) field.classList.toggle('field--error', !ok);
    return ok;
  }

  function validateForm(form) {
    let firstInvalid = null;
    for (const el of form.querySelectorAll('input, select')) {
      if (!validateField(el) && !firstInvalid) firstInvalid = el;
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  // Une fois une erreur affichée, on revalide le champ à chaque frappe
  for (const type of ['input', 'change']) {
    document.addEventListener(type, (e) => {
      if (e.target.closest('.field--error')) validateField(e.target);
    });
  }

  // ── Page connexion ──────────────────────────────────────
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  }));

  for (const id of ['login-form', 'register-form']) {
    const form = document.getElementById(id);
    if (!form) continue;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      form.querySelector('[data-success]').hidden = !validateForm(form);
    });
  }

  // ── Page inscription au tournoi ─────────────────────────
  const insForm = document.getElementById('inscription-form');
  if (!insForm) return;

  const { tournois, ROLES } = window.ELIX;
  const open = tournois.filter((t) => t.inscriptions);

  const select = document.getElementById('ins-tournoi');
  const recap = document.getElementById('tournoi-recap');
  const recapDefault = recap.innerHTML;

  select.insertAdjacentHTML('beforeend',
    open.map((t) => `<option value="${t.id}">${t.nom} · ${t.badge}</option>`).join(''));

  const preselect = new URLSearchParams(location.search).get('tournoi');
  if (open.some((t) => String(t.id) === preselect)) select.value = preselect;

  function renderRecap() {
    const t = open.find((x) => String(x.id) === select.value);
    if (!t) { recap.innerHTML = recapDefault; return; }

    const left = t.places - t.equipes.length;
    recap.innerHTML = `
      <div><span class="badge badge--upcoming" style="margin-bottom: var(--space-3);">${t.badge}</span></div>
      <h3>${t.nom}</h3>
      <p class="text-muted" style="margin-block: var(--space-2);">${t.format} · ${t.info}</p>
      <div class="prize">${t.cashprize}</div>
      <div style="margin-top: var(--space-4);">
        <div class="progress-bar"><div class="progress-bar__fill" style="width: ${(t.equipes.length / t.places) * 100}%;"></div></div>
      </div>
      <p class="text-muted" style="margin-top: var(--space-3);">${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} sur ${t.places}</p>`;
  }

  select.addEventListener('change', renderRecap);
  renderRecap();

  // Cinq lignes joueur : pseudo + rôle
  const roleOptions = [...new Set(ROLES)];
  document.getElementById('roster-fields').innerHTML = ROLES.map((role, i) => `
    <div class="roster-row">
      <span class="roster-row__num">0${i + 1}</span>
      <div class="field">
        <input class="input" type="text" id="ins-joueur-${i}" required minlength="2" maxlength="20"
          placeholder="Pseudo du joueur ${i + 1}${i === 0 ? ' (capitaine)' : ''}" aria-label="Pseudo du joueur ${i + 1}">
        <span class="field__error">Pseudo requis (2 caractères minimum).</span>
      </div>
      <select class="input" id="ins-role-${i}" aria-label="Rôle du joueur ${i + 1}">
        ${roleOptions.map((r) => `<option${r === role ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>`).join('');

  insForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateForm(insForm)) return;

    const t = open.find((x) => String(x.id) === select.value);
    const nom = document.getElementById('ins-nom').value.trim();
    const tag = document.getElementById('ins-tag').value.trim().toUpperCase();
    const email = document.getElementById('ins-email').value.trim();

    // Données prêtes à être envoyées à la future base locale
    const inscription = {
      tournoiId: t.id,
      equipe: {
        nom,
        tag,
        region: document.getElementById('ins-region').value,
        discord: document.getElementById('ins-discord').value.trim(),
        email,
        joueurs: ROLES.map((_, i) => ({
          pseudo: document.getElementById(`ins-joueur-${i}`).value.trim(),
          role: document.getElementById(`ins-role-${i}`).value,
        })),
      },
    };
    console.log('Inscription (démo) :', inscription);

    document.getElementById('inscription-success-text').textContent =
      `${nom} [${tag}] est inscrite au tournoi ${t.nom}. La confirmation sera envoyée à ${email}.`;
    document.getElementById('inscription-layout').hidden = true;
    const success = document.getElementById('inscription-success');
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
