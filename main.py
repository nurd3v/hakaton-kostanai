"""Backend API for the Allur factory digital-twin case."""

from __future__ import annotations

import os
import json
import csv
import io
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import install_auth, setup_auth


DB_PATH = Path(os.getenv("DATABASE_PATH", "factory.db"))
TARGET_OEE = 85.0
MAX_DEFECT_RATE = 2.0
MAX_CRITICAL_DOWNTIME_MINUTES = 60
MONTHLY_OUTPUT_TARGET = 5500


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def setup_database() -> None:
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS line_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_date TEXT NOT NULL,
                line TEXT NOT NULL,
                planned_units INTEGER NOT NULL CHECK(planned_units >= 0),
                actual_units INTEGER NOT NULL CHECK(actual_units >= 0),
                operating_hours REAL NOT NULL CHECK(operating_hours >= 0),
                utilization_percent REAL NOT NULL CHECK(utilization_percent BETWEEN 0 AND 100)
            );
            CREATE TABLE IF NOT EXISTS downtimes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_date TEXT NOT NULL,
                area TEXT NOT NULL,
                equipment TEXT NOT NULL,
                reason TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL CHECK(duration_minutes >= 0),
                is_critical INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS production_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model TEXT NOT NULL UNIQUE,
                monthly_plan INTEGER NOT NULL CHECK(monthly_plan >= 0)
            );
            CREATE TABLE IF NOT EXISTS quality_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_date TEXT NOT NULL,
                area TEXT NOT NULL,
                produced INTEGER NOT NULL CHECK(produced >= 0),
                defects INTEGER NOT NULL CHECK(defects >= 0 AND defects <= produced)
            );
            CREATE TABLE IF NOT EXISTS event_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS equipment_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                area TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'working' CHECK(status IN ('working','maintenance','stopped')),
                last_maintenance TEXT,
                next_maintenance TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT ''
            );
        """)
        if db.execute("SELECT COUNT(*) FROM line_runs").fetchone()[0] == 0:
            db.executemany("""INSERT INTO line_runs
                (work_date,line,planned_units,actual_units,operating_hours,utilization_percent)
                VALUES (?,?,?,?,?,?)""", [
                ("2026-10-01", "Сварка-1", 120, 118, 7.8, 98),
                ("2026-10-01", "Окраска-1", 120, 115, 7.5, 94),
                ("2026-10-01", "Сборка-1", 120, 121, 8.0, 100),
                ("2026-10-02", "Сварка-1", 120, 111, 7.2, 91),
                ("2026-10-02", "Окраска-1", 120, 116, 7.7, 96),
                ("2026-10-02", "Сборка-1", 120, 119, 7.9, 99),
            ])
            db.executemany("""INSERT INTO downtimes
                (work_date,area,equipment,reason,duration_minutes,is_critical)
                VALUES (?,?,?,?,?,?)""", [
                ("2026-10-01", "Сварка", "ABB-01", "Ошибка датчика", 25, 1),
                ("2026-10-01", "Окраска", "Камера-02", "Замена фильтра", 40, 1),
                ("2026-10-02", "Сборка", "Конвейер-03", "Обрыв цепи", 55, 1),
                ("2026-10-02", "Сварка", "ABB-04", "Плановое ТО", 30, 1),
            ])
            db.executemany("INSERT INTO production_plans (model,monthly_plan) VALUES (?,?)", [
                ("Chevrolet Onix", 2500), ("Chevrolet Cobalt", 1800), ("JAC J7", 500),
            ])
            db.executemany("INSERT INTO quality_records (work_date,area,produced,defects) VALUES (?,?,?,?)", [
                ("2026-10-01", "Сварка", 118, 2), ("2026-10-01", "Окраска", 115, 4),
                ("2026-10-01", "Сборка", 121, 1), ("2026-10-02", "Сварка", 111, 3),
                ("2026-10-02", "Окраска", 116, 6), ("2026-10-02", "Сборка", 119, 2),
            ])
        db.executemany("""INSERT OR IGNORE INTO equipment_assets
            (name,area,status,last_maintenance,next_maintenance,notes) VALUES (?,?,?,?,?,?)""", [
            ("ABB-01", "Сварка", "working", "2026-09-15", "2026-10-15", "Робот сварки"),
            ("ABB-04", "Сварка", "working", "2026-09-18", "2026-10-18", "Робот сварки"),
            ("Камера-02", "Окраска", "working", "2026-09-20", "2026-10-20", "Камера окраски"),
            ("Конвейер-03", "Сборка", "working", "2026-09-10", "2026-10-10", "Главный конвейер"),
        ])


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_database()
    setup_auth(connect)
    yield


app = FastAPI(
    title="Allur Factory Digital Twin API",
    description="Производственные линии, простои, качество, планы и KPI завода.",
    version="1.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory="static"), name="static")
install_auth(app, connect)


class InputModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class LineRunIn(InputModel):
    work_date: date
    line: str = Field(min_length=1, max_length=100)
    planned_units: int = Field(ge=0)
    actual_units: int = Field(ge=0)
    operating_hours: float = Field(ge=0, le=24)
    utilization_percent: float = Field(ge=0, le=100)


class DowntimeIn(InputModel):
    work_date: date
    area: str = Field(min_length=1, max_length=100)
    equipment: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=500)
    duration_minutes: int = Field(ge=0)
    is_critical: bool = True


class PlanIn(InputModel):
    model: str = Field(min_length=1, max_length=120)
    monthly_plan: int = Field(ge=0)


class QualityIn(InputModel):
    work_date: date
    area: str = Field(min_length=1, max_length=100)
    produced: int = Field(ge=0)
    defects: int = Field(ge=0)


class ShiftEntryIn(InputModel):
    work_date: date
    area: str = Field(min_length=1, max_length=100)
    planned_units: int = Field(ge=0)
    actual_units: int = Field(ge=0)
    operating_hours: float = Field(ge=0, le=24)
    utilization_percent: float = Field(ge=0, le=100)
    produced: int = Field(ge=0)
    defects: int = Field(ge=0)
    equipment: str = Field(default="", max_length=100)
    downtime_reason: str = Field(default="", max_length=500)
    downtime_minutes: int = Field(default=0, ge=0)
    is_critical: bool = True

    @model_validator(mode="after")
    def validate_shift(self):
        if self.area not in AREAS:
            raise ValueError("Неизвестный производственный участок")
        if self.defects > self.produced:
            raise ValueError("Брак не может превышать выпуск")
        has_downtime = bool(self.equipment or self.downtime_reason or self.downtime_minutes)
        if has_downtime and not (self.equipment.strip() and self.downtime_reason.strip() and self.downtime_minutes > 0):
            raise ValueError("Для простоя укажите оборудование, причину и длительность")
        return self


class AssetIn(InputModel):
    name: str = Field(min_length=1, max_length=100)
    area: str = Field(min_length=1, max_length=100)
    status: str = Field(default="working", pattern="^(working|maintenance|stopped)$")
    last_maintenance: date | None = None
    next_maintenance: date
    notes: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_asset(self):
        if self.area not in AREAS:
            raise ValueError("Неизвестный производственный участок")
        if self.last_maintenance and self.last_maintenance > self.next_maintenance:
            raise ValueError("Дата следующего ТО должна быть не раньше последнего ТО")
        return self


def rows(query: str, params: tuple = ()) -> list[dict]:
    with connect() as db:
        return [dict(row) for row in db.execute(query, params).fetchall()]


def insert(table: str, payload: dict, fields: tuple[str, ...]) -> dict:
    values = {key: payload[key] for key in fields}
    values = {k: (v.isoformat() if isinstance(v, date) else int(v) if isinstance(v, bool) else v)
              for k, v in values.items()}
    columns = ",".join(values)
    marks = ",".join("?" for _ in values)
    try:
        with connect() as db:
            cur = db.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(values.values()))
            result = db.execute(f"SELECT * FROM {table} WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(result)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, str(exc)) from exc


def date_filters(start: date | None, end: date | None, column: str = "work_date") -> tuple[str, tuple]:
    clauses, params = [], []
    if start:
        clauses.append(f"{column} >= ?"); params.append(start.isoformat())
    if end:
        clauses.append(f"{column} <= ?"); params.append(end.isoformat())
    return (" WHERE " + " AND ".join(clauses) if clauses else "", tuple(params))


def validate_range(start: date | None, end: date | None) -> None:
    if start and end and start > end:
        raise HTTPException(422, "start_date must be before or equal to end_date")


def scoped_filters(start: date | None, end: date | None, area: str | None, column: str) -> tuple[str, tuple]:
    where, params = date_filters(start, end)
    if area:
        if area not in AREAS:
            raise HTTPException(422, "Unknown production area")
        where += (" AND " if where else " WHERE ") + f"{column} = ?"
        params += (area,)
    return where, params


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "allur-factory-digital-twin"}


@app.get("/api/lines")
def get_lines(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    where, params = date_filters(start_date, end_date)
    if area:
        if area not in AREAS:
            raise HTTPException(422, "Unknown production area")
        where += (" AND " if where else " WHERE ") + "line = ?"
        params += (AREAS[area],)
    return rows(f"SELECT * FROM line_runs{where} ORDER BY work_date,line", params)


@app.post("/api/lines", status_code=201)
def add_line(record: LineRunIn):
    return insert("line_runs", record.model_dump(), ("work_date", "line", "planned_units", "actual_units", "operating_hours", "utilization_percent"))


@app.get("/api/downtimes")
def get_downtimes(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    where, params = scoped_filters(start_date, end_date, area, "area")
    return rows(f"SELECT * FROM downtimes{where} ORDER BY work_date,equipment", params)


@app.post("/api/downtimes", status_code=201)
def add_downtime(record: DowntimeIn):
    return insert("downtimes", record.model_dump(), ("work_date", "area", "equipment", "reason", "duration_minutes", "is_critical"))


@app.get("/api/plans")
def get_plans():
    return rows("SELECT * FROM production_plans ORDER BY model")


@app.post("/api/plans", status_code=201)
def add_plan(record: PlanIn):
    return insert("production_plans", record.model_dump(), ("model", "monthly_plan"))


@app.put("/api/plans/{plan_id}")
def update_plan(plan_id: int, record: PlanIn):
    with connect() as db:
        try:
            cur = db.execute("UPDATE production_plans SET model=?,monthly_plan=? WHERE id=?", (record.model, record.monthly_plan, plan_id))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, str(exc)) from exc
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        return dict(db.execute("SELECT * FROM production_plans WHERE id=?", (plan_id,)).fetchone())


@app.delete("/api/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int):
    with connect() as db:
        cur = db.execute("DELETE FROM production_plans WHERE id=?", (plan_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")


@app.get("/api/quality")
def get_quality(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    where, params = scoped_filters(start_date, end_date, area, "area")
    return rows(f"""SELECT id,work_date,area,produced,defects,
        CASE WHEN produced=0 THEN 0 ELSE ROUND(defects*100.0/produced,2) END AS defect_rate_percent
        FROM quality_records{where} ORDER BY work_date,area""", params)


@app.post("/api/quality", status_code=201)
def add_quality(record: QualityIn):
    if record.defects > record.produced:
        raise HTTPException(422, "defects cannot exceed produced")
    result = insert("quality_records", record.model_dump(), ("work_date", "area", "produced", "defects"))
    result["defect_rate_percent"] = round(result["defects"] * 100 / result["produced"], 2) if result["produced"] else 0
    return result


@app.post("/api/shift-entry", status_code=201)
def add_shift_entry(record: ShiftEntryIn):
    line_name = AREAS[record.area]
    with connect() as db:
        db.execute("INSERT INTO line_runs (work_date,line,planned_units,actual_units,operating_hours,utilization_percent) VALUES (?,?,?,?,?,?)",
                   (record.work_date.isoformat(), line_name, record.planned_units, record.actual_units, record.operating_hours, record.utilization_percent))
        db.execute("INSERT INTO quality_records (work_date,area,produced,defects) VALUES (?,?,?,?)",
                   (record.work_date.isoformat(), record.area, record.produced, record.defects))
        if record.downtime_minutes:
            db.execute("INSERT INTO downtimes (work_date,area,equipment,reason,duration_minutes,is_critical) VALUES (?,?,?,?,?,?)",
                       (record.work_date.isoformat(), record.area, record.equipment, record.downtime_reason, record.downtime_minutes, int(record.is_critical)))
    log_event("shift_entry", "warning" if record.downtime_minutes else "info", f"Смена внесена: {record.area}",
              {"date": record.work_date.isoformat(), "actual_units": record.actual_units, "defects": record.defects})
    return {"status": "created", "area": record.area, "work_date": record.work_date.isoformat()}


@app.get("/api/production-flow")
def production_flow():
    return [
        {"sequence": i, "name": name}
        for i, name in enumerate(("Склад комплектующих", "Сварка", "Окраска", "Сборка", "Контроль качества", "Склад готовой продукции"), 1)
    ]


@app.get("/api/dashboard")
def dashboard(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    if area and area not in AREAS:
        raise HTTPException(422, "Unknown production area")
    where, params = date_filters(start_date, end_date)
    if area:
        where += (" AND " if where else " WHERE ") + "line = ?"
        params += (AREAS[area],)
    line_data = rows(f"SELECT * FROM line_runs{where}", params)
    quality_where, quality_params = scoped_filters(start_date, end_date, area, "area")
    quality = rows(f"SELECT * FROM quality_records{quality_where}", quality_params)
    downtime_where, downtime_params = scoped_filters(start_date, end_date, area, "area")
    downtimes = rows(f"SELECT * FROM downtimes{downtime_where}", downtime_params)
    with connect() as db:
        monthly_plan = db.execute("SELECT COALESCE(SUM(monthly_plan),0) FROM production_plans").fetchone()[0]
    # Count finished vehicles once, at final assembly, rather than summing the same units at each stage.
    finished_line_data = line_data if area else [r for r in line_data if r["line"].startswith("\u0421\u0431\u043e\u0440\u043a\u0430")]
    planned = sum(r["planned_units"] for r in finished_line_data)
    actual = sum(r["actual_units"] for r in finished_line_data)
    utilization = sum(r["utilization_percent"] for r in line_data) / len(line_data) if line_data else 0
    defect_total = sum(r["defects"] for r in quality)
    produced_total = sum(r["produced"] for r in quality)
    defect_rate = defect_total * 100 / produced_total if produced_total else 0
    attainment = actual * 100 / planned if planned else 0
    # Proxy OEE from available case fields: utilization × plan attainment × quality yield.
    oee = utilization * min(attainment, 100) / 100 * (100 - defect_rate) / 100
    daily_equipment: dict[tuple[str, str], int] = {}
    for item in downtimes:
        if item["is_critical"]:
            key = (item["work_date"], item["equipment"])
            daily_equipment[key] = daily_equipment.get(key, 0) + item["duration_minutes"]
    alerts = []
    if oee < TARGET_OEE:
        alerts.append({"code": "LOW_OEE", "severity": "warning", "value": round(oee, 2), "limit": TARGET_OEE, "message": "OEE ниже целевого уровня 85%"})
    if defect_rate > MAX_DEFECT_RATE:
        alerts.append({"code": "HIGH_DEFECT_RATE", "severity": "critical", "value": round(defect_rate, 2), "limit": MAX_DEFECT_RATE, "message": "Доля брака превышает допустимые 2%"})
    for (work_day, equipment), minutes in daily_equipment.items():
        if minutes > MAX_CRITICAL_DOWNTIME_MINUTES:
            alerts.append({"code": "CRITICAL_DOWNTIME", "severity": "critical", "date": work_day, "equipment": equipment, "value": minutes, "limit": MAX_CRITICAL_DOWNTIME_MINUTES, "message": "Превышен суточный лимит простоя оборудования"})
    if monthly_plan < MONTHLY_OUTPUT_TARGET:
        alerts.append({"code": "LOW_MONTHLY_PLAN", "severity": "warning", "value": monthly_plan, "limit": MONTHLY_OUTPUT_TARGET, "message": "План моделей ниже целевого выпуска 5 500 автомобилей в месяц"})
    return {
        "period": {"start_date": start_date, "end_date": end_date},
        "kpis": {
            "oee_percent": round(oee, 2), "oee_target_percent": TARGET_OEE,
            "plan_attainment_percent": round(attainment, 2), "planned_units": planned, "actual_units": actual,
            "average_utilization_percent": round(utilization, 2),
            "defect_rate_percent": round(defect_rate, 2), "defect_rate_limit_percent": MAX_DEFECT_RATE,
            "downtime_minutes": sum(x["duration_minutes"] for x in downtimes),
            "monthly_plan_units": monthly_plan, "monthly_output_target_units": MONTHLY_OUTPUT_TARGET,
        },
        "alerts": alerts,
    }


@app.get("/api/alerts")
def get_alerts(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    return dashboard(start_date, end_date, area)["alerts"]


@app.get("/api/reports.csv")
def export_report(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    if area and area not in AREAS:
        raise HTTPException(422, "Unknown production area")
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    def write_row(*values):
        safe = [("'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value) for value in values]
        writer.writerow(safe)
    write_row("Раздел", "Дата", "Участок", "Объект", "Значение", "Единица")
    line_where, line_params = date_filters(start_date, end_date)
    if area:
        line_where += (" AND " if line_where else " WHERE ") + "line = ?"
        line_params += (AREAS[area],)
    for item in rows(f"SELECT * FROM line_runs{line_where} ORDER BY work_date,line", line_params):
        write_row("Производство", item["work_date"], item["line"], "Выпуск", item["actual_units"], "авто")
        write_row("Производство", item["work_date"], item["line"], "Загрузка", item["utilization_percent"], "%")
    for table, section, value_field, unit in (("quality_records", "Качество", "defects", "шт брака"), ("downtimes", "Простои", "duration_minutes", "мин")):
        where, params = scoped_filters(start_date, end_date, area, "area")
        for item in rows(f"SELECT * FROM {table}{where} ORDER BY work_date,area", params):
            label = "Брак" if table == "quality_records" else item["equipment"]
            write_row(section, item["work_date"], item["area"], label, item[value_field], unit)
    content = "\ufeff" + output.getvalue()
    return Response(content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=ro-factory-report.csv"})


AREAS = {
    "\u0421\u0432\u0430\u0440\u043a\u0430": "\u0421\u0432\u0430\u0440\u043a\u0430-1",
    "\u041e\u043a\u0440\u0430\u0441\u043a\u0430": "\u041e\u043a\u0440\u0430\u0441\u043a\u0430-1",
    "\u0421\u0431\u043e\u0440\u043a\u0430": "\u0421\u0431\u043e\u0440\u043a\u0430-1",
}


def log_event(event_type: str, severity: str, title: str, details: dict) -> dict:
    with connect() as db:
        cur = db.execute(
            "INSERT INTO event_log (created_at,event_type,severity,title,details) VALUES (?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), event_type, severity, title, json.dumps(details, ensure_ascii=False)),
        )
        row = db.execute("SELECT * FROM event_log WHERE id=?", (cur.lastrowid,)).fetchone()
    result = dict(row)
    result["details"] = json.loads(result["details"])
    return result


class SimulationIn(InputModel):
    scenario: str = Field(default="normal", pattern="^(normal|failure|quality)$")


class EventNoteIn(InputModel):
    title: str = Field(min_length=1, max_length=160)
    details: dict = Field(default_factory=dict)


@app.get("/")
def dashboard_page():
    return FileResponse("static/index.html")


@app.get("/api/factory-state")
def factory_state(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    if area and area not in AREAS:
        raise HTTPException(422, "Unknown production area")
    latest_where, latest_params = date_filters(start_date, end_date)
    if area:
        latest_where += (" AND " if latest_where else " WHERE ") + "line = ?"
        latest_params += (AREAS[area],)
    latest = rows(f"SELECT MAX(work_date) AS work_date FROM line_runs{latest_where}", latest_params)[0]["work_date"]
    if latest is None:
        return {"date": None, "areas": []}
    lines = rows("SELECT * FROM line_runs WHERE work_date=? ORDER BY id DESC", (latest,))
    quality = rows("SELECT * FROM quality_records WHERE work_date=? ORDER BY id DESC", (latest,))
    downtimes = rows("SELECT * FROM downtimes WHERE work_date=?", (latest,))
    result = []
    for area, line_name in AREAS.items():
        line = next((x for x in lines if x["line"] == line_name), None)
        q = next((x for x in quality if x["area"] == area), None)
        area_downs = [x for x in downtimes if x["area"] == area]
        down_minutes = sum(x["duration_minutes"] for x in area_downs)
        defect_rate = q["defects"] * 100 / q["produced"] if q and q["produced"] else 0
        if down_minutes >= MAX_CRITICAL_DOWNTIME_MINUTES or defect_rate > MAX_DEFECT_RATE:
            status = "critical"
        elif (line and line["utilization_percent"] < 95) or down_minutes > 0 or defect_rate > 1:
            status = "warning"
        else:
            status = "normal"
        result.append({
            "area": area, "line": line_name, "status": status,
            "utilization_percent": line["utilization_percent"] if line else None,
            "actual_units": line["actual_units"] if line else 0,
            "planned_units": line["planned_units"] if line else 0,
            "defect_rate_percent": round(defect_rate, 2),
            "downtime_minutes": down_minutes,
            "equipment": [x["equipment"] for x in area_downs],
        })
    return {"date": latest, "areas": [item for item in result if not area or item["area"] == area]}


@app.get("/api/equipment")
def get_equipment(area: str | None = None):
    where, params = scoped_filters(None, None, area, "a.area")
    return rows(f"""SELECT a.*,
        COALESCE((SELECT SUM(d.duration_minutes) FROM downtimes d WHERE d.equipment=a.name),0) AS total_downtime_minutes,
        (SELECT MAX(d.work_date) FROM downtimes d WHERE d.equipment=a.name) AS last_incident
        FROM equipment_assets a{where} ORDER BY a.next_maintenance,a.name""", params)


@app.post("/api/equipment", status_code=201)
def add_equipment(record: AssetIn):
    return insert("equipment_assets", record.model_dump(), ("name", "area", "status", "last_maintenance", "next_maintenance", "notes"))


@app.put("/api/equipment/{asset_id}")
def update_equipment(asset_id: int, record: AssetIn):
    data = record.model_dump()
    values = tuple(value.isoformat() if isinstance(value, date) else value for value in data.values())
    try:
        with connect() as db:
            cursor = db.execute("UPDATE equipment_assets SET name=?,area=?,status=?,last_maintenance=?,next_maintenance=?,notes=? WHERE id=?", (*values, asset_id))
            if not cursor.rowcount:
                raise HTTPException(404, "Оборудование не найдено")
            return dict(db.execute("SELECT * FROM equipment_assets WHERE id=?", (asset_id,)).fetchone())
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "Оборудование с таким названием уже существует") from exc


@app.get("/api/recommendations")
def recommendations(start_date: date | None = None, end_date: date | None = None, area: str | None = None):
    validate_range(start_date, end_date)
    where, params = scoped_filters(start_date, end_date, area, "area")
    quality = rows(f"SELECT area,SUM(produced) produced,SUM(defects) defects FROM quality_records{where} GROUP BY area", params)
    downtime = rows(f"SELECT area,SUM(duration_minutes) minutes FROM downtimes{where} GROUP BY area", params)
    suggestions = []
    if quality:
        worst = max(quality, key=lambda x: x["defects"] / x["produced"] if x["produced"] else 0)
        rate = worst["defects"] * 100 / worst["produced"] if worst["produced"] else 0
        if rate > MAX_DEFECT_RATE:
            suggestions.append({"type": "quality", "priority": "high", "area": worst["area"],
                "title": f"\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u043e \u043d\u0430 \u0443\u0447\u0430\u0441\u0442\u043a\u0435 \u00ab{worst['area']}\u00bb",
                "reason": f"\u0411\u0440\u0430\u043a {rate:.1f}% \u043f\u0440\u0438 \u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u043e\u043c \u0443\u0440\u043e\u0432\u043d\u0435 {MAX_DEFECT_RATE:.0f}%.",
                "action": "\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043e\u0431\u043e\u0440\u0443\u0434\u043e\u0432\u0430\u043d\u0438\u044f \u0438 \u043f\u0435\u0440\u0432\u0443\u044e \u0434\u0435\u0442\u0430\u043b\u044c \u043f\u043e\u0441\u043b\u0435 \u043f\u0435\u0440\u0435\u043d\u0430\u043b\u0430\u0434\u043a\u0438; \u0443\u0441\u0438\u043b\u0438\u0442\u044c \u0432\u044b\u0431\u043e\u0440\u043e\u0447\u043d\u044b\u0439 \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044c."})
    if downtime:
        worst = max(downtime, key=lambda x: x["minutes"])
        if worst["minutes"]:
            suggestions.append({"type": "maintenance", "priority": "high" if worst["minutes"] >= 60 else "medium", "area": worst["area"],
                "title": f"\u0421\u043d\u0438\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0441\u0442\u043e\u0438 \u043d\u0430 \u0443\u0447\u0430\u0441\u0442\u043a\u0435 \u00ab{worst['area']}\u00bb",
                "reason": f"\u0417\u0430 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043f\u0435\u0440\u0438\u043e\u0434 \u043f\u0440\u043e\u0441\u0442\u043e\u0438 \u0441\u043e\u0441\u0442\u0430\u0432\u0438\u043b\u0438 {worst['minutes']} \u043c\u0438\u043d.",
                "action": "\u0421\u0432\u0435\u0440\u0438\u0442\u044c\u0441\u044f \u0441 \u0436\u0443\u0440\u043d\u0430\u043b\u043e\u043c \u043e\u0442\u043a\u0430\u0437\u043e\u0432 \u0438 \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u0434\u043b\u044f \u043e\u0431\u0441\u043b\u0443\u0436\u0438\u0432\u0430\u043d\u0438\u044f."})
    if not suggestions:
        suggestions.append({"type": "operations", "priority": "low", "title": "\u041a\u0440\u0438\u0442\u0438\u0447\u043d\u044b\u0445 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u0439 \u043d\u0435\u0442", "reason": "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u0438 \u0432 \u043f\u0440\u0435\u0434\u0435\u043b\u0430\u0445 \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044c\u043d\u044b\u0445 \u043f\u043e\u0440\u043e\u0433\u043e\u0432.", "action": "\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0442\u044c \u043c\u043e\u043d\u0438\u0442\u043e\u0440\u0438\u043d\u0433 \u043f\u043e \u0441\u043c\u0435\u043d\u0430\u043c."})
    return suggestions


@app.get("/api/plan-recommendation")
def plan_recommendation():
    plans = rows("SELECT * FROM production_plans ORDER BY model")
    current = sum(item["monthly_plan"] for item in plans)
    gap = max(0, MONTHLY_OUTPUT_TARGET - current)
    allocations = []
    remaining = gap
    for index, item in enumerate(plans):
        extra = remaining if index == len(plans) - 1 else round(gap * item["monthly_plan"] / (current or len(plans) or 1))
        remaining -= extra
        allocations.append({"id": item["id"], "model": item["model"], "current": item["monthly_plan"], "additional": extra, "suggested": item["monthly_plan"] + extra})
    return {"current_total": current, "target": MONTHLY_OUTPUT_TARGET, "gap": gap, "allocations": allocations}


@app.get("/api/events")
def get_events(limit: int = 50):
    if not 1 <= limit <= 200:
        raise HTTPException(422, "limit must be between 1 and 200")
    events = rows("SELECT * FROM event_log ORDER BY id DESC LIMIT ?", (limit,))
    for event in events:
        event["details"] = json.loads(event["details"])
    return events


@app.post("/api/event-note", status_code=201)
def add_event_note(record: EventNoteIn):
    return log_event("operator_action", "info", record.title, record.details)


@app.post("/api/simulation/shift")
def simulate_shift(request: SimulationIn):
    with connect() as db:
        last = db.execute("SELECT MAX(work_date) FROM line_runs").fetchone()[0]
    work_day = max(date.today(), date.fromisoformat(last) + timedelta(days=1)) if last else date.today()
    previous = dashboard(date.fromisoformat(last), date.fromisoformat(last)) if last else dashboard()
    scenario = request.scenario
    values = {"\u0421\u0432\u0430\u0440\u043a\u0430": (118, 96.0), "\u041e\u043a\u0440\u0430\u0441\u043a\u0430": (116, 95.0), "\u0421\u0431\u043e\u0440\u043a\u0430": (120, 98.0)}
    if scenario == "failure":
        values["\u041e\u043a\u0440\u0430\u0441\u043a\u0430"] = (78, 67.0)
    for area, line_name in AREAS.items():
        actual, utilization = values[area]
        defects = 8 if scenario == "quality" and area == "\u041e\u043a\u0440\u0430\u0441\u043a\u0430" else {"\u0421\u0432\u0430\u0440\u043a\u0430": 2, "\u041e\u043a\u0440\u0430\u0441\u043a\u0430": 2, "\u0421\u0431\u043e\u0440\u043a\u0430": 1}[area]
        with connect() as db:
            db.execute("INSERT INTO line_runs (work_date,line,planned_units,actual_units,operating_hours,utilization_percent) VALUES (?,?,?,?,?,?)", (work_day.isoformat(), line_name, 120, actual, round(8 * utilization / 100, 1), utilization))
            db.execute("INSERT INTO quality_records (work_date,area,produced,defects) VALUES (?,?,?,?)", (work_day.isoformat(), area, actual, defects))
    if scenario == "failure":
        values["Сборка"] = (78, 67.0)
        with connect() as db:
            db.execute("INSERT INTO downtimes (work_date,area,equipment,reason,duration_minutes,is_critical) VALUES (?,?,?,?,?,1)", (work_day.isoformat(), "\u041e\u043a\u0440\u0430\u0441\u043a\u0430", "\u041a\u0430\u043c\u0435\u0440\u0430-02", "\u041f\u0435\u0440\u0435\u0433\u0440\u0435\u0432 \u0432\u0435\u043d\u0442\u0438\u043b\u044f\u0442\u043e\u0440\u0430", 68))
        log_event("simulation", "critical", "\u0421\u0431\u043e\u0439 \u043a\u0430\u043c\u0435\u0440\u044b \u043e\u043a\u0440\u0430\u0441\u043a\u0438 \u0441\u043c\u043e\u0434\u0435\u043b\u0438\u0440\u043e\u0432\u0430\u043d", {"date": work_day.isoformat(), "equipment": "\u041a\u0430\u043c\u0435\u0440\u0430-02", "duration_minutes": 68})
    elif scenario == "quality":
        log_event("simulation", "warning", "\u0420\u043e\u0441\u0442 \u0431\u0440\u0430\u043a\u0430 \u043d\u0430 \u043e\u043a\u0440\u0430\u0441\u043a\u0435 \u0441\u043c\u043e\u0434\u0435\u043b\u0438\u0440\u043e\u0432\u0430\u043d", {"date": work_day.isoformat(), "defects": 8})
    else:
        log_event("simulation", "info", "\u0421\u0438\u043c\u0443\u043b\u044f\u0446\u0438\u044f \u0441\u043c\u0435\u043d\u044b \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430", {"date": work_day.isoformat(), "scenario": scenario})
    current = dashboard(work_day, work_day)
    comparison_keys = ("actual_units", "oee_percent", "defect_rate_percent", "downtime_minutes")
    comparison = {key: {"before": previous["kpis"][key], "after": current["kpis"][key],
                        "change": round(current["kpis"][key] - previous["kpis"][key], 2)}
                  for key in comparison_keys}
    recommendations = {
        "failure": {"action": "Проверить вентилятор камеры окраски и выполнить внеплановое ТО.",
                    "expected_effect": "После устранения узкого места выпуск может вернуться к штатному уровню около 120 автомобилей за смену."},
        "quality": {"action": "Проверить настройки камеры окраски и усилить контроль первой детали после переналадки.",
                    "expected_effect": "Целевой уровень брака — не более 2%; достижение цели нужно подтвердить следующей сменой."},
        "normal": {"action": "Продолжать мониторинг загрузки и качества участков.",
                   "expected_effect": "Сохранить выпуск около 120 автомобилей за смену при текущих настройках."},
    }
    log_event("simulation_comparison", "info", "Сравнение смен до и после симуляции",
              {"date": work_day.isoformat(), "scenario": scenario, "comparison": comparison, "recommendation": recommendations[scenario]})
    return {"date": work_day.isoformat(), "scenario": scenario, "dashboard": current,
            "comparison": comparison, "recommendation": recommendations[scenario]}


@app.post("/api/simulation/reset")
def reset_simulation():
    with connect() as db:
        for table in ("event_log", "line_runs", "downtimes", "production_plans", "quality_records"):
            db.execute(f"DELETE FROM {table}")
    setup_database()
    log_event("simulation", "info", "\u0414\u0435\u043c\u043e-\u0434\u0430\u043d\u043d\u044b\u0435 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u044b", {})
    return {"status": "reset"}
