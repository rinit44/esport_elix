/* Compte connecté (window.ELIX_USER, fourni par le serveur via /session.js).
   - window.ELIX_AUTH.can('admin', 'organisateur') pour tester un rôle depuis les autres scripts
   - data-roles="admin organisateur" sur un élément : retiré pour les autres rôles
   - bouton « Se connecter » de la nav remplacé par « Déconnexion » */

(function () {
  const user = window.ELIX_USER || null;
  const can = (...roles) => !!user && roles.includes(user.role);

  window.ELIX_AUTH = { user, can, canManage: () => can('admin', 'organisateur') };

  const ROLE_LABEL = { admin: 'Admin', organisateur: 'Orga', user: 'Membre' };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-roles]').forEach((el) => {
      if (!can(...el.dataset.roles.split(' '))) el.remove();
    });

    const navBtn = document.querySelector('.nav a[href="connexion.html"]');
    if (!user) {
      document.querySelector('.nav__links')?.remove(); // rien à visiter sans compte
      return;
    }
    if (!navBtn) return;

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = navBtn.className.replace('btn--primary', 'btn--outline');
    logout.textContent = `${user.pseudo} · ${ROLE_LABEL[user.role]} · Déconnexion`;
    logout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/connexion.html';
    });
    navBtn.replaceWith(logout);
  });
})();
