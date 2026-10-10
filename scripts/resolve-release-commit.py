#!/usr/bin/env python3
"""Keep an unpublished release pinned while allowing workflow-only repairs on main."""
import argparse
import re


def select_commit(head, tag_commit=None, draft="missing"):
    for value in [head, tag_commit]:
        if value and not re.fullmatch(r"[0-9a-f]{40}", value):
            raise ValueError("Release commits must be full Git commit IDs")
    if not head or draft not in ["missing", "true", "false"]:
        raise ValueError("Invalid release state")
    if draft == "false":
        raise ValueError("Refusing to overwrite a published release")
    if draft == "true":
        if not tag_commit:
            raise ValueError("Existing draft release has no tag")
        return tag_commit
    if tag_commit and tag_commit != head:
        raise ValueError("Existing tag points to another commit and has no draft to resume")
    return head


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--head", required=True)
    parser.add_argument("--tag-commit", default="")
    parser.add_argument("--draft", choices=["missing", "true", "false"], default="missing")
    args = parser.parse_args()
    try:
        print(select_commit(args.head, args.tag_commit, args.draft))
    except ValueError as error:
        parser.error(str(error))
