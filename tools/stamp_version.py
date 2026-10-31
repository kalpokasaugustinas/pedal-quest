# stamps a build number + timestamp into the site before each commit (run by the git pre-commit hook).
# - shows "build N · yyyy-mm-dd hh:mm" in the corner of the start screen
# - adds ?v=N to css/js links and to every relative js import, so phones never mix cached old files with new ones
import re
import subprocess
from datetime import datetime
from pathlib import Path

root = Path(__file__).resolve().parent.parent

# build number = number of commits including the one being made
count = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
build = int(count or 0) + 1
stamp = datetime.now().strftime("%Y-%m-%d %H:%M")

# index.html: version label + cache-busting query on the stylesheet and entry script
index = root / "index.html"
html = index.read_text(encoding="utf-8")
html = re.sub(r'<span id="version">.*?</span>', f'<span id="version">build {build} · {stamp}</span>', html)
html = re.sub(r'(href="style\.css|src="js/main\.js)(\?v=\d+)?"', rf'\g<1>?v={build}"', html)
index.write_text(html, encoding="utf-8")

# js modules: relative imports get the same query, e.g. from './race.js?v=12'
for js in (root / "js").glob("*.js"):
    src = js.read_text(encoding="utf-8")
    new = re.sub(r"(from\s+'\./[\w-]+\.js)(\?v=\d+)?'", rf"\g<1>?v={build}'", src)
    if new != src:
        js.write_text(new, encoding="utf-8")

print(f"stamped build {build} · {stamp}")
