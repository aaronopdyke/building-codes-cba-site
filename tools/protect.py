"""Password-gate the site HTML (StatiCrypt-equivalent, no Node needed).

Encrypts pages/*.html with AES-256-GCM (key from PBKDF2-SHA256, 310k
iterations) and writes self-decrypting login pages into docs/. The browser
decrypts with WebCrypto after the password prompt (GitHub Pages is HTTPS, and
localhost previews count as a secure context).

DEMO-GRADE protection: only the HTML shell is gated. Everything under
docs/data/ and docs/assets/ remains fetchable by direct URL. Do not publish
sensitive data.

Usage (from the repo root):
  py tools/protect.py                 # prompts for a password
  py tools/protect.py --password X    # non-interactive
  py tools/protect.py --plain         # no gate: copy pages/ to docs/ as-is

Requires: pip install cryptography
"""

import argparse
import base64
import getpass
import hashlib
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'pages')
DOCS = os.path.join(ROOT, 'docs')
ITERATIONS = 310_000

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected — Building Codes CBA</title>
<style>
  body {{ margin: 0; min-height: 100vh; display: flex; align-items: center;
         justify-content: center; background: #f9f9f7; color: #0b0b0b;
         font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
  .card {{ background: #fcfcfb; border: 1px solid #e1e0d9; border-radius: 10px;
          padding: 2rem 2.2rem; max-width: 360px; box-shadow: 0 4px 18px rgba(0,0,0,.06); }}
  h1 {{ font-size: 1.1rem; margin: 0 0 0.3rem; }}
  p {{ color: #52514e; font-size: 0.85rem; margin: 0.2rem 0 1rem; }}
  input {{ width: 100%; font: inherit; padding: 0.45rem 0.6rem; border: 1px solid #c3c2b7;
          border-radius: 6px; margin-bottom: 0.7rem; box-sizing: border-box; }}
  button {{ width: 100%; font: inherit; font-weight: 600; padding: 0.45rem; border: 0;
           border-radius: 6px; background: #2a78d6; color: #fff; cursor: pointer; }}
  .err {{ color: #b03030; font-size: 0.8rem; min-height: 1.2em; margin-top: 0.5rem; }}
</style>
</head>
<body>
<div class="card">
  <h1>Building Codes CBA</h1>
  <p>This demo is password-protected. Enter the password to continue.</p>
  <form id="f">
    <input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password">
    <button type="submit">Unlock</button>
    <div class="err" id="err"></div>
  </form>
</div>
<script>
const SALT = "{salt}", IV = "{iv}", DATA = "{data}", ITER = {iterations};
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlock(pwText) {{
  const pw = new TextEncoder().encode(pwText);
  const km = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {{ name: "PBKDF2", salt: b64(SALT), iterations: ITER, hash: "SHA-256" }},
    km, {{ name: "AES-GCM", length: 256 }}, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    {{ name: "AES-GCM", iv: b64(IV) }}, key, b64(DATA));
  const html = new TextDecoder().decode(plain);
  try {{ sessionStorage.setItem("bccba_pw", pwText); }} catch (e) {{}}
  document.open(); document.write(html); document.close();
}}
document.getElementById("f").addEventListener("submit", async ev => {{
  ev.preventDefault();
  const err = document.getElementById("err");
  err.textContent = "";
  try {{
    await unlock(document.getElementById("pw").value);
  }} catch (e) {{
    err.textContent = "Wrong password.";
  }}
}});
// enter the password once per browser tab: reuse it silently across pages
(async () => {{
  let stored = null;
  try {{ stored = sessionStorage.getItem("bccba_pw"); }} catch (e) {{}}
  if (stored) {{
    try {{ await unlock(stored); }}
    catch (e) {{ try {{ sessionStorage.removeItem("bccba_pw"); }} catch (e2) {{}} }}
  }}
}})();
</script>
</body>
</html>
"""


def encrypt_page(src, dst, password):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    with open(src, encoding='utf-8') as f:
        html = f.read()
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, ITERATIONS)
    ct = AESGCM(key).encrypt(iv, html.encode('utf-8'), None)
    out = TEMPLATE.format(salt=base64.b64encode(salt).decode(),
                          iv=base64.b64encode(iv).decode(),
                          data=base64.b64encode(ct).decode(),
                          iterations=ITERATIONS)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--password', help='password (omit to be prompted)')
    ap.add_argument('--plain', action='store_true',
                    help='copy pages/ to docs/ without a gate (local preview)')
    args = ap.parse_args()

    pages = [f for f in os.listdir(PAGES) if f.endswith('.html')]
    if not pages:
        sys.exit('No HTML files in pages/.')

    if args.plain:
        for f in pages:
            shutil.copy2(os.path.join(PAGES, f), os.path.join(DOCS, f))
        print(f'Copied {len(pages)} plain pages to docs/ (NO password gate).')
        return

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
    except ImportError:
        sys.exit('Needs the cryptography package: pip install cryptography')

    pw = args.password or getpass.getpass('Site password: ')
    if not pw:
        sys.exit('Empty password.')
    for f in pages:
        encrypt_page(os.path.join(PAGES, f), os.path.join(DOCS, f), pw)
    print(f'Encrypted {len(pages)} pages into docs/ (AES-256-GCM, PBKDF2 '
          f'{ITERATIONS:,} iters).')
    print('NOTE: docs/data/* and docs/assets/* remain publicly fetchable - '
          'demo-grade gate only.')


if __name__ == '__main__':
    main()
