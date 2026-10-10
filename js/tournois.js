/* Page Tournois : liste des tournois + arbre en élimination simple.
   Les matchs viennent de la base (API Flask). brackets-manager.js reconstruit
   l'arbre en mémoire à partir de ces matchs, brackets-viewer.js l'affiche. */

(async function () {
  const MANAGER_URL = 'https://cdn.jsdelivr.net/npm/brackets-manager@1.11.1/+esm';
  const MEMORY_DB_URL = 'https://cdn.jsdelivr.net/npm/brackets-memory-db@1.0.6/+esm';

  const { api, esc, loadTournois, loadTournoi } = window.ELIX;

  const STATUS_BADGE = { live: 'badge--live', upcoming: 'badge--upcoming', ended: 'badge--ended' };
  const ROUND_NAMES = ['Finale', 'Demies', 'Quarts', 'Huitièmes', 'Seizièmes'];

  const list = document.getElementById('tournament-list');
  const filters = document.getElementById('tournament-filters');
  const bracketEl = document.getElementById('bracket');
  const emptyEl = document.getElementById('bracket-empty');
  const subtitle = document.getElementById('bracket-subtitle');

  const modal = document.getElementById('score-modal');
  const scoreForm = document.getElementById('score-form');
  const score1 = document.getElementById('score-1');
  const score2 = document.getElementById('score-2');
  const scoreError = document.getElementById('score-error');

  let tournois;
  try {
    tournois = await loadTournois();
  } catch (err) {
    list.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    subtitle.textContent = '';
    return;
  }

  const params = new URLSearchParams(location.search);
  let selected = tournois.find((t) => t.id === Number(params.get('id')))
    || tournois.find((t) => t.statut === 'live')
    || tournois[0];

  // ── Liste des tournois ──────────────────────────────────
  const activeFilter = () => filters.querySelector('.tag.active').dataset.filter;

  function renderList(filter) {
    list.innerHTML = '';
    const visible = tournois.filter((t) => filter === 'all' || t.statut === filter);

    if (!visible.length) {
      list.innerHTML = '<p class="empty-state">Aucun tournoi dans cette catégorie.</p>';
      return;
    }

    for (const t of visible) {
      const card = document.createElement('article');
      card.className = 'card--tournament is-clickable' + (t.id === selected?.id ? ' is-selected' : '');
      card.innerHTML = `
        <div><span class="badge ${STATUS_BADGE[t.statut]}" style="margin-bottom: var(--space-3);">${esc(t.badge)}</span></div>
        <h3>${esc(t.nom)}</h3>
        <p class="text-muted" style="margin-block: var(--space-2);">${esc(t.format)} · ${esc(t.info)}</p>
        <div class="prize">${t.prize}</div>
        <div style="margin-top: var(--space-4);">
          <div class="progress-bar"><div class="progress-bar__fill" style="width: ${t.progression}%;"></div></div>
        </div>
        <div class="card--tournament__meta">
          <span class="text-muted">${t.nb_equipes} / ${t.places} équipes</span>
          ${t.inscriptions && t.peut_gerer
            ? `<a href="inscription.html?tournoi=${t.id}" class="btn btn--primary btn--sm">Inscrire</a>`
            : `<span class="btn btn--outline btn--sm">Voir l'arbre</span>`}
        </div>`;

      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        selectTournament(t);
      });
      list.appendChild(card);
    }
  }

  // Recharge la liste après une modification (statut, progression)
  async function refreshList() {
    tournois = await loadTournois();
    selected = tournois.find((t) => t.id === selected.id) || selected;
    renderList(activeFilter());
  }

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filters.querySelectorAll('.tag').forEach((b) => b.classList.toggle('active', b === btn));
    renderList(btn.dataset.filter);
  });

  renderList('all');
  if (!selected) {
    subtitle.textContent = '';
    showEmpty('Aucun tournoi', '<p>Aucun tournoi n\'a encore été créé.</p>');
    return;
  }

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

  // Reconstruit l'arbre en mémoire : têtes de série puis matchs joués, tour par tour
  async function buildStage(detail) {
    const manager = new BracketsManager(new InMemoryDatabase());
    const seeding = Array(detail.places).fill(null); // null = place vide (qualification directe)
    for (const e of detail.equipes) {
      if (e.seed && e.seed <= detail.places) seeding[e.seed - 1] = e.nom;
    }

    const stage = await manager.create.stage({
      tournamentId: detail.id,
      name: detail.nom,
      type: 'single_elimination',
      seeding,
      settings: { seedOrdering: ['inner_outer'], size: detail.places },
    });

    const nomEquipe = (id) => detail.equipes.find((e) => e.id === id)?.nom;
    const joues = detail.matchs.filter((m) => m.vainqueur_id && m.equipe1_id && m.equipe2_id);

    for (const m of joues) {
      const data = await manager.get.stageData(stage.id);
      const name = (pid) => data.participant.find((p) => p.id === pid)?.name;
      const round = data.round.find((r) => r.number === m.tour);
      const n1 = nomEquipe(m.equipe1_id);
      const n2 = nomEquipe(m.equipe2_id);

      // On retrouve le match par ses deux équipes : l'ordre des slots peut différer
      const target = data.match.find((x) => x.round_id === round?.id
        && [name(x.opponent1?.id), name(x.opponent2?.id)].includes(n1)
        && [name(x.opponent1?.id), name(x.opponent2?.id)].includes(n2));
      if (!target) continue;

      const [a, b] = name(target.opponent1.id) === n1 ? [m.score1, m.score2] : [m.score2, m.score1];
      await manager.update.match({
        id: target.id,
        opponent1: { score: a, result: a > b ? 'win' : 'loss' },
        opponent2: { score: b, result: a > b ? 'loss' : 'win' },
      });
    }

    return manager.get.stageData(stage.id);
  }

  // ── Affichage ───────────────────────────────────────────
  let current = null; // { detail, data } du tournoi affiché

  function showEmpty(title, bodyHtml) {
    bracketEl.hidden = true;
    bracketEl.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.innerHTML = `<h3>${title}</h3>${bodyHtml}`;
  }

  // Arbre pas encore généré : équipes inscrites + actions de l'organisateur
  function showPending(detail) {
    current = null;
    const nb = detail.equipes.length;
    const tags = detail.equipes.map((e) => `<span class="tag">${esc(e.nom)}</span>`).join(' ');
    const actions = [];
    if (detail.peut_gerer && detail.inscriptions_ouvertes && nb < detail.places) {
      actions.push(`<a href="inscription.html?tournoi=${detail.id}" class="btn btn--primary">Inscrire une équipe</a>`);
    }
    if (detail.peut_gerer && nb > detail.places / 2) {
      actions.push('<button type="button" class="btn btn--outline" data-generate>Générer l\'arbre</button>');
    }

    subtitle.textContent = `${detail.nom} · ${detail.inscriptions_ouvertes ? 'inscriptions ouvertes' : 'arbre pas encore généré'}`;
    showEmpty(
      `${nb} / ${detail.places} équipes inscrites`,
      `<p>${detail.peut_gerer
        ? 'Génère l\'arbre une fois les inscriptions terminées (plus de la moitié des places remplies).'
        : 'L\'arbre sera publié par l\'organisateur à la clôture des inscriptions.'}</p>
       <div class="tag-group" style="justify-content: center; margin-block: var(--space-6);">${tags}</div>
       <div style="display: flex; gap: var(--space-4); justify-content: center; flex-wrap: wrap;">${actions.join('')}</div>
       <p class="field__error" data-generate-error style="display: block; margin-top: var(--space-4);"></p>`
    );

    emptyEl.querySelector('[data-generate]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api(`/tournois/${detail.id}/arbre`, { method: 'POST' });
        await refreshList();
        await renderBracket();
      } catch (err) {
        emptyEl.querySelector('[data-generate-error]').textContent = err.message;
        e.target.disabled = false;
      }
    });
  }

  async function renderBracket() {
    const t = selected;
    let detail;
    try {
      detail = await loadTournoi(t.id);
    } catch (err) {
      current = null;
      showEmpty('Impossible de charger le tournoi', `<p>${esc(err.message)}</p>`);
      return;
    }

    if (!detail.matchs.length) {
      showPending(detail);
      return;
    }

    const data = await buildStage(detail);
    current = { detail, data };

    emptyEl.hidden = true;
    bracketEl.hidden = false;
    subtitle.textContent = `${detail.nom} · ${detail.format} · élimination simple.`
      + (detail.peut_gerer ? ' Clique sur un match pour saisir le score.' : '');

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
    renderList(activeFilter());
    await renderBracket();
    document.getElementById('arbre').scrollIntoView({ behavior: 'smooth' });
  }

  // ── Saisie des scores (propriétaire du tournoi ou admin) ─
  let editing = null; // { matchId, swap } : swap si l'équipe 1 de l'arbre est l'équipe 2 en base

  window.bracketsViewer.onMatchClicked = (match) => {
    if (!current || !current.detail.peut_gerer) return;
    const m = current.data.match.find((x) => x.id === match.id);
    if (!m || m.opponent1?.id == null || m.opponent2?.id == null) return;

    const name = (id) => current.data.participant.find((p) => p.id === id).name;
    const idOf = (nom) => current.detail.equipes.find((e) => e.nom === nom)?.id;
    const round = current.data.round.find((r) => r.id === m.round_id);
    const id1 = idOf(name(m.opponent1.id));
    const id2 = idOf(name(m.opponent2.id));

    const dbMatch = current.detail.matchs.find((x) => x.tour === round.number
      && [x.equipe1_id, x.equipe2_id].includes(id1) && [x.equipe1_id, x.equipe2_id].includes(id2));
    if (!dbMatch) return;

    editing = { matchId: dbMatch.id, swap: dbMatch.equipe1_id !== id1 };
    const roundCount = current.data.round.length;
    document.getElementById('score-round').textContent = `${ROUND_NAMES[roundCount - round.number] || 'Tour ' + round.number} · Match ${m.number}`;
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

    const [s1, s2] = editing.swap ? [b, a] : [a, b];
    try {
      await api(`/tournois/${selected.id}/matchs/${editing.matchId}`, {
        method: 'PUT',
        body: { score1: s1, score2: s2 },
      });
    } catch (err) {
      scoreError.textContent = err.message;
      return;
    }

    modal.close();
    await refreshList();
    await renderBracket();
  });

  await renderBracket();
})();
