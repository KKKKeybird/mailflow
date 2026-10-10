#!/usr/bin/env python3
"""Validate fork release versions before any release mutation."""
import argparse
import re

PATTERN = re.compile(r"v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-r([1-9][0-9]*)")


def release_version(value):
    match = PATTERN.fullmatch(value)
    if not match:
        raise ValueError("Use a fork version such as v3.9.0-r4")
    numbers = tuple(map(int, match.groups()))
    return "v" + ".".join(map(str, numbers[:3])) + "-r" + str(numbers[3]), numbers


def validate_release(value, latest=None):
    tag, version = release_version(value)
    if latest and version <= release_version(latest)[1]:
        raise ValueError("Release version must be newer than latest: " + latest)
    return tag


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--latest")
    args = parser.parse_args()
    try:
        print(validate_release(args.version, args.latest))
    except ValueError as error:
        parser.error(str(error))
