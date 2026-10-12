"""Shared work directories for the fine-tuning conversion tools.

The conversion and training scripts clone and build llama.cpp, save
merged models, and write conversion outputs and logs at fixed paths.
Fixed paths must not live in a shared temporary directory: the names
are predictable, so another local user could pre-create or symlink
them and control the code these tools run. Everything instead sits
under the user's own cache directory.
"""

from pathlib import Path

WORK_DIR = Path.home() / ".cache" / "qmd"
LLAMA_CPP_DIR = WORK_DIR / "llama.cpp"
