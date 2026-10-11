#!/usr/bin/env bash
# Installation et mise à jour d'ElixTV sur alwaysdata.
#
# À lancer en SSH sur ton compte alwaysdata (ssh TONCOMPTE@ssh-TONCOMPTE.alwaysdata.net) :
#   bash <(curl -sL https://raw.githubusercontent.com/rinit44/esport_elix/main/deploy/alwaysdata.sh)
#
# Avant le premier lancement (administration alwaysdata) :
#   1. Bases de données > MySQL : donner un mot de passe à l'utilisateur MySQL
#      et créer la base TONCOMPTE_elix
#   2. Accès distant > SSH : autoriser la connexion par mot de passe
#
# Relancer le même script plus tard met le code à jour (git pull) sans toucher
# à la base. Il faut ensuite redémarrer le site depuis Web > Sites.

set -euo pipefail

REPO="https://github.com/rinit44/esport_elix.git"
ACCOUNT="$(whoami)"
APP_DIR="$HOME/esport_elix"
VENV="$APP_DIR/.venv"
DB_HOST="mysql-$ACCOUNT.alwaysdata.net"
DB_NAME="${ACCOUNT}_elix"

step() { printf '\n\033[1;31m==>\033[0m \033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErreur :\033[0m %s\n' "$1" >&2; exit 1; }

# ── 1. Code ─────────────────────────────────────────────────
step "Récupération du code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi

# ── 2. Python et dépendances ────────────────────────────────
step "Environnement Python"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
PY=$("$VENV/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
"$VENV/bin/python" -m pip install -q --disable-pip-version-check -r "$APP_DIR/requirements.txt"
echo "Python $PY prêt."

# ── 3. Fichier .env ─────────────────────────────────────────
step "Configuration (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  read -rp "Utilisateur MySQL (Entrée pour « $ACCOUNT ») : " DB_USER
  DB_USER=${DB_USER:-$ACCOUNT}
  read -rsp "Mot de passe de cet utilisateur MySQL : " DB_PASSWORD; echo
  SECRET=$("$VENV/bin/python" -c 'import secrets; print(secrets.token_hex(32))')
  umask 077
  cat > "$APP_DIR/.env" <<EOF
SECRET_KEY=$SECRET
DB_HOST=$DB_HOST
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD='$DB_PASSWORD'
DB_NAME=$DB_NAME
DB_POOL_SIZE=2
SESSION_COOKIE_SECURE=1
EOF
  umask 022
  echo ".env créé."
else
  echo ".env déjà présent : conservé."
fi

# Identifiants relus depuis le .env et passés au client mysql par un fichier
# d'options temporaire (lisible par toi seul) : jamais dans la ligne de commande.
MYCNF=$(mktemp)
trap 'rm -f "$MYCNF"' EXIT
chmod 600 "$MYCNF"
(cd "$APP_DIR" && "$VENV/bin/python" - <<'PY'
import sys
from dotenv import dotenv_values
v = dotenv_values(".env")
if "\\" in v["DB_PASSWORD"]:
    sys.exit("Le mot de passe MySQL ne doit pas contenir de « \\ ». Change-le dans "
             "Bases de données > MySQL, puis : rm ~/esport_elix/.env et relance.")
password = v["DB_PASSWORD"].replace('"', '\\"')
print("[client]")
print("host=" + v["DB_HOST"])
print("user=" + v["DB_USER"])
print('password="' + password + '"')
print("default-character-set=utf8mb4")
PY
) > "$MYCNF"
db() { mysql --defaults-extra-file="$MYCNF" "$@"; }
DB_USER=$(sed -n 's/^user=//p' "$MYCNF")

# ── 4. Base de données ──────────────────────────────────────
step "Base de données $DB_NAME"
db "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1 \
  || fail "Connexion MySQL impossible. Vérifie dans Bases de données > MySQL que la base
« $DB_NAME » existe et que l'utilisateur « $DB_USER » a les droits dessus.
Si tu t'es trompé de mot de passe : rm ~/esport_elix/.env puis relance."

FIRST_IMPORT=0
if [ -z "$(db -N "$DB_NAME" -e "SHOW TABLES LIKE 'utilisateurs'")" ]; then
  db "$DB_NAME" < "$APP_DIR/database.sql"
  FIRST_IMPORT=1
  echo "Tables et fausses données importées."
else
  echo "Base déjà remplie : conservée telle quelle."
fi

# ── 5. Mots de passe des comptes de démo ────────────────────
# Ceux de database.sql sont publics (dépôt GitHub) : on les remplace tous.
PASSWORDS_FILE="$HOME/elix_mots_de_passe.txt"
if [ "$FIRST_IMPORT" = 1 ]; then
  step "Nouveaux mots de passe des comptes"
  (umask 077; cd "$APP_DIR" && "$VENV/bin/python" - > "$PASSWORDS_FILE" <<'PY'
import secrets
from werkzeug.security import generate_password_hash
from backend.config import Config
from backend.db import execute, fetch_all, init_pool

init_pool(Config)
for u in fetch_all("SELECT id, email, role FROM utilisateurs ORDER BY id"):
    password = secrets.token_urlsafe(9)
    execute("UPDATE utilisateurs SET mot_de_passe = %s WHERE id = %s",
            (generate_password_hash(password), u["id"]))
    print(f"{u['role']:<13} {u['email']:<18} {password}")
PY
  )
  cat "$PASSWORDS_FILE"
fi

# ── 6. Vérification : l'application démarre ────────────────
step "Vérification de l'application"
(cd "$APP_DIR" && "$VENV/bin/python" -c "
from wsgi import application
r = application.test_client().get('/connexion.html')
assert r.status_code == 200, r.status_code
print('Application OK.')")

# ── Fin ─────────────────────────────────────────────────────
step "Terminé"
cat <<EOF
Dans l'administration alwaysdata, Web > Sites, modifie le site
« $ACCOUNT.alwaysdata.net » (ou ajoute-le) avec :

  Type                       : Python WSGI
  Chemin de l'application    : $APP_DIR/wsgi.py
  Répertoire de travail      : $APP_DIR
  Répertoire du virtualenv   : $VENV
  Version de Python          : $PY

Puis enregistre (et redémarre le site s'il existait déjà).
Ton site : https://$ACCOUNT.alwaysdata.net
EOF
if [ "$FIRST_IMPORT" = 1 ]; then
  echo
  echo "Les mots de passe ci-dessus sont aussi dans $PASSWORDS_FILE."
  echo "Note-les, puis supprime ce fichier : rm $PASSWORDS_FILE"
fi
