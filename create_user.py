"""Crée un compte depuis le terminal (utile pour le tout premier admin).

    python create_user.py --pseudo Admin --email admin@elix.tv --role admin

Changer le mot de passe d'un compte existant (ex. les comptes de démo) :

    python create_user.py --reset --email orga@elix.tv

Le mot de passe est demandé au clavier (il n'apparaît pas dans l'historique).
"""

import argparse
import getpass
import sys

from mysql.connector.errors import IntegrityError
from werkzeug.security import generate_password_hash

from backend.auth import ROLES
from backend.config import Config
from backend.db import execute, fetch_one, init_pool


def ask_password():
    password = getpass.getpass("Mot de passe : ")
    if len(password) < 8:
        sys.exit("Le mot de passe doit contenir au moins 8 caractères.")
    if getpass.getpass("Confirmation : ") != password:
        sys.exit("Les mots de passe ne correspondent pas.")
    return generate_password_hash(password)


def main():
    parser = argparse.ArgumentParser(description="Créer un compte ELIXTV ou changer son mot de passe")
    parser.add_argument("--email", required=True)
    parser.add_argument("--pseudo", help="obligatoire pour créer un compte")
    parser.add_argument("--role", choices=ROLES, default="user")
    parser.add_argument("--reset", action="store_true", help="changer le mot de passe d'un compte existant")
    args = parser.parse_args()
    email = args.email.strip().lower()

    if not args.reset and not args.pseudo:
        parser.error("--pseudo est obligatoire pour créer un compte")

    init_pool(Config)

    if args.reset:
        user = fetch_one("SELECT id, pseudo FROM utilisateurs WHERE email = %s", (email,))
        if user is None:
            sys.exit("Aucun compte avec cet email.")
        execute("UPDATE utilisateurs SET mot_de_passe = %s WHERE id = %s", (ask_password(), user["id"]))
        print(f"Mot de passe de « {user['pseudo']} » modifié.")
        return

    try:
        user_id = execute(
            "INSERT INTO utilisateurs (pseudo, email, mot_de_passe, role) VALUES (%s, %s, %s, %s)",
            (args.pseudo.strip(), email, ask_password(), args.role),
        )
    except IntegrityError:
        sys.exit("Ce pseudo ou cet email est déjà utilisé.")
    print(f"Compte {args.role} « {args.pseudo} » créé (id {user_id}).")


if __name__ == "__main__":
    main()
