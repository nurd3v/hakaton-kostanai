"""Create the first admin or recover an account from the server terminal."""
import argparse
import getpass
import sqlite3
from pydantic import ValidationError
from fastapi import HTTPException
from main import connect, setup_database
from auth import NewUserIn, create_user, password_hash, setup_auth

parser = argparse.ArgumentParser(description='Управление аккаунтами RO-FACTORY')
parser.add_argument('action', choices=['create-admin', 'create-user', 'reset-password'])
args = parser.parse_args()
setup_database()
setup_auth(connect)
username = input('Логин: ').strip().lower()
name = input('Имя: ').strip() if args.action != 'reset-password' else ''
password = getpass.getpass('Пароль (минимум 12 символов): ')
if password != getpass.getpass('Повторите пароль: '):
    raise SystemExit('Пароли не совпадают')
try:
    if args.action == 'reset-password':
        if not 12 <= len(password) <= 128:
            raise SystemExit('Пароль должен содержать от 12 до 128 символов')
        with connect() as db:
            user = db.execute('SELECT id FROM auth_users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
            if not user:
                raise SystemExit('Пользователь не найден')
            db.execute('UPDATE auth_users SET password_hash=? WHERE id=?', (password_hash(password), user['id']))
            db.execute('DELETE FROM auth_sessions WHERE user_id=?', (user['id'],))
    else:
        create_user(connect, NewUserIn(username=username, name=name, password=password, role='admin' if args.action == 'create-admin' else 'user'))
except (ValidationError, HTTPException) as exc:
    raise SystemExit(getattr(exc, 'detail', 'Проверьте логин, имя и длину пароля'))
print('Готово. Пароль хранится в виде хеша.')
