"""Point d'entrée WSGI pour l'hébergement (ex. alwaysdata, type de site « Python WSGI »).

Le serveur cherche une variable nommée `application`.
"""

import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app import create_app  # noqa: E402

application = create_app()
