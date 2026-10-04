/* Données de démonstration partagées par toutes les pages.
   À remplacer plus tard par les appels à la base de données locale. */

window.ELIX = (function () {
  const ROLES = ['Duellist', 'Duellist', 'Initiateur', 'Smoker', 'Sentinel'];

  // nom, tag, région, victoires, défaites, joueurs
  const RAW_TEAMS = [
    ['Cyber Samurai',    'CSM', 'Europe',     18, 2,  ['Vortex', 'Cipher', 'Kaze', 'Ronin', 'Hikari']],
    ['Neon Titans',      'NTN', 'Europe',     15, 5,  ['Blitz', 'Nova', 'Atlas', 'Aegis', 'Specter']],
    ['Shadow Syndicate', 'SHS', 'Amérique',   12, 8,  ['Wraith', 'Onyx', 'Raven', 'Smog', 'Bastion']],
    ['Apex Predators',   'APX', 'Amérique',   10, 10, ['Talon', 'Fang', 'Hunter', 'Ash', 'Warden']],
    ['Void Runners',     'VDR', 'Europe',     9,  11, ['Drift', 'Echo', 'Pulse', 'Haze', 'Keeper']],
    ['Crimson Lotus',    'CRL', 'Asie',       9,  11, ['Sakura', 'Jin', 'Lotus', 'Mist', 'Shield']],
    ['Iron Wolves',      'IWF', 'Europe',     8,  12, ['Fenrir', 'Lupo', 'Tracker', 'Fumo', 'Guard']],
    ['Phantom Unit',     'PHU', 'Amérique',   8,  12, ['Ghost', 'Shade', 'Scout', 'Veil', 'Lock']],
    ['Solar Flare',      'SLF', 'Asie',       7,  13, ['Helios', 'Ray', 'Dawn', 'Ember', 'Sol']],
    ['Frost Legion',     'FRL', 'Europe',     7,  13, ['Glacier', 'Rime', 'Polar', 'Snow', 'Yeti']],
    ['Night Owls',       'NOW', 'Amérique',   6,  14, ['Hoot', 'Luna', 'Dusk', 'Gloom', 'Perch']],
    ['Storm Breakers',   'STB', 'Europe',     6,  14, ['Thunder', 'Bolt', 'Gale', 'Cloud', 'Anchor']],
    ['Jade Dragons',     'JDD', 'Asie',       5,  15, ['Ryu', 'Jade', 'Long', 'Smoke', 'Pearl']],
    ['Pixel Reapers',    'PXR', 'Amérique',   4,  16, ['Byte', 'Glitch', 'Scythe', 'Pixel', 'Grim']],
    ['Omega Squad',      'OMG', 'Europe',     3,  17, ['Omega', 'Delta', 'Sigma', 'Theta', 'Alpha']],
    ['Blaze Kings',      'BLK', 'Asie',       2,  18, ['Blaze', 'Pyro', 'Inferno', 'Cinder', 'Crown']],
  ];

  const teams = RAW_TEAMS.map(([nom, tag, region, victoires, defaites, joueurs], i) => ({
    id: i + 1,
    nom,
    tag,
    region,
    victoires,
    defaites,
    points: victoires * 3,
    joueurs: joueurs.map((pseudo, j) => ({ pseudo, role: ROLES[j] })),
  }));

  const byName = (nom) => teams.find((t) => t.nom === nom);

  // statut : live | upcoming | ended
  const tournois = [
    {
      id: 1,
      nom: 'Grand Finals 2026',
      statut: 'live',
      badge: 'En cours',
      format: 'BO5',
      info: 'Serveur EU Ouest',
      cashprize: '$100,000',
      places: 8,
      equipes: teams.slice(0, 8).map((t) => t.nom),
      inscriptions: false,
      progression: 75,
    },
    {
      id: 2,
      nom: 'Championship Qualifiers',
      statut: 'upcoming',
      badge: 'Demain · 20:00',
      format: 'BO3',
      info: 'Open Bracket',
      cashprize: '$25,000',
      places: 16,
      equipes: teams.map((t) => t.nom),
      inscriptions: false,
      progression: 30,
    },
    {
      id: 3,
      nom: 'Rookie Showdown',
      statut: 'ended',
      badge: 'Terminé',
      format: 'BO1',
      info: 'Amateurs',
      cashprize: '$5,000',
      places: 8,
      equipes: teams.slice(8).map((t) => t.nom),
      inscriptions: false,
      progression: 100,
    },
    {
      id: 4,
      nom: 'Elix Winter Cup',
      statut: 'upcoming',
      badge: '12 déc. · 19:00',
      format: 'BO3',
      info: 'Serveur EU Ouest',
      cashprize: '$15,000',
      places: 8,
      equipes: ['Void Runners', 'Frost Legion', 'Storm Breakers', 'Iron Wolves', 'Omega Squad'],
      inscriptions: true,
      progression: 0,
    },
    {
      id: 5,
      nom: 'Spring Clash 2027',
      statut: 'upcoming',
      badge: '14 mars · 18:00',
      format: 'BO3',
      info: 'Open Bracket',
      cashprize: '$40,000',
      places: 16,
      equipes: ['Crimson Lotus', 'Jade Dragons', 'Night Owls', 'Pixel Reapers'],
      inscriptions: true,
      progression: 0,
    },
  ];

  return { teams, tournois, byName, ROLES };
})();
