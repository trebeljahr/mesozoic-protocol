#[cfg(all(desktop, feature = "updater"))]
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Off unless the `updater` Cargo feature is on — see src-tauri/Cargo.toml.
    #[cfg(all(desktop, feature = "updater"))]
    {
        builder = updater::register(builder);
    }

    builder
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
