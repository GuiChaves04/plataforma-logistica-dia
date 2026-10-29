# backend/frota_consumo.py
# Estimativa de gasto com diesel: KM real do Siga+ ÷ consumo médio do tipo de caminhão × preço do litro.
# O Siga+ não envia litros e o WinThor não tem consumo cadastrado (PCVEICUL.CONSUMOPADRAO vazio),
# então o consumo vem de referência pública por modelo (uso urbano/distribuição, carregado).

PRECO_DIESEL_LITRO = 7.05

# Desgaste (manutenção): a oficina informou de R$ 1.500 a R$ 2.000 por caminhão por mês; usa o meio da faixa.
# Rateado por dia (mês = 30 dias) para qualquer período filtrado.
MANUTENCAO_MENSAL_VEICULO = 1750.0

# km/L por modelo. Fontes: computador de bordo (MAX Turbos) para Delivery 9.170 e 11.180,
# faixas de guias de frota para toco (3,5 a 5,0) e truck 6x2, ficha técnica para Kia Bongo K2500.
CONSUMO_KM_L = {
    'KIA BONGO': 8.0,
    '8.160': 6.1,
    '9.170': 6.1,
    '10.160': 5.5,
    '11.180': 5.1,
    '13.190': 4.2,
    '14.210': 4.0,
    '17.210': 3.8,
    '17.230': 3.8,
    '23.230': 3.0,
    '24.280': 3.0,
}

# Planilha da frota (placa → modelo, tipo). Placa no formato do Siga+/WinThor, sem hífen.
FROTA = {
    'OYM2287': ('8.160', 'Três quarto'), 'OYM2447': ('8.160', 'Três quarto'),
    'OYM2377': ('13.190', 'Toco'), 'PDO8543': ('13.190', 'Toco'), 'PDO8523': ('13.190', 'Toco'),
    'PDL9925': ('17.230', 'Toco'), 'PDD2245': ('23.230', 'Truck'),
    'PED6443': ('11.180', 'Três quarto'), 'PED6433': ('9.170', 'Três quarto'),
    'PDQ8095': ('11.180', 'Três quarto'), 'PDQ7965': ('11.180', 'Três quarto'),
    'PCW3431': ('10.160', 'Três quarto'), 'PCW2841': ('10.160', 'Três quarto'),
    'PCW3081': ('10.160', 'Três quarto'), 'PCW2951': ('10.160', 'Três quarto'),
    'QYM8G54': ('17.230', 'Toco'), 'QYM8I34': ('17.230', 'Toco'),
    'QYL3E12': ('17.230', 'Toco'), 'QYL3H52': ('17.230', 'Toco'),
    'QYD7253': ('24.280', 'Truck'), 'QYD7153': ('24.280', 'Truck'),
    'RZF6A21': ('9.170', 'Três quarto'), 'RZF3E49': ('9.170', 'Três quarto'),
    'RZF3F39': ('9.170', 'Três quarto'), 'RZF3F29': ('9.170', 'Três quarto'),
    'RZG0J21': ('11.180', 'Três quarto'), 'RZI1C83': ('11.180', 'Três quarto'),
    'RZH8C13': ('11.180', 'Três quarto'), 'RZI1B33': ('11.180', 'Três quarto'),
    'RZI1D53': ('11.180', 'Três quarto'), 'RZI0E03': ('11.180', 'Três quarto'),
    'RZX8D59': ('9.170', 'Três quarto'),
    'SNK6J14': ('14.210', 'Toco'), 'SNK6I54': ('14.210', 'Toco'), 'SNK6H94': ('14.210', 'Toco'),
    'SOR5J44': ('11.180', 'Três quarto'), 'SOR5I94': ('11.180', 'Três quarto'),
    'UHS7A67': ('11.180', 'Três quarto'), 'UHV3D54': ('11.180', 'Três quarto'),
    'UHV0A01': ('11.180', 'Três quarto'), 'UHS6B79': ('17.210', 'Toco'),
    'UIA9H94': ('KIA BONGO', 'Kia Bongo'), 'UIA4E84': ('KIA BONGO', 'Kia Bongo'),
    'UIA4G84': ('KIA BONGO', 'Kia Bongo'), 'UHZ7E66': ('KIA BONGO', 'Kia Bongo'),
    'UHZ7F16': ('KIA BONGO', 'Kia Bongo'), 'UHZ7F56': ('KIA BONGO', 'Kia Bongo'),
}


def so_caminhoes(km):
    """
    Mantém só as placas da planilha da frota (FROTA) e refaz o total. Carros da equipe comercial (RZP...),
    rastreadores duplicados (placa com "B") e qualquer outro veículo do Siga+ ficam de fora.
    """
    veiculos = [v for v in km['veiculos'] if v['placa'] in FROTA]
    return {**km, 'veiculos': veiculos, 'km_total': round(sum(v['km'] for v in veiculos), 1)}


def calcular_manutencao(veiculo_dias):
    """veiculo_dias: soma, placa a placa, dos dias do período em que o caminhão conta (só placas da FROTA)."""
    return round(veiculo_dias * MANUTENCAO_MENSAL_VEICULO / 30, 2)


def calcular_gasto_diesel(veiculos):
    """veiculos: [{'placa', 'km'}] do Siga+. Placas fora da planilha não entram na conta e são listadas à parte."""
    por_tipo, sem_tipo = {}, []
    total_litros = total_gasto = km_considerado = 0.0
    for v in veiculos:
        cadastro = FROTA.get(v['placa'])
        if not cadastro:
            sem_tipo.append(v['placa'])
            continue
        modelo, tipo = cadastro
        if tipo == 'Três quarto':
            # Três quarto aparece separado pelo número de referência do modelo (o número antes do ponto: 11.180 → Ref. 11)
            tipo = f"Três Quarto (Ref. {modelo.split('.')[0]})"
        litros = v['km'] / CONSUMO_KM_L[modelo]
        gasto = litros * PRECO_DIESEL_LITRO
        t = por_tipo.setdefault(tipo, {'tipo': tipo, 'veiculos': 0, 'km': 0.0, 'litros': 0.0, 'gasto': 0.0})
        t['veiculos'] += 1
        t['km'] += v['km']
        t['litros'] += litros
        t['gasto'] += gasto
        km_considerado += v['km']
        total_litros += litros
        total_gasto += gasto
    tipos = sorted(por_tipo.values(), key=lambda x: x['gasto'], reverse=True)
    for t in tipos:
        t.update({k: round(t[k], 2) for k in ('km', 'litros', 'gasto')})
    return {
        'gasto_total': round(total_gasto, 2),
        'litros_total': round(total_litros, 1),
        'km_considerado': round(km_considerado, 1),
        'preco_litro': PRECO_DIESEL_LITRO,
        'por_tipo': tipos,
        'placas_sem_tipo': sem_tipo,
    }
