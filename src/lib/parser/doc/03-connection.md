# Conexão: config, auth, erros

## Config (`localStorage['sumi.suwayomi.config']`)

`{ baseUrl: 'http://127.0.0.1:4567', username: '', password: '', enabled: true }`.
`enabled: false` = modo leve forçado (nem tenta).

## Health (`checkHealth()`)

`GET /source/list` com timeout 8s, sem retry:
`{online: true, latencyMs, sourceCount}` ou `{online: false, code, message}`.
Códigos: `DISABLED` | `UNREACHABLE` | `TIMEOUT` | `HTTP` | `BAD_RESPONSE`.

## Auth

Servidor zerado = sem login. Se o usuário ligou `BASIC_AUTH`, preencher
username/password → header `Authorization: Basic`. `401` não tem retry
(resposta direta pra UI pedir credencial). `SIMPLE_LOGIN` (cookie) não é
suportado na v1 — documentar "use BASIC ou sem auth no localhost".

## Retry (`client.js`)

1 retry em erro de rede e HTTP 5xx/429. Sem retry em 4xx (401/404 direto).
Timeout default 15s por tentativa (lento = extensão/site pesado, não necessariamente queda).

## Armadilhas reais (observadas)

- **Data-dir no Temp do Windows**: instância de teste gravou banco/extensões em
  `Temp\Tachidesk` — limpeza de disco apaga tudo. Sidecar (4d) fixa o data-dir.
- **CEF baixa sozinho (~260 MB)** no primeiro boot; maioria das extensões não precisa.
  4d: desligar download padrão, sob demanda.
- **Instância 1 morreu sem crash dump** nesta máquina (causa desconhecida, possível
  CEF/GPU). Mitigação: health-check + UI offline graciosa + logs do sidecar na 4d.
