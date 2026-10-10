"""Serveur Esport ELIXTV (Flask + MySQL).

Lancement :  python app.py   puis   http://localhost:5000

Toutes les pages demandent d'être connecté, sauf connexion.html et cgu.html.
inscription.html est réservée aux organisateurs et aux admins.
"""

import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from flask import Flask, Response, abort, g, redirect, send_from_directory, url_for
from flask.json.provider import DefaultJSONProvider

from backend.auth import GESTIONNAIRES, bp as auth_bp, load_user, login_required, public_user
from backend.config import Config
from backend.db import init_pool
from backend.errors import register_error_handlers
from backend.routes.equipes import bp as equipes_bp
from backend.routes.tournois import bp as tournois_bp
from backend.routes.utilisateurs import bp as utilisateurs_bp

ROOT = Path(__file__).resolve().parent

# Pages HTML servies et rôles autorisés (None = tout compte connecté)
PAGES = {
    "index": None,
    "tournois": None,
    "classement": None,
    "equipes": None,
    "inscription": GESTIONNAIRES,
}


class JSONProvider(DefaultJSONProvider):
    """Dates en ISO 8601 et nombres MySQL (Decimal) en vrais nombres JSON."""

    @staticmethod
    def default(o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return int(o) if o == o.to_integral_value() else float(o)
        return DefaultJSONProvider.default(o)


def create_app():
    if not Config.SECRET_KEY:
        raise RuntimeError("SECRET_KEY manquant : copie .env.example en .env et remplis-le.")

    # static_folder=None : on ne sert que les fichiers listés ici (jamais .py ni .env)
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    app.json = JSONProvider(app)

    init_pool(Config)
    register_error_handlers(app)
    app.before_request(load_user)

    for bp in (auth_bp, tournois_bp, equipes_bp, utilisateurs_bp):
        app.register_blueprint(bp)

    # ── Pages ───────────────────────────────────────────────
    @app.get("/connexion.html")
    def connexion():
        if g.user is not None:
            return redirect(url_for("index"))
        return send_from_directory(ROOT, "connexion.html")

    # Les CGU restent lisibles sans compte (lien depuis la page de connexion)
    @app.get("/cgu.html")
    def cgu():
        return send_from_directory(ROOT, "cgu.html")

    @app.get("/")
    @login_required
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<page>.html")
    @login_required
    def page(page):
        if page not in PAGES:
            abort(404)
        roles = PAGES[page]
        if roles and g.user["role"] not in roles:
            return redirect(url_for("index"))
        return send_from_directory(ROOT, f"{page}.html")

    # ── Fichiers statiques ──────────────────────────────────
    @app.get("/style.css")
    def style():
        return send_from_directory(ROOT, "style.css")

    @app.get("/js/<path:filename>")
    def js(filename):
        return send_from_directory(ROOT / "js", filename)

    @app.get("/img/<path:filename>")
    def img(filename):
        return send_from_directory(ROOT / "img", filename)

    # Compte connecté, lu de façon synchrone par les pages (js/auth.js)
    @app.get("/session.js")
    def session_js():
        user = public_user(g.user) if g.user else None
        return Response(
            f"window.ELIX_USER = {json.dumps(user)};",
            mimetype="text/javascript",
            headers={"Cache-Control": "no-store"},
        )

    return app


if __name__ == "__main__":
    create_app().run(debug=True)
