"""Accès à MySQL avec mysql-connector (pool de connexions).

Utilisation :
    rows = fetch_all("SELECT * FROM equipes WHERE region = %s", ("Europe",))
    new_id = execute("INSERT INTO equipes (nom) VALUES (%s)", ("X",))

Pour plusieurs requêtes dans une même transaction :
    with transaction() as cur:
        cur.execute(...)
        cur.execute(...)
"""

from contextlib import contextmanager

from mysql.connector import pooling

_pool = None


def init_pool(config):
    global _pool
    _pool = pooling.MySQLConnectionPool(
        pool_name="elix",
        pool_size=5,
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME,
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
        autocommit=False,
    )


@contextmanager
def transaction():
    """Curseur (lignes en dict) : commit à la fin, rollback si exception."""
    cnx = _pool.get_connection()
    cur = cnx.cursor(dictionary=True)
    try:
        yield cur
        cnx.commit()
    except Exception:
        cnx.rollback()
        raise
    finally:
        cur.close()
        cnx.close()  # rend la connexion au pool


def fetch_all(sql, params=()):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql, params=()):
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(sql, params=()):
    """INSERT / UPDATE / DELETE. Renvoie l'id inséré (ou le nombre de lignes touchées)."""
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.lastrowid or cur.rowcount
