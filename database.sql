-- ============================================================
--  Base de données Esport ELIXTV (MySQL 8)
--
--  Le fichier s'importe dans une base existante (sur PythonAnywhere,
--  la base se crée depuis l'onglet « Databases »).
--
--  En local (PowerShell) :
--    mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS elix CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
--    mysql -u root -p --default-character-set=utf8mb4 elix -e "source database.sql"
--
--  ATTENTION : réimporter efface toutes les données existantes.
--
--  Rôles :
--    admin        : tout + gestion des comptes
--    organisateur : crée des tournois et gère uniquement les siens
--    user         : consultation seule
--
--  Aucun compte n'est créé depuis le site : les comptes sont créés
--  par un admin (API /api/utilisateurs ou script create_user.py).
-- ============================================================

SET NAMES utf8mb4;

DROP VIEW IF EXISTS v_tournois, v_classement;
DROP TABLE IF EXISTS matchs, tournoi_equipes, tournois, joueurs, equipes, utilisateurs;

-- ── Comptes ─────────────────────────────────────────────────
CREATE TABLE utilisateurs (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pseudo             VARCHAR(20)  NOT NULL UNIQUE,
  email              VARCHAR(255) NOT NULL UNIQUE,
  mot_de_passe       VARCHAR(255) NOT NULL,              -- hash werkzeug (scrypt)
  role               ENUM('admin', 'organisateur', 'user') NOT NULL DEFAULT 'user',
  actif              BOOLEAN      NOT NULL DEFAULT TRUE,  -- compte désactivé = connexion refusée
  derniere_connexion DATETIME     NULL,
  cree_le            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Équipes et joueurs ──────────────────────────────────────
CREATE TABLE equipes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom             VARCHAR(30)  NOT NULL UNIQUE,
  tag             VARCHAR(4)   NOT NULL UNIQUE,
  region          ENUM('Europe', 'Amérique', 'Asie') NOT NULL,
  discord         VARCHAR(50)  NULL,                      -- contact du capitaine
  email_capitaine VARCHAR(255) NULL,
  cree_par        INT UNSIGNED NULL,
  cree_le         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_equipes_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE joueurs (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipe_id INT UNSIGNED NOT NULL,
  pseudo    VARCHAR(20)  NOT NULL,
  role      ENUM('Duellist', 'Initiateur', 'Smoker', 'Sentinel') NOT NULL,
  position  TINYINT UNSIGNED NOT NULL,                    -- 1 à 5, le n°1 est le capitaine
  CONSTRAINT fk_joueurs_equipe FOREIGN KEY (equipe_id) REFERENCES equipes (id) ON DELETE CASCADE,
  CONSTRAINT uq_joueurs_position UNIQUE (equipe_id, position),
  CONSTRAINT uq_joueurs_pseudo   UNIQUE (equipe_id, pseudo),
  CONSTRAINT ck_joueurs_position CHECK (position BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tournois ────────────────────────────────────────────────
CREATE TABLE tournois (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom                   VARCHAR(60)  NOT NULL,
  statut                ENUM('upcoming', 'live', 'ended') NOT NULL DEFAULT 'upcoming',
  date_debut            DATETIME     NULL,
  format                ENUM('BO1', 'BO3', 'BO5') NOT NULL DEFAULT 'BO3',
  info                  VARCHAR(60)  NULL,                -- ex : « Serveur EU Ouest »
  cashprize             INT UNSIGNED NOT NULL DEFAULT 0,  -- en dollars
  places                TINYINT UNSIGNED NOT NULL DEFAULT 8,
  inscriptions_ouvertes BOOLEAN      NOT NULL DEFAULT FALSE,
  organisateur_id       INT UNSIGNED NULL,                -- propriétaire du tournoi
  cree_le               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tournois_orga FOREIGN KEY (organisateur_id) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT ck_tournois_places CHECK (places IN (4, 8, 16, 32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tournoi_equipes (
  tournoi_id  INT UNSIGNED NOT NULL,
  equipe_id   INT UNSIGNED NOT NULL,
  seed        TINYINT UNSIGNED NULL,                      -- tête de série (ordre dans l'arbre)
  inscrit_par INT UNSIGNED NULL,
  inscrit_le  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournoi_id, equipe_id),
  CONSTRAINT fk_te_tournoi FOREIGN KEY (tournoi_id)  REFERENCES tournois (id)     ON DELETE CASCADE,
  CONSTRAINT fk_te_equipe  FOREIGN KEY (equipe_id)   REFERENCES equipes (id)      ON DELETE CASCADE,
  CONSTRAINT fk_te_auteur  FOREIGN KEY (inscrit_par) REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT uq_te_seed UNIQUE (tournoi_id, seed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Matchs (élimination simple) ─────────────────────────────
--  tour 1 = premier tour, le dernier tour est la finale.
--  Le vainqueur du match (tour, n) va dans le match (tour + 1, ceil(n / 2)).
CREATE TABLE matchs (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tournoi_id   INT UNSIGNED NOT NULL,
  tour         TINYINT UNSIGNED NOT NULL,
  numero       TINYINT UNSIGNED NOT NULL,
  equipe1_id   INT UNSIGNED NULL,
  equipe2_id   INT UNSIGNED NULL,
  score1       TINYINT UNSIGNED NULL,
  score2       TINYINT UNSIGNED NULL,
  vainqueur_id INT UNSIGNED NULL,
  joue_le      DATETIME     NULL,
  CONSTRAINT fk_matchs_tournoi   FOREIGN KEY (tournoi_id)   REFERENCES tournois (id) ON DELETE CASCADE,
  CONSTRAINT fk_matchs_equipe1   FOREIGN KEY (equipe1_id)   REFERENCES equipes (id)  ON DELETE SET NULL,
  CONSTRAINT fk_matchs_equipe2   FOREIGN KEY (equipe2_id)   REFERENCES equipes (id)  ON DELETE SET NULL,
  CONSTRAINT fk_matchs_vainqueur FOREIGN KEY (vainqueur_id) REFERENCES equipes (id)  ON DELETE SET NULL,
  CONSTRAINT uq_matchs_position UNIQUE (tournoi_id, tour, numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Vues ────────────────────────────────────────────────────
-- Classement : 3 points par victoire, calculé à partir des matchs joués
CREATE VIEW v_classement AS
SELECT
  e.id, e.nom, e.tag, e.region,
  COUNT(CASE WHEN m.vainqueur_id = e.id THEN 1 END)  AS victoires,
  COUNT(CASE WHEN m.vainqueur_id <> e.id THEN 1 END) AS defaites,
  COUNT(CASE WHEN m.vainqueur_id = e.id THEN 1 END) * 3 AS points
FROM equipes e
LEFT JOIN matchs m                                      -- les byes (une seule équipe) ne comptent pas
  ON m.vainqueur_id IS NOT NULL AND m.equipe1_id IS NOT NULL AND m.equipe2_id IS NOT NULL
 AND e.id IN (m.equipe1_id, m.equipe2_id)
GROUP BY e.id, e.nom, e.tag, e.region;

-- Tournois avec nombre d'inscrits et progression (% de matchs joués)
CREATE VIEW v_tournois AS
SELECT
  t.*,
  u.pseudo AS organisateur,
  (SELECT COUNT(*) FROM tournoi_equipes te WHERE te.tournoi_id = t.id) AS nb_equipes,
  CASE
    WHEN t.statut = 'ended' THEN 100
    ELSE ROUND(100 * (SELECT COUNT(*) FROM matchs m WHERE m.tournoi_id = t.id AND m.vainqueur_id IS NOT NULL
                                          AND m.equipe1_id IS NOT NULL AND m.equipe2_id IS NOT NULL)
                    / (t.places - 1))
  END AS progression
FROM tournois t
LEFT JOIN utilisateurs u ON u.id = t.organisateur_id;


-- ============================================================
--  Données de démonstration (fausses équipes, tournois et matchs)
-- ============================================================

-- Comptes de démo : CHANGER LES MOTS DE PASSE avant toute mise en ligne.
--   admin@elix.tv  / Admin123!
--   orga@elix.tv   / Orga1234!
--   orga2@elix.tv  / Orga1234!
--   user@elix.tv   / User1234!
INSERT INTO utilisateurs (id, pseudo, email, mot_de_passe, role) VALUES
(1, 'Admin', 'admin@elix.tv', 'scrypt:32768:8:1$70kKFSRpVLC5APMc$9e39c5a48cfec85b5dcd83bd842c63634def01ce17b9ad73056382ffe26f7cde07d1ea0bcb54a1f8ef7b07bf1a19a44a58101da4ce35f73b4363fc9c20ab49a6', 'admin'),
(2, 'Orga', 'orga@elix.tv', 'scrypt:32768:8:1$mpNkUrRGTqlMt0Al$1787936447a7a56408471d5699a53ef0788dfdd91c5144170e819787961f0670b40af7a3d6d78f31f353d28f2031f340ef35c4f9dac4ac90f8e3ac476b8f83c1', 'organisateur'),
(3, 'Orga2', 'orga2@elix.tv', 'scrypt:32768:8:1$mpNkUrRGTqlMt0Al$1787936447a7a56408471d5699a53ef0788dfdd91c5144170e819787961f0670b40af7a3d6d78f31f353d28f2031f340ef35c4f9dac4ac90f8e3ac476b8f83c1', 'organisateur'),
(4, 'Spectateur', 'user@elix.tv', 'scrypt:32768:8:1$W5xFfJgsHRyQ4IS7$58cec56ebe4af607bb70b33f16bb9cb9afa73362f1bceb97f7104e2f0ca56f295deae86b07a42bafd0a7faccdd9901786b574e92edd9eb0d8cc64f150cfbf674', 'user');

INSERT INTO equipes (id, nom, tag, region, cree_par) VALUES
(1,  'Cyber Samurai',    'CSM', 'Europe',   1),
(2,  'Neon Titans',      'NTN', 'Europe',   1),
(3,  'Shadow Syndicate', 'SHS', 'Amérique', 1),
(4,  'Apex Predators',   'APX', 'Amérique', 1),
(5,  'Void Runners',     'VDR', 'Europe',   1),
(6,  'Crimson Lotus',    'CRL', 'Asie',     1),
(7,  'Iron Wolves',      'IWF', 'Europe',   1),
(8,  'Phantom Unit',     'PHU', 'Amérique', 1),
(9,  'Solar Flare',      'SLF', 'Asie',     1),
(10, 'Frost Legion',     'FRL', 'Europe',   1),
(11, 'Night Owls',       'NOW', 'Amérique', 1),
(12, 'Storm Breakers',   'STB', 'Europe',   1),
(13, 'Jade Dragons',     'JDD', 'Asie',     1),
(14, 'Pixel Reapers',    'PXR', 'Amérique', 1),
(15, 'Omega Squad',      'OMG', 'Europe',   1),
(16, 'Blaze Kings',      'BLK', 'Asie',     1);

INSERT INTO joueurs (equipe_id, pseudo, role, position) VALUES
(1, 'Vortex', 'Duellist', 1),   (1, 'Cipher', 'Duellist', 2),  (1, 'Kaze', 'Initiateur', 3),    (1, 'Ronin', 'Smoker', 4),   (1, 'Hikari', 'Sentinel', 5),
(2, 'Blitz', 'Duellist', 1),    (2, 'Nova', 'Duellist', 2),    (2, 'Atlas', 'Initiateur', 3),   (2, 'Aegis', 'Smoker', 4),   (2, 'Specter', 'Sentinel', 5),
(3, 'Wraith', 'Duellist', 1),   (3, 'Onyx', 'Duellist', 2),    (3, 'Raven', 'Initiateur', 3),   (3, 'Smog', 'Smoker', 4),    (3, 'Bastion', 'Sentinel', 5),
(4, 'Talon', 'Duellist', 1),    (4, 'Fang', 'Duellist', 2),    (4, 'Hunter', 'Initiateur', 3),  (4, 'Ash', 'Smoker', 4),     (4, 'Warden', 'Sentinel', 5),
(5, 'Drift', 'Duellist', 1),    (5, 'Echo', 'Duellist', 2),    (5, 'Pulse', 'Initiateur', 3),   (5, 'Haze', 'Smoker', 4),    (5, 'Keeper', 'Sentinel', 5),
(6, 'Sakura', 'Duellist', 1),   (6, 'Jin', 'Duellist', 2),     (6, 'Lotus', 'Initiateur', 3),   (6, 'Mist', 'Smoker', 4),    (6, 'Shield', 'Sentinel', 5),
(7, 'Fenrir', 'Duellist', 1),   (7, 'Lupo', 'Duellist', 2),    (7, 'Tracker', 'Initiateur', 3), (7, 'Fumo', 'Smoker', 4),    (7, 'Guard', 'Sentinel', 5),
(8, 'Ghost', 'Duellist', 1),    (8, 'Shade', 'Duellist', 2),   (8, 'Scout', 'Initiateur', 3),   (8, 'Veil', 'Smoker', 4),    (8, 'Lock', 'Sentinel', 5),
(9, 'Helios', 'Duellist', 1),   (9, 'Ray', 'Duellist', 2),     (9, 'Dawn', 'Initiateur', 3),    (9, 'Ember', 'Smoker', 4),   (9, 'Sol', 'Sentinel', 5),
(10, 'Glacier', 'Duellist', 1), (10, 'Rime', 'Duellist', 2),   (10, 'Polar', 'Initiateur', 3),  (10, 'Snow', 'Smoker', 4),   (10, 'Yeti', 'Sentinel', 5),
(11, 'Hoot', 'Duellist', 1),    (11, 'Luna', 'Duellist', 2),   (11, 'Dusk', 'Initiateur', 3),   (11, 'Gloom', 'Smoker', 4),  (11, 'Perch', 'Sentinel', 5),
(12, 'Thunder', 'Duellist', 1), (12, 'Bolt', 'Duellist', 2),   (12, 'Gale', 'Initiateur', 3),   (12, 'Cloud', 'Smoker', 4),  (12, 'Anchor', 'Sentinel', 5),
(13, 'Ryu', 'Duellist', 1),     (13, 'Jade', 'Duellist', 2),   (13, 'Long', 'Initiateur', 3),   (13, 'Smoke', 'Smoker', 4),  (13, 'Pearl', 'Sentinel', 5),
(14, 'Byte', 'Duellist', 1),    (14, 'Glitch', 'Duellist', 2), (14, 'Scythe', 'Initiateur', 3), (14, 'Pixel', 'Smoker', 4),  (14, 'Grim', 'Sentinel', 5),
(15, 'Omega', 'Duellist', 1),   (15, 'Delta', 'Duellist', 2),  (15, 'Sigma', 'Initiateur', 3),  (15, 'Theta', 'Smoker', 4),  (15, 'Alpha', 'Sentinel', 5),
(16, 'Blaze', 'Duellist', 1),   (16, 'Pyro', 'Duellist', 2),   (16, 'Inferno', 'Initiateur', 3),(16, 'Cinder', 'Smoker', 4), (16, 'Crown', 'Sentinel', 5);

INSERT INTO tournois (id, nom, statut, date_debut, format, info, cashprize, places, inscriptions_ouvertes, organisateur_id) VALUES
(1, 'Grand Finals 2026',       'live',     '2026-10-09 18:00:00', 'BO5', 'Serveur EU Ouest', 100000, 8,  FALSE, 2),
(2, 'Championship Qualifiers', 'upcoming', '2026-10-10 20:00:00', 'BO3', 'Open Bracket',      25000, 16, FALSE, 2),
(3, 'Rookie Showdown',         'ended',    '2026-09-20 18:00:00', 'BO1', 'Amateurs',           5000, 8,  FALSE, 3),
(4, 'Elix Winter Cup',         'upcoming', '2026-12-12 19:00:00', 'BO3', 'Serveur EU Ouest',  15000, 8,  TRUE,  2),
(5, 'Spring Clash 2027',       'upcoming', '2027-03-14 18:00:00', 'BO3', 'Open Bracket',      40000, 16, TRUE,  3),
(6, 'Masters Series #1',       'ended',    '2026-05-16 14:00:00', 'BO3', 'Serveur EU Ouest',  20000, 8,  FALSE, 2),
(7, 'Elix Summer Cup 2026',    'ended',    '2026-06-20 14:00:00', 'BO3', 'Open Bracket',      30000, 16, FALSE, 2),
(8, 'Autumn Open 2026',        'ended',    '2026-08-29 14:00:00', 'BO3', 'Open Bracket',      20000, 16, FALSE, 3);

-- Inscriptions (seed = ordre de tête de série)
INSERT INTO tournoi_equipes (tournoi_id, equipe_id, seed, inscrit_par) VALUES
(1, 1, 1, 2), (1, 2, 2, 2), (1, 3, 3, 2), (1, 4, 4, 2), (1, 5, 5, 2), (1, 6, 6, 2), (1, 7, 7, 2), (1, 8, 8, 2),
(2, 1, 1, 2),  (2, 2, 2, 2),  (2, 3, 3, 2),  (2, 4, 4, 2),  (2, 5, 5, 2),  (2, 6, 6, 2),  (2, 7, 7, 2),  (2, 8, 8, 2),
(2, 9, 9, 2),  (2, 10, 10, 2), (2, 11, 11, 2), (2, 12, 12, 2), (2, 13, 13, 2), (2, 14, 14, 2), (2, 15, 15, 2), (2, 16, 16, 2),
(3, 9, 1, 3), (3, 10, 2, 3), (3, 11, 3, 3), (3, 12, 4, 3), (3, 13, 5, 3), (3, 14, 6, 3), (3, 15, 7, 3), (3, 16, 8, 3),
(4, 5, 1, 2), (4, 10, 2, 2), (4, 12, 3, 2), (4, 7, 4, 2), (4, 15, 5, 2),
(5, 6, 1, 3), (5, 13, 2, 3), (5, 11, 3, 3), (5, 14, 4, 3),
(6, 1, 1, 2), (6, 2, 2, 2), (6, 3, 3, 2), (6, 4, 4, 2), (6, 5, 5, 2), (6, 6, 6, 2), (6, 7, 7, 2), (6, 8, 8, 2),
(7, 1, 1, 2), (7, 2, 2, 2), (7, 3, 3, 2), (7, 4, 4, 2), (7, 5, 5, 2), (7, 6, 6, 2), (7, 7, 7, 2), (7, 8, 8, 2), (7, 9, 9, 2), (7, 10, 10, 2), (7, 11, 11, 2), (7, 12, 12, 2), (7, 13, 13, 2), (7, 14, 14, 2), (7, 15, 15, 2), (7, 16, 16, 2),
(8, 12, 1, 3), (8, 5, 2, 3), (8, 11, 3, 3), (8, 6, 4, 3), (8, 8, 5, 3), (8, 15, 6, 3), (8, 14, 7, 3), (8, 7, 8, 3), (8, 2, 9, 3), (8, 9, 10, 3), (8, 16, 11, 3), (8, 3, 12, 3), (8, 13, 13, 3), (8, 4, 14, 3), (8, 10, 15, 3), (8, 1, 16, 3);

-- Rookie Showdown (terminé) : appariements 1v8, 4v5, 2v7, 3v6
INSERT INTO matchs (tournoi_id, tour, numero, equipe1_id, equipe2_id, score1, score2, vainqueur_id, joue_le) VALUES
(3, 1, 1, 9,  16, 13, 7,  9,  '2026-09-20 18:00:00'),
(3, 1, 2, 12, 13, 13, 10, 12, '2026-09-20 18:00:00'),
(3, 1, 3, 10, 15, 13, 6,  10, '2026-09-20 19:00:00'),
(3, 1, 4, 11, 14, 11, 13, 14, '2026-09-20 19:00:00'),
(3, 2, 1, 9,  12, 9,  13, 12, '2026-09-20 20:00:00'),
(3, 2, 2, 10, 14, 13, 8,  10, '2026-09-20 20:00:00'),
(3, 3, 1, 12, 10, 11, 13, 10, '2026-09-20 21:00:00');

-- Grand Finals (en cours) : quarts joués, une demie jouée
INSERT INTO matchs (tournoi_id, tour, numero, equipe1_id, equipe2_id, score1, score2, vainqueur_id, joue_le) VALUES
(1, 1, 1, 1, 8, 3, 1, 1, '2026-10-09 18:00:00'),
(1, 1, 2, 4, 5, 3, 2, 4, '2026-10-09 18:00:00'),
(1, 1, 3, 2, 7, 3, 0, 2, '2026-10-09 19:30:00'),
(1, 1, 4, 3, 6, 3, 1, 3, '2026-10-09 19:30:00'),
(1, 2, 1, 1, 4, 3, 1, 1, '2026-10-09 21:00:00'),
(1, 2, 2, 2, 3, NULL, NULL, NULL, NULL),
(1, 3, 1, 1, NULL, NULL, NULL, NULL, NULL);

-- Historique de la saison (matchs générés aléatoirement, favoris avantagés)
INSERT INTO matchs (tournoi_id, tour, numero, equipe1_id, equipe2_id, score1, score2, vainqueur_id, joue_le) VALUES
(6, 1, 1, 1, 8, 0, 2, 8, '2026-05-16 14:00:00'),
(6, 1, 2, 4, 5, 2, 1, 4, '2026-05-16 14:00:00'),
(6, 1, 3, 2, 7, 2, 1, 2, '2026-05-16 14:00:00'),
(6, 1, 4, 3, 6, 2, 1, 3, '2026-05-16 14:00:00'),
(6, 2, 1, 8, 4, 2, 0, 8, '2026-05-16 16:00:00'),
(6, 2, 2, 2, 3, 0, 2, 3, '2026-05-16 16:00:00'),
(6, 3, 1, 8, 3, 1, 2, 3, '2026-05-16 18:00:00'),
(7, 1, 1, 1, 16, 2, 0, 1, '2026-06-20 14:00:00'),
(7, 1, 2, 8, 9, 2, 1, 8, '2026-06-20 14:00:00'),
(7, 1, 3, 4, 13, 2, 1, 4, '2026-06-20 14:00:00'),
(7, 1, 4, 5, 12, 2, 0, 5, '2026-06-20 14:00:00'),
(7, 1, 5, 2, 15, 2, 0, 2, '2026-06-20 15:00:00'),
(7, 1, 6, 7, 10, 2, 1, 7, '2026-06-20 15:00:00'),
(7, 1, 7, 3, 14, 2, 0, 3, '2026-06-20 15:00:00'),
(7, 1, 8, 6, 11, 2, 1, 6, '2026-06-20 15:00:00'),
(7, 2, 1, 1, 8, 1, 2, 8, '2026-06-20 16:00:00'),
(7, 2, 2, 4, 5, 2, 1, 4, '2026-06-20 16:00:00'),
(7, 2, 3, 2, 7, 1, 2, 7, '2026-06-20 16:00:00'),
(7, 2, 4, 3, 6, 2, 1, 3, '2026-06-20 16:00:00'),
(7, 3, 1, 8, 4, 1, 2, 4, '2026-06-20 18:00:00'),
(7, 3, 2, 7, 3, 1, 2, 3, '2026-06-20 18:00:00'),
(7, 4, 1, 4, 3, 1, 2, 3, '2026-06-20 20:00:00'),
(8, 1, 1, 12, 1, 1, 2, 1, '2026-08-29 14:00:00'),
(8, 1, 2, 7, 2, 1, 2, 2, '2026-08-29 14:00:00'),
(8, 1, 3, 6, 13, 2, 1, 6, '2026-08-29 14:00:00'),
(8, 1, 4, 8, 3, 1, 2, 3, '2026-08-29 14:00:00'),
(8, 1, 5, 5, 10, 2, 1, 5, '2026-08-29 15:00:00'),
(8, 1, 6, 14, 9, 0, 2, 9, '2026-08-29 15:00:00'),
(8, 1, 7, 11, 4, 2, 1, 11, '2026-08-29 15:00:00'),
(8, 1, 8, 15, 16, 2, 1, 15, '2026-08-29 15:00:00'),
(8, 2, 1, 1, 2, 2, 0, 1, '2026-08-29 16:00:00'),
(8, 2, 2, 6, 3, 1, 2, 3, '2026-08-29 16:00:00'),
(8, 2, 3, 5, 9, 2, 1, 5, '2026-08-29 16:00:00'),
(8, 2, 4, 11, 15, 2, 0, 11, '2026-08-29 16:00:00'),
(8, 3, 1, 1, 3, 2, 1, 1, '2026-08-29 18:00:00'),
(8, 3, 2, 5, 11, 2, 0, 5, '2026-08-29 18:00:00'),
(8, 4, 1, 1, 5, 2, 1, 1, '2026-08-29 20:00:00')
;

-- Championship Qualifiers : arbre généré, aucun match joué
INSERT INTO matchs (tournoi_id, tour, numero, equipe1_id, equipe2_id) VALUES
(2, 1, 1, 1, 16),
(2, 1, 2, 8, 9),
(2, 1, 3, 4, 13),
(2, 1, 4, 5, 12),
(2, 1, 5, 2, 15),
(2, 1, 6, 7, 10),
(2, 1, 7, 3, 14),
(2, 1, 8, 6, 11),
(2, 2, 1, NULL, NULL),
(2, 2, 2, NULL, NULL),
(2, 2, 3, NULL, NULL),
(2, 2, 4, NULL, NULL),
(2, 3, 1, NULL, NULL),
(2, 3, 2, NULL, NULL),
(2, 4, 1, NULL, NULL);
