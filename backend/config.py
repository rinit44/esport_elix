"""Configuration lue depuis le fichier .env (voir .env.example)."""

import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY")

    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = int(os.getenv("DB_PORT", "3306"))
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "elix")

    # Cookie de session : illisible en JS, pas envoyé depuis un autre site
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "0") == "1"  # 1 en HTTPS
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 7  # « Se souvenir de moi » : 7 jours
