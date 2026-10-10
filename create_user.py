"""Crée un compte depuis le terminal (utile pour le tout premier admin).

    python create_user.py --pseudo Admin --email admin@elix.tv --role admin

Le mot de passe est demandé au clavier (il n'apparaît pas dans l'historique).
"""

import argparse
import getpass
import sys

from mysql.connector.errors import IntegrityError
from werkzeug.security import generate_password_hash

from backend.auth import ROLES
from backend.config import Config
from backend.db import execute, init_pool


def main():
    parser = argparse.ArgumentParser(description="Créer un compte ELIXTV")
    parser.add_argument("--pseudo", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=ROLES, default="user")
    args = parser.parse_args()

    password = getpass.getpass("Mot de passe : ")
    if len(password) < 8:
        sys.exit("Le mot de passe doit contenir au moins 8 caractères.")
    if getpass.getpass("Confirmation : ") != password:
        sys.exit("Les mots de passe ne correspondent pas.")

    init_pool(Config)
    try:
        user_id = execute(
            "INSERT INTO utilisateurs (pseudo, email, mot_de_passe, role) VALUES (%s, %s, %s, %s)",
            (args.pseudo.strip(), args.email.strip().lower(), generate_password_hash(password), args.role),
        )
    except IntegrityError:
        sys.exit("Ce pseudo ou cet email est déjà utilisé.")
    print(f"Compte {args.role} « {args.pseudo} » créé (id {user_id}).")


if __name__ == "__main__":
    main()
