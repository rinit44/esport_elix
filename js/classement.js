/* Page Classement : podium + tableau filtrable par région. */

(function () {
  const QUALIFIED = 2; // nombre d'équipes qualifiées pour la grande finale

  const ranked = [...window.ELIX.teams]
    .sort((a, b) => b.points - a.points || a.defaites - b.defaites)
    .map((team, i) => ({ ...team, rang: i + 1 }));

  const pad = (n) => String(n).padStart(2, '0');

  // ── Podium (2e, 1er, 3e pour l'effet marches) ──────────
  const podium = document.getElementById('podium');
  for (const team of [ranked[1], ranked[0], ranked[2]]) {
    const card = document.createElement('div');
    card.className = 'card' + (team.rang === 1 ? ' card--first' : '');
    card.innerHTML = `
      <div class="podium__place podium__place--${team.rang}">${pad(team.rang)}</div>
      <h3 style="margin-top: var(--space-4);">${team.nom}</h3>
      <p class="text-muted" style="margin: var(--space-2) auto;">${team.region} · ${team.victoires} V · ${team.defaites} D</p>
      <div class="stat-value" style="font-size: var(--size-xl);">${team.points} pts</div>`;
    podium.appendChild(card);
  }

  // ── Tableau ─────────────────────────────────────────────
  const body = document.getElementById('leaderboard-body');
  const filters = document.getElementById('region-filters');

  function render(region) {
    const rows = ranked.filter((t) => region === 'all' || t.region === region);
    body.innerHTML = rows.map((t) => {
      const ratio = Math.round((t.victoires / (t.victoires + t.defaites)) * 100);
      const rankClass = t.rang <= 3 ? ` rank--${t.rang}` : '';
      const status = t.rang <= QUALIFIED
        ? '<span class="badge badge--win">Qualifié</span>'
        : '<span class="badge badge--loss">Éliminé</span>';
      return `
        <tr>
          <td class="rank${rankClass}">${pad(t.rang)}</td>
          <td class="team-name"><span class="text-accent">${t.tag}</span> ${t.nom}</td>
          <td>${t.region}</td>
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
