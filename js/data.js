/* Accès aux données partagé par toutes les pages.
   Tout vient de l'API Flask (base MySQL) : voir backend/routes/. */

window.ELIX = (function () {
  // Rôles proposés par défaut pour les cinq joueurs d'une équipe
  const ROLES = ['Duellist', 'Duellist', 'Initiateur', 'Smoker', 'Sentinel'];

  // Appel à l'API : renvoie le JSON, lève une Error avec le message du serveur
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      location.href = '/connexion.html?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Connexion requise.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erreur || 'Erreur du serveur.');
    return data;
  }

  // Les noms viennent de la base : on les échappe avant de les mettre dans du HTML
  const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const prize = (n) => '$' + Number(n).toLocaleString('en-US');

  // « En cours », « Terminé », « Demain · 20:00 », « 12 déc. · 19:00 »
  function badge(t) {
    if (t.statut === 'live') return 'En cours';
    if (t.statut === 'ended') return 'Terminé';
    if (!t.date_debut) return 'Date à venir';

    const d = new Date(t.date_debut);
    const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const jours = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    if (jours === 0) return `Aujourd'hui · ${heure}`;
    if (jours === 1) return `Demain · ${heure}`;
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return `${d.toLocaleDateString('fr-FR', opts)} · ${heure}`;
  }

  async function loadTournois() {
    const tournois = await api('/tournois');
    return tournois.map((t) => ({
      ...t,
      badge: badge(t),
      prize: prize(t.cashprize),
      inscriptions: Boolean(t.inscriptions_ouvertes),
    }));
  }

  const loadTournoi = (id) => api(`/tournois/${id}`);
  const loadEquipes = () => api('/equipes');
  const loadClassement = () => api('/classement');

  return { ROLES, api, esc, prize, badge, loadTournois, loadTournoi, loadEquipes, loadClassement };
})();
