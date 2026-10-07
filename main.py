"""Backend API for the Allur factory digital-twin case."""

from __future__ import annotations

import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field


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


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_database()
    yield


app = FastAPI(
    title="Allur Factory Digital Twin API",
    description="Производственные линии, простои, качество, планы и KPI завода.",
    version="1.0.0",
    lifespan=lifespan,
)


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


RangeArgs = tuple[date | None, date | None]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "allur-factory-digital-twin"}


@app.get("/api/lines")
def get_lines(start_date: date | None = None, end_date: date | None = None):
    validate_range(start_date, end_date)
    where, params = date_filters(start_date, end_date)
    return rows(f"SELECT * FROM line_runs{where} ORDER BY work_date,line", params)


@app.post("/api/lines", status_code=201)
def add_line(record: LineRunIn):
    return insert("line_runs", record.model_dump(), ("work_date", "line", "planned_units", "actual_units", "operating_hours", "utilization_percent"))


@app.get("/api/downtimes")
def get_downtimes(start_date: date | None = None, end_date: date | None = None):
    validate_range(start_date, end_date)
    where, params = date_filters(start_date, end_date)
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
def get_quality(start_date: date | None = None, end_date: date | None = None):
    validate_range(start_date, end_date)
    where, params = date_filters(start_date, end_date)
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


@app.get("/api/production-flow")
def production_flow():
    return [
        {"sequence": i, "name": name}
        for i, name in enumerate(("Склад комплектующих", "Сварка", "Окраска", "Сборка", "Контроль качества", "Склад готовой продукции"), 1)
    ]


@app.get("/api/dashboard")
def dashboard(start_date: date | None = None, end_date: date | None = None):
    validate_range(start_date, end_date)
    where, params = date_filters(start_date, end_date)
    line_data = rows(f"SELECT * FROM line_runs{where}", params)
    quality = rows(f"SELECT * FROM quality_records{where}", params)
    downtime_where, downtime_params = date_filters(start_date, end_date)
    downtimes = rows(f"SELECT * FROM downtimes{downtime_where}", downtime_params)
    with connect() as db:
        monthly_plan = db.execute("SELECT COALESCE(SUM(monthly_plan),0) FROM production_plans").fetchone()[0]
    planned = sum(r["planned_units"] for r in line_data)
    actual = sum(r["actual_units"] for r in line_data)
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
def get_alerts(start_date: date | None = None, end_date: date | None = None):
    return dashboard(start_date, end_date)["alerts"]
