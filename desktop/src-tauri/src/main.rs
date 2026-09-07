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
fn main() {
    #[cfg(target_os = "linux")]
    apply_nvidia_wayland_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Sumi desktop app");
}
