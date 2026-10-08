"""SQLite-backed users, password hashes and opaque browser sessions."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator

COOKIE = 'ro_factory_session'
SESSION_SECONDS = 8 * 60 * 60
ITERATIONS = 600_000
DUMMY_HASH = None


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, ITERATIONS)
    return f'pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}'


def password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256':
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def public_user(row) -> dict:
    return {key: row[key] for key in ('id', 'username', 'name', 'role', 'is_active', 'created_at')}


def record_audit(connect, actor, action: str, entity_type: str, entity_id=None, details: dict | None = None) -> None:
    actor = dict(actor) if actor is not None else {}
    with connect() as db:
        db.execute('''INSERT INTO audit_log
            (created_at,actor_id,actor_username,action,entity_type,entity_id,details)
            VALUES(?,?,?,?,?,?,?)''',
            (int(time.time()), actor.get('id'), actor.get('username', 'system'), action,
             entity_type, str(entity_id) if entity_id is not None else None,
             json.dumps(details or {}, ensure_ascii=False)))


def setup_auth(connect) -> None:
    global DUMMY_HASH
    if DUMMY_HASH is None:
        DUMMY_HASH = password_hash(secrets.token_urlsafe(24))
    with connect() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','user')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                csrf_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS auth_session_expiry ON auth_sessions(expires_at);
            CREATE TABLE IF NOT EXISTS auth_login_attempts (
                bucket TEXT NOT NULL,
                attempted_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS auth_attempt_bucket ON auth_login_attempts(bucket, attempted_at);
        ''')


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class NewUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=128)
    role: Literal['admin', 'user'] = 'user'

    @field_validator('username')
    @classmethod
    def valid_username(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[a-z0-9_.@-]{3,80}', value):
            raise ValueError('Логин: латинские буквы, цифры, _, ., @ или -')
        return value

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError('Введите имя')
        return value.strip()


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError('Введите имя')
        return value.strip()


class PasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class ActiveIn(BaseModel):
    is_active: bool


def create_user(connect, payload: NewUserIn) -> dict:
    encoded = password_hash(payload.password)
    try:
        with connect() as db:
            cursor = db.execute('INSERT INTO auth_users(username,name,password_hash,role,created_at) VALUES(?,?,?,?,?)',
                                (payload.username, payload.name, encoded, payload.role, int(time.time())))
            return public_user(db.execute('SELECT * FROM auth_users WHERE id=?', (cursor.lastrowid,)).fetchone())
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Этот логин уже занят')


def install_auth(app, connect) -> None:
    def resolve_session(request):
        token = request.cookies.get(COOKIE, '')
        if not token or len(token) > 200:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect() as db:
            row = db.execute('''SELECT u.*, s.csrf_token, s.token_hash FROM auth_sessions s
                JOIN auth_users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1''', (token_hash, int(time.time()))).fetchone()
        return dict(row) if row else None

    def admin(request):
        if request.state.user['role'] != 'admin':
            raise HTTPException(403, 'Доступ только для администратора')

    @app.middleware('http')
    async def authorization(request: Request, call_next):
        path = request.url.path
        protected = path.startswith('/api/') or path in ('/', '/docs', '/redoc', '/openapi.json')
        user = resolve_session(request) if protected or path == '/login' else None
        request.state.user = user
        if path == '/login' and user:
            return RedirectResponse('/#cabinet', status_code=303)
        if protected and path != '/api/auth/login':
            if not user:
                if path == '/':
                    return RedirectResponse('/login', status_code=303)
                return JSONResponse({'detail': 'Войдите в аккаунт'}, status_code=401, headers={'Cache-Control': 'no-store'})
            action_workflow_update = request.method == 'PATCH' and path.startswith('/api/actions/')
            if (path.startswith('/api/admin/') or path in ('/docs', '/redoc', '/openapi.json') or
                (request.method not in ('GET', 'HEAD', 'OPTIONS') and not path.startswith('/api/auth/')
                 and not action_workflow_update)) and user['role'] != 'admin':
                return JSONResponse({'detail': 'Доступ только для администратора'}, status_code=403)
        if path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            # A same-origin JSON client plus session-bound CSRF token protects cookie-authenticated writes.
            origin = request.headers.get('origin')
            if origin:
                parsed = urlsplit(origin)
                if parsed.scheme != request.url.scheme or parsed.netloc != request.headers.get('host'):
                    return JSONResponse({'detail': 'Недопустимый источник запроса'}, status_code=403)
            if user and path != '/api/auth/login' and not hmac.compare_digest(request.headers.get('x-csrf-token', '').encode(), user['csrf_token'].encode()):
                return JSONResponse({'detail': 'Обновите страницу и повторите действие'}, status_code=403)
        response = await call_next(request)
        if (user and path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS')
                and path != '/api/auth/login' and response.status_code < 400):
            route = request.scope.get('route')
            route_path = getattr(route, 'path', path)
            entity_type = route_path.strip('/').split('/')[1] if len(route_path.strip('/').split('/')) > 1 else 'api'
            entity_id = next(iter(request.path_params.values()), None)
            record_audit(connect, user, f'{request.method} {route_path}', entity_type, entity_id,
                         {'status_code': response.status_code})
        if protected or path == '/login':
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Referrer-Policy'] = 'same-origin'
        return response

    @app.get('/login', include_in_schema=False)
    def login_page():
        return FileResponse('static/login.html')

    @app.post('/api/auth/login')
    def login(payload: LoginIn, request: Request, response: Response):
        username = payload.username.strip().lower()
        ip = request.client.host if request.client else 'unknown'
        buckets = [hashlib.sha256(('user:'+username).encode()).hexdigest(), hashlib.sha256(('ip:'+ip).encode()).hexdigest()]
        now = int(time.time())
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM auth_login_attempts WHERE attempted_at<?', (now-900,))
            for bucket, limit in zip(buckets, (10, 50)):
                count = db.execute('SELECT COUNT(*) FROM auth_login_attempts WHERE bucket=?', (bucket,)).fetchone()[0]
                if count >= limit:
                    raise HTTPException(429, 'Слишком много попыток. Повторите через 15 минут.', headers={'Retry-After': '900'})
            db.executemany('INSERT INTO auth_login_attempts VALUES(?,?)', [(b, now) for b in buckets])
            row = db.execute('SELECT * FROM auth_users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
        valid = password_matches(payload.password, row['password_hash'] if row else DUMMY_HASH)
        if not row or not valid or not row['is_active']:
            raise HTTPException(401, 'Неверный логин или пароль')
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with connect() as db:
            db.execute('DELETE FROM auth_sessions WHERE expires_at<=?', (now,))
            old = request.cookies.get(COOKIE, '')
            if old:
                db.execute('DELETE FROM auth_sessions WHERE token_hash=?', (hashlib.sha256(old.encode()).hexdigest(),))
            db.execute('INSERT INTO auth_sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), row['id'], csrf, now+SESSION_SECONDS))
            db.execute('DELETE FROM auth_login_attempts WHERE bucket=?', (buckets[0],))
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=os.getenv('AUTH_COOKIE_SECURE', '0') == '1', samesite='strict', path='/')
        record_audit(connect, dict(row), 'login', 'session', details={'ip': ip})
        return {'user': public_user(row), 'csrf_token': csrf}

    @app.get('/api/auth/me')
    def me(request: Request):
        return {'user': public_user(request.state.user), 'csrf_token': request.state.user['csrf_token']}

    @app.post('/api/auth/logout', status_code=204)
    def logout(request: Request, response: Response):
        with connect() as db:
            db.execute('DELETE FROM auth_sessions WHERE token_hash=?', (request.state.user['token_hash'],))
        response.delete_cookie(COOKIE, path='/', httponly=True, samesite='strict', secure=os.getenv('AUTH_COOKIE_SECURE', '0') == '1')

    @app.patch('/api/auth/profile')
    def profile(payload: ProfileIn, request: Request):
        with connect() as db:
            db.execute('UPDATE auth_users SET name=? WHERE id=?', (payload.name, request.state.user['id']))
            row = db.execute('SELECT * FROM auth_users WHERE id=?', (request.state.user['id'],)).fetchone()
        return public_user(row)

    @app.post('/api/auth/password', status_code=204)
    def change_password(payload: PasswordIn, request: Request):
        if not password_matches(payload.current_password, request.state.user['password_hash']):
            raise HTTPException(400, 'Текущий пароль указан неверно')
        with connect() as db:
            db.execute('UPDATE auth_users SET password_hash=? WHERE id=?', (password_hash(payload.new_password), request.state.user['id']))
            db.execute('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?', (request.state.user['id'], request.state.user['token_hash']))

    @app.get('/api/admin/users')
    def users(request: Request):
        admin(request)
        with connect() as db:
            return [public_user(row) for row in db.execute('SELECT * FROM auth_users ORDER BY id')]

    @app.post('/api/admin/users', status_code=201)
    def add_user(payload: NewUserIn, request: Request):
        admin(request)
        return create_user(connect, payload)

    @app.patch('/api/admin/users/{user_id}')
    def set_active(user_id: int, payload: ActiveIn, request: Request):
        admin(request)
        if user_id == request.state.user['id']:
            raise HTTPException(400, 'Нельзя заблокировать свой аккаунт')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM auth_users WHERE id=?', (user_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Пользователь не найден')
            if row['role'] == 'admin' and row['is_active'] and not payload.is_active:
                remaining = db.execute("SELECT COUNT(*) FROM auth_users WHERE role='admin' AND is_active=1 AND id<>?", (user_id,)).fetchone()[0]
                if remaining == 0:
                    raise HTTPException(409, 'Нельзя заблокировать последнего активного администратора')
            db.execute('UPDATE auth_users SET is_active=? WHERE id=?', (int(payload.is_active), user_id))
            if not payload.is_active:
                db.execute('DELETE FROM auth_sessions WHERE user_id=?', (user_id,))
            result = public_user(db.execute('SELECT * FROM auth_users WHERE id=?', (user_id,)).fetchone())
        return result

    @app.delete('/api/admin/users/{user_id}', status_code=204)
    def delete_user(user_id: int, request: Request):
        admin(request)
        if user_id == request.state.user['id']:
            raise HTTPException(400, 'Нельзя удалить собственный аккаунт')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT role,is_active FROM auth_users WHERE id=?', (user_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Пользователь не найден')
            if row['role'] == 'admin' and row['is_active']:
                remaining = db.execute("SELECT COUNT(*) FROM auth_users WHERE role='admin' AND is_active=1 AND id<>?", (user_id,)).fetchone()[0]
                if remaining == 0:
                    raise HTTPException(409, 'Нельзя удалить последнего активного администратора')
            db.execute('DELETE FROM auth_users WHERE id=?', (user_id,))

    @app.get('/api/admin/audit')
    def audit_log(request: Request, limit: int = 100):
        admin(request)
        if not 1 <= limit <= 500:
            raise HTTPException(422, 'limit must be between 1 and 500')
        with connect() as db:
            result = [dict(row) for row in db.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', (limit,))]
        for item in result:
            item['details'] = json.loads(item['details'])
        return result
