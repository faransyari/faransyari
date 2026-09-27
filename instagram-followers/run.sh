#!/usr/bin/env sh
# Sets up a virtualenv on first run, then starts the site at http://localhost:5000
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
fi
.venv/bin/pip install --quiet -r requirements.txt
exec .venv/bin/python app.py
