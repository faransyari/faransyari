# Follower Lookup

A small website that runs on your own machine and shows the most recent followers of any Instagram account. Each lookup is saved, so the next one marks who's new since last time.

Built with Flask and [Instaloader](https://instaloader.github.io/).

## What it does

- **Lookup**: type a username (or paste a profile link) and pick how many followers to fetch, from 10 up to the `MAX_FOLLOWERS` cap.
- **Profile page**: shows the account's bio, follower, following and post counts, and the fetched followers, newest first. You can filter the list by name.
- **What changed**: every lookup is saved as a snapshot in SQLite. The next check shows the change in follower count and marks followers that weren't in the previous list, with an "Only new" toggle.
- **History**: open any older snapshot, export any snapshot as CSV or JSON, or delete an account's history.
- **Account page**: sign in with a password (two-factor codes work), or with a `sessionid` cookie copied from a browser when Instagram blocks scripted logins. The session is saved to `instance/sessions/`, so you only sign in once.
- **JSON API**: `GET /api/recent_followers/<username>?limit=20` returns the same data as JSON, like the original script did.

## Run it

You need Python 3.10 or newer.

```sh
cd instagram-followers
./run.sh          # macOS / Linux
run.bat           # Windows
```

Then open **http://localhost:5000**, go to **Sign in** and log in with an Instagram account.

Or set it up by hand:

```sh
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Configuration

Copy `.env.example` to `.env`. Everything in it is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `IG_USERNAME` | | Account to use. If a saved session exists for it, it's loaded at startup. |
| `IG_PASSWORD` | | Used to sign in at startup when there's no saved session yet. You can leave it empty and sign in from the Account page instead. |
| `MAX_FOLLOWERS` | `100` | Most followers one lookup may fetch. |
| `SECRET_KEY` | generated | Signs the browser cookie. If unset, a key is generated once and kept in `instance/secret_key`. |
| `HOST` / `PORT` | `127.0.0.1` / `5000` | Where the site listens. |

Credentials no longer live in the code. The original script called `L.login("YOUR_USERNAME", "YOUR_PASSWORD")` on every start. This version signs in once and reuses the saved session, which is also much less likely to trip Instagram's login checks.

## API

```
GET /api/recent_followers/<username>?limit=20
```

```json
{
  "status": "success",
  "fetched_at": "2026-09-27T10:00:00+00:00",
  "profile": { "username": "natgeo", "followers": 283000000, "...": "..." },
  "data": [
    { "username": "someone", "full_name": "Some One", "is_verified": false, "is_private": true, "profile_pic_url": "..." }
  ]
}
```

On failure it returns `{"status": "error", "message": "..."}` with a matching HTTP status: 401 when not signed in, 403 for private accounts you don't follow, 404 for unknown accounts, 429 when rate limited. `GET /api/status` reports which account is signed in.

## Good to know

- **Instagram only shows follower lists to signed-in accounts.** Private accounts only work if the signed-in account follows them.
- **Use a spare account.** Instagram rate limits accounts that read a lot of follower lists, and can temporarily lock them. Keep lookups small and spaced out. The site handles one Instagram request at a time.
- **"New" is based on the list order.** Instagram returns followers roughly newest first. A follower counts as new when they appear in the part of the list that the previous snapshot also covered but weren't in it. People further down were never fetched, so they aren't compared.
- **It's for localhost.** By default the server only listens on `127.0.0.1` and only accepts requests addressed to `localhost`. Forms are CSRF protected. Don't expose it to the internet: anyone who can reach it can use your Instagram session.
- Profile pictures are fetched through the app (`/img`), because Instagram's CDN won't serve them to other sites. Only Instagram CDN hosts are allowed.
- Everything you save lives in `instance/` (database, sessions, secret key). Delete that folder to start fresh.

## Files

```
app.py           Flask routes, startup sign-in, exports, image proxy
ig.py            Instaloader wrapper: sign-in, sessions, follower lookups, error messages
db.py            SQLite snapshots
templates/       Pages (Jinja)
static/          CSS and a little JavaScript
```
