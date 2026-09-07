#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Ponto de entrada do app desktop Sumi (Tauri 2).
///
/// O frontend (React/Vite) continua sendo a mesma base da versao web.
/// Downloads que no navegador precisariam de proxy CORS passam pelo
/// plugin `http` (chamado de `desktop/frontend-integration/tauri-env.js`),
/// executado aqui no Rust — sem depender de corsproxy.io em producao.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Sumi desktop app");
}
