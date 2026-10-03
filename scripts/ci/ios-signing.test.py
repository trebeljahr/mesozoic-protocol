import copy
import datetime
import importlib.util
import os
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("ios_signing", Path(__file__).with_name("ios-signing.py"))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class CodesignTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "darwin", "requires Apple's codesign utility")
    def test_extracts_public_certificate_from_signed_app(self):
        # Apple's sealed-system apps can omit their certificate chain. Use an
        # explicitly selected signed app; no keychain or private key is read.
        fixture = os.environ.get("CODESIGN_TEST_APP")
        if not fixture:
            self.skipTest("set CODESIGN_TEST_APP to a certificate-signed app")
        app = Path(fixture)
        with tempfile.TemporaryDirectory(prefix="signer path with spaces ") as directory:
            certificate = signing.extract_signer_certificate(app, directory)
            self.assertGreater(len(certificate), 100)
            self.assertEqual(certificate[0], 0x30)  # DER sequence


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 10, 4, tzinfo=datetime.timezone.utc)
        self.profile = {
            "Name": "Mesozoic & Test / App Store",
            "UUID": "test-profile-uuid",
            "TeamIdentifier": ["TESTTEAMID"],
            "ExpirationDate": datetime.datetime(2027, 1, 1),
            "DeveloperCertificates": [b"public-certificate"],
            "Entitlements": {
                "application-identifier": f"TESTTEAMID.{signing.BUNDLE_ID}",
                "com.apple.developer.team-identifier": "TESTTEAMID",
                "get-task-allow": False,
            },
        }

    def validate(self, profile):
        signing.validate_profile(profile, "TESTTEAMID", self.profile["Name"], b"public-certificate", self.now)

    def test_accepts_matching_distribution_profile(self):
        self.validate(self.profile)

    def test_rejects_wrong_expired_or_device_profiles(self):
        for field, value in [("TeamIdentifier", ["OTHERTEAM"]), ("Name", "Other app"), ("ExpirationDate", self.now), ("DeveloperCertificates", [b"other-certificate"]), ("ProvisionedDevices", []), ("ProvisionsAllDevices", True), ("UUID", "")]:
            with self.subTest(field=field):
                candidate = copy.deepcopy(self.profile)
                candidate[field] = value
                with self.assertRaises(ValueError):
                    self.validate(candidate)

    def test_rejects_debugging_and_entitlement_mismatch(self):
        for field, value in [("application-identifier", "TESTTEAMID.other.app"), ("com.apple.developer.team-identifier", "OTHERTEAM"), ("get-task-allow", True), ("get-task-allow", None)]:
            with self.subTest(field=field):
                candidate = copy.deepcopy(self.profile)
                candidate["Entitlements"][field] = value
                with self.assertRaises(ValueError):
                    self.validate(candidate)

    def test_export_options_escape_profile_names_and_preserve_versions(self):
        options = plistlib.loads(plistlib.dumps(signing.export_options("TESTTEAMID", self.profile["Name"])))
        self.assertEqual(options["provisioningProfiles"][signing.BUNDLE_ID], self.profile["Name"])
        self.assertFalse(options["manageAppVersionAndBuildNumber"])


if __name__ == "__main__":
    unittest.main()
