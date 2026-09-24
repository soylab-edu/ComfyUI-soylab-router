"""Open the local key settings in the operating system's text editor."""

import os
import subprocess
import sys
from pathlib import Path


def open_key_file(path: Path) -> None:
    path = Path(path)
    if not path.exists():
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write("[comfy_router]\napi_key = \n")
    if not path.is_file():
        raise OSError("API KEY.INI 경로가 일반 파일이 아닙니다.")
    if sys.platform == "darwin":
        command = ["open", "-t", str(path)]
    elif os.name == "nt":
        command = ["notepad.exe", str(path)]
    else:
        command = ["xdg-open", str(path)]
    subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
