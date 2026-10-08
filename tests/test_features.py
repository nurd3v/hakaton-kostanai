from datetime import date, timedelta
import gc
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

import main
from auth import NewUserIn, create_user, setup_auth


@pytest.fixture
def admin_client(monkeypatch):
    temporary_dir = TemporaryDirectory(prefix=".pytest-db-", dir=Path(__file__).resolve().parents[1])
    monkeypatch.setattr(main, "DB_PATH", Path(temporary_dir.name) / "test.db")
    main.setup_database()
    setup_auth(main.connect)
    create_user(main.connect, NewUserIn(
        username="tester", name="Test Admin", password="test-password-123", role="admin"
    ))
    try:
        with TestClient(main.app) as client:
            response = client.post("/api/auth/login", json={
                "username": "tester", "password": "test-password-123"
            })
            assert response.status_code == 200
            client.headers.update({"X-CSRF-Token": response.json()["csrf_token"]})
            yield client
    finally:
        gc.collect()
        temporary_dir.cleanup()


def test_maintenance_alerts_include_due_assets_and_validate_window(admin_client):
    response = admin_client.post("/api/equipment", json={
        "name": "Press 1", "area": "Сварка", "status": "working",
        "last_maintenance": None,
        "next_maintenance": (date.today() + timedelta(days=2)).isoformat(),
        "notes": "",
    })
    assert response.status_code == 201
    alerts = admin_client.get("/api/maintenance/alerts?within_days=3")
    assert alerts.status_code == 200
    added_alert = next(item for item in alerts.json()["items"] if item["name"] == "Press 1")
    assert added_alert["days_remaining"] == 2
    assert admin_client.get("/api/maintenance/alerts?within_days=400").status_code == 422


def test_csv_template_and_import_are_atomic(admin_client):
    template = admin_client.get("/api/import/template.csv")
    assert template.status_code == 200
    assert "work_date,area,planned_units" in template.text
    assert "elapsed_shift_hours" in template.text

    header = "work_date,area,planned_units,actual_units,operating_hours,utilization_percent,produced,defects,equipment,downtime_reason,downtime_minutes,is_critical"
    valid = f"{date.today().isoformat()},Сварка,120,118,8,95,118,2,Press 1,setup,12,true"
    imported = admin_client.post("/api/import/csv", json={"content": header + "\n" + valid})
    assert imported.status_code == 201
    assert imported.json()["count"] == 1

    invalid = f"{date.today().isoformat()},Сварка,120,118,8,95,118,999,Press 1,setup,12,true"
    rejected = admin_client.post("/api/import/csv", json={"content": header + "\n" + valid + "\n" + invalid})
    assert rejected.status_code == 422
    extra_column = admin_client.post("/api/import/csv", json={"content": header + "\n" + valid + ",unexpected"})
    assert extra_column.status_code == 422
    with main.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM line_runs WHERE work_date=?", (date.today().isoformat(),)).fetchone()[0] == 1


def test_audit_log_records_writes_and_is_admin_only(admin_client):
    response = admin_client.post("/api/event-note", json={"title": "Test action", "details": {}})
    assert response.status_code < 400
    audit = admin_client.get("/api/admin/audit?limit=20")
    assert audit.status_code == 200
    actions = [row["action"] for row in audit.json()]
    assert "login" in actions
    assert "POST /api/event-note" in actions

    create_user(main.connect, NewUserIn(
        username="viewer", name="Viewer", password="viewer-password-123", role="user"
    ))
    viewer = TestClient(main.app)
    login = viewer.post("/api/auth/login", json={"username": "viewer", "password": "viewer-password-123"})
    assert login.status_code == 200
    viewer.headers.update({"X-CSRF-Token": login.json()["csrf_token"]})
    assert viewer.get("/api/admin/audit").status_code == 403
    action_id = admin_client.get("/api/actions").json()[0]["id"]
    assert viewer.patch(f"/api/actions/{action_id}", json={
        "status": "in_progress", "assigned_to": "Viewer",
    }).status_code == 200


def test_forecast_uses_elapsed_time_and_reports_basis(admin_client):
    area = next(iter(main.AREAS))
    response = admin_client.post("/api/shift-entry", json={
        "work_date": (date.today() + timedelta(days=3)).isoformat(),
        "area": area, "planned_units": 100, "actual_units": 30,
        "operating_hours": 3, "elapsed_shift_hours": 4,
        "utilization_percent": 60, "produced": 30, "defects": 1,
    })
    assert response.status_code == 201
    result = admin_client.get("/api/production-forecast").json()
    forecast = next(item for item in result["areas"] if item["area"] == area)
    assert forecast["projected_units"] == 60
    assert forecast["projected_gap"] == 40
    assert forecast["status"] == "at_risk"
    assert forecast["data_sources"] == ["manual"]
    assert result["method"] == "linear_pace"
    assert result["limitation"]


def test_action_center_tracks_owner_and_status(admin_client):
    actions = admin_client.get("/api/actions")
    assert actions.status_code == 200
    assert actions.json()
    action_id = actions.json()[0]["id"]
    updated = admin_client.patch(f"/api/actions/{action_id}", json={
        "status": "in_progress", "assigned_to": "Maintenance team",
    })
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"
    assert updated.json()["assigned_to"] == "Maintenance team"
    refreshed = next(item for item in admin_client.get("/api/actions").json() if item["id"] == action_id)
    assert refreshed["status"] == "in_progress"


def test_simulation_returns_labeled_impact_estimate(admin_client):
    response = admin_client.post("/api/simulation/shift", json={"scenario": "failure"})
    assert response.status_code == 200
    impact = response.json()["estimated_impact"]
    assert impact["estimated_downtime_hours"] == 1.13
    assert impact["estimated_recovered_units_per_shift"] == 42
    assert impact["label"]
    assert impact["basis"]
