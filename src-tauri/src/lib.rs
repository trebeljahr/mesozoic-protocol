#[cfg(desktop)]
mod saves;
#[cfg(desktop)]
mod steam;
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

    #[cfg(desktop)]
    {
        builder = builder
            .manage(saves::SaveState::default())
            .on_window_event(saves::window_event);
        #[cfg(feature = "updater")]
        {
            builder = builder.invoke_handler(tauri::generate_handler![
                saves::desktop_saves_directory,
                saves::desktop_saves_load,
                saves::desktop_saves_write,
                saves::desktop_saves_open_directory,
                saves::desktop_saves_close,
                updater::updater_check,
                updater::updater_download,
                updater::updater_install
            ]);
        }
        #[cfg(not(feature = "updater"))]
        {
            builder = builder.invoke_handler(tauri::generate_handler![
                saves::desktop_saves_directory,
                saves::desktop_saves_load,
                saves::desktop_saves_write,
                saves::desktop_saves_open_directory,
                saves::desktop_saves_close
            ]);
        }
    }

    let app = builder
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|_app, _event| {
        #[cfg(desktop)]
        saves::run_event(_app, &_event);
    });
}
