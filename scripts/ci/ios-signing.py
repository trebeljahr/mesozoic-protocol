"""Validate only public signing metadata; never export private key material."""
import datetime
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile

BUNDLE_ID = "com.ricoslabs.mesozoicprotocol"


def validate_profile(profile, team, name, certificate=None, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    entitlements = profile.get("Entitlements", {})
    if entitlements.get("application-identifier") != f"{team}.{BUNDLE_ID}":
        raise ValueError("Provisioning profile bundle identifier does not match the app and team.")
    if profile.get("TeamIdentifier") != [team] or entitlements.get("com.apple.developer.team-identifier") != team:
        raise ValueError("Provisioning profile team does not match.")
    if profile.get("Name") != name or not profile.get("UUID"):
        raise ValueError("Provisioning profile name or UUID is invalid.")
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime.datetime):
        raise ValueError("Provisioning profile expiry is missing.")
    if expires.replace(tzinfo=expires.tzinfo or datetime.timezone.utc) <= now:
        raise ValueError("Provisioning profile has expired.")
    if entitlements.get("get-task-allow") is not False:
        raise ValueError("App Store profile must set get-task-allow to false.")
    if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
        raise ValueError("Expected an App Store distribution profile.")
    if certificate is not None and certificate not in profile.get("DeveloperCertificates", []):
        raise ValueError("Provisioning profile does not include the signing certificate.")


def export_options(team, name):
    return {
        "method": "app-store-connect",
        "teamID": team,
        "signingStyle": "manual",
        "signingCertificate": "Apple Distribution",
        "provisioningProfiles": {BUNDLE_ID: name},
        "uploadSymbols": True,
        "destination": "export",
        "stripSwiftSymbols": True,
        "manageAppVersionAndBuildNumber": False,
    }


def command(arguments):
    result = subprocess.run(arguments, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(f"{arguments[0]} failed: {result.stderr.decode(errors='replace')}")
    return result


def extract_signer_certificate(app, directory):
    prefix = Path(directory) / "signer-"
    # codesign treats this as an optional argument: it must be attached to the
    # option, otherwise the prefix is interpreted as another code object.
    command(["codesign", "--display", f"--extract-certificates={prefix}", str(app)])
    return (Path(directory) / "signer-0").read_bytes()


def verify_ipa(ipa, team, name, expected_certificate, version, build):
    with tempfile.TemporaryDirectory(prefix="ipa-verification-", dir=os.environ.get("RUNNER_TEMP")) as directory:
        root = Path(directory)
        command(["ditto", "-x", "-k", str(ipa), str(root)])
        apps = list((root / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise ValueError("Expected exactly one app in the IPA.")
        app = apps[0]
        info = plistlib.loads((app / "Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != BUNDLE_ID:
            raise ValueError("Exported IPA bundle identifier does not match.")
        if info.get("CFBundleShortVersionString") != version or info.get("CFBundleVersion") != build:
            raise ValueError("Exported IPA marketing version or build number does not match.")
        command(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)])
        metadata = command(["codesign", "--display", "--verbose=4", str(app)]).stderr.decode()
        if f"TeamIdentifier={team}" not in metadata.splitlines() or f"Identifier={BUNDLE_ID}" not in metadata.splitlines():
            raise ValueError("Exported IPA code signature identity does not match.")
        entitlement_bytes = command(["codesign", "--display", "--entitlements", ":-", str(app)]).stdout
        entitlements = plistlib.loads(entitlement_bytes)
        if entitlements.get("application-identifier") != f"{team}.{BUNDLE_ID}" or entitlements.get("com.apple.developer.team-identifier") != team:
            raise ValueError("Exported IPA signing entitlements do not match.")
        if entitlements.get("get-task-allow", False) is not False:
            raise ValueError("Exported IPA permits debugging.")
        if extract_signer_certificate(app, root) != expected_certificate:
            raise ValueError("Exported IPA signer does not match the configured certificate.")
        profile_bytes = command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]).stdout
        validate_profile(plistlib.loads(profile_bytes), team, name, expected_certificate)
        print(f"Verified signed IPA: {BUNDLE_ID}, team {team}, version {version} ({build}).")


def main():
    temporary = Path(os.environ["RUNNER_TEMP"])
    team = os.environ["APPLE_TEAM_ID"]
    name = os.environ["APPLE_PROVISIONING_PROFILE_NAME"]
    mode = sys.argv[1]
    if mode == "profile":
        validate_profile(plistlib.loads((temporary / "profile.plist").read_bytes()), team, name, (temporary / "signing-cert.der").read_bytes())
        print("Provisioning profile identity, expiry, distribution type and certificate verified.")
    elif mode == "export-options":
        (temporary / "ExportOptions.plist").write_bytes(plistlib.dumps(export_options(team, name)))
    elif mode == "verify":
        verify_ipa(temporary / "ipa/App.ipa", team, name, (temporary / "signing-cert.der").read_bytes(), os.environ["ANDROID_VERSION_NAME"], os.environ["IOS_BUILD_NUMBER"])
    else:
        raise ValueError("Usage: ios-signing.py profile|export-options|verify")


if __name__ == "__main__":
    main()
