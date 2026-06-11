"""Smart local preview server for the HIRE XA frontend.

Plain static serving isn't enough because the app pages:
  - redirect to login when there's no logged-in user, and
  - fetch /api/... (no backend here),
  - link to short slug routes (/b4kx, /c8qr, ...).

So this server:
  1. Serves /static/... files,
  2. Injects a tiny shim into every HTML page that seeds a fake "logged-in"
     user, so the auth gates pass and the layout renders,
  3. Maps the app's slug routes to their page,
  4. Returns an empty 200 for /api/* so client fetches resolve instead of erroring.

Run this (or double-click serve.bat). It auto-opens http://localhost:8000/.
None of this touches your source files — it only affects what's served live.
"""
import http.server
import os
import socketserver
import threading
import urllib.parse
import webbrowser

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(ROOT, "static", "pages")

# Slug -> page file (mirrors the backend's route table)
SLUG = {
    "b4kx": "dashboard.html", "c8qr": "pipeline.html", "d2mw": "pipeline_monitor.html",
    "e6vn": "pipeline_launch.html", "f9pj": "hiring_dashboard.html", "g3tg": "hiring_feedback.html",
    "h7nh": "settings.html", "m3xk": "profile.html", "n8wd": "user_dashboard.html",
    "j5sb": "upload_resumes.html", "k2yh": "job_posting.html",
    "p8eu": "screening_round_conversation.html", "q4uv": "screening_round_monitor.html",
    "r2qa": "screening_round_candidates.html", "s6oz": "screening_round_feedback.html",
    "t3wr": "screening_round_room.html", "login": "login.html",
    # Public, unauthenticated routes the backend serves directly (not slugs).
    "privacy": "privacy.html", "terms": "terms.html",
    "auth/linkedin/callback": "linkedin_callback.html",
}

# Seeds a fake logged-in user so the pages' auth gates pass and render the layout.
SHIM = (
    b"<script>/* preview-mode */(function(){try{if(!localStorage.getItem('fluenzoUser')){"
    b"localStorage.setItem('fluenzoUser',JSON.stringify({id:1,email:'preview@hirexa.ai',"
    b"name:'Preview User',is_admin:true,role:'admin',auth_provider:'email',"
    b"needs_onboarding:false,organisation_id:1,company_name:'Preview Co'}));}}catch(e){}})();</script>"
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _html(self, filepath):
        try:
            with open(filepath, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        i = body.lower().find(b"<head>")
        if i != -1:
            body = body[:i + 6] + SHIM + body[i + 6:]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, raw=b"{}"):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path.startswith("/api/"):
            return self._json()
        self.send_error(404)

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p.startswith("/api/"):
            return self._json()
        if p in ("/", "/index.html"):
            return self._html(os.path.join(ROOT, "index.html"))
        slug = p.strip("/")
        if slug.startswith("a/"):  # candidate apply form: /a/{posting_id}
            return self._html(os.path.join(PAGES, "job_apply.html"))
        if slug in SLUG:
            return self._html(os.path.join(PAGES, SLUG[slug]))
        if p.startswith("/static/pages/") and p.endswith(".html"):
            return self._html(os.path.join(ROOT, p.lstrip("/").replace("/", os.sep)))
        return super().do_GET()

    def log_message(self, *a):
        pass  # quiet


threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}/")).start()
print(f"\n  HIRE XA frontend preview\n  Open: http://localhost:{PORT}/\n  Keep this window open. Press Ctrl+C to stop.\n")
try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
except OSError as e:
    print(f"\nCould not start on port {PORT}: {e}\nClose whatever is using it, or change PORT in preview.py.")
