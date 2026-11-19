#!/usr/bin/env bash
# Put one secret into a vars.json from the phone (Moshi terminal) or any terminal, without it showing on screen, in
# chat or in a log: the value is read hidden from the keyboard (paste it), and only its length is printed.
# usage: workers/phone/set-var.sh <path to vars.json> <NAME>   e.g. workers/phone/set-var.sh app/vars.json API_KEY
set -euo pipefail
file=${1:?path to vars.json} name=${2:?variable name}
[[ $name =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "name must be UPPER_CASE"; exit 2; }
read -rsp "Paste $name (hidden), then Enter: " value; echo
[ -n "$value" ] || { echo "nothing pasted; $file unchanged"; exit 1; }
VALUE=$value python3 -I - "$file" "$name" <<'PY'
import json, os, sys
path, name = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except FileNotFoundError:
    data = {}
data[name] = os.environ["VALUE"].strip()
old = os.umask(0o077)
json.dump(data, open(path, "w"), indent=2)
os.umask(old)
os.chmod(path, 0o600)
print(f"{name} set in {path}, length {len(data[name])}")
PY
