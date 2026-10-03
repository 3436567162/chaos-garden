#!/usr/bin/env python3
"""Static server for gestura with caching disabled.

`python -m http.server` sends Last-Modified but no Cache-Control, so browsers
apply a heuristic freshness lifetime and keep serving stale ES modules. In a
project whose whole dev loop is "edit a file, reload", that turns every change
into a hard-reload-or-it-didn't-take exercise — and a stale module fails with a
cryptic error like `tracker.warmUp is not a function` rather than anything that
points at the cache.

Usage:  python serve.py [port]     (default 8000)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable; a drawing session reloads a lot.
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"gestura  ->  http://127.0.0.1:{port}/   (caching disabled, Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()