# Plataforma de Logística DIA

Plataforma web de análise logística integrada ao ERP **WinThor** (Oracle). Ela reúne num só lugar cortes de pedidos, excesso de estoque, devoluções, faturamento, pedidos e telemetria da frota, com dados lidos direto do banco a cada consulta.

Feita para o time de logística acompanhar a operação no dia a dia, no computador, no celular ou numa TV da sala de logística.

## Funcionalidades

| Aba | O que mostra |
|---|---|
| **Dashboard (Visão Geral)** | Faturamento líquido, notas emitidas, clientes positivados, peso faturado e taxa de devolução do período. |
| **Telemetria & Frota** | Entregas e devoluções por motorista e por dia da semana, mapa de Pernambuco por cidade, km rodado por caminhão (Siga+/Fulltrack) e gasto estimado com diesel por tipo de veículo. |
| **Pedidos a Faturar** | Pedidos em aberto aguardando faturamento. |
| **Consulta Pedidos (335)** | Consulta de pedidos com itens e leitura do DANFE a partir do XML da NF-e. |
| **Devoluções & Setores** | Devoluções por motivo, setor responsável, cliente, vendedor e motorista. Ao clicar numa cidade do mapa, a aba mostra só aquela cidade, com gráficos por dia da semana, bairro e cliente. |
| **Cortes & Rupturas** | Itens cortados nos pedidos, por motivo, produto, comprador e área, com o top 10 de cada visão e a exportação em planilha. |
| **Excesso de Estoque** | Capital em excesso por comprador × limite ideal, produtos obsoletos, SKUs em ruptura e quebra. Os cards abrem a tabela detalhada dentro da plataforma. |
| **Comercial & Vendas** | Vendas por comprador, clientes e consistência de giro dos produtos. |
| **Modo TV (Painel)** | Painel em tela cheia, com rotação automática dos indicadores, para a TV da sala de logística. |

### Regras de negócio principais

- **Clientes positivados:** clientes com venda maior que zero no período, na base de faturamento do WinThor (`VIEW_BI_FATURAMENTO`, filiais 1 e 11). É a mesma regra da rotina 111.
- **Produto obsoleto:** tem estoque, está há mais de 45 dias sem venda e a última entrada (rotina 1130) foi há pelo menos 30 dias.
- **Devoluções por motorista:** cada devolução que entra no período é atribuída ao motorista que entregou a nota de venda original, mesmo quando a venda é anterior ao período. Assim o total bate com a visão por motivo.
- **Km rodado:** maior hodômetro menos o menor, por caminhão e por dia, com histórico do Siga+ baixado em janelas de 15 dias. Rastreadores sem hodômetro usam a distância calculada pelo GPS.
- **Gasto com diesel:** km rodado dividido pelo consumo médio do modelo (km/L) e multiplicado pelo preço do litro, configurado em `Backend/frota_consumo.py`.

## Tecnologias

- **Backend:** Python 3, Flask, servido pelo Waitress na porta 5000.
- **Banco:** Oracle do WinThor, acessado com `python-oracledb` por um usuário **somente leitura**. Um SQLite local (`gestao_logistica.db`) guarda os usuários da plataforma e as leituras de hodômetro.
- **Telemetria:** API da Fulltrack (Siga+).
- **Frontend:** HTML, Tailwind CSS, Chart.js e mapa SVG dos municípios de Pernambuco, sem etapa de build.
- **Acesso externo:** túnel ngrok com domínio fixo.

## Estrutura

```
app_cortes/
├── Backend/
│   ├── app.py                       # rotas Flask, autenticação e montagem dos dashboards
│   ├── sql_queries.py               # todas as consultas SQL ao WinThor
│   ├── database.py                  # conexão Oracle (credenciais vêm do .env)
│   ├── local_db.py                  # SQLite local: usuários e hodômetro
│   ├── fulltrack.py                 # integração Siga+/Fulltrack (posições e histórico)
│   ├── frota_consumo.py             # frota, consumo por modelo e preço do diesel
│   ├── danfe_parser.py              # leitura do XML da NF-e para o DANFE
│   ├── notificador.py               # e-mail diário de cortes para os supervisores
│   └── config_local.example.json    # modelo dos dados internos (ver Configuração)
├── Frontend/
│   ├── index.html
│   ├── css/plataforma.css
│   └── js/                          # dashboard.js, plataforma_integrada.js, mapa de PE
├── .env.example                     # modelo das credenciais
├── requirements.txt
├── instalar_servidor.bat            # cria o venv e instala as dependências
├── configurar_ngrok.bat             # grava o token e o domínio do ngrok no .env
└── iniciar_servidor.bat             # sobe o servidor e o reinicia se cair
```

## Instalação

Requisitos: Windows, Python 3.12 ou mais novo e acesso de rede ao Oracle do WinThor.

1. Clone o repositório e rode `instalar_servidor.bat`. Ele:
   - cria o `venv`;
   - instala o `requirements.txt`;
   - copia os modelos para `.env` e `Backend/config_local.json`.
2. Preencha o `.env` (detalhes em [Configuração](#configuração)).
3. Preencha o `Backend/config_local.json`.
4. Opcional: rode `configurar_ngrok.bat` para liberar o acesso de fora da rede.

## Configuração

### `.env` (credenciais)

| Variável | Uso |
|---|---|
| `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_DSN` | Conexão com o WinThor. Use um usuário só de leitura. O DSN segue o formato `host:1521/SERVICE_NAME`. |
| `FULLTRACK_BASE_URL`, `FULLTRACK_API_KEY`, `FULLTRACK_SECRET_KEY` | API do Siga+ (Fulltrack). |
| `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` | Túnel para o link público (opcional). |
| `EMAIL_REMETENTE`, `EMAIL_SENHA` | Conta Gmail (senha de app) usada pelo `notificador.py`. |

### `Backend/config_local.json` (dados internos)

| Chave | Uso |
|---|---|
| `usuarios_iniciais` | Usuários criados no primeiro uso: e-mail, usuário, senha, nome e perfil (`admin`, `viewer` ou `tv_blurred`). As senhas são gravadas com hash. |
| `compradores` | Rótulos do filtro de comprador, no formato `{"código": "NOME (código)"}`. |
| `supervisores` | Quem recebe o e-mail diário de cortes e de quais compradores. |

## Execução

Dê dois cliques em `iniciar_servidor.bat`. Ele:
- sobe o servidor em `http://localhost:5000`;
- abre o túnel ngrok, se estiver configurado;
- reinicia o servidor sozinho se ele cair, com logs em `logs/`.

> Rode **uma única cópia** do `iniciar_servidor.bat`. Duas cópias abrem dois túneis no mesmo domínio, e o ngrok recusa o segundo (`ERR_NGROK_6030`).

## Segurança e dados

Nenhum dado da empresa vai para o repositório. Ficam fora do Git, pelo `.gitignore`:

- `.env` e `Backend/config_local.json`, com credenciais e dados internos;
- `Backend/.secret_key`, a chave de sessão do Flask;
- `*.db`, a base local com usuários e telemetria;
- `logs/`;
- planilhas, PDFs e apresentações exportadas.

Todas as rotas `/api/*` exigem login. Os parâmetros das consultas são validados e passados ao Oracle como *bind variables*.
