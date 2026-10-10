"""Erreurs de l'API : toujours renvoyées en JSON { "erreur": "..." }."""

from flask import jsonify, request
from mysql.connector import errorcode
from mysql.connector.errors import IntegrityError


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def json_body(*required):
    """Corps JSON de la requête, avec vérification des champs obligatoires."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Corps JSON attendu.")
    missing = [f for f in required if data.get(f) in (None, "")]
    if missing:
        raise ApiError("Champs manquants : " + ", ".join(missing))
    return data


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def api_error(err):
        return jsonify(erreur=err.message), err.status

    @app.errorhandler(IntegrityError)
    def integrity_error(err):
        if err.errno == errorcode.ER_DUP_ENTRY:
            return jsonify(erreur="Cette valeur existe déjà."), 409
        return jsonify(erreur="Donnée invalide."), 400
