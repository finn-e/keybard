"""Shared capture settings. Override with environment variables.

KEYBARD_CAPTURE_URL is the running Keybard development server, including its
base path (`npm run dev` serves /keybard/; its port depends on the branch,
5173 unless vite.config.ts assigns another). MANUAL_URL serves docs/manual.
"""
import os, tempfile
from urllib.parse import urlsplit
KEYBARD_URL = os.environ.get('KEYBARD_CAPTURE_URL', 'http://127.0.0.1:5173/keybard/').rstrip('/') + '/'
# Vite serves source modules under the same base path as the app.
BASE = urlsplit(KEYBARD_URL).path
MANUAL_URL = os.environ.get('MANUAL_URL', 'http://127.0.0.1:5190/').rstrip('/') + '/'
FAILURES = tempfile.gettempdir()
