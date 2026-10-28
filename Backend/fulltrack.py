# backend/fulltrack.py
"""
Cliente central da API Fulltrack (Siga+) — cliente DIA LOG.

Única porta de saída da plataforma para a Fulltrack. Segue o README de integração:
- chaves só no .env (FULLTRACK_API_KEY, FULLTRACK_SECRET_KEY, FULLTRACK_BASE_URL), nunca em código ou log;
- cache por tipo de dado: as telas leem daqui, então 100 usuários não viram 100 chamadas;
- um único lock: no máximo 1 requisição à Fulltrack por vez;
- timeout de 30 s, retry com backoff exponencial + jitter só em 429/5xx/timeout (nunca em 401/403);
- valida Content-Type (endpoint inexistente devolve HTML) e o campo "status" do corpo;
- circuit breaker: após 5 falhas seguidas, pausa as chamadas por 5 minutos;
- corrige o encoding duplicado ("PadrÃ£o" -> "Padrão") e converte números e datas explicitamente.
"""
import logging
import os
import random
import threading
import time
from datetime import datetime, timedelta

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'), override=False)
except ImportError:
    pass

logger = logging.getLogger('fulltrack')

BASE_URL = os.getenv('FULLTRACK_BASE_URL', 'https://ws.fulltrack2.com').rstrip('/')
TIMEOUT_S = 30
MAX_TENTATIVAS = 3
FALHAS_PARA_PAUSAR = 5
PAUSA_CIRCUITO_S = 300

# Tempo de vida do cache por endpoint (segundos). Cadastros mudam pouco; posições, a cada minuto.
TTL_S = {
    'clients/all': 3600,
    'vehicles/all': 1800,
    'drivers/all': 1800,
    'events/all': 60,
}

_cache = {}
_lock = threading.Lock()
_estado = {'falhas_seguidas': 0, 'pausado_ate': 0.0, 'ultimo_erro': None, 'requisicoes': 0}


class FulltrackErro(Exception):
    pass


def _cabecalhos():
    api_key = os.getenv('FULLTRACK_API_KEY', '').strip()
    secret_key = os.getenv('FULLTRACK_SECRET_KEY', '').strip()
    if not api_key or not secret_key:
        raise FulltrackErro('Credenciais da Fulltrack ausentes: defina FULLTRACK_API_KEY e FULLTRACK_SECRET_KEY no .env.')
    return {'apiKey': api_key, 'secretKey': secret_key, 'Content-Type': 'application/json'}


def corrigir_texto(valor):
    """Desfaz o encoding duplicado da API (UTF-8 lido como Latin-1)."""
    if not isinstance(valor, str) or not valor:
        return valor
    try:
        return valor.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return valor


def _corrigir_registro(obj):
    if isinstance(obj, dict):
        return {k: _corrigir_registro(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_corrigir_registro(v) for v in obj]
    return corrigir_texto(obj)


def para_float(valor):
    try:
        return float(str(valor).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def para_int(valor):
    f = para_float(valor)
    return int(f) if f is not None else None


def normalizar_placa(placa):
    """'RZF-6A21' e 'RZF6A21' viram 'RZF6A21' (mesmo formato de PCVEICUL.PLACA no WinThor)."""
    return ''.join(ch for ch in str(placa or '').upper() if ch.isalnum())


# ras_eve_data_gps vem em UTC: em 22/10/2026 às 11:17 (Recife) a última posição marcava 14:17.
# America/Recife é UTC-3 o ano todo (sem horário de verão).
_UTC_PARA_RECIFE = timedelta(hours=-3)


def data_evento(valor):
    """Converte 'dd/MM/yyyy HH:mm:ss' (UTC) para datetime no horário de Recife; None se inválida."""
    try:
        return datetime.strptime(str(valor).strip(), '%d/%m/%Y %H:%M:%S') + _UTC_PARA_RECIFE
    except (TypeError, ValueError):
        return None


def _requisitar(endpoint):
    url = f'{BASE_URL}/{endpoint}'
    cabecalhos = _cabecalhos()
    espera = 1.0
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        t0 = time.time()
        try:
            _estado['requisicoes'] += 1
            resp = requests.get(url, headers=cabecalhos, timeout=TIMEOUT_S)
        except requests.RequestException as exc:
            logger.warning('Fulltrack %s: falha de rede na tentativa %d (%s)', endpoint, tentativa, type(exc).__name__)
            if tentativa == MAX_TENTATIVAS:
                raise FulltrackErro(f'Fulltrack indisponível ({type(exc).__name__}).')
            time.sleep(espera + random.uniform(0, 0.5))
            espera *= 2
            continue

        duracao = time.time() - t0
        if resp.status_code in (401, 403):
            logger.error('Fulltrack %s: HTTP %d (credencial inválida ou revogada) em %.1fs', endpoint, resp.status_code, duracao)
            raise FulltrackErro(f'Fulltrack recusou a credencial (HTTP {resp.status_code}).')
        if resp.status_code == 429 or resp.status_code >= 500:
            logger.warning('Fulltrack %s: HTTP %d na tentativa %d', endpoint, resp.status_code, tentativa)
            if tentativa == MAX_TENTATIVAS:
                raise FulltrackErro(f'Fulltrack respondeu HTTP {resp.status_code}.')
            retry_after = para_float(resp.headers.get('Retry-After'))
            time.sleep(retry_after if retry_after else espera + random.uniform(0, 0.5))
            espera *= 2
            continue
        if 'json' not in resp.headers.get('Content-Type', '').lower():
            raise FulltrackErro(f'Fulltrack devolveu {resp.headers.get("Content-Type") or "conteúdo"} em vez de JSON para {endpoint} (endpoint inexistente?).')

        corpo = resp.json()
        if not isinstance(corpo, dict) or corpo.get('status') is not True:
            mensagem = corpo.get('message') if isinstance(corpo, dict) else 'resposta inesperada'
            raise FulltrackErro(f'Fulltrack {endpoint}: {mensagem}')
        dados = corpo.get('data') or []
        logger.info('Fulltrack %s: HTTP %d em %.1fs, %d registros', endpoint, resp.status_code, duracao, len(dados))
        return _corrigir_registro(dados)
    raise FulltrackErro('Fulltrack: tentativas esgotadas.')


def obter(endpoint):
    """
    Devolve (dados, meta). Lê do cache enquanto estiver válido; só uma thread consulta a API por vez.
    Se a API falhar e houver cache antigo, devolve o cache antigo marcado em meta['desatualizado'].
    """
    ttl = TTL_S.get(endpoint, 300)
    agora = time.time()
    em_cache = _cache.get(endpoint)
    if em_cache and agora - em_cache[0] < ttl:
        return em_cache[1], {'atualizado_em': datetime.fromtimestamp(em_cache[0]).isoformat(timespec='seconds'), 'desatualizado': False}

    with _lock:
        em_cache = _cache.get(endpoint)
        agora = time.time()
        if em_cache and agora - em_cache[0] < ttl:
            return em_cache[1], {'atualizado_em': datetime.fromtimestamp(em_cache[0]).isoformat(timespec='seconds'), 'desatualizado': False}

        erro = None
        if agora < _estado['pausado_ate']:
            erro = 'Integração com a Fulltrack pausada após falhas seguidas; nova tentativa em alguns minutos.'
        else:
            try:
                dados = _requisitar(endpoint)
                _cache[endpoint] = (time.time(), dados)
                _estado['falhas_seguidas'] = 0
                _estado['ultimo_erro'] = None
                return dados, {'atualizado_em': datetime.now().isoformat(timespec='seconds'), 'desatualizado': False}
            except FulltrackErro as exc:
                erro = str(exc)
                _estado['falhas_seguidas'] += 1
                _estado['ultimo_erro'] = erro
                if _estado['falhas_seguidas'] >= FALHAS_PARA_PAUSAR:
                    _estado['pausado_ate'] = time.time() + PAUSA_CIRCUITO_S
                    logger.error('Fulltrack: %d falhas seguidas; pausando por %d s', _estado['falhas_seguidas'], PAUSA_CIRCUITO_S)

        if em_cache:
            return em_cache[1], {'atualizado_em': datetime.fromtimestamp(em_cache[0]).isoformat(timespec='seconds'), 'desatualizado': True, 'erro': erro}
        raise FulltrackErro(erro)


def veiculos():
    """Cadastro de veículos rastreados. Odômetro da Fulltrack vem em metros."""
    dados, meta = obter('vehicles/all')
    lista = []
    for v in dados:
        odometro_m = para_int(v.get('ras_vei_odometro'))
        lista.append({
            'id': v.get('ras_vei_id'),
            'placa': (v.get('ras_vei_placa') or '').strip().upper(),
            'descricao': v.get('ras_vei_veiculo'),
            'modelo': v.get('ras_vei_modelo'),
            'ano': para_int(v.get('ras_vei_ano')),
            'odometro_km': round(odometro_m / 1000) if odometro_m else None,
        })
    return lista, meta


def posicoes():
    """Última posição de cada rastreador. Coordenadas inválidas ou sem sinal de GPS ficam sinalizadas."""
    dados, meta = obter('events/all')
    lista = []
    for e in dados:
        lat = para_float(e.get('ras_eve_latitude'))
        lon = para_float(e.get('ras_eve_longitude'))
        coordenada_valida = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0)
        dt = data_evento(e.get('ras_eve_data_gps'))
        motorista = (e.get('ras_mot_nome') or '').strip()
        hodometro_m = para_int(e.get('ras_eve_hodometro'))
        lista.append({
            'veiculo_id': e.get('ras_vei_id'),
            'placa': (e.get('ras_vei_placa') or '').strip().upper(),
            'hodometro_m': hodometro_m if hodometro_m and hodometro_m > 0 else None,
            'data_gps': dt.isoformat() if dt else None,
            'latitude': lat if coordenada_valida else None,
            'longitude': lon if coordenada_valida else None,
            'gps_ok': coordenada_valida and str(e.get('ras_ras_sinal_gps')) != '0',
            'ignicao': str(e.get('ras_eve_ignicao')) == '1',
            'velocidade_kmh': para_int(e.get('ras_eve_velocidade')),
            'motorista': motorista if motorista.upper() not in ('', 'PADRAO', 'PADRÃO') else None,
        })
    return lista, meta


def nomes_motoristas():
    """Só id e nome (LGPD: CPF, CNH e endereço de /drivers/all não saem deste módulo)."""
    dados, meta = obter('drivers/all')
    return [{'id': d.get('ras_mot_id'), 'nome': (d.get('ras_mot_nome') or '').strip()} for d in dados if d.get('ras_mot_nome')], meta


def resumo_frota(horas_online=24):
    """Indicadores reais de telemetria: veículos cadastrados e quantos rastreadores comunicaram recentemente."""
    lista_veic, meta_v = veiculos()
    lista_pos, meta_p = posicoes()
    limite = datetime.now() - timedelta(hours=horas_online)
    comunicando = [p for p in lista_pos if p['data_gps'] and datetime.fromisoformat(p['data_gps']) >= limite]
    return {
        'veiculos_cadastrados': len(lista_veic),
        'rastreadores_com_posicao': len(lista_pos),
        'comunicando_ultimas_horas': len(comunicando),
        'janela_horas': horas_online,
        'em_movimento': sum(1 for p in comunicando if p['ignicao'] and (p['velocidade_kmh'] or 0) > 0),
        'ultima_posicao': max((p['data_gps'] for p in lista_pos if p['data_gps']), default=None),
        'atualizado_em': min(meta_v['atualizado_em'], meta_p['atualizado_em']),
        'desatualizado': meta_v['desatualizado'] or meta_p['desatualizado'],
    }


def leituras_hodometro(max_idade_horas=48):
    """[(placa_normalizada, 'YYYY-MM-DD', hodometro_m, momento ISO)] das posições recentes com hodômetro > 0."""
    lista_pos, _ = posicoes()
    limite = datetime.now() - timedelta(hours=max_idade_horas)
    leituras = []
    for p in lista_pos:
        if not p['hodometro_m'] or not p['data_gps']:
            continue
        momento = datetime.fromisoformat(p['data_gps'])
        if momento < limite:
            continue
        leituras.append((normalizar_placa(p['placa']), momento.strftime('%Y-%m-%d'), p['hodometro_m'], p['data_gps']))
    return leituras


_coletor = {'ativo': False, 'ultima_execucao': None, 'ultimas_leituras': 0}


def iniciar_coletor(salvar_leituras, intervalo_s=600):
    """
    Rotina central (uma por processo) que grava o hodômetro a cada `intervalo_s` com jitter.
    `salvar_leituras` recebe a lista de leituras_hodometro(); erros são registrados e o ciclo segue.
    """
    if _coletor['ativo']:
        return

    def ciclo():
        time.sleep(random.uniform(5, 30))
        while True:
            try:
                leituras = leituras_hodometro()
                salvar_leituras(leituras)
                _coletor['ultima_execucao'] = datetime.now().isoformat(timespec='seconds')
                _coletor['ultimas_leituras'] = len(leituras)
                logger.info('Coletor Siga+: %d leituras de hodômetro gravadas', len(leituras))
            except Exception as exc:
                logger.warning('Coletor Siga+: ciclo falhou (%s)', exc)
            time.sleep(intervalo_s + random.uniform(0, 60))

    _coletor['ativo'] = True
    threading.Thread(target=ciclo, name='coletor-siga', daemon=True).start()


# --- Histórico (events/interval) -------------------------------------------------
# A API devolve eventos passados por rastreador, no máximo 15 dias por consulta ("Range days is gratther
# than 15 days!") e com dados a partir de set/2026. O histórico é baixado em janelas fixas de 15 dias.
HISTORICO_DESDE = datetime(2026, 7, 1)
JANELA_DIAS = 15

_historico = {'ativo': False, 'janelas_pendentes': None, 'janelas_baixadas': 0, 'ultima_execucao': None, 'ultimo_erro': None}


def eventos_intervalo(veiculo_id, inicio, fim):
    """Eventos de um rastreador entre dois datetimes locais (Recife). Intervalo sem eventos devolve lista vazia."""
    endpoint = f'events/interval/id/{veiculo_id}/begin/{int(inicio.timestamp())}/end/{int(fim.timestamp())}'
    with _lock:
        if time.time() < _estado['pausado_ate']:
            raise FulltrackErro('Integração com a Fulltrack pausada após falhas seguidas.')
        try:
            return _requisitar(endpoint)
        except FulltrackErro as exc:
            if 'No data were found' in str(exc):
                return []
            raise


def resumir_hodometro_por_dia(eventos):
    """
    Primeira e última leitura de hodômetro de cada placa por dia (horário de Recife), no formato de
    leituras_hodometro(): [(placa_normalizada, 'YYYY-MM-DD', hodometro_m, momento ISO)].
    """
    dias = {}
    for e in eventos:
        hodometro_m = para_int(e.get('ras_eve_hodometro'))
        momento = data_evento(e.get('ras_eve_data_gps'))
        if not hodometro_m or hodometro_m <= 0 or not momento:
            continue
        chave = (normalizar_placa(e.get('ras_vei_placa')), momento.strftime('%Y-%m-%d'))
        dia = dias.get(chave)
        if dia is None:
            dias[chave] = [hodometro_m, momento, hodometro_m, momento]
        else:
            if hodometro_m < dia[0]:
                dia[0], dia[1] = hodometro_m, momento
            if hodometro_m > dia[2]:
                dia[2], dia[3] = hodometro_m, momento
    leituras = []
    for (placa, data), (h_min, t_min, h_max, t_max) in dias.items():
        leituras.append((placa, data, h_min, t_min.isoformat()))
        leituras.append((placa, data, h_max, t_max.isoformat()))
    return leituras


# Rastreadores que mandam hodômetro sempre 0 (até a Fulltrack ajustar a instalação): o km do dia sai da soma
# das distâncias entre posições GPS, só em trechos com ignição ligada (parado, o GPS "passeia" alguns metros)
# e descartando saltos impossíveis. Dia que já tiver hodômetro usa o hodômetro (local_db._somar_km_gps),
# então a troca é automática quando a Fulltrack corrigir o rastreador.
PLACAS_KM_POR_GPS = {'UIA4G84'}
VELOCIDADE_MAX_KMH = 150


def _distancia_m(lat1, lon1, lat2, lon2):
    """Distância em metros entre duas coordenadas (fórmula de haversine)."""
    from math import radians, sin, cos, asin, sqrt
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def km_gps_por_dia(eventos):
    """[(placa_normalizada, 'YYYY-MM-DD', km)] somando os trechos entre posições consecutivas de cada placa."""
    pontos = []
    for e in eventos:
        lat, lon = para_float(e.get('ras_eve_latitude')), para_float(e.get('ras_eve_longitude'))
        momento = data_evento(e.get('ras_eve_data_gps'))
        if lat is None or lon is None or (lat == 0 and lon == 0) or not momento or str(e.get('ras_ras_sinal_gps')) == '0':
            continue
        pontos.append((normalizar_placa(e.get('ras_vei_placa')), momento, lat, lon, str(e.get('ras_eve_ignicao')) == '1'))
    pontos.sort()
    km = {}
    for a, b in zip(pontos, pontos[1:]):
        if a[0] != b[0] or not (a[4] or b[4]):
            continue
        horas = (b[1] - a[1]).total_seconds() / 3600
        distancia_km = _distancia_m(a[2], a[3], b[2], b[3]) / 1000
        if horas <= 0 or distancia_km / horas > VELOCIDADE_MAX_KMH:
            continue
        chave = (b[0], b[1].strftime('%Y-%m-%d'))
        km[chave] = km.get(chave, 0.0) + distancia_km
    return [(placa, dia, round(valor, 2)) for (placa, dia), valor in km.items()]


def _janelas_historico(agora):
    janelas, inicio = [], HISTORICO_DESDE
    while inicio < agora:
        fim = min(inicio + timedelta(days=JANELA_DIAS) - timedelta(seconds=1), agora)
        janelas.append((inicio, fim))
        inicio += timedelta(days=JANELA_DIAS)
    return janelas


def iniciar_historico(salvar_leituras, janela_baixada, marcar_janela, salvar_km_gps=None, intervalo_s=6 * 3600):
    """
    Rotina central que completa o hodômetro diário com o histórico do Siga+, para o KM sair certo em
    qualquer período escolhido na tela. Janelas já encerradas são baixadas uma única vez
    (`marcar_janela`); a janela em andamento é refeita a cada ciclo. Uma consulta por vez, com pausa entre elas.
    """
    if _historico['ativo']:
        return

    def ciclo():
        time.sleep(random.uniform(20, 60))
        while True:
            try:
                lista, _ = veiculos()
                agora = datetime.now()
                hoje = agora.replace(hour=0, minute=0, second=0, microsecond=0)
                pendentes = [(v, ini, fim) for v in lista if v['id'] for ini, fim in _janelas_historico(agora)
                             if not janela_baixada(str(v['id']), ini.strftime('%Y-%m-%d'))]
                _historico['janelas_pendentes'] = len(pendentes)
                for v, ini, fim in pendentes:
                    try:
                        eventos = eventos_intervalo(v['id'], ini, fim)
                        salvar_leituras(resumir_hodometro_por_dia(eventos))
                        if salvar_km_gps and normalizar_placa(v['placa']) in PLACAS_KM_POR_GPS:
                            salvar_km_gps(km_gps_por_dia(eventos))
                        if fim < hoje:
                            marcar_janela(str(v['id']), ini.strftime('%Y-%m-%d'))
                        _historico['janelas_baixadas'] += 1
                    except FulltrackErro as exc:
                        _historico['ultimo_erro'] = str(exc)
                        logger.warning('Histórico Siga+: %s (%s a %s) falhou: %s', v['placa'], ini.date(), fim.date(), exc)
                    _historico['janelas_pendentes'] -= 1
                    time.sleep(1 + random.uniform(0, 0.5))
                _historico['ultima_execucao'] = datetime.now().isoformat(timespec='seconds')
                logger.info('Histórico Siga+: ciclo concluído (%d janelas processadas no total)', _historico['janelas_baixadas'])
            except Exception as exc:
                _historico['ultimo_erro'] = str(exc)
                logger.warning('Histórico Siga+: ciclo falhou (%s)', exc)
            time.sleep(intervalo_s + random.uniform(0, 300))

    _historico['ativo'] = True
    threading.Thread(target=ciclo, name='historico-siga', daemon=True).start()


def status_historico():
    return dict(_historico)


def status_integracao():
    return {
        'falhas_seguidas': _estado['falhas_seguidas'],
        'pausado': time.time() < _estado['pausado_ate'],
        'ultimo_erro': _estado['ultimo_erro'],
        'requisicoes_desde_inicio': _estado['requisicoes'],
        'coletor': dict(_coletor),
        'historico': dict(_historico),
        'cache': {k: datetime.fromtimestamp(v[0]).isoformat(timespec='seconds') for k, v in _cache.items()},
    }
