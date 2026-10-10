import unittest
import os
import subprocess
import tempfile
import fnmatch
import re
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("release_policy", Path(__file__).with_name("release-policy.py"))
policy = module_from_spec(spec)
spec.loader.exec_module(policy)


class ReleasePolicyTests(unittest.TestCase):
    def test_canonical_version(self):
        self.assertEqual(policy.validate_release("3.9.0-r4", "v3.9.0-r3"), "v3.9.0-r4")

    def test_numeric_revision_and_upstream_upgrade(self):
        self.assertEqual(policy.validate_release("v3.9.0-r10", "v3.9.0-r9"), "v3.9.0-r10")
        self.assertEqual(policy.validate_release("v3.10.0-r1", "v3.9.0-r20"), "v3.10.0-r1")

    def test_rejects_overwrites_and_downgrades(self):
        for version in ["v3.9.0-r3", "v3.9.0-r2", "v3.8.0-r10"]:
            with self.subTest(version=version), self.assertRaises(ValueError):
                policy.validate_release(version, "v3.9.0-r3")

    def test_rejects_upstream_prerelease_and_malformed_tags(self):
        for version in ["v3.9.0", "v3.9.0-beta1", "v3.9.0-r0", "v03.9.0-r4", "v3.9.0-r04", "v3.9.0-r4\n", "main", "v3.9.0-r4; echo bad"]:
            with self.subTest(version=version), self.assertRaises(ValueError):
                policy.validate_release(version)


class ReleaseCommitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = spec_from_file_location("release_commit", Path(__file__).with_name("resolve-release-commit.py"))
        cls.resolver = module_from_spec(spec)
        spec.loader.exec_module(cls.resolver)

    def test_fresh_release_uses_main(self):
        self.assertEqual(self.resolver.select_commit("a" * 40), "a" * 40)

    def test_resume_keeps_original_draft_commit_after_workflow_fix(self):
        self.assertEqual(self.resolver.select_commit("a" * 40, "b" * 40, "true"), "b" * 40)

    def test_same_head_tag_without_draft_can_finish_prepare(self):
        self.assertEqual(self.resolver.select_commit("a" * 40, "a" * 40), "a" * 40)

    def test_rejects_published_or_unrelated_existing_tag(self):
        for tag, draft in [("b" * 40, "false"), ("a" * 40, "false"), ("b" * 40, "missing"), (None, "true")]:
            with self.subTest(tag=tag, draft=draft), self.assertRaises(ValueError):
                self.resolver.select_commit("a" * 40, tag, draft)

    def test_rejects_non_commit_inputs(self):
        with self.assertRaises(ValueError):
            self.resolver.select_commit("main", "b" * 40, "true")


class ReleaseArtifactTests(unittest.TestCase):
    def test_combined_release_download_excludes_buildx_records(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/publish-apps.yml").read_text()
        download = workflow.split("- name: Download artifacts", 1)[1].split("- name:", 1)[0]
        pattern = re.search(r"pattern: (\S+)", download).group(1)
        artifacts = ["mailflow-electron-windows-latest", "mailflow-electron-macos-latest",
                     "mailflow-electron-ubuntu-latest", "mailflow-android",
                     "KKKKeybird~mailflow~J63UP9.dockerbuild", "KKKKeybird~mailflow~KD2L1V.dockerbuild"]
        selected = [name for name in artifacts if fnmatch.fnmatchcase(name, pattern)]
        self.assertEqual(selected, artifacts[:4])

    def test_asset_completeness_and_upload_state(self):
        spec = spec_from_file_location("assets", Path(__file__).with_name("verify-release-assets.py"))
        assets = module_from_spec(spec)
        spec.loader.exec_module(assets)
        names = ["Setup.exe", "Universal.dmg", "amd64.deb", "arm64.deb", "x86_64.rpm", "aarch64.rpm"]
        data = {"assets": [{"name": "MailFlow-3.9.0-r4-" + name, "size": 100, "state": "uploaded"} for name in names]}
        assets.verify_assets("v3.9.0-r4", data)
        data["assets"][-1]["state"] = "uploading"
        with self.assertRaises(ValueError):
            assets.verify_assets("v3.9.0-r4", data)
        with self.assertRaises(ValueError):
            assets.verify_assets("v3.9.0-r5", data)

    def test_image_must_have_both_architectures(self):
        spec = spec_from_file_location("images", Path(__file__).with_name("verify-release-image.py"))
        images = module_from_spec(spec)
        spec.loader.exec_module(images)
        data = {"manifests": [{"platform": {"os": "linux", "architecture": arch}} for arch in ["amd64", "arm64"]]}
        images.verify_image(data)
        data["manifests"].pop()
        with self.assertRaises(ValueError):
            images.verify_image(data)


class ReleaseDispatchTests(unittest.TestCase):
    def test_script_only_dispatches_the_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "git").write_text('#!/bin/sh\ncase "$1" in branch) echo main;; status|fetch) ;; rev-parse) echo tested-commit;; *) exit 99;; esac\n')
            (root / "gh").write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_GH_LOG"\n')
            (root / "git").chmod(0o755)
            (root / "gh").chmod(0o755)
            log = root / "dispatch"
            env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"], "TEST_GH_LOG": str(log)}
            script = Path(__file__).with_name("release.sh")
            subprocess.run(["bash", str(script), "3.9.0-r4"], env=env, check=True, capture_output=True)
            self.assertEqual(log.read_text().splitlines(), ["workflow", "run", "publish.yml", "--repo", "KKKKeybird/mailflow", "--ref", "main", "--field", "version=v3.9.0-r4"])


if __name__ == "__main__":
    unittest.main()
