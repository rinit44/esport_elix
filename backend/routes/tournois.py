"""Tournois, inscriptions des équipes et arbre en élimination simple.

Lecture : tous les comptes connectés.
Création : organisateurs et admins (le créateur devient propriétaire).
Modification, inscriptions, scores : propriétaire du tournoi ou admin.
"""

from datetime import datetime

from flask import Blueprint, g, jsonify

from ..auth import GESTIONNAIRES, check_owner, login_required, roles_required
from ..db import execute, fetch_all, fetch_one, transaction
from ..errors import ApiError, json_body
from .equipes import insert_equipe, validate_equipe

STATUTS = ("upcoming", "live", "ended")
FORMATS = ("BO1", "BO3", "BO5")
PLACES = (4, 8, 16, 32)

bp = Blueprint("tournois", __name__, url_prefix="/api/tournois")


# ── Helpers ─────────────────────────────────────────────────
def _get_tournoi_or_404(tournoi_id):
    tournoi = fetch_one("SELECT * FROM v_tournois WHERE id = %s", (tournoi_id,))
    if tournoi is None:
        raise ApiError("Tournoi introuvable.", 404)
    return tournoi


def _validate_tournoi(data):
    nom = str(data.get("nom", "")).strip()
    if not 3 <= len(nom) <= 60:
        raise ApiError("Le nom du tournoi doit faire entre 3 et 60 caractères.")
    if data.get("format", "BO3") not in FORMATS:
        raise ApiError("Format invalide (BO1, BO3 ou BO5).")
    if data.get("statut", "upcoming") not in STATUTS:
        raise ApiError("Statut invalide.")
    try:
        places = int(data.get("places", 8))
        cashprize = int(data.get("cashprize", 0))
    except (TypeError, ValueError):
        raise ApiError("Places et cashprize doivent être des nombres.")
    if places not in PLACES:
        raise ApiError("Le nombre de places doit être 4, 8, 16 ou 32.")
    if cashprize < 0:
        raise ApiError("Le cashprize ne peut pas être négatif.")

    date_debut = data.get("date_debut") or None
    if date_debut:
        try:
            date_debut = datetime.fromisoformat(date_debut)
        except ValueError:
            raise ApiError("Date invalide (format attendu : 2026-12-12T19:00).")

    return (
        nom,
        data.get("statut", "upcoming"),
        date_debut,
        data.get("format", "BO3"),
        (data.get("info") or "").strip() or None,
        cashprize,
        places,
        bool(data.get("inscriptions_ouvertes", False)),
    )


def _seed_order(size):
    """Ordre des têtes de série dans l'arbre : 8 -> [1, 8, 4, 5, 2, 7, 3, 6]."""
    order = [1, 2]
    while len(order) < size:
        n = len(order) * 2
        order = [s for seed in order for s in (seed, n + 1 - seed)]
    return order


def _advance(cur, tournoi_id, tour, numero, vainqueur_id):
    """Place le vainqueur dans le match suivant (ou termine le tournoi après la finale)."""
    cur.execute(
        "SELECT id FROM matchs WHERE tournoi_id = %s AND tour = %s AND numero = %s",
        (tournoi_id, tour + 1, (numero + 1) // 2),
    )
    suivant = cur.fetchone()
    if suivant is None:
        cur.execute("UPDATE tournois SET statut = 'ended' WHERE id = %s", (tournoi_id,))
        return
    slot = "equipe1_id" if numero % 2 == 1 else "equipe2_id"
    cur.execute(f"UPDATE matchs SET {slot} = %s WHERE id = %s", (vainqueur_id, suivant["id"]))


# ── Lecture ─────────────────────────────────────────────────
@bp.get("")
@login_required
def list_tournois():
    # En cours, puis à venir (le plus proche d'abord), puis terminés (le plus récent d'abord)
    tournois = fetch_all(
        "SELECT * FROM v_tournois ORDER BY FIELD(statut, 'live', 'upcoming', 'ended'), "
        "CASE WHEN statut = 'ended' THEN date_debut END DESC, date_debut"
    )
    inscrits = fetch_all(
        "SELECT te.tournoi_id, e.id, e.nom, e.tag FROM tournoi_equipes te "
        "JOIN equipes e ON e.id = te.equipe_id ORDER BY te.tournoi_id, te.seed"
    )
    for t in tournois:
        t["equipes"] = [{"id": e["id"], "nom": e["nom"], "tag": e["tag"]}
                        for e in inscrits if e["tournoi_id"] == t["id"]]
        t["peut_gerer"] = _peut_gerer(t)
    return jsonify(tournois)


@bp.get("/<int:tournoi_id>")
@login_required
def get_tournoi(tournoi_id):
    tournoi = _get_tournoi_or_404(tournoi_id)
    tournoi["equipes"] = fetch_all(
        "SELECT e.id, e.nom, e.tag, e.region, te.seed FROM tournoi_equipes te "
        "JOIN equipes e ON e.id = te.equipe_id WHERE te.tournoi_id = %s ORDER BY te.seed",
        (tournoi_id,),
    )
    tournoi["matchs"] = fetch_all(
        "SELECT * FROM matchs WHERE tournoi_id = %s ORDER BY tour, numero", (tournoi_id,)
    )
    tournoi["peut_gerer"] = _peut_gerer(tournoi)
    return jsonify(tournoi)


def _peut_gerer(tournoi):
    """Indique au front s'il doit afficher les boutons de gestion."""
    role = g.user["role"]
    return role == "admin" or (role == "organisateur" and tournoi["organisateur_id"] == g.user["id"])


# ── Création / modification ─────────────────────────────────
@bp.post("")
@roles_required(*GESTIONNAIRES)
def create_tournoi():
    values = _validate_tournoi(json_body("nom"))
    tournoi_id = execute(
        "INSERT INTO tournois (nom, statut, date_debut, format, info, cashprize, places, "
        "inscriptions_ouvertes, organisateur_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        values + (g.user["id"],),
    )
    return jsonify(id=tournoi_id), 201


@bp.put("/<int:tournoi_id>")
@roles_required(*GESTIONNAIRES)
def update_tournoi(tournoi_id):
    tournoi = _get_tournoi_or_404(tournoi_id)
    check_owner(tournoi)
    values = _validate_tournoi(json_body("nom"))
    if values[6] < tournoi["nb_equipes"]:
        raise ApiError("Il y a déjà plus d'équipes inscrites que de places.")
    execute(
        "UPDATE tournois SET nom = %s, statut = %s, date_debut = %s, format = %s, info = %s, "
        "cashprize = %s, places = %s, inscriptions_ouvertes = %s WHERE id = %s",
        values + (tournoi_id,),
    )
    return jsonify(ok=True)


@bp.delete("/<int:tournoi_id>")
@roles_required(*GESTIONNAIRES)
def delete_tournoi(tournoi_id):
    check_owner(_get_tournoi_or_404(tournoi_id))
    execute("DELETE FROM tournois WHERE id = %s", (tournoi_id,))
    return jsonify(ok=True)


# ── Inscriptions ────────────────────────────────────────────
@bp.post("/<int:tournoi_id>/equipes")
@roles_required(*GESTIONNAIRES)
def inscrire_equipe(tournoi_id):
    """Corps : { "equipe_id": 3 } pour une équipe existante,
    ou { "equipe": { nom, tag, region, discord, email, joueurs: [...] } } pour en créer une."""
    tournoi = _get_tournoi_or_404(tournoi_id)
    check_owner(tournoi)
    if not tournoi["inscriptions_ouvertes"]:
        raise ApiError("Les inscriptions de ce tournoi sont fermées.", 409)
    if tournoi["nb_equipes"] >= tournoi["places"]:
        raise ApiError("Le tournoi est complet.", 409)

    data = json_body()
    with transaction() as cur:
        if data.get("equipe_id"):
            cur.execute("SELECT id FROM equipes WHERE id = %s", (data["equipe_id"],))
            if cur.fetchone() is None:
                raise ApiError("Équipe introuvable.", 404)
            equipe_id = data["equipe_id"]
        elif isinstance(data.get("equipe"), dict):
            equipe_id = insert_equipe(cur, validate_equipe(data["equipe"]))
        else:
            raise ApiError("Indique equipe_id ou equipe.")

        cur.execute(
            "SELECT COALESCE(MAX(seed), 0) + 1 AS seed FROM tournoi_equipes WHERE tournoi_id = %s",
            (tournoi_id,),
        )
        seed = cur.fetchone()["seed"]
        cur.execute(
            "INSERT INTO tournoi_equipes (tournoi_id, equipe_id, seed, inscrit_par) VALUES (%s, %s, %s, %s)",
            (tournoi_id, equipe_id, seed, g.user["id"]),
        )
    return jsonify(equipe_id=equipe_id), 201


@bp.delete("/<int:tournoi_id>/equipes/<int:equipe_id>")
@roles_required(*GESTIONNAIRES)
def desinscrire_equipe(tournoi_id, equipe_id):
    check_owner(_get_tournoi_or_404(tournoi_id))
    if fetch_one("SELECT 1 FROM matchs WHERE tournoi_id = %s LIMIT 1", (tournoi_id,)):
        raise ApiError("L'arbre est déjà généré : impossible de retirer une équipe.", 409)
    with transaction() as cur:
        cur.execute(
            "SELECT seed FROM tournoi_equipes WHERE tournoi_id = %s AND equipe_id = %s", (tournoi_id, equipe_id)
        )
        inscription = cur.fetchone()
        if inscription is None:
            raise ApiError("Cette équipe n'est pas inscrite à ce tournoi.", 404)
        cur.execute(
            "DELETE FROM tournoi_equipes WHERE tournoi_id = %s AND equipe_id = %s", (tournoi_id, equipe_id)
        )
        # Les seeds suivants remontent d'un cran (ORDER BY évite les doublons temporaires)
        cur.execute(
            "UPDATE tournoi_equipes SET seed = seed - 1 WHERE tournoi_id = %s AND seed > %s ORDER BY seed",
            (tournoi_id, inscription["seed"]),
        )
    return jsonify(ok=True)


# ── Arbre et scores ─────────────────────────────────────────
@bp.post("/<int:tournoi_id>/arbre")
@roles_required(*GESTIONNAIRES)
def generer_arbre(tournoi_id):
    """Ferme les inscriptions et crée tous les matchs de l'arbre.
    Les places vides donnent une qualification directe (bye)."""
    tournoi = _get_tournoi_or_404(tournoi_id)
    check_owner(tournoi)
    if tournoi["nb_equipes"] <= tournoi["places"] // 2:
        raise ApiError("Plus de la moitié des places doivent être remplies : "
                       "réduis le nombre de places pour générer l'arbre.", 409)
    if fetch_one("SELECT 1 FROM matchs WHERE tournoi_id = %s LIMIT 1", (tournoi_id,)):
        raise ApiError("L'arbre existe déjà.", 409)

    places = tournoi["places"]
    seeds = {
        r["seed"]: r["equipe_id"]
        for r in fetch_all("SELECT seed, equipe_id FROM tournoi_equipes WHERE tournoi_id = %s", (tournoi_id,))
    }
    order = _seed_order(places)

    with transaction() as cur:
        cur.execute("UPDATE tournois SET inscriptions_ouvertes = FALSE WHERE id = %s", (tournoi_id,))

        nb_tours = places.bit_length() - 1  # 8 places -> 3 tours
        for tour in range(1, nb_tours + 1):
            for numero in range(1, places // 2 ** tour + 1):
                e1 = e2 = None
                if tour == 1:
                    e1, e2 = seeds.get(order[2 * numero - 2]), seeds.get(order[2 * numero - 1])
                cur.execute(
                    "INSERT INTO matchs (tournoi_id, tour, numero, equipe1_id, equipe2_id) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (tournoi_id, tour, numero, e1, e2),
                )

        # Byes : une équipe seule au premier tour passe directement
        for numero in range(1, places // 2 + 1):
            e1, e2 = seeds.get(order[2 * numero - 2]), seeds.get(order[2 * numero - 1])
            if (e1 is None) != (e2 is None):
                vainqueur = e1 or e2
                cur.execute(
                    "UPDATE matchs SET vainqueur_id = %s WHERE tournoi_id = %s AND tour = 1 AND numero = %s",
                    (vainqueur, tournoi_id, numero),
                )
                _advance(cur, tournoi_id, 1, numero, vainqueur)

    return jsonify(ok=True), 201


@bp.put("/<int:tournoi_id>/matchs/<int:match_id>")
@roles_required(*GESTIONNAIRES)
def saisir_score(tournoi_id, match_id):
    check_owner(_get_tournoi_or_404(tournoi_id))
    data = json_body("score1", "score2")
    try:
        score1, score2 = int(data["score1"]), int(data["score2"])
    except (TypeError, ValueError):
        raise ApiError("Les scores doivent être des nombres.")
    if score1 < 0 or score2 < 0:
        raise ApiError("Les scores ne peuvent pas être négatifs.")
    if score1 == score2:
        raise ApiError("Pas d'égalité possible en élimination directe.")

    with transaction() as cur:
        cur.execute("SELECT * FROM matchs WHERE id = %s AND tournoi_id = %s", (match_id, tournoi_id))
        match = cur.fetchone()
        if match is None:
            raise ApiError("Match introuvable.", 404)
        if match["equipe1_id"] is None or match["equipe2_id"] is None:
            raise ApiError("Les deux équipes de ce match ne sont pas encore connues.", 409)

        cur.execute(
            "SELECT vainqueur_id FROM matchs WHERE tournoi_id = %s AND tour = %s AND numero = %s",
            (tournoi_id, match["tour"] + 1, (match["numero"] + 1) // 2),
        )
        suivant = cur.fetchone()
        if suivant and suivant["vainqueur_id"] is not None:
            raise ApiError("Ce match ne peut plus être modifié : le tour suivant est déjà joué.", 409)

        vainqueur = match["equipe1_id"] if score1 > score2 else match["equipe2_id"]
        cur.execute(
            "UPDATE matchs SET score1 = %s, score2 = %s, vainqueur_id = %s, joue_le = NOW() WHERE id = %s",
            (score1, score2, vainqueur, match_id),
        )
        cur.execute("UPDATE tournois SET statut = 'live' WHERE id = %s AND statut = 'upcoming'", (tournoi_id,))
        _advance(cur, tournoi_id, match["tour"], match["numero"], vainqueur)

    return jsonify(vainqueur_id=vainqueur)
