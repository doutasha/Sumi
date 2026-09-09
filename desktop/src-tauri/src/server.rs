//! Gerente do motor Suwayomi-Server como processo filho (sidecar) — fase 4d-2.
//!
//! Decisões (conforme escolha do usuário):
//! - JRE slim + JAR sob demanda (`server_download`, com progresso e SHA-256;
//!   nada é baixado sem o usuário ver).
//! - Data-dir FIXO: `<LocalAppData>/Sumi/suwayomi` via
//!   `app.path().app_local_data_dir()` (+ `Sumi/suwayomi`), repassado com
//!   `-Dsuwayomi.tachidesk.config.server.rootDir=...` (padrão do wiki oficial).
//! - Autostart oculto: `CREATE_NO_WINDOW` no Windows + stdio nulo +
//!   `initialOpenInBrowserEnabled=false` + `systemTrayEnabled=false`.
//! - Heap capado: `-Xmx512m`.
//! - CEF lazy: `kcefEnabled=false` por padrão (poupa ~260MB); opt-in via
//!   `server_set_kcef` (marcador `<base>/kcef.enabled`, exige restart).
//! - Health + relançamento: o Rust expõe `server_start` idempotente; o loop de
//!   health fica no frontend (`sidecar.js`, reusa `checkHealth()` de parser/).
//! - Kill-on-close: `shutdown_server` é chamado no `CloseRequested` da janela
//!   e no `RunEvent::Exit` — mata SÓ o PID filho que este app spawnou.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// Porta padrão do motor (igual ao `DEFAULT_BASE_URL` do parser/).
/// Override de prova/dev via env `SUMI_SUWAYOMI_PORT` (ex.: 4568 p/ não
/// colidir com um servidor manual em 4567). Produção usa sempre 4567.
pub fn default_port() -> u16 {
    std::env::var("SUMI_SUWAYOMI_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}
pub const DEFAULT_PORT: u16 = 4567;
/// Teto de heap da JVM do sidecar.
pub const HEAP_MAX: &str = "-Xmx512m";
/// Versão do servidor pinada (a mesma provada ao vivo nos testes 4a–4d-1).
pub const SERVER_VERSION: &str = "v2.3.2243";

/// Layout sob demanda dentro do data-dir fixo:
/// `<base>/jre/bin/java(.exe)` e `<base>/bin/Suwayomi-Server.jar`.
#[derive(Debug, Default)]
struct Inner {
    child: Option<Child>,
    info: Option<StartedInfo>,
}

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedInfo {
    pub pid: u32,
    pub port: u16,
    pub kcef: bool,
    pub data_dir: String,
    pub java_bin: String,
    pub jar: String,
}

#[derive(Debug, Default)]
pub struct ServerState {
    inner: Mutex<Inner>,
}

/// `<LocalAppData>/Sumi/suwayomi` (ou equival. por SO) — cria se ausente.
pub fn sumi_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("data-dir indisponível: {e}"))?;
    let dir = base.join("Sumi").join("suwayomi");
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
    Ok(dir)
}

fn java_bin_for(base: &std::path::Path) -> PathBuf {
    let exe = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };
    base.join("jre").join("bin").join(exe)
}

fn jar_for(base: &std::path::Path) -> PathBuf {
    base.join("bin").join("Suwayomi-Server.jar")
}

/// Reap se o filho já morreu; devolve true se segue vivo.
fn still_running(inner: &mut Inner) -> bool {
    match inner.child.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                inner.child = None;
                false
            }
        },
        None => false,
    }
}

/// Mata o filho (best-effort) e limpa o estado. Chamado no close/exit.
pub fn shutdown_server(state: &tauri::State<ServerState>) {
    let mut inner = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.info = None;
}

/// true se já há algo ouvindo a porta (ex.: servidor manual do usuário).
/// Nesse caso o autostart recua: nunca disputar a porta de outro dono.
fn port_busy(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// Marcador opt-in do KCEF: `<base>/kcef.enabled` existe = ligado.
/// Arquivo (não registro) de propósito: sobrevive a reinstalações e vale
/// por máquina; o frontend só lê/escreve via `server_set_kcef`.
fn kcef_marker(base: &std::path::Path) -> PathBuf {
    base.join("kcef.enabled")
}

fn read_kcef(base: &std::path::Path) -> bool {
    kcef_marker(base).exists()
}

/// Liga/desliga o WebView KCEF (~260MB baixados pelo servidor no primeiro
/// uso com Cloudflare). Exige restart do motor — o frontend reinicia.
#[tauri::command]
pub fn server_set_kcef(app: AppHandle, enabled: bool) -> Result<serde_json::Value, String> {
    let base = sumi_data_dir(&app)?;
    let marker = kcef_marker(&base);
    if enabled {
        std::fs::write(&marker, "1").map_err(|e| format!("gravar marcador: {e}"))?;
    } else {
        let _ = std::fs::remove_file(&marker);
    }
    Ok(serde_json::json!({ "kcef": enabled }))
}

/// Autostart oculto (chamado no setup do app, fase 4d-2 item 1).
/// Regras: sem JRE/JAR → `skipped: needs-download` (nunca baixa sozinho os
/// 220MB); porta ocupada → `skipped: port-busy` (servidor manual é o dono);
/// filho já vivo → idempotente. Erro de spawn vira `skipped: spawn-failed`
/// (o usuário ainda pode iniciar pelo Config) — nunca derruba o app.
pub fn autostart(app: &AppHandle) -> serde_json::Value {
    let port = default_port();
    let out = (|| -> Result<serde_json::Value, String> {
        let data_dir = sumi_data_dir(app)?;
        if !jar_for(&data_dir).exists() || !java_bin_for(&data_dir).exists() {
            return Ok(serde_json::json!({ "started": false, "reason": "needs-download" }));
        }
        if port_busy(port) {
            return Ok(serde_json::json!({ "started": false, "reason": "port-busy", "port": port }));
        }
        let state: tauri::State<ServerState> = app.state();
        let info = server_start_inner(app, &state, port, None, None, None)?;
        Ok(serde_json::json!({ "started": true, "pid": info.pid, "port": info.port, "kcef": info.kcef }))
    })();
    match out {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "started": false, "reason": "spawn-failed", "message": e }),
    }
}

#[tauri::command]
pub fn server_status(
    app: AppHandle,
    state: tauri::State<ServerState>,
) -> Result<serde_json::Value, String> {
    let data_dir = sumi_data_dir(&app)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "estado do servidor travado".to_string())?;
    let running = still_running(&mut inner);
    if !running {
        inner.info = None;
    }
    Ok(serde_json::json!({
        "running": running,
        "needsDownload": !jar_for(&data_dir).exists() || !java_bin_for(&data_dir).exists(),
        "kcef": read_kcef(&data_dir),
        "info": inner.info,
        "dataDir": data_dir.to_string_lossy(),
        "port": inner.info.clone().map(|i| i.port).unwrap_or_else(default_port),
        "serverVersion": SERVER_VERSION,
    }))
}

#[tauri::command]
pub fn server_start(
    app: AppHandle,
    state: tauri::State<ServerState>,
    port: Option<u16>,
    java_path: Option<String>,
    jar_path: Option<String>,
    kcef: Option<bool>,
) -> Result<StartedInfo, String> {
    server_start_inner(
        &app,
        &state,
        port.unwrap_or_else(default_port),
        java_path,
        jar_path,
        kcef,
    )
}

fn server_start_inner(
    app: &AppHandle,
    state: &tauri::State<ServerState>,
    port: u16,
    java_path: Option<String>,
    jar_path: Option<String>,
    kcef: Option<bool>,
) -> Result<StartedInfo, String> {
    let data_dir = sumi_data_dir(app)?;

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "estado do servidor travado".to_string())?;
    if still_running(&mut inner) {
        return inner.info.clone().ok_or("inconsistência interna".to_string());
    }
    inner.child = None;
    inner.info = None;

    // Porta ocupada por outro dono (ex.: servidor manual): recusar com
    // mensagem clara em vez de spawnar um filho que morre no mutex.
    if port_busy(port) {
        return Err(format!(
            "PORTA OCUPADA: já há um servidor em 127.0.0.1:{port} (desligue o manual ou mude a porta)"
        ));
    }

    // Layout sob demanda; overrides só p/ dev/prova (ex.: bundle existente).
    let java_bin = java_path.map(PathBuf::from).unwrap_or_else(|| java_bin_for(&data_dir));
    let jar = jar_path.map(PathBuf::from).unwrap_or_else(|| jar_for(&data_dir));
    if !java_bin.exists() || !jar.exists() {
        return Err(format!(
            "NEEDS_DOWNLOAD: baixe JRE slim + JAR {SERVER_VERSION} para {} (esperado: {} e {})",
            data_dir.display(),
            java_bin.display(),
            jar.display()
        ));
    }

    // KCEF: explícito > marcador em disco > desligado (lazy).
    let kcef = kcef.unwrap_or_else(|| read_kcef(&data_dir));

    // HOCON via -D prefere barras normais no Windows.
    let root = data_dir.to_string_lossy().replace('\\', "/");
    let mut cmd = Command::new(&java_bin);
    cmd.arg("--add-exports=java.desktop/sun.awt=ALL-UNNAMED")
        .arg(HEAP_MAX)
        .arg(format!("-Dsuwayomi.tachidesk.config.server.rootDir={root}"))
        .arg(format!(
            "-Dsuwayomi.tachidesk.config.server.port={port}"
        ))
        .arg("-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false")
        .arg("-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false")
        .arg(format!(
            "-Dsuwayomi.tachidesk.config.server.kcefEnabled={kcef}"
        ))
        .arg("-jar")
        .arg(&jar)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .current_dir(&data_dir);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Autostart oculto: sem janela de console (o usuário odeia popup).
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("spawn java: {e}"))?;
    let info = StartedInfo {
        pid: child.id(),
        port,
        kcef,
        data_dir: data_dir.to_string_lossy().to_string(),
        java_bin: java_bin.to_string_lossy().to_string(),
        jar: jar.to_string_lossy().to_string(),
    };
    inner.child = Some(child);
    inner.info = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub fn server_stop(state: tauri::State<ServerState>) -> Result<bool, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "estado do servidor travado".to_string())?;
    let had = inner.child.is_some();
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.info = None;
    Ok(had)
}

/// Tamanho em bytes de um caminho (arquivo ou árvore). Erros viram 0.
fn path_size(path: &std::path::Path) -> u64 {
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    total
}

/// Apaga TODOS os dados do motor (zona de perigo) — ou só mede (`preview`).
/// Mantém sempre o runtime (jre/ + Suwayomi-Server.jar) para não rebaixar
/// 220MB; remove banco, downloads, backups, capas, settings, KCEF e o
/// marcador kcef. Para o filho antes. Exige motor parado depois (o chamador
/// reinicia do zero).
#[tauri::command]
pub fn server_wipe_data(
    app: AppHandle,
    state: tauri::State<ServerState>,
    preview: Option<bool>,
) -> Result<serde_json::Value, String> {
    let base = sumi_data_dir(&app)?;
    let preview = preview.unwrap_or(false);

    // Guarda real: sem filho nosso mas com a porta ocupada, há um servidor
    // estranho (ex.: sonda, manual) com o banco aberto — apagar por baixo
    // dele corrompe sem limpar de verdade. Pare-o antes.
    {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "estado do servidor travado".to_string())?;
        let tracked = inner.child.is_some();
        drop(inner);
        if !tracked && port_busy(default_port()) && !preview {
            return Err(
                "há outro servidor na porta (sonda/manual?) — pare-o antes de apagar".to_string(),
            );
        }
    }

    // Para o filho primeiro (banco aberto não se apaga).
    shutdown_server(&state);

    let jar_name = std::ffi::OsString::from("Suwayomi-Server.jar");
    let mut freed: u64 = 0;
    let mut kept: Vec<String> = vec![];
    let entries: Vec<_> = std::fs::read_dir(&base)
        .map_err(|e| format!("ler data-dir: {e}"))?
        .flatten()
        .collect();
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        if path.is_dir() && name == "jre" {
            kept.push("jre/".to_string());
            continue;
        }
        if path.is_dir() && name == "bin" {
            // Dentro de bin/: mantém o JAR, apaga o resto (kcef etc.).
            let inner: Vec<_> = std::fs::read_dir(&path)
                .map_err(|e| format!("ler bin/: {e}"))?
                .flatten()
                .collect();
            for sub in inner {
                if sub.path().is_file() && sub.file_name() == jar_name {
                    kept.push("bin/Suwayomi-Server.jar".to_string());
                    continue;
                }
                freed += path_size(&sub.path());
                if !preview {
                    let p = sub.path();
                    if p.is_dir() {
                        std::fs::remove_dir_all(&p).map_err(|e| format!("apagar {}: {e}", p.display()))?;
                    } else {
                        std::fs::remove_file(&p).map_err(|e| format!("apagar {}: {e}", p.display()))?;
                    }
                }
            }
            continue;
        }
        freed += path_size(&path);
        if !preview {
            if path.is_dir() {
                std::fs::remove_dir_all(&path).map_err(|e| format!("apagar {}: {e}", path.display()))?;
            } else {
                std::fs::remove_file(&path).map_err(|e| format!("apagar {}: {e}", path.display()))?;
            }
        }
    }
    Ok(serde_json::json!({ "freedBytes": freed, "kept": kept, "preview": preview }))
}

// ---------- Download sob demanda (JRE slim + JAR, ~220MB) ----------
//
// Tudo verificado por HEAD/hashes em 2026-09-07 e pinado abaixo.
// O JAR é multiplataforma; a JRE está verificada só p/ Windows x64 —
// outras plataformas devolvem erro honesto até terem URL provada.

/// JAR oficial v2.3.2243 (mesmo binário provado nos testes 4a–4d-1).
const JAR_URL: &str = "https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.3.2243/Suwayomi-Server-v2.3.2243.jar";
/// SHA-256 oficial (asset Checksums.sha256 do release).
const JAR_SHA256: &str = "821141b32e170d4a02d3cbdfed577ed8f07bd22383ff5f4132ebb5ae40e98dd5";
const JAR_BYTES: u64 = 174_128_768;
/// Zulu 25 JRE (mesma família do bundle de teste, que roda Zulu25.0.3).
const JRE_URL_WIN_X64: &str =
    "https://cdn.azul.com/zulu/bin/zulu25.34.17-ca-jre25.0.3-win_x64.zip";
const JRE_BYTES_WIN_X64: u64 = 58_871_369;

fn jre_source() -> Result<(&'static str, u64), String> {
    if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        Ok((JRE_URL_WIN_X64, JRE_BYTES_WIN_X64))
    } else {
        Err("download automático ainda sem URL verificada nesta plataforma — \
             informe javaPath/jarPath (dev) ou aguarde o mapeamento"
            .to_string())
    }
}

fn emit_progress(app: &AppHandle, phase: &str, received: u64, total: u64) {
    let _ = app.emit(
        "server-download",
        serde_json::json!({ "phase": phase, "received": received, "total": total }),
    );
}

/// Baixa com progresso, confere tamanho + SHA-256 (quando pinado) e
/// move de `.part` para o destino só no final (nunca deixa meio-arquivo).
fn download_one(
    client: &reqwest::blocking::Client,
    app: &AppHandle,
    phase: &str,
    url: &str,
    expected_bytes: u64,
    expected_sha256: Option<&str>,
    dest: &std::path::Path,
) -> Result<u64, String> {
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| format!("GET {phase}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("GET {phase}: HTTP {status}"));
    }
    let total = resp.content_length().unwrap_or(expected_bytes);
    emit_progress(app, phase, 0, total);

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("criar dir: {e}"))?;
    }
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| format!("criar .part: {e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    // 64KB: comandos Tauri rodam na main thread (stack ~1MB no Windows);
    // 1MB de buffer aqui estourou a pilha (STATUS_STACK_OVERFLOW, provado).
    let mut buf = [0u8; 64 * 1024];
    loop {
        use std::io::Read;
        let n = resp.read(&mut buf).map_err(|e| format!("ler {phase}: {e}"))?;
        if n == 0 {
            break;
        }
        {
            use std::io::Write;
            file.write_all(&buf[..n])
                .map_err(|e| format!("escrever {phase}: {e}"))?;
        }
        hasher.update(&buf[..n]);
        received += n as u64;
        if received - last_emit >= 1_048_576 {
            emit_progress(app, phase, received, total);
            last_emit = received;
        }
    }
    drop(file);
    emit_progress(app, phase, received, total);

    if expected_bytes > 0 && received != expected_bytes {
        let _ = std::fs::remove_file(&part);
        return Err(format!(
            "{phase}: tamanho divergente ({received} != {expected_bytes})"
        ));
    }
    if let Some(hex) = expected_sha256 {
        let actual = format!("{:x}", hasher.finalize());
        if actual != hex {
            let _ = std::fs::remove_file(&part);
            return Err(format!("{phase}: SHA-256 divergente"));
        }
    }
    std::fs::rename(&part, dest).map_err(|e| format!("finalizar {phase}: {e}"))?;
    Ok(received)
}

/// Extrai o zip da JRE para `<base>/jre`, descartando o diretório-raiz do
/// zip (`zulu…/bin/java` → `<base>/jre/bin/java`). Barreira anti zip-slip.
fn extract_jre(app: &AppHandle, zip_path: &std::path::Path, jre_dir: &std::path::Path) -> Result<usize, String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("abrir zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip inválido: {e}"))?;
    let total = archive.len() as u64;
    if jre_dir.exists() {
        std::fs::remove_dir_all(jre_dir).map_err(|e| format!("limpar jre antiga: {e}"))?;
    }
    std::fs::create_dir_all(jre_dir).map_err(|e| format!("criar jre: {e}"))?;
    let mut count = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("ler zip[{i}]: {e}"))?;
        let inner = entry.enclosed_name().ok_or(format!("zip[{i}]: caminho inseguro"))?;
        let mut parts = inner.components();
        parts.next(); // raiz do zip (ex.: zulu25…-win_x64/)
        let rel: PathBuf = parts.collect();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = jre_dir.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("criar dir: {e}"))?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("criar dir: {e}"))?;
                // Barreira extra anti-symlink: o pai real tem que continuar
                // dentro de jre/ mesmo após resolver links.
                let canon_base = jre_dir
                    .canonicalize()
                    .map_err(|e| format!("canonicalizar jre: {e}"))?;
                let canon_parent = parent
                    .canonicalize()
                    .map_err(|e| format!("canonicalizar destino: {e}"))?;
                if !canon_parent.starts_with(&canon_base) {
                    return Err(format!("zip: destino fora de jre/ ({})", target.display()));
                }
            }
            let mut out =
                std::fs::File::create(&target).map_err(|e| format!("extrair: {e}"))?;
            use std::io::copy;
            copy(&mut entry, &mut out).map_err(|e| format!("extrair: {e}"))?;
            count += 1;
        }
        if i % 200 == 0 {
            emit_progress(app, "extract", i as u64, total);
        }
    }
    emit_progress(app, "extract", total, total);
    Ok(count)
}

/// Roda `java --version` oculto: prova que a JRE descompactada funciona.
fn verify_java(java_bin: &std::path::Path) -> Result<String, String> {
    let mut cmd = Command::new(java_bin);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().map_err(|e| format!("testar java: {e}"))?;
    if !out.status.success() {
        return Err("java --version falhou (JRE incompleta?)".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    Ok(text.lines().next().unwrap_or("java ok").to_string())
}

/// Baixa JRE slim + JAR para o data-dir fixo, com progresso via evento
/// `server-download` ({phase, received, total}; phases: jar/jre/extract/done).
/// Idempotente: sem `force`, com tudo presente devolve `cached: true`.
#[tauri::command]
pub fn server_download(
    app: AppHandle,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let base = sumi_data_dir(&app)?;
    let java_bin = java_bin_for(&base);
    let jar = jar_for(&base);
    if !force.unwrap_or(false) && java_bin.exists() && jar.exists() {
        return Ok(serde_json::json!({
            "cached": true,
            "dataDir": base.to_string_lossy(),
            "javaBin": java_bin.to_string_lossy(),
            "jar": jar.to_string_lossy(),
        }));
    }
    let (jre_url, jre_bytes) = jre_source()?;

    let client = reqwest::blocking::Client::builder()
        .user_agent("Sumi-sidecar/1.0")
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let bin_dir = jar_for(&base);
    let bin_dir = bin_dir.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("criar bin: {e}"))?;
    let jar_bytes = download_one(
        &client,
        &app,
        "jar",
        JAR_URL,
        JAR_BYTES,
        Some(JAR_SHA256),
        &jar,
    )?;

    let tmp_zip = base.join("jre.zip");
    let got_zip = download_one(&client, &app, "jre", jre_url, jre_bytes, None, &tmp_zip)?;
    let jre_dir = base.join("jre");
    let files = extract_jre(&app, &tmp_zip, &jre_dir)?;
    let _ = std::fs::remove_file(&tmp_zip);

    if !java_bin.exists() {
        return Err(format!(
            "JRE extraída sem {} (zip inesperado?)",
            java_bin.display()
        ));
    }
    let java_version = verify_java(&java_bin)?;

    emit_progress(&app, "done", 1, 1);
    Ok(serde_json::json!({
        "cached": false,
        "dataDir": base.to_string_lossy(),
        "javaBin": java_bin.to_string_lossy(),
        "jar": jar.to_string_lossy(),
        "jarBytes": jar_bytes,
        "jreBytes": got_zip,
        "jreFiles": files,
        "javaVersion": java_version,
    }))
}
