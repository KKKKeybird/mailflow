#!/usr/bin/env python3
"""Require the complete desktop artifact set before publishing a release."""
import json
import sys
from pathlib import Path


def verify_assets(tag, data):
    version = tag.removeprefix("v")
    expected = {
        f"MailFlow-{version}-Setup.exe",
        f"MailFlow-{version}-Universal.dmg",
        f"MailFlow-{version}-amd64.deb",
        f"MailFlow-{version}-arm64.deb",
        f"MailFlow-{version}-x86_64.rpm",
        f"MailFlow-{version}-aarch64.rpm",
    }
    uploaded = {asset["name"] for asset in data["assets"]
                if asset.get("state") == "uploaded" and asset.get("size", 0) > 0}
    missing = expected - uploaded
    if missing:
        raise ValueError("Missing release assets: " + ", ".join(sorted(missing)))


if __name__ == "__main__":
    verify_assets(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()))
