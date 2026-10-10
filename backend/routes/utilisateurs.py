"""Gestion des comptes : réservée aux admins.

Il n'y a pas d'inscription publique : seuls les admins créent les comptes.
"""

import re

from flask import Blueprint, g, jsonify
from werkzeug.security import generate_password_hash

from ..auth import ADMIN, ROLES, roles_required
from ..db import execute, fetch_all, fetch_one
from ..errors import ApiError, json_body

EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
MIN_PASSWORD = 8

bp = Blueprint("utilisateurs", __name__, url_prefix="/api/utilisateurs")

COLONNES = "id, pseudo, email, role, actif, derniere_connexion, cree_le"


def _validate_password(password):
    if len(password or "") < MIN_PASSWORD:
        raise ApiError(f"Le mot de passe doit contenir au moins {MIN_PASSWORD} caractères.")


def _get_or_404(user_id):
    user = fetch_one(f"SELECT {COLONNES} FROM utilisateurs WHERE id = %s", (user_id,))
    if user is None:
        raise ApiError("Compte introuvable.", 404)
    return user


@bp.get("")
@roles_required(ADMIN)
def list_utilisateurs():
    return jsonify(fetch_all(f"SELECT {COLONNES} FROM utilisateurs ORDER BY role, pseudo"))


@bp.post("")
@roles_required(ADMIN)
def create_utilisateur():
    data = json_body("pseudo", "email", "password")
    pseudo = data["pseudo"].strip()
    email = data["email"].strip().lower()
    role = data.get("role", "user")

    if not 3 <= len(pseudo) <= 20:
        raise ApiError("Le pseudo doit faire entre 3 et 20 caractères.")
    if not EMAIL_RE.fullmatch(email):
        raise ApiError("Email invalide.")
    if role not in ROLES:
        raise ApiError("Rôle invalide (admin, organisateur ou user).")
    _validate_password(data["password"])

    user_id = execute(
        "INSERT INTO utilisateurs (pseudo, email, mot_de_passe, role) VALUES (%s, %s, %s, %s)",
        (pseudo, email, generate_password_hash(data["password"]), role),
    )
    return jsonify(_get_or_404(user_id)), 201


@bp.put("/<int:user_id>")
@roles_required(ADMIN)
def update_utilisateur(user_id):
    """Champs modifiables : role, actif, password (réinitialisation)."""
    _get_or_404(user_id)
    data = json_body()

    if user_id == g.user["id"] and (data.get("role", ADMIN) != ADMIN or data.get("actif") is False):
        raise ApiError("Tu ne peux pas retirer tes propres droits d'admin.", 409)

    if "role" in data:
        if data["role"] not in ROLES:
            raise ApiError("Rôle invalide (admin, organisateur ou user).")
        execute("UPDATE utilisateurs SET role = %s WHERE id = %s", (data["role"], user_id))
    if "actif" in data:
        execute("UPDATE utilisateurs SET actif = %s WHERE id = %s", (bool(data["actif"]), user_id))
    if "password" in data:
        _validate_password(data["password"])
        execute(
            "UPDATE utilisateurs SET mot_de_passe = %s WHERE id = %s",
            (generate_password_hash(data["password"]), user_id),
        )
    return jsonify(_get_or_404(user_id))


@bp.delete("/<int:user_id>")
@roles_required(ADMIN)
def delete_utilisateur(user_id):
    if user_id == g.user["id"]:
        raise ApiError("Tu ne peux pas supprimer ton propre compte.", 409)
    _get_or_404(user_id)
    # Ses tournois et équipes restent (organisateur_id / cree_par passent à NULL)
    execute("DELETE FROM utilisateurs WHERE id = %s", (user_id,))
    return jsonify(ok=True)
