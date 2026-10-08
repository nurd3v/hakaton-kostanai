from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from auth import NewUserIn, create_user, setup_auth


@pytest.fixture
def admin_client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.db")
    main.setup_database()
    setup_auth(main.connect)
    create_user(main.connect, NewUserIn(
        username="tester", name="Test Admin", password="test-password-123", role="admin"
    ))
    with TestClient(main.app) as client:
        response = client.post("/api/auth/login", json={
            "username": "tester", "password": "test-password-123"
        })
        assert response.status_code == 200
        client.headers.update({"X-CSRF-Token": response.json()["csrf_token"]})
        yield client


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
