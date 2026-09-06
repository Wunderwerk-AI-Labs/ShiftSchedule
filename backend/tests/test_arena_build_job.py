import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

from backend.arena.build_job import build_job


def test_checkout_experiment_uses_packaged_code_and_reads_settings_without_writes(tmp_path):
    root = tmp_path / "checkout"
    arena = root / "backend/arena"
    arena.mkdir(parents=True)
    (root / "backend/__init__.py").write_text("")
    (root / "backend/agent_budget.py").write_text("def _read_rows(): raise RuntimeError('deployed database helper must not run')")
    (arena / "fixture_complex.json").write_text("{}")
    (arena / "prompt_eval.py").write_text(
        "import json, pathlib, backend.agent_budget as budget\n"
        "print(json.dumps({'settings':budget._read_rows(), 'module':budget.__file__}))\n")
    database = tmp_path / "settings.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE agent_settings (key TEXT, value TEXT)")
        connection.execute("INSERT INTO agent_settings VALUES ('provider','mock')")
    original = database.read_bytes()
    job = build_job(root, ["prompt_eval"], "checkout")
    result = subprocess.run([sys.executable, "-"], input=job, text=True, capture_output=True,
                            env={**os.environ, "SCHEDULE_DB_PATH": str(database)}, check=True)
    output = json.loads(result.stdout)
    assert output["settings"] == {"provider": "mock"}
    assert "shift-arena-" in output["module"]
    assert not Path(output["module"]).exists()  # temporary checkout was cleaned up
    assert database.read_bytes() == original
