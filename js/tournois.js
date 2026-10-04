/* Page Tournois : liste des tournois + arbre en élimination simple.
   brackets-manager.js génère et met à jour l'arbre (données en mémoire),
   brackets-viewer.js l'affiche. */

(async function () {
  const MANAGER_URL = 'https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm';
  const MEMORY_DB_URL = 'https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm';

  const { tournois, byName } = window.ELIX;

  const STATUS_BADGE = { live: 'badge--live', upcoming: 'badge--upcoming', ended: 'badge--ended' };
  const ROUND_NAMES = ['Finale', 'Demies', 'Quarts', 'Huitièmes', 'Seizièmes'];

  const list = document.getElementById('tournament-list');
  const filters = document.getElementById('tournament-filters');
  const bracketEl = document.getElementById('bracket');
  const emptyEl = document.getElementById('bracket-empty');
  const subtitle = document.getElementById('bracket-subtitle');
  const resetBtn = document.getElementById('bracket-reset');

  const modal = document.getElementById('score-modal');
  const scoreForm = document.getElementById('score-form');
  const score1 = document.getElementById('score-1');
  const score2 = document.getElementById('score-2');
  const scoreError = document.getElementById('score-error');

  const params = new URLSearchParams(location.search);
  let selected = tournois.find((t) => t.id === Number(params.get('id')))
    || tournois.find((t) => t.statut === 'live')
    || tournois[0];

  // ── Liste des tournois ──────────────────────────────────
  function renderList(filter) {
    list.innerHTML = '';
    const visible = tournois.filter((t) => filter === 'all' || t.statut === filter);

    if (!visible.length) {
      list.innerHTML = '<p class="empty-state">Aucun tournoi dans cette catégorie.</p>';
      return;
    }

    for (const t of visible) {
      const card = document.createElement('article');
      card.className = 'card--tournament is-clickable' + (t.id === selected.id ? ' is-selected' : '');
      card.innerHTML = `
        <div><span class="badge ${STATUS_BADGE[t.statut]}" style="margin-bottom: var(--space-3);">${t.badge}</span></div>
        <h3>${t.nom}</h3>
        <p class="text-muted" style="margin-block: var(--space-2);">${t.format} · ${t.info}</p>
        <div class="prize">${t.cashprize}</div>
        <div style="margin-top: var(--space-4);">
          <div class="progress-bar"><div class="progress-bar__fill" style="width: ${t.progression}%;"></div></div>
        </div>
        <div class="card--tournament__meta">
          <span class="text-muted">${t.equipes.length} / ${t.places} équipes</span>
          ${t.inscriptions
            ? `<a href="inscription.html?tournoi=${t.id}" class="btn btn--primary btn--sm">S'inscrire</a>`
            : `<span class="btn btn--outline btn--sm">Voir l'arbre</span>`}
        </div>`;

      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        selectTournament(t);
      });
      list.appendChild(card);
    }
  }

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filters.querySelectorAll('.tag').forEach((b) => b.classList.toggle('active', b === btn));
    renderList(btn.dataset.filter);
  });

  renderList('all');

  // ── Chargement de brackets-manager ──────────────────────
  let BracketsManager, InMemoryDatabase;
  try {
    ({ BracketsManager } = await import(MANAGER_URL));
    ({ InMemoryDatabase } = await import(MEMORY_DB_URL));
  } catch (err) {
    console.error(err);
    showEmpty('Impossible de charger l\'arbre', '<p>Vérifie ta connexion internet : les bibliothèques de bracket sont chargées depuis un CDN.</p>');
    subtitle.textContent = '';
    return;
  }

  // Un manager (et sa base en mémoire) par tournoi
  const brackets = new Map();

  function scoreFor(format, seed) {
    if (format === 'BO1') return [13, 5 + (seed % 7)];
    if (format === 'BO5') return [3, seed % 3];
    return [2, seed % 2];
  }

  // Joue automatiquement des matchs pour simuler un tournoi en cours ou terminé
  async function playMatch(manager, match, participants, format) {
    const p1 = participants.find((p) => p.id === match.opponent1.id);
    const p2 = participants.find((p) => p.id === match.opponent2.id);
    const strength = (p) => (byName(p.name) || { points: 0 }).points;

    let firstWins = strength(p1) >= strength(p2);
    if ((match.id * 7 + match.number) % 5 === 0) firstWins = !firstWins; // une petite surprise de temps en temps

    const [w, l] = scoreFor(format, match.id);
    await manager.update.match({
      id: match.id,
      opponent1: { score: firstWins ? w : l, result: firstWins ? 'win' : 'loss' },
      opponent2: { score: firstWins ? l : w, result: firstWins ? 'loss' : 'win' },
    });
  }

  async function simulate(manager, stageId, t, fullRounds, extraMatches) {
    const { round } = await manager.get.stageData(stageId);
    const rounds = [...round].sort((a, b) => a.number - b.number);

    for (let i = 0; i < rounds.length && i <= fullRounds; i++) {
      const data = await manager.get.stageData(stageId);
      let matches = data.match
        .filter((m) => m.round_id === rounds[i].id)
        .sort((a, b) => a.number - b.number);
      if (i === fullRounds) matches = matches.slice(0, extraMatches);

      for (const m of matches) await playMatch(manager, m, data.participant, t.format);
    }
  }

  async function getBracket(t) {
    if (brackets.has(t.id)) return brackets.get(t.id);

    const manager = new BracketsManager(new InMemoryDatabase());
    const stage = await manager.create.stage({
      tournamentId: t.id,
      name: t.nom,
      type: 'single_elimination',
      seeding: t.equipes,
      settings: { seedOrdering: ['inner_outer'], size: t.places },
    });

    if (t.statut === 'ended') await simulate(manager, stage.id, t, Infinity, 0);
    if (t.statut === 'live') await simulate(manager, stage.id, t, 1, 1);

    const entry = { manager, stageId: stage.id };
    brackets.set(t.id, entry);
    return entry;
  }

  // ── Affichage ───────────────────────────────────────────
  let current = null; // { manager, data } du tournoi affiché

  function showEmpty(title, bodyHtml) {
    bracketEl.hidden = true;
    bracketEl.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.innerHTML = `<h3>${title}</h3>${bodyHtml}`;
  }

  async function renderBracket() {
    const t = selected;
    resetBtn.hidden = true;

    // Inscriptions ouvertes : l'arbre n'existe pas encore
    if (t.equipes.length < t.places) {
      current = null;
      subtitle.textContent = `${t.nom} · inscriptions ouvertes`;
      const tags = t.equipes.map((n) => `<span class="tag">${n}</span>`).join(' ');
      showEmpty(
        `${t.equipes.length} / ${t.places} équipes inscrites`,
        `<p>L'arbre sera généré à la clôture des inscriptions.</p>
         <div class="tag-group" style="justify-content: center; margin-block: var(--space-6);">${tags}</div>
         <a href="inscription.html?tournoi=${t.id}" class="btn btn--primary">Inscrire mon équipe</a>`
      );
      return;
    }

    const { manager, stageId } = await getBracket(t);
    const data = await manager.get.stageData(stageId);
    current = { manager, data, stageId };

    emptyEl.hidden = true;
    bracketEl.hidden = false;
    resetBtn.hidden = false;
    subtitle.textContent = `${t.nom} · ${t.format} · élimination simple. Clique sur un match pour saisir le score.`;

    await window.bracketsViewer.render(
      {
        stages: data.stage,
        matches: data.match,
        matchGames: data.match_game,
        participants: data.participant,
      },
      {
        selector: '#bracket',
        clear: true,
        highlightParticipantOnHover: true,
        customRoundName: (info) => ROUND_NAMES[info.roundCount - info.roundNumber],
      }
    );

    // Le viewer affiche un tiret pour les scores non joués : on le retire
    bracketEl.querySelectorAll('.result').forEach((r) => {
      if (r.textContent.trim() === '-') r.textContent = '';
    });
  }

  async function selectTournament(t) {
    selected = t;
    renderList(filters.querySelector('.tag.active').dataset.filter);
    await renderBracket();
    document.getElementById('arbre').scrollIntoView({ behavior: 'smooth' });
  }

  resetBtn.addEventListener('click', async () => {
    brackets.delete(selected.id);
    await renderBracket();
  });

  // ── Saisie des scores ───────────────────────────────────
  let editing = null;

  window.bracketsViewer.onMatchClicked = (match) => {
    if (!current) return;
    const m = current.data.match.find((x) => x.id === match.id);
    if (!m || m.opponent1?.id == null || m.opponent2?.id == null) return;

    const name = (id) => current.data.participant.find((p) => p.id === id).name;
    const roundIdx = current.data.round.find((r) => r.id === m.round_id).number;
    const roundCount = current.data.round.length;

    editing = m;
    document.getElementById('score-round').textContent = `${ROUND_NAMES[roundCount - roundIdx] || 'Tour ' + roundIdx} · Match ${m.number}`;
    document.getElementById('score-1-label').textContent = name(m.opponent1.id);
    document.getElementById('score-2-label').textContent = name(m.opponent2.id);
    score1.value = m.opponent1.score ?? '';
    score2.value = m.opponent2.score ?? '';
    scoreError.textContent = '';
    modal.showModal();
    score1.focus();
  };

  document.getElementById('score-cancel').addEventListener('click', () => modal.close());

  scoreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = Number(score1.value);
    const b = Number(score2.value);

    if (score1.value === '' || score2.value === '' || a < 0 || b < 0) {
      scoreError.textContent = 'Indique un score pour chaque équipe.';
      return;
    }
    if (a === b) {
      scoreError.textContent = 'Pas d\'égalité possible en élimination directe.';
      return;
    }

    try {
      await current.manager.update.match({
        id: editing.id,
        opponent1: { score: a, result: a > b ? 'win' : 'loss' },
        opponent2: { score: b, result: a > b ? 'loss' : 'win' },
      });
    } catch (err) {
      console.error(err);
      scoreError.textContent = 'Ce match ne peut plus être modifié : le tour suivant a déjà commencé.';
      return;
    }

    modal.close();
    await renderBracket();
  });

  await renderBracket();
})();
