/* Formulaires : connexion et inscription d'une équipe à un tournoi
   (réservée aux organisateurs et aux admins). Les données partent vers l'API Flask. */

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
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    const loginError = document.getElementById('login-error');

    // On ne revient que vers une page du site (pas de redirection externe)
    function nextUrl() {
      const next = new URLSearchParams(location.search).get('next') || '';
      return /^\/(?![/\\])/.test(next) ? next : '/';
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.textContent = '';
      if (!validateForm(loginForm)) return;

      const btn = loginForm.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('login-email').value.trim(),
            password: document.getElementById('login-password').value,
            remember: document.getElementById('login-remember').checked,
          }),
        });
        if (res.ok) { location.href = nextUrl(); return; }
        loginError.textContent = (await res.json().catch(() => ({}))).erreur || 'Connexion impossible.';
      } catch (err) {
        loginError.textContent = 'Serveur injoignable.';
      }
      btn.disabled = false;
    });
  }

  // ── Page inscription au tournoi ─────────────────────────
  const insForm = document.getElementById('inscription-form');
  if (!insForm) return;

  const { ROLES, api, esc, loadTournois } = window.ELIX;
  let open = []; // tournois que l'utilisateur gère et dont les inscriptions sont ouvertes

  const select = document.getElementById('ins-tournoi');
  const recap = document.getElementById('tournoi-recap');
  const recapDefault = recap.innerHTML;

  function renderRecap() {
    const t = open.find((x) => String(x.id) === select.value);
    if (!t) { recap.innerHTML = recapDefault; return; }

    const left = t.places - t.nb_equipes;
    recap.innerHTML = `
      <div><span class="badge badge--upcoming" style="margin-bottom: var(--space-3);">${esc(t.badge)}</span></div>
      <h3>${esc(t.nom)}</h3>
      <p class="text-muted" style="margin-block: var(--space-2);">${esc(t.format)} · ${esc(t.info)}</p>
      <div class="prize">${t.prize}</div>
      <div style="margin-top: var(--space-4);">
        <div class="progress-bar"><div class="progress-bar__fill" style="width: ${(t.nb_equipes / t.places) * 100}%;"></div></div>
      </div>
      <p class="text-muted" style="margin-top: var(--space-3);">${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} sur ${t.places}</p>`;
  }

  async function fillTournois() {
    try {
      open = (await loadTournois()).filter((t) => t.peut_gerer && t.inscriptions && t.nb_equipes < t.places);
    } catch (err) {
      open = [];
    }

    select.insertAdjacentHTML('beforeend',
      open.map((t) => `<option value="${t.id}">${esc(t.nom)} · ${esc(t.badge)}</option>`).join(''));
    if (!open.length) {
      recap.innerHTML = `<h3>Aucun tournoi</h3>
        <p class="text-muted" style="margin-top: var(--space-2);">Aucun de tes tournois n'a d'inscriptions ouvertes.</p>`;
      return;
    }

    const preselect = new URLSearchParams(location.search).get('tournoi');
    if (open.some((t) => String(t.id) === preselect)) select.value = preselect;
    renderRecap();
  }

  select.addEventListener('change', renderRecap);
  fillTournois();

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

  const insError = document.getElementById('inscription-error');

  insForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    insError.textContent = '';
    if (!validateForm(insForm)) return;

    const t = open.find((x) => String(x.id) === select.value);
    const nom = document.getElementById('ins-nom').value.trim();
    const tag = document.getElementById('ins-tag').value.trim().toUpperCase();

    const equipe = {
      nom,
      tag,
      region: document.getElementById('ins-region').value,
      discord: document.getElementById('ins-discord').value.trim(),
      email: document.getElementById('ins-email').value.trim(),
      joueurs: ROLES.map((_, i) => ({
        pseudo: document.getElementById(`ins-joueur-${i}`).value.trim(),
        role: document.getElementById(`ins-role-${i}`).value,
      })),
    };

    const btn = insForm.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api(`/tournois/${t.id}/equipes`, { method: 'POST', body: { equipe } });
    } catch (err) {
      insError.textContent = err.message;
      btn.disabled = false;
      return;
    }

    document.getElementById('inscription-success-text').textContent =
      `${nom} [${tag}] est inscrite au tournoi ${t.nom}.`;
    document.getElementById('inscription-layout').hidden = true;
    const success = document.getElementById('inscription-success');
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
