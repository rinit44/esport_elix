"""Connexion / déconnexion et contrôle des rôles.

Rôles :
    admin        : tout, y compris la gestion des comptes
    organisateur : crée des tournois et ne gère que les siens
    user         : consultation seule
"""

from functools import wraps

from flask import Blueprint, g, jsonify, redirect, request, session, url_for
from werkzeug.security import check_password_hash

from .db import execute, fetch_one
from .errors import ApiError, json_body

ADMIN = "admin"
ORGA = "organisateur"
USER = "user"
ROLES = (ADMIN, ORGA, USER)
GESTIONNAIRES = (ADMIN, ORGA)  # peuvent créer / modifier des tournois

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def public_user(u):
    return {"id": u["id"], "pseudo": u["pseudo"], "email": u["email"], "role": u["role"]}


def load_user():
    """Relit le compte à chaque requête : un changement de rôle ou une
    désactivation s'applique tout de suite, sans attendre la déconnexion."""
    g.user = None
    user_id = session.get("user_id")
    if user_id is None:
        return
    user = fetch_one(
        "SELECT id, pseudo, email, role FROM utilisateurs WHERE id = %s AND actif = TRUE",
        (user_id,),
    )
    if user is None:
        session.clear()
    g.user = user


# ── Décorateurs ─────────────────────────────────────────────
def _refuse(status):
    if request.path.startswith("/api/"):
        message = "Connexion requise." if status == 401 else "Accès refusé."
        return jsonify(erreur=message), status
    if status == 401:
        return redirect(url_for("connexion", next=request.full_path.rstrip("?")))
    return redirect(url_for("index"))


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return _refuse(401)
        return view(*args, **kwargs)
    return wrapper


def roles_required(*roles):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if g.user is None:
                return _refuse(401)
            if g.user["role"] not in roles:
                return _refuse(403)
            return view(*args, **kwargs)
        return wrapper
    return decorator


def check_owner(tournoi):
    """Un organisateur ne gère que ses propres tournois, l'admin gère tout."""
    if g.user["role"] == ADMIN:
        return
    if g.user["role"] == ORGA and tournoi["organisateur_id"] == g.user["id"]:
        return
    raise ApiError("Ce tournoi appartient à un autre organisateur.", 403)


# ── Routes ──────────────────────────────────────────────────
@bp.post("/login")
def login():
    data = json_body("email", "password")
    user = fetch_one(
        "SELECT * FROM utilisateurs WHERE email = %s AND actif = TRUE",
        (data["email"].strip().lower(),),
    )
    if user is None or not check_password_hash(user["mot_de_passe"], data["password"]):
        raise ApiError("Email ou mot de passe incorrect.", 401)

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = bool(data.get("remember"))
    execute("UPDATE utilisateurs SET derniere_connexion = NOW() WHERE id = %s", (user["id"],))
    return jsonify(utilisateur=public_user(user))


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@bp.get("/me")
@login_required
def me():
    return jsonify(utilisateur=public_user(g.user))
