"""SQLite storage for follower snapshots.

Every lookup is saved as a snapshot, so the site can show what changed since
the previous check without asking Instagram again.
"""

import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    target          TEXT    NOT NULL,
    taken_at        TEXT    NOT NULL,
    requested       INTEGER NOT NULL,
    full_name       TEXT    NOT NULL DEFAULT '',
    biography       TEXT    NOT NULL DEFAULT '',
    external_url    TEXT    NOT NULL DEFAULT '',
    follower_count  INTEGER NOT NULL DEFAULT 0,
    following_count INTEGER NOT NULL DEFAULT 0,
    post_count      INTEGER NOT NULL DEFAULT 0,
    is_private      INTEGER NOT NULL DEFAULT 0,
    is_verified     INTEGER NOT NULL DEFAULT 0,
    profile_pic_url TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS snapshots_target ON snapshots (target, taken_at);

CREATE TABLE IF NOT EXISTS snapshot_followers (
    snapshot_id     INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    username        TEXT    NOT NULL,
    full_name       TEXT    NOT NULL DEFAULT '',
    profile_pic_url TEXT    NOT NULL DEFAULT '',
    is_verified     INTEGER NOT NULL DEFAULT 0,
    is_private      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_id, position)
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(path):
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)


def save_snapshot(result, requested):
    p = result.profile
    db = get_db()
    cur = db.execute(
        """INSERT INTO snapshots (target, taken_at, requested, full_name, biography,
               external_url, follower_count, following_count, post_count,
               is_private, is_verified, profile_pic_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            p["username"], result.fetched_at, requested, p["full_name"], p["biography"],
            p["external_url"], p["followers"], p["followees"], p["mediacount"],
            int(p["is_private"]), int(p["is_verified"]), p["profile_pic_url"],
        ),
    )
    snapshot_id = cur.lastrowid
    db.executemany(
        """INSERT INTO snapshot_followers (snapshot_id, position, username, full_name,
               profile_pic_url, is_verified, is_private)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [
            (snapshot_id, i, f["username"], f["full_name"], f["profile_pic_url"],
             int(f["is_verified"]), int(f["is_private"]))
            for i, f in enumerate(result.followers)
        ],
    )
    db.commit()
    return snapshot_id


def tracked_accounts():
    """One row per account ever looked up, with its latest snapshot."""
    return get_db().execute(
        """SELECT s.*, counts.checks
           FROM snapshots s
           JOIN (SELECT target, MAX(id) AS latest, COUNT(*) AS checks
                 FROM snapshots GROUP BY target) counts
             ON counts.latest = s.id
           ORDER BY s.taken_at DESC"""
    ).fetchall()


def snapshots_for(target):
    return get_db().execute(
        """SELECT s.*, (SELECT COUNT(*) FROM snapshot_followers f WHERE f.snapshot_id = s.id) AS fetched
           FROM snapshots s WHERE target = ? ORDER BY id DESC""",
        (target,),
    ).fetchall()


def get_snapshot(target, snapshot_id=None):
    db = get_db()
    if snapshot_id is None:
        row = db.execute(
            "SELECT * FROM snapshots WHERE target = ? ORDER BY id DESC LIMIT 1", (target,)
        ).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM snapshots WHERE target = ? AND id = ?", (target, snapshot_id)
        ).fetchone()
    return row


def previous_snapshot(snapshot):
    return get_db().execute(
        "SELECT * FROM snapshots WHERE target = ? AND id < ? ORDER BY id DESC LIMIT 1",
        (snapshot["target"], snapshot["id"]),
    ).fetchone()


def followers_of(snapshot_id):
    return get_db().execute(
        "SELECT * FROM snapshot_followers WHERE snapshot_id = ? ORDER BY position",
        (snapshot_id,),
    ).fetchall()


def delete_target(target):
    db = get_db()
    db.execute("DELETE FROM snapshots WHERE target = ?", (target,))
    db.commit()
