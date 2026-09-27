import csv
import io
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import db
from ig import IGError, InstagramClient, normalize_username

load_dotenv()
log = logging.getLogger("followers")

IMAGE_HOST_SUFFIXES = (".cdninstagram.com", ".fbcdn.net")
IMAGE_MAX_BYTES = 2 * 1024 * 1024


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)

    host = os.environ.get("HOST", "127.0.0.1")
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or _stored_secret(app.instance_path),
        DATABASE=os.path.join(app.instance_path, "followers.sqlite3"),
        MAX_FOLLOWERS=max(1, int(os.environ.get("MAX_FOLLOWERS", "100"))),
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_HTTPONLY=True,
    )
    if host in ("127.0.0.1", "localhost", "::1"):
        # Refuse requests for other host names, so a web page can't reach the
        # site through DNS rebinding and use your Instagram session.
        app.config["TRUSTED_HOSTS"] = ["127.0.0.1", "localhost", "[::1]"]

    db.init_db(app.config["DATABASE"])
    app.teardown_appcontext(db.close_db)

    client = InstagramClient(os.path.join(app.instance_path, "sessions"))
    _sign_in_at_startup(client)
    app.extensions["instagram"] = client

    _register_template_helpers(app)
    _register_routes(app, client)
    return app


def _stored_secret(instance_path):
    path = os.path.join(instance_path, "secret_key")
    if not os.path.exists(path):
        with open(path, "w") as fh:
            fh.write(secrets.token_hex(32))
        os.chmod(path, 0o600)
    with open(path) as fh:
        return fh.read().strip()


def _sign_in_at_startup(client):
    username = (os.environ.get("IG_USERNAME") or "").strip().lstrip("@").lower()
    password = os.environ.get("IG_PASSWORD") or ""
    try:
        if username and client.restore(username):
            log.info("Restored saved Instagram session for @%s", username)
        elif username and password:
            if client.login(username, password) == "2fa":
                log.warning("@%s needs a two-factor code. Finish signing in on the Account page.", username)
            else:
                log.info("Signed in to Instagram as @%s", username)
        elif not username:
            saved = client.saved_sessions()
            if len(saved) == 1 and client.restore(saved[0]):
                log.info("Restored saved Instagram session for @%s", saved[0])
    except IGError as err:
        log.warning("Couldn't sign in at startup: %s", err.message)


def _clamp_limit(app, raw, default=20):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, app.config["MAX_FOLLOWERS"]))


def _register_template_helpers(app):
    @app.template_filter("compact")
    def compact(n):
        n = int(n or 0)
        for size, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
            if abs(n) >= size:
                text = f"{n / size:.1f}".rstrip("0").rstrip(".")
                return f"{text}{suffix}"
        return str(n)

    @app.template_filter("ago")
    def ago(iso):
        then = datetime.fromisoformat(iso)
        seconds = int((datetime.now(timezone.utc) - then).total_seconds())
        if seconds < 60:
            return "just now"
        for size, unit in ((86400, "day"), (3600, "hour"), (60, "minute")):
            if seconds >= size:
                count = seconds // size
                return f"{count} {unit}{'' if count == 1 else 's'} ago"

    @app.template_filter("img")
    def img(url):
        return url_for("image_proxy", u=url) if url else ""

    @app.context_processor
    def inject_globals():
        client = app.extensions["instagram"]
        return {
            "ig_user": client.username,
            "csrf_token": _csrf_token,
            "max_followers": app.config["MAX_FOLLOWERS"],
        }


def _csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def _register_routes(app, client):
    @app.before_request
    def check_csrf():
        if request.method == "POST":
            sent = request.form.get("csrf_token", "")
            if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
                abort(400, "The form expired. Reload the page and try again.")

    # -- pages ------------------------------------------------------------

    @app.get("/")
    def index():
        return render_template("index.html", tracked=db.tracked_accounts())

    @app.post("/lookup")
    def lookup():
        raw = request.form.get("username", "")
        limit = _clamp_limit(app, request.form.get("limit"))
        try:
            target = normalize_username(raw)
            result = client.recent_followers(target, limit)
        except IGError as err:
            flash(err.message, "error")
            if err.status == 401:
                return redirect(url_for("account"))
            return redirect(url_for("index", u=raw))
        db.save_snapshot(result, limit)
        return redirect(url_for("profile", username=target))

    @app.get("/u/<username>")
    def profile(username):
        target = _target_or_404(username)
        snap = db.get_snapshot(target, request.args.get("snapshot", type=int))
        if snap is None:
            if request.args.get("snapshot"):
                abort(404)
            return render_template("empty_profile.html", target=target)

        followers = db.followers_of(snap["id"])
        prev = db.previous_snapshot(snap)
        new_usernames = set()
        follower_delta = None
        if prev is not None:
            prev_followers = db.followers_of(prev["id"])
            seen = {f["username"] for f in prev_followers}
            # Only the first len(prev) rows can be compared: anything past the
            # end of the older list was never fetched, so it isn't "new".
            for f in followers[: len(prev_followers)]:
                if f["username"] not in seen:
                    new_usernames.add(f["username"])
            follower_delta = snap["follower_count"] - prev["follower_count"]

        return render_template(
            "profile.html",
            snap=snap,
            prev=prev,
            followers=followers,
            new_usernames=new_usernames,
            follower_delta=follower_delta,
            history=db.snapshots_for(target),
            is_latest=db.get_snapshot(target)["id"] == snap["id"],
        )

    @app.post("/u/<username>/refresh")
    def refresh(username):
        target = _target_or_404(username)
        latest = db.get_snapshot(target)
        limit = _clamp_limit(app, request.form.get("limit"), latest["requested"] if latest else 20)
        try:
            result = client.recent_followers(target, limit)
        except IGError as err:
            flash(err.message, "error")
            if err.status == 401:
                return redirect(url_for("account"))
            return redirect(url_for("profile", username=target))
        db.save_snapshot(result, limit)
        flash(f"Fetched {len(result.followers)} followers of @{target}.", "ok")
        return redirect(url_for("profile", username=target))

    @app.post("/u/<username>/delete")
    def delete(username):
        target = _target_or_404(username)
        db.delete_target(target)
        flash(f"Deleted the saved history for @{target}.", "ok")
        return redirect(url_for("index"))

    @app.get("/u/<username>/export.<fmt>")
    def export(username, fmt):
        target = _target_or_404(username)
        snap = db.get_snapshot(target, request.args.get("snapshot", type=int))
        if snap is None or fmt not in ("csv", "json"):
            abort(404)
        rows = [
            {**dict(r), "position": r["position"] + 1,
             "is_verified": bool(r["is_verified"]), "is_private": bool(r["is_private"])}
            for r in db.followers_of(snap["id"])
        ]
        stamp = snap["taken_at"][:19].replace(":", "").replace("T", "-")
        filename = f"{target}-followers-{stamp}.{fmt}"
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        fields = ["position", "username", "full_name", "is_verified", "is_private", "profile_pic_url"]

        if fmt == "json":
            payload = {
                "target": target,
                "taken_at": snap["taken_at"],
                "follower_count": snap["follower_count"],
                "followers": [{k: r[k] for k in fields} for r in rows],
            }
            return Response(json.dumps(payload, indent=2), mimetype="application/json", headers=headers)

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return Response(buf.getvalue(), mimetype="text/csv", headers=headers)

    # -- account ----------------------------------------------------------

    @app.get("/account")
    def account():
        return render_template(
            "account.html",
            awaiting_2fa=client.awaiting_2fa,
            saved_sessions=client.saved_sessions(),
        )

    @app.post("/account/login")
    def account_login():
        try:
            outcome = client.login(request.form.get("username", ""), request.form.get("password", ""))
        except IGError as err:
            flash(err.message, "error")
            return redirect(url_for("account"))
        if outcome == "2fa":
            flash("Instagram sent you a two-factor code. Enter it below.", "ok")
        else:
            flash(f"Signed in as @{client.username}.", "ok")
        return redirect(url_for("account"))

    @app.post("/account/2fa")
    def account_2fa():
        try:
            client.two_factor(request.form.get("code", ""))
        except IGError as err:
            flash(err.message, "error")
            return redirect(url_for("account"))
        flash(f"Signed in as @{client.username}.", "ok")
        return redirect(url_for("index"))

    @app.post("/account/cookie")
    def account_cookie():
        try:
            client.login_with_cookie(
                request.form.get("username", ""),
                request.form.get("sessionid", ""),
                request.form.get("csrftoken", ""),
            )
        except IGError as err:
            flash(err.message, "error")
            return redirect(url_for("account"))
        flash(f"Signed in as @{client.username}.", "ok")
        return redirect(url_for("index"))

    @app.post("/account/restore")
    def account_restore():
        name = request.form.get("username", "")
        if name in client.saved_sessions() and client.restore(name):
            flash(f"Switched to the saved session for @{name}.", "ok")
        else:
            flash("Couldn't load that saved session.", "error")
        return redirect(url_for("account"))

    @app.post("/account/logout")
    def account_logout():
        forget = request.form.get("forget") == "1"
        client.logout(forget=forget)
        flash("Signed out." + (" The saved session was deleted." if forget else ""), "ok")
        return redirect(url_for("account"))

    # -- JSON API ---------------------------------------------------------

    @app.get("/api/status")
    def api_status():
        return jsonify({"status": "success", "logged_in_as": client.username})

    @app.get("/api/recent_followers/<target_username>")
    def api_recent_followers(target_username):
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            return jsonify({"status": "error", "message": "Cross-site requests aren't allowed."}), 403
        limit = _clamp_limit(app, request.args.get("limit"))
        try:
            result = client.recent_followers(target_username, limit)
        except IGError as err:
            return jsonify({"status": "error", "message": err.message}), err.status
        db.save_snapshot(result, limit)
        return jsonify(
            {
                "status": "success",
                "profile": result.profile,
                "fetched_at": result.fetched_at,
                "data": result.followers,
            }
        )

    # -- images -----------------------------------------------------------

    @app.get("/img")
    def image_proxy():
        # Instagram's CDN refuses to serve images embedded on other sites, so
        # profile pictures are fetched here and passed through. Only Instagram
        # CDN hosts are allowed, otherwise this would be an open proxy.
        url = request.args.get("u", "")
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host.endswith(IMAGE_HOST_SUFFIXES):
            abort(400)
        try:
            upstream = requests.get(url, timeout=10, stream=True, allow_redirects=False)
        except requests.RequestException:
            abort(502)
        with upstream:
            ctype = upstream.headers.get("Content-Type", "")
            if upstream.status_code != 200 or not ctype.startswith("image/"):
                abort(404)
            body = upstream.raw.read(IMAGE_MAX_BYTES + 1, decode_content=True)
        if len(body) > IMAGE_MAX_BYTES:
            abort(413)
        return Response(body, mimetype=ctype, headers={"Cache-Control": "private, max-age=86400"})

    # -- errors -----------------------------------------------------------

    @app.errorhandler(400)
    @app.errorhandler(404)
    def http_error(err):
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": err.description}), err.code
        try:
            return render_template("error.html", error=err), err.code
        except Exception:
            # Requests rejected before routing (an untrusted Host header, say)
            # can't build URLs, so the full page can't render.
            return Response(f"{err.code} {err.name}", status=err.code, mimetype="text/plain")


def _target_or_404(username):
    try:
        return normalize_username(username)
    except IGError:
        abort(404)


logging.basicConfig(level=logging.INFO, format="%(message)s")
app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    print(f"\n  Follower lookup running at http://{'localhost' if host == '127.0.0.1' else host}:{port}\n")
    app.run(host=host, port=port, threaded=True)
