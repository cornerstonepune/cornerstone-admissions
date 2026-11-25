#!/bin/bash
# render.sh <ID> [height]  -> shots of the repo wireframe at 1440 and 400
S=$(cd "$(dirname "$0")" && pwd); R=$(git -C "$S" rev-parse --show-toplevel)
python3 $S/gen.py $R/design/wireframes >/dev/null || exit 1
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for w in 1440 500; do "$C" --headless=new --disable-gpu --hide-scrollbars --window-size=$w,${2:-2400} --screenshot=${TMPDIR:-/tmp}/$1-$w.png "file://$R/design/wireframes/$1.html" 2>/dev/null; done
