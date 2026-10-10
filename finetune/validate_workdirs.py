"""Check that the fine-tuning tools keep their work paths private.

Runs with the standard library only. Exits 0 when the work paths stay
under the user's home directory, outside the shared temporary
directory, and no script hard-codes a /tmp path again.
"""

import re
import sys
import tempfile
from pathlib import Path

from workdirs import LLAMA_CPP_DIR, WORK_DIR

SCRIPTS = ("convert_gguf.py", "convert_onnx.py", "train.py")


def main() -> int:
    here = Path(__file__).resolve().parent
    home = Path.home().resolve()
    shared_tmp = Path(tempfile.gettempdir()).resolve()
    problems = []

    for path in (WORK_DIR, LLAMA_CPP_DIR):
        resolved = path.resolve()
        if resolved != home and home not in resolved.parents:
            problems.append(f"{path} is outside the user home directory")
        if shared_tmp == resolved or shared_tmp in resolved.parents:
            problems.append(f"{path} is inside the shared temporary directory")

    if LLAMA_CPP_DIR.parent != WORK_DIR:
        problems.append("the llama.cpp cache does not live under the work directory")

    for name in SCRIPTS:
        text = (here / name).read_text(encoding="utf-8")
        if re.search(r"""['"]/tmp/""", text):
            problems.append(f"{name} hard-codes a shared temporary path")

    if problems:
        for problem in problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        return 1

    print(f"work paths are private under {WORK_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
