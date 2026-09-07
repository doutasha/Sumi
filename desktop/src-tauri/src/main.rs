#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Workaround p/ crash na inicializacao em Wayland + NVIDIA proprietario:
/// o WebKitGTK usa explicit sync (linux-drm-syncobj) que o driver rejeita
/// ("explicit sync is used, but no acquire point is set") e o processo morre
/// com `Error 71 (Protocol error) dispatching to Wayland display`.
/// Desligar o explicit sync da NVIDIA resolve mantendo o DMABUF ligado —
/// preferivel a `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
/// So atua em sessao Wayland no Linux e respeita valor ja definido no ambiente.
#[cfg(target_os = "linux")]
fn apply_nvidia_wayland_workaround() {
    if std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return;
    }
    if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}

/// Ponto de entrada do app desktop Sumi (Tauri 2).
///
/// O frontend (React/Vite) continua sendo a mesma base da versao web.
/// Downloads que no navegador precisariam de proxy CORS passam pelo
/// plugin `http` (chamado de `desktop/frontend-integration/tauri-env.js`),
/// executado aqui no Rust — sem depender de corsproxy.io em producao.
///
/// O motor Suwayomi-Server roda como processo filho gerenciado em
/// `server.rs` (fase 4d-2): autostart oculto, data-dir fixo, heap capado,
/// health via frontend e kill-on-close (nunca deixar java orfao).
mod server;

use tauri::{Emitter, Manager};

fn main() {
    #[cfg(target_os = "linux")]
    apply_nvidia_wayland_workaround();

    tauri::Builder::default()
        .manage(server::ServerState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            server::server_status,
            server::server_start,
            server::server_stop,
            server::server_download,
            server::server_set_kcef,
            server::server_wipe_data,
        ])
        // Autostart oculto (4d-2 item 1): tenta subir o motor junto do app.
        // Nunca falha o boot: sem arquivos ou porta ocupada, só recua e o
        // usuário inicia pelo Config. Resultado vai no evento p/ debug.
        .setup(|app| {
            let report = server::autostart(app.handle());
            app.emit("server-autostart", &report)
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        // Kill-on-close (parte 1): janela pedindo para fechar mata o filho.
        // Sem tray no Sumi: última janela destruída encerra o app (o que
        // dispara RunEvent::Exit abaixo e remata o filho por garantia).
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    if let Some(state) = window.try_state::<server::ServerState>() {
                        server::shutdown_server(&state);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    let app = window.app_handle();
                    if app.webview_windows().is_empty() {
                        app.exit(0);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running Sumi desktop app")
        // Kill-on-close (parte 2): qualquer saída do event loop mata o filho.
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<server::ServerState>() {
                    server::shutdown_server(&state);
                }
            }
        });
}
