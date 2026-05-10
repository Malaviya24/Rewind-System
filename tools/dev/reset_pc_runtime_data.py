import argparse
import os
import shutil
from pathlib import Path


def runtime_dir():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MotorRepairManager"
    return Path.home() / "MotorRepairManager"


def remove_path(path):
    if not path.exists():
        return "missing"
    if path.is_dir():
        shutil.rmtree(path)
        return "removed folder"
    path.unlink()
    return "removed file"


def main():
    parser = argparse.ArgumentParser(
        description="Safely reset Motor Repair Manager packaged PC runtime data for clean first-launch testing."
    )
    parser.add_argument("--yes", action="store_true", help="Confirm deletion of packaged runtime data.")
    args = parser.parse_args()

    target = runtime_dir().resolve()
    allowed_parent = Path(os.environ.get("LOCALAPPDATA") or Path.home()).resolve()
    project_root = Path(__file__).resolve().parents[2]

    print("Motor Repair Manager runtime reset")
    print("----------------------------------")
    print(f"Target runtime folder: {target}")
    print(f"Project folder:        {project_root}")
    print()

    if target == project_root or project_root in target.parents:
        raise SystemExit("Refusing to delete: runtime target is inside the source project.")
    if allowed_parent not in target.parents and target != allowed_parent:
        raise SystemExit("Refusing to delete: runtime target is outside the expected user data folder.")

    if not args.yes:
        print("No files were deleted.")
        print("Run with --yes to remove only these runtime items:")
        print(f"  {target / 'database.db'}")
        print(f"  {target / 'uploads'}")
        print(f"  {target / 'backups'}")
        return

    target.mkdir(parents=True, exist_ok=True)
    for item in ("database.db", "uploads", "backups"):
        path = target / item
        print(f"{item}: {remove_path(path)}")

    print()
    print("Done. Next packaged EXE launch will create a clean empty database.")


if __name__ == "__main__":
    main()
