@echo off
rem Sets up a virtualenv on first run, then starts the site at http://localhost:5000
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv
)
.venv\Scripts\pip install --quiet -r requirements.txt
.venv\Scripts\python app.py
