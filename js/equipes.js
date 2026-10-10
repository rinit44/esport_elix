/* Page Équipes : cartes avec effectif, recherche et filtre par région. */

(async function () {
  const { loadEquipes, esc } = window.ELIX;

  const grid = document.getElementById('team-grid');
  const search = document.getElementById('team-search');
  const filters = document.getElementById('region-filters');

  let region = 'all';
  let teams = [];

  function render() {
    const q = search.value.trim().toLowerCase();
    const visible = teams.filter((t) =>
      (region === 'all' || t.region === region) &&
      (!q || t.nom.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q) ||
        t.joueurs.some((j) => j.pseudo.toLowerCase().includes(q)))
    );

    if (!visible.length) {
      grid.innerHTML = '<p class="empty-state" style="grid-column: 1 / -1;">Aucune équipe ne correspond à ta recherche.</p>';
      return;
    }

    grid.innerHTML = visible.map((t) => `
      <article class="card team-card">
        <div class="team-card__head">
          <div class="team-card__logo">${esc(t.tag)}</div>
          <div>
            <h3>${esc(t.nom)}</h3>
            <span class="text-muted">${esc(t.region)}</span>
          </div>
        </div>
        <div class="team-card__stats">
          <div><div class="stat-value">${t.victoires}</div><div class="stat-label">Victoires</div></div>
          <div><div class="stat-value">${t.defaites}</div><div class="stat-label">Défaites</div></div>
          <div><div class="stat-value">${t.points}</div><div class="stat-label">Points</div></div>
        </div>
        <ul class="roster">
          ${t.joueurs.map((j) => `<li>${esc(j.pseudo)}<span>${esc(j.role)}</span></li>`).join('')}
        </ul>
      </article>`).join('');
  }

  search.addEventListener('input', render);

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    region = btn.dataset.region;
    filters.querySelectorAll('.tag').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });

  try {
    teams = await loadEquipes();
  } catch (err) {
    grid.innerHTML = `<p class="empty-state" style="grid-column: 1 / -1;">${esc(err.message)}</p>`;
    return;
  }
  render();
})();
