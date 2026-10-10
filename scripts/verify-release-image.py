#!/usr/bin/env python3
"""Require both supported architectures in a published image index."""
import json
import sys
from pathlib import Path


def verify_image(data):
    platforms = {(entry.get("platform", {}).get("os"), entry.get("platform", {}).get("architecture"))
                 for entry in data.get("manifests", [])}
    if not {("linux", "amd64"), ("linux", "arm64")}.issubset(platforms):
        raise ValueError("Image must include linux/amd64 and linux/arm64")


if __name__ == "__main__":
    verify_image(json.loads(Path(sys.argv[1]).read_text()))
