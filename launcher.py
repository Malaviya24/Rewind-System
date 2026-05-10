import os
import threading
import webbrowser
from pathlib import Path


def configure_data_folder():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        data_dir = Path(local_app_data) / "MotorRepairManager"
    else:
        data_dir = Path.home() / "MotorRepairManager"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MOTOR_REPAIR_DATA_DIR", str(data_dir))


def open_browser():
    webbrowser.open("http://127.0.0.1:5000")


if __name__ == "__main__":
    configure_data_folder()
    from app import app

    if os.environ.get("MOTOR_REPAIR_NO_BROWSER") != "1":
        threading.Timer(1.2, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
