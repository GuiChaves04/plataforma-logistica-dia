# backend/local_db.py
# Banco local (SQLite) usado só para o que não vem do WinThor:
# usuários da plataforma e leituras de hodômetro do Siga+ (Fulltrack).
import sqlite3
import os
import json
import hashlib
import hmac
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gestao_logistica.db')
CONFIG_LOCAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config_local.json')


def config_local():
    """Dados internos da empresa (usuários iniciais, supervisores). Arquivo fora do Git; vazio se não existir."""
    try:
        with open(CONFIG_LOCAL_PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    c = conn.cursor()

    # 1. Telemetria Siga+ (Fulltrack): menor e maior hodômetro visto por placa e dia (em metros).
    #    KM rodado num período = maior leitura - menor leitura da placa no período.
    c.execute('''
    CREATE TABLE IF NOT EXISTS siga_hodometro_diario (
        placa TEXT NOT NULL,
        data TEXT NOT NULL,
        hodometro_min_m INTEGER NOT NULL,
        hodometro_max_m INTEGER NOT NULL,
        primeira_leitura TEXT NOT NULL,
        ultima_leitura TEXT NOT NULL,
        leituras INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (placa, data)
    )
    ''')

    # 1a. KM diário calculado pelo GPS, para rastreadores que mandam hodômetro 0 (fulltrack.PLACAS_KM_POR_GPS).
    c.execute('''
    CREATE TABLE IF NOT EXISTS siga_km_gps_diario (
        placa TEXT NOT NULL,
        data TEXT NOT NULL,
        km REAL NOT NULL,
        PRIMARY KEY (placa, data)
    )
    ''')

    # 1b. Janelas de 15 dias do histórico Siga+ já baixadas por rastreador (só janelas encerradas).
    c.execute('''
    CREATE TABLE IF NOT EXISTS siga_historico_janelas (
        veiculo_id TEXT NOT NULL,
        inicio TEXT NOT NULL,
        baixado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (veiculo_id, inicio)
    )
    ''')

    # 2. Usuários & Perfis (Sistema de Auth integrado)
    c.execute('''
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        usuario TEXT UNIQUE,
        senha_hash TEXT NOT NULL,
        nome TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer', -- 'admin' ou 'viewer'
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    conn.commit()

    # Usuários iniciais (e-mails e senhas) ficam em Backend/config_local.json, fora do Git.
    def h(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()

    usuarios_padrao = [(email, usuario, h(senha), nome, role)
                       for email, usuario, senha, nome, role in config_local().get('usuarios_iniciais', [])]
    for u in usuarios_padrao:
        c.execute('''
        INSERT OR IGNORE INTO usuarios (email, usuario, senha_hash, nome, role)
        VALUES (?, ?, ?, ?, ?)
        ''', u)
    conn.commit()
    conn.close()

# Initialize immediately when imported
init_db()


def hash_senha(senha):
    """Hash legado (SHA-256 sem sal). Só é usado para reconhecer senhas antigas e migrá-las."""
    return hashlib.sha256(str(senha).strip().encode('utf-8')).hexdigest()

def autenticar_usuario(identificador, senha):
    ident = str(identificador or '').strip().lower()
    senha_limpa = str(senha).strip()
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
    SELECT id, email, usuario, nome, role, senha_hash
    FROM usuarios
    WHERE LOWER(email) = ? OR LOWER(usuario) = ?
    ''', (ident, ident))
    row = c.fetchone()
    if not row:
        conn.close()
        return None

    armazenado = row['senha_hash']
    if armazenado.startswith(('scrypt:', 'pbkdf2:')):
        ok = check_password_hash(armazenado, senha_limpa)
    else:
        # Senha ainda no formato SHA-256 antigo: confere e, se bater, regrava com hash com sal.
        ok = hmac.compare_digest(armazenado, hash_senha(senha_limpa))
        if ok:
            c.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?',
                      (generate_password_hash(senha_limpa), row['id']))
            conn.commit()
    conn.close()
    if not ok:
        return None
    user = dict(row)
    user.pop('senha_hash', None)
    return user

def obter_usuario_por_id(user_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT id, email, usuario, nome, role FROM usuarios WHERE id = ?', (user_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None


# --- Telemetria Siga+ (hodômetro) ---------------------------------------------

def registrar_leituras_hodometro(leituras):
    """leituras: [(placa_normalizada, data 'YYYY-MM-DD', hodometro_m, momento ISO)]. Idempotente por placa+dia."""
    conn = get_connection()
    c = conn.cursor()
    for placa, data, hodometro_m, momento in leituras:
        c.execute('''
        INSERT INTO siga_hodometro_diario (placa, data, hodometro_min_m, hodometro_max_m, primeira_leitura, ultima_leitura, leituras)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(placa, data) DO UPDATE SET
            hodometro_min_m = MIN(hodometro_min_m, excluded.hodometro_min_m),
            hodometro_max_m = MAX(hodometro_max_m, excluded.hodometro_max_m),
            primeira_leitura = MIN(primeira_leitura, excluded.primeira_leitura),
            ultima_leitura = MAX(ultima_leitura, excluded.ultima_leitura),
            leituras = leituras + 1
        ''', (placa, data, hodometro_m, hodometro_m, momento, momento))
    conn.commit()
    conn.close()

def registrar_km_gps(km_dias):
    """km_dias: [(placa_normalizada, 'YYYY-MM-DD', km)]. O dia é sempre recalculado inteiro, então substitui."""
    conn = get_connection()
    c = conn.cursor()
    c.executemany('INSERT OR REPLACE INTO siga_km_gps_diario (placa, data, km) VALUES (?, ?, ?)', km_dias)
    conn.commit()
    conn.close()

def _somar_km_gps(c, por_veiculo, filtro_sql, parametros):
    """
    Soma em por_veiculo o km calculado pelo GPS, só nos dias em que a placa não tem leitura de hodômetro.
    Assim, quando a Fulltrack passa a enviar o hodômetro, esses dias passam a usá-lo sozinhos.
    """
    c.execute(f'''
    SELECT g.placa, SUM(g.km) AS km, COUNT(*) AS dias FROM siga_km_gps_diario g
    WHERE {filtro_sql}
      AND NOT EXISTS (SELECT 1 FROM siga_hodometro_diario h WHERE h.placa = g.placa AND h.data = g.data)
    GROUP BY g.placa
    ''', parametros)
    existentes = {v['placa']: v for v in por_veiculo}
    for r in c.fetchall():
        if r['placa'] in existentes:
            v = existentes[r['placa']]
            v['km'] = round(v['km'] + r['km'], 1)
            v['dias_com_leitura'] += r['dias']
        else:
            por_veiculo.append({'placa': r['placa'], 'km': round(r['km'], 1), 'dias_com_leitura': r['dias'], 'fonte': 'gps'})

def janela_historico_baixada(veiculo_id, inicio):
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT 1 FROM siga_historico_janelas WHERE veiculo_id = ? AND inicio = ?', (veiculo_id, inicio))
    achou = c.fetchone() is not None
    conn.close()
    return achou

def marcar_janela_historico(veiculo_id, inicio):
    conn = get_connection()
    c = conn.cursor()
    c.execute('INSERT OR IGNORE INTO siga_historico_janelas (veiculo_id, inicio) VALUES (?, ?)', (veiculo_id, inicio))
    conn.commit()
    conn.close()

def km_rodados_siga_dias(placa_dias, km_max_dia=1500):
    """
    KM de cada placa só nos dias informados ({placa: {'YYYY-MM-DD', ...}}), usado no filtro por motorista:
    soma, dia a dia, maior - menor leitura. Dia com salto negativo ou acima de km_max_dia é descartado.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT MIN(data) AS inicio FROM siga_hodometro_diario')
    inicio_coleta = c.fetchone()['inicio']
    por_veiculo, descartados = [], set()
    for placa, dias in placa_dias.items():
        if not dias:
            continue
        marcas = ','.join('?' * len(dias))
        c.execute(f'''
        SELECT data, hodometro_min_m, hodometro_max_m FROM siga_hodometro_diario
        WHERE placa = ? AND data IN ({marcas})
        ''', (placa, *sorted(dias)))
        km, dias_com_leitura = 0.0, 0
        for r in c.fetchall():
            km_dia = (r['hodometro_max_m'] - r['hodometro_min_m']) / 1000.0
            if km_dia < 0 or km_dia > km_max_dia:
                descartados.add(placa)
                continue
            km += km_dia
            dias_com_leitura += 1
        da_placa = [{'placa': placa, 'km': round(km, 1), 'dias_com_leitura': dias_com_leitura}] if dias_com_leitura else []
        _somar_km_gps(c, da_placa, f'g.placa = ? AND g.data IN ({marcas})', (placa, *sorted(dias)))
        por_veiculo += da_placa
    conn.close()
    por_veiculo.sort(key=lambda x: x['km'], reverse=True)
    primeiro_dia = min((d for dias in placa_dias.values() for d in dias), default=None)
    return {
        'km_total': round(sum(v['km'] for v in por_veiculo), 1),
        'veiculos': por_veiculo,
        'descartados': sorted(descartados),
        'inicio_coleta': inicio_coleta,
        'periodo_coberto': bool(inicio_coleta) and bool(primeiro_dia) and inicio_coleta <= primeiro_dia,
    }

def km_rodados_siga(data_inicio, data_fim, placas=None, km_max_dia=1500):
    """
    KM por placa no período a partir das leituras guardadas. Placas com salto negativo ou acima de
    km_max_dia por dia de coleta são descartadas (hodômetro trocado ou leitura errada) e contadas à parte.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT MIN(data) AS inicio FROM siga_hodometro_diario')
    inicio_coleta = c.fetchone()['inicio']
    c.execute('''
    SELECT placa, MIN(hodometro_min_m) AS hod_min, MAX(hodometro_max_m) AS hod_max,
           COUNT(*) AS dias, MIN(data) AS primeiro_dia, MAX(data) AS ultimo_dia
    FROM siga_hodometro_diario
    WHERE data >= ? AND data <= ?
    GROUP BY placa
    ''', (data_inicio, data_fim))
    linhas = c.fetchall()

    por_veiculo, descartados = [], []
    for r in linhas:
        if placas is not None and r['placa'] not in placas:
            continue
        km = (r['hod_max'] - r['hod_min']) / 1000.0
        if km < 0 or km > km_max_dia * r['dias']:
            descartados.append(r['placa'])
            continue
        por_veiculo.append({'placa': r['placa'], 'km': round(km, 1), 'dias_com_leitura': r['dias']})
    _somar_km_gps(c, por_veiculo, 'g.data >= ? AND g.data <= ?', (data_inicio, data_fim))
    if placas is not None:
        por_veiculo = [v for v in por_veiculo if v['placa'] in placas]
    conn.close()
    por_veiculo.sort(key=lambda x: x['km'], reverse=True)
    return {
        'km_total': round(sum(v['km'] for v in por_veiculo), 1),
        'veiculos': por_veiculo,
        'descartados': descartados,
        'inicio_coleta': inicio_coleta,
        'periodo_coberto': bool(inicio_coleta) and inicio_coleta <= data_inicio,
    }
