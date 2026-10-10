#!/usr/bin/env bash
# Installation et mise à jour d'ElixTV sur PythonAnywhere.
#
# À coller dans une console Bash PythonAnywhere :
#   bash <(curl -sL https://raw.githubusercontent.com/rinit44/esport_elix/main/deploy/pythonanywhere.sh)
#
# Avant le premier lancement (sur le site PythonAnywhere) :
#   1. Databases : choisir un mot de passe MySQL et créer la base « elix »
#   2. Account > API Token : créer un jeton d'API
#
# Relancer le même script plus tard met le site à jour (git pull + reload)
# sans toucher à la base de données.

set -euo pipefail

REPO="https://github.com/rinit44/esport_elix.git"
PA_USER="$(whoami)"
APP_DIR="$HOME/esport_elix"
VENV="$HOME/.virtualenvs/elix"
DB_NAME="${PA_USER}\$elix"

step() { printf '\n\033[1;31m==>\033[0m \033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErreur :\033[0m %s\n' "$1" >&2; exit 1; }

# ── 1. Jeton d'API et région (www = US, eu = Europe) ─────────
step "Connexion à l'API PythonAnywhere"
if [ -z "${API_TOKEN:-}" ]; then
  echo "Jeton introuvable dans la console. Copie-le depuis Account > API Token."
  read -rsp "Colle ton jeton d'API puis Entrée : " API_TOKEN; echo
fi

API_HOST=""
for host in www.pythonanywhere.com eu.pythonanywhere.com; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Token $API_TOKEN" \
    "https://$host/api/v0/user/$PA_USER/cpu/")
  if [ "$code" = 200 ]; then API_HOST=$host; break; fi
done
[ -n "$API_HOST" ] || fail "Jeton d'API refusé. Recrée-le dans Account > API Token et relance."

if [ "$API_HOST" = eu.pythonanywhere.com ]; then
  DOMAIN="$PA_USER.eu.pythonanywhere.com"
  DB_HOST="$PA_USER.mysql.eu.pythonanywhere-services.com"
else
  DOMAIN="$PA_USER.pythonanywhere.com"
  DB_HOST="$PA_USER.mysql.pythonanywhere-services.com"
fi
API="https://$API_HOST/api/v0/user/$PA_USER"
echo "Compte $PA_USER ($API_HOST), site : https://$DOMAIN"

# Appel d'API qui s'arrête avec le message du serveur en cas d'échec
call() {
  local method=$1 url=$2; shift 2
  local out code
  out=$(mktemp)
  code=$(curl -s -o "$out" -w '%{http_code}' -H "Authorization: Token $API_TOKEN" -X "$method" "$url" "$@")
  if [ "${code:0:1}" != 2 ]; then
    cat "$out" >&2; rm -f "$out"
    fail "L'API a refusé $method $url (HTTP $code)."
  fi
  rm -f "$out"
}

# ── 2. Code ─────────────────────────────────────────────────
step "Récupération du code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi

# ── 3. Python et dépendances ────────────────────────────────
step "Environnement Python"
if [ ! -x "$VENV/bin/python" ]; then
  PY=""
  for v in 3.13 3.12 3.11 3.10; do
    if command -v "python$v" >/dev/null; then PY=$v; break; fi
  done
  [ -n "$PY" ] || fail "Aucune version de Python 3.10 ou plus récente trouvée."
  "python$PY" -m venv "$VENV"
fi
PY=$("$VENV/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
"$VENV/bin/pip" install -q --disable-pip-version-check -r "$APP_DIR/requirements.txt"
echo "Python $PY prêt."

# ── 4. Fichier .env ─────────────────────────────────────────
step "Configuration (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  read -rsp "Mot de passe MySQL (celui choisi dans l'onglet Databases) : " DB_PASSWORD; echo
  SECRET=$("$VENV/bin/python" -c 'import secrets; print(secrets.token_hex(32))')
  umask 077
  cat > "$APP_DIR/.env" <<EOF
SECRET_KEY=$SECRET
DB_HOST=$DB_HOST
DB_PORT=3306
DB_USER=$PA_USER
DB_PASSWORD='$DB_PASSWORD'
DB_NAME='$DB_NAME'
DB_POOL_SIZE=2
SESSION_COOKIE_SECURE=1
EOF
  umask 022
  echo ".env créé."
else
  echo ".env déjà présent : conservé."
fi
DB_PASSWORD=$(cd "$APP_DIR" && "$VENV/bin/python" -c \
  "from dotenv import dotenv_values; print(dotenv_values('.env')['DB_PASSWORD'])")
export MYSQL_PWD="$DB_PASSWORD"  # évite d'écrire le mot de passe dans la ligne de commande

# ── 5. Base de données ──────────────────────────────────────
step "Base de données $DB_NAME"
if ! mysql -h "$DB_HOST" -u "$PA_USER" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1; then
  mysql -h "$DB_HOST" -u "$PA_USER" \
    -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" 2>/dev/null \
    || fail "Connexion MySQL impossible. Vérifie dans l'onglet Databases que tu as bien choisi un mot de passe
et créé la base « elix ». Si tu t'es trompé de mot de passe : rm ~/esport_elix/.env puis relance."
fi

FIRST_IMPORT=0
if [ -z "$(mysql -N -h "$DB_HOST" -u "$PA_USER" "$DB_NAME" -e "SHOW TABLES LIKE 'utilisateurs'")" ]; then
  mysql --default-character-set=utf8mb4 -h "$DB_HOST" -u "$PA_USER" "$DB_NAME" < "$APP_DIR/database.sql"
  FIRST_IMPORT=1
  echo "Tables et fausses données importées."
else
  echo "Base déjà remplie : conservée telle quelle."
fi

# ── 6. Mots de passe des comptes de démo ────────────────────
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

# ── 7. Application web ──────────────────────────────────────
step "Site web $DOMAIN"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Token $API_TOKEN" "$API/webapps/$DOMAIN/")
if [ "$code" = 404 ]; then
  call POST "$API/webapps/" -d "domain_name=$DOMAIN" -d "python_version=python${PY/./}"
  echo "Application web créée."
fi
call PATCH "$API/webapps/$DOMAIN/" \
  -d "python_version=python${PY/./}" \
  -d "source_directory=$APP_DIR" \
  -d "virtualenv_path=$VENV" \
  -d "force_https=true"

cat > "/var/www/${DOMAIN//./_}_wsgi.py" <<EOF
# Généré par deploy/pythonanywhere.sh
import sys

path = "$APP_DIR"
if path not in sys.path:
    sys.path.insert(0, path)

from app import create_app
application = create_app()
EOF

call POST "$API/webapps/$DOMAIN/reload/"

# ── Fin ─────────────────────────────────────────────────────
step "Terminé"
echo "Ton site : https://$DOMAIN"
if [ "$FIRST_IMPORT" = 1 ]; then
  echo
  echo "Les mots de passe ci-dessus sont aussi dans $PASSWORDS_FILE."
  echo "Note-les, puis supprime ce fichier : rm $PASSWORDS_FILE"
fi
echo "En cas d'erreur sur le site : onglet Web > Error log."
