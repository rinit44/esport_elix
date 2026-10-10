/* Page d'accueil : match en direct, chiffres de la saison, tournois à suivre,
   capitaines du top 4 et extrait du classement. Tout vient de la base. */

(async function () {
  const { esc, prize, loadTournois, loadTournoi, loadEquipes, loadClassement } = window.ELIX;

  const QUALIFIED = 2;
  const STATUS_BADGE = { live: 'badge--live', upcoming: 'badge--upcoming', ended: 'badge--ended' };
  const STATUS_ORDER = { live: 0, upcoming: 1, ended: 2 };
  const pad = (n) => String(n).padStart(2, '0');
  const setText = (id, value) => { document.getElementById(id).textContent = value; };

  let tournois, equipes, classement;
  try {
    [tournois, equipes, classement] = await Promise.all([loadTournois(), loadEquipes(), loadClassement()]);
  } catch (err) {
    document.getElementById('home-tournois').innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    return;
  }

  // ── Chiffres de la saison ───────────────────────────────
  setText('stat-tournois', tournois.length);
  setText('stat-cashprize', prize(tournois.reduce((sum, t) => sum + t.cashprize, 0)));
  setText('stat-equipes', equipes.length);
  setText('stat-matchs', classement.reduce((sum, e) => sum + e.victoires, 0)); // une victoire par match joué

  // ── Tournois à suivre : en cours, puis à venir, puis terminés ─
  const aSuivre = [...tournois]
    .sort((a, b) => STATUS_ORDER[a.statut] - STATUS_ORDER[b.statut])
    .slice(0, 3);
  document.getElementById('home-tournois').innerHTML = aSuivre.map((t) => `
    <a href="tournois.html?id=${t.id}" class="card--tournament" style="display: block; color: inherit;">
      <div class="badge ${STATUS_BADGE[t.statut]}" style="margin-bottom: var(--space-3);">${esc(t.badge)}</div>
      <h3>${esc(t.nom)}</h3>
      <p class="text-muted" style="margin-block: var(--space-2);">${esc(t.format)} · ${esc(t.info)}</p>
      <div class="prize">${t.prize}</div>
      <div style="margin-top: var(--space-4);">
        <div class="progress-bar"><div class="progress-bar__fill" style="width: ${t.progression}%;"></div></div>
      </div>
    </a>`).join('') || '<p class="empty-state">Aucun tournoi pour le moment.</p>';

  // ── Classement (top 4) ──────────────────────────────────
  const top = classement.slice(0, 4);
  document.getElementById('home-classement').innerHTML = top.map((t) => `
    <tr>
      <td class="rank${t.rang <= 3 ? ` rank--${t.rang}` : ''}">${pad(t.rang)}</td>
      <td class="team-name">${esc(t.nom)}</td>
      <td class="text-mono">${t.victoires} - ${t.defaites}</td>
      <td>${t.rang <= QUALIFIED
        ? '<span class="badge badge--win">Qualifié</span>'
        : '<span class="badge badge--loss">Éliminé</span>'}</td>
    </tr>`).join('');

  // ── Capitaines des équipes du top 4 ─────────────────────
  document.getElementById('home-joueurs').innerHTML = top.map((t) => {
    const equipe = equipes.find((e) => e.id === t.id);
    const capitaine = equipe?.joueurs[0];
    if (!capitaine) return '';
    return `
      <div class="card card--player">
        <div class="avatar"></div>
        <h3>${esc(capitaine.pseudo)}</h3>
        <div class="role">${esc(capitaine.role)}</div>
        <p class="text-muted" style="margin-top: var(--space-2);">${esc(t.tag)} · ${t.victoires} victoires</p>
      </div>`;
  }).join('');

  // ── Match en direct : prochain match du tournoi en cours ─
  const live = tournois.find((t) => t.statut === 'live');
  if (!live) return;

  const detail = await loadTournoi(live.id).catch(() => null);
  if (!detail) return;
  const nom = (id) => detail.equipes.find((e) => e.id === id)?.nom || 'À définir';
  const avecEquipes = detail.matchs.filter((m) => m.equipe1_id && m.equipe2_id);
  const enCours = avecEquipes.find((m) => !m.vainqueur_id);
  const match = enCours || avecEquipes.filter((m) => m.vainqueur_id).pop();
  if (!match) return;

  setText('live-tournoi', `${live.nom} · ${enCours ? 'match en cours' : 'dernier résultat'}`);
  setText('live-team-1', nom(match.equipe1_id).toUpperCase());
  setText('live-team-2', nom(match.equipe2_id).toUpperCase());
  setText('live-score-1', match.score1 == null ? '–' : pad(match.score1));
  setText('live-score-2', match.score2 == null ? '–' : pad(match.score2));
  if (match.vainqueur_id) {
    const winner = match.vainqueur_id === match.equipe1_id ? 'live-score-1' : 'live-score-2';
    document.getElementById(winner).classList.add('scoreboard__score--winner');
  }
  document.getElementById('live-section').hidden = false;
})();
