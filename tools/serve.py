"""เซิร์ฟเวอร์สำหรับรันเว็บบนเครื่อง: python tools/serve.py [port]

- เสิร์ฟไฟล์ทั้งหมดในโฟลเดอร์โปรเจกต์ (เปิด http://localhost:8000)
- รับ PUT เฉพาะ data/money.sqlite และ pictures/<ไฟล์รูป> เพื่อให้ปุ่ม Save บันทึกลงไฟล์ในเครื่องได้
  (เมื่อขึ้น GitHub Pages ระบบจะ commit ผ่าน GitHub API แทน)
"""
import http.server, os, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB_FILE = ROOT / "data" / "money.sqlite"
PIC_DIR = ROOT / "pictures"
PIC_RE = re.compile(r"^/pictures/([\w.-]{1,120}\.(?:jpe?g|png|gif|webp|heic|bmp))$", re.I)
MAX_BYTES = 20 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path == "/data/money.sqlite":
            target = DB_FILE
        else:
            m = PIC_RE.match(path)
            if not m:
                self.send_error(403, "write not allowed")
                return
            PIC_DIR.mkdir(exist_ok=True)
            target = PIC_DIR / m.group(1)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            self.send_error(400, "bad body size")
            return
        body = self.rfile.read(length)
        if target == DB_FILE and not body.startswith(b"SQLite format 3\x00"):
            self.send_error(400, "not a sqlite file")
            return
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(body)
        os.replace(tmp, target)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving {ROOT} at http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
