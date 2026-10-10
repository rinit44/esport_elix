/* Page Classement : podium + tableau filtrable par région. */

(async function () {
  const QUALIFIED = 2; // nombre d'équipes qualifiées pour la grande finale

  const { loadClassement, esc } = window.ELIX;
  const pad = (n) => String(n).padStart(2, '0');

  const podium = document.getElementById('podium');
  const body = document.getElementById('leaderboard-body');
  const filters = document.getElementById('region-filters');

  let ranked;
  try {
    ranked = await loadClassement(); // déjà trié par la base, avec le rang
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">${esc(err.message)}</td></tr>`;
    return;
  }

  // ── Podium (2e, 1er, 3e pour l'effet marches) ──────────
  for (const team of [ranked[1], ranked[0], ranked[2]].filter(Boolean)) {
    const card = document.createElement('div');
    card.className = 'card' + (team.rang === 1 ? ' card--first' : '');
    card.innerHTML = `
      <div class="podium__place podium__place--${team.rang}">${pad(team.rang)}</div>
      <h3 style="margin-top: var(--space-4);">${esc(team.nom)}</h3>
      <p class="text-muted" style="margin: var(--space-2) auto;">${esc(team.region)} · ${team.victoires} V · ${team.defaites} D</p>
      <div class="stat-value" style="font-size: var(--size-xl);">${team.points} pts</div>`;
    podium.appendChild(card);
  }

  // ── Tableau ─────────────────────────────────────────────
  function render(region) {
    const rows = ranked.filter((t) => region === 'all' || t.region === region);
    body.innerHTML = rows.map((t) => {
      const joues = t.victoires + t.defaites;
      const ratio = joues ? Math.round((t.victoires / joues) * 100) : 0;
      const rankClass = t.rang <= 3 ? ` rank--${t.rang}` : '';
      const status = t.rang <= QUALIFIED
        ? '<span class="badge badge--win">Qualifié</span>'
        : '<span class="badge badge--loss">Éliminé</span>';
      return `
        <tr>
          <td class="rank${rankClass}">${pad(t.rang)}</td>
          <td class="team-name"><span class="text-accent">${esc(t.tag)}</span> ${esc(t.nom)}</td>
          <td>${esc(t.region)}</td>
          <td class="text-mono">${t.victoires}</td>
          <td class="text-mono">${t.defaites}</td>
          <td class="text-mono">${ratio} %</td>
          <td class="text-mono team-name">${t.points}</td>
          <td>${status}</td>
        </tr>`;
    }).join('');
  }

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    filters.querySelectorAll('.tag').forEach((b) => b.classList.toggle('active', b === btn));
    render(btn.dataset.region);
  });

  render('all');
})();
