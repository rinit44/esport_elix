"""Équipes, joueurs et classement.

Lecture : tous les comptes connectés.
Création : organisateurs et admins. Modification : créateur de l'équipe ou admin.
Suppression : admin.
"""

import re

from flask import Blueprint, g, jsonify

from ..auth import ADMIN, GESTIONNAIRES, login_required, roles_required
from ..db import execute, fetch_all, fetch_one, transaction
from ..errors import ApiError, json_body

REGIONS = ("Europe", "Amérique", "Asie")
ROLES_JOUEUR = ("Duellist", "Initiateur", "Smoker", "Sentinel")
NB_JOUEURS = 5

bp = Blueprint("equipes", __name__, url_prefix="/api")


# ── Helpers ─────────────────────────────────────────────────
def _with_joueurs(equipes):
    """Ajoute la liste des joueurs (triée par position) à chaque équipe."""
    if not equipes:
        return equipes
    ids = [e["id"] for e in equipes]
    placeholders = ", ".join(["%s"] * len(ids))
    joueurs = fetch_all(
        f"SELECT equipe_id, pseudo, role, position FROM joueurs "
        f"WHERE equipe_id IN ({placeholders}) ORDER BY equipe_id, position",
        ids,
    )
    for e in equipes:
        e["joueurs"] = [
            {"pseudo": j["pseudo"], "role": j["role"]} for j in joueurs if j["equipe_id"] == e["id"]
        ]
    return equipes


def _get_equipe_or_404(equipe_id):
    equipe = fetch_one("SELECT * FROM equipes WHERE id = %s", (equipe_id,))
    if equipe is None:
        raise ApiError("Équipe introuvable.", 404)
    return equipe


def validate_equipe(data):
    nom = str(data.get("nom", "")).strip()
    tag = str(data.get("tag", "")).strip().upper()
    if not 3 <= len(nom) <= 30:
        raise ApiError("Le nom d'équipe doit faire entre 3 et 30 caractères.")
    if not re.fullmatch(r"[A-Z0-9]{2,4}", tag):
        raise ApiError("Le tag doit faire 2 à 4 lettres ou chiffres.")
    if data.get("region") not in REGIONS:
        raise ApiError("Région invalide.")

    joueurs = data.get("joueurs")
    if not isinstance(joueurs, list) or len(joueurs) != NB_JOUEURS:
        raise ApiError(f"Une équipe compte exactement {NB_JOUEURS} joueurs.")
    for j in joueurs:
        if not 2 <= len(str(j.get("pseudo", "")).strip()) <= 20:
            raise ApiError("Chaque pseudo doit faire entre 2 et 20 caractères.")
        if j.get("role") not in ROLES_JOUEUR:
            raise ApiError("Rôle de joueur invalide.")

    return {
        "nom": nom,
        "tag": tag,
        "region": data["region"],
        "discord": (data.get("discord") or "").strip() or None,
        "email": (data.get("email") or "").strip().lower() or None,
        "joueurs": [{"pseudo": j["pseudo"].strip(), "role": j["role"]} for j in joueurs],
    }


def insert_equipe(cur, equipe):
    """Insère une équipe validée et ses joueurs dans la transaction en cours."""
    cur.execute(
        "INSERT INTO equipes (nom, tag, region, discord, email_capitaine, cree_par) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (equipe["nom"], equipe["tag"], equipe["region"], equipe["discord"], equipe["email"], g.user["id"]),
    )
    equipe_id = cur.lastrowid
    cur.executemany(
        "INSERT INTO joueurs (equipe_id, pseudo, role, position) VALUES (%s, %s, %s, %s)",
        [(equipe_id, j["pseudo"], j["role"], i + 1) for i, j in enumerate(equipe["joueurs"])],
    )
    return equipe_id


# ── Routes ──────────────────────────────────────────────────
@bp.get("/equipes")
@login_required
def list_equipes():
    equipes = fetch_all("SELECT * FROM v_classement ORDER BY nom")
    return jsonify(_with_joueurs(equipes))


@bp.get("/equipes/<int:equipe_id>")
@login_required
def get_equipe(equipe_id):
    equipe = fetch_one("SELECT * FROM v_classement WHERE id = %s", (equipe_id,))
    if equipe is None:
        raise ApiError("Équipe introuvable.", 404)
    # Les contacts du capitaine ne sont visibles que par les gestionnaires
    if g.user["role"] in GESTIONNAIRES:
        contact = fetch_one("SELECT discord, email_capitaine FROM equipes WHERE id = %s", (equipe_id,))
        equipe.update(contact)
    return jsonify(_with_joueurs([equipe])[0])


@bp.post("/equipes")
@roles_required(*GESTIONNAIRES)
def create_equipe():
    equipe = validate_equipe(json_body())
    with transaction() as cur:
        equipe_id = insert_equipe(cur, equipe)
    return jsonify(id=equipe_id), 201


@bp.put("/equipes/<int:equipe_id>")
@roles_required(*GESTIONNAIRES)
def update_equipe(equipe_id):
    existing = _get_equipe_or_404(equipe_id)
    if g.user["role"] != ADMIN and existing["cree_par"] != g.user["id"]:
        raise ApiError("Seul le créateur de l'équipe ou un admin peut la modifier.", 403)

    equipe = validate_equipe(json_body())
    with transaction() as cur:
        cur.execute(
            "UPDATE equipes SET nom = %s, tag = %s, region = %s, discord = %s, email_capitaine = %s "
            "WHERE id = %s",
            (equipe["nom"], equipe["tag"], equipe["region"], equipe["discord"], equipe["email"], equipe_id),
        )
        cur.execute("DELETE FROM joueurs WHERE equipe_id = %s", (equipe_id,))
        cur.executemany(
            "INSERT INTO joueurs (equipe_id, pseudo, role, position) VALUES (%s, %s, %s, %s)",
            [(equipe_id, j["pseudo"], j["role"], i + 1) for i, j in enumerate(equipe["joueurs"])],
        )
    return jsonify(ok=True)


@bp.delete("/equipes/<int:equipe_id>")
@roles_required(ADMIN)
def delete_equipe(equipe_id):
    _get_equipe_or_404(equipe_id)
    execute("DELETE FROM equipes WHERE id = %s", (equipe_id,))
    return jsonify(ok=True)


@bp.get("/classement")
@login_required
def classement():
    rows = fetch_all("SELECT * FROM v_classement ORDER BY points DESC, defaites ASC, nom")
    for rang, row in enumerate(rows, start=1):
        row["rang"] = rang
    return jsonify(rows)
