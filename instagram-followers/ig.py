"""Thin wrapper around a single shared Instaloader instance.

Instaloader keeps one requests session and one rate controller, and neither is
safe to use from several threads at once, so every call into it goes through
``_lock``. The site is meant for one person on localhost, so serialising
requests is fine and also keeps us gentle with Instagram.
"""

import os
import re
import secrets
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

import instaloader
from instaloader.exceptions import (
    BadCredentialsException,
    ConnectionException,
    InstaloaderException,
    InvalidArgumentException,
    LoginException,
    LoginRequiredException,
    PrivateProfileNotFollowedException,
    ProfileNotExistsException,
    QueryReturnedBadRequestException,
    QueryReturnedForbiddenException,
    TooManyRequestsException,
    TwoFactorAuthRequiredException,
)

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")


class IGError(Exception):
    """A lookup failed for a reason we can explain to the person using the site."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class LookupResult:
    profile: dict
    followers: list = field(default_factory=list)
    fetched_at: str = ""


def normalize_username(raw):
    """Accept '@name', 'name', or a profile URL and return the bare username."""
    value = (raw or "").strip()
    match = re.search(r"instagram\.com/([^/?#]+)", value)
    if match:
        value = match.group(1)
    value = value.lstrip("@").strip("/").lower()
    if not USERNAME_RE.match(value):
        raise IGError("That doesn't look like an Instagram username.")
    return value


def _node_get(profile, key, default=None):
    # Reading attributes like ``profile.full_name`` makes Instaloader fetch the
    # full profile when the key is missing, and ``profile_pic_url`` always hits
    # an extra endpoint when logged in. Follower nodes already carry everything
    # we show, so read them directly to keep one request per page of followers.
    return getattr(profile, "_node", {}).get(key, default)


class InstagramClient:
    def __init__(self, session_dir):
        self._lock = threading.Lock()
        self._session_dir = session_dir
        self._pending_2fa_user = None
        self.L = self._new_loader()

    @staticmethod
    def _new_loader():
        return instaloader.Instaloader(
            quiet=True,
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            save_metadata=False,
            max_connection_attempts=1,
            request_timeout=30.0,
        )

    # -- session handling -------------------------------------------------

    def _session_path(self, username):
        return os.path.join(self._session_dir, f"session-{username}")

    def _save_session(self):
        os.makedirs(self._session_dir, exist_ok=True)
        self.L.save_session_to_file(self._session_path(self.L.context.username))

    @property
    def username(self):
        return self.L.context.username if self.L.context.is_logged_in else None

    @property
    def awaiting_2fa(self):
        return self._pending_2fa_user

    def saved_sessions(self):
        if not os.path.isdir(self._session_dir):
            return []
        return sorted(
            name[len("session-"):]
            for name in os.listdir(self._session_dir)
            if name.startswith("session-")
        )

    def restore(self, username):
        """Load a saved session file if there is one. Returns True on success."""
        path = self._session_path(username)
        if not os.path.exists(path):
            return False
        with self._lock:
            try:
                self.L.load_session_from_file(username, path)
            except Exception:
                self.L = self._new_loader()
                return False
            return True

    def login(self, username, password):
        username = normalize_username(username)
        with self._lock:
            self._pending_2fa_user = None
            try:
                self.L.login(username, password)
            except TwoFactorAuthRequiredException:
                self._pending_2fa_user = username
                return "2fa"
            except BadCredentialsException:
                raise IGError("Instagram rejected that username and password.")
            except LoginException as err:
                raise IGError(_login_hint(err))
            except ConnectionException as err:
                raise IGError(f"Couldn't reach Instagram: {err}", 502)
            self._save_session()
            return "ok"

    def two_factor(self, code):
        code = (code or "").strip().replace(" ", "")
        with self._lock:
            if not self._pending_2fa_user:
                raise IGError("There's no sign-in waiting for a code. Start again.")
            try:
                self.L.two_factor_login(code)
            except BadCredentialsException:
                raise IGError("That code didn't work. Check the latest one and try again.")
            except (InvalidArgumentException, LoginException) as err:
                self._pending_2fa_user = None
                raise IGError(_login_hint(err))
            self._pending_2fa_user = None
            self._save_session()

    def login_with_cookie(self, username, sessionid, csrftoken=""):
        """Use the ``sessionid`` cookie from a browser that's already signed in.

        Useful when Instagram blocks password logins from scripts with a
        checkpoint. The cookie is checked with a real request before it's kept.
        """
        username = normalize_username(username)
        sessionid = (sessionid or "").strip()
        if not sessionid:
            raise IGError("Paste the value of the sessionid cookie.")
        cookies = {
            "sessionid": sessionid,
            "csrftoken": (csrftoken or "").strip() or secrets.token_hex(16),
        }
        user_id = sessionid.split("%3A", 1)[0].split(":", 1)[0]
        if user_id.isdigit():
            cookies["ds_user_id"] = user_id
        with self._lock:
            self.L = self._new_loader()
            self.L.load_session(username, cookies)
            who = self.L.test_login()
            if not who:
                self.L = self._new_loader()
                raise IGError("Instagram didn't accept that cookie. It may have expired.")
            if who.lower() != username:
                self.L = self._new_loader()
                raise IGError(f"That cookie belongs to @{who}, not @{username}.")
            self._save_session()

    def logout(self, forget=False):
        with self._lock:
            username = self.L.context.username
            self._pending_2fa_user = None
            self.L.close()
            self.L = self._new_loader()
        if forget and username:
            try:
                os.remove(self._session_path(username))
            except FileNotFoundError:
                pass

    # -- lookups ----------------------------------------------------------

    def recent_followers(self, target, limit):
        target = normalize_username(target)
        with self._lock:
            if not self.L.context.is_logged_in:
                raise IGError(
                    "Instagram only shows follower lists to signed-in accounts. "
                    "Sign in on the Account page first.",
                    401,
                )
            try:
                profile = instaloader.Profile.from_username(self.L.context, target)
                summary = _profile_summary(profile)
                if profile.is_private and not profile.followed_by_viewer and target != self.username:
                    raise IGError(
                        f"@{target} is private and @{self.username} doesn't follow them, "
                        "so Instagram won't share their followers.",
                        403,
                    )
                followers = []
                for follower in profile.get_followers():
                    if len(followers) >= limit:
                        break
                    followers.append(
                        {
                            "username": follower.username,
                            "full_name": _node_get(follower, "full_name", "") or "",
                            "profile_pic_url": _node_get(follower, "profile_pic_url", "") or "",
                            "is_verified": bool(_node_get(follower, "is_verified", False)),
                            "is_private": bool(_node_get(follower, "is_private", False)),
                        }
                    )
            except IGError:
                raise
            except ProfileNotExistsException:
                raise IGError(f"There's no Instagram account called @{target}.", 404)
            except PrivateProfileNotFollowedException:
                raise IGError(f"@{target} is private and you don't follow them.", 403)
            except LoginRequiredException:
                raise IGError("Your Instagram session has expired. Sign in again.", 401)
            except TooManyRequestsException:
                raise IGError(
                    "Instagram is rate limiting this account. Wait a few minutes before trying again.",
                    429,
                )
            except (QueryReturnedBadRequestException, QueryReturnedForbiddenException) as err:
                raise IGError(
                    "Instagram refused the request. This usually means a checkpoint or a "
                    f"temporary block on the signed-in account. ({err})",
                    502,
                )
            except ConnectionException as err:
                raise IGError(f"Couldn't reach Instagram: {err}", 502)
            except InstaloaderException as err:
                raise IGError(f"Instagram lookup failed: {err}", 502)

        return LookupResult(
            profile=summary,
            followers=followers,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )


def _profile_summary(profile):
    return {
        "username": profile.username,
        "full_name": profile.full_name or "",
        "biography": profile.biography or "",
        "external_url": profile.external_url or "",
        "followers": profile.followers,
        "followees": profile.followees,
        "mediacount": profile.mediacount,
        "is_private": profile.is_private,
        "is_verified": profile.is_verified,
        "profile_pic_url": _node_get(profile, "profile_pic_url_hd")
        or _node_get(profile, "profile_pic_url", ""),
    }


def _login_hint(err):
    text = str(err)
    if "checkpoint" in text.lower():
        return (
            "Instagram wants to verify this sign-in (a checkpoint). Open Instagram in your "
            "browser or app, approve the login, then try again, or sign in with a session cookie."
        )
    return f"Instagram sign-in failed: {text}"
