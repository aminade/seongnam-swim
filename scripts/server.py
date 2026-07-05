#!/usr/bin/env python3
import http.server
import urllib.request
import os

AS_URL = 'https://script.google.com/macros/s/AKfycbzipcY-bhohZ4DpEnxnlBLezyiY_hE8n9XWHh5C0CuPH3zf-v_rDlUvEwE1osDtjQh_Lg/exec'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/ga4':
            try:
                req = urllib.request.Request(AS_URL, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as r:
                    data = r.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(('{"ok":false,"error":"' + str(e) + '"}').encode())
        else:
            super().do_GET()

    def log_message(self, format, *args):
        pass  # 로그 숨김

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
print('서버 시작: http://localhost:8080')
print('admin: http://localhost:8080/admin.html')
http.server.HTTPServer(('', 8080), Handler).serve_forever()
