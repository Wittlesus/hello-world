use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use serde_json::Value;
use tauri::Emitter;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};

fn hw_path(project_path: &str, file_name: &str) -> PathBuf {
    PathBuf::from(project_path).join(".hello-world").join(file_name)
}

fn read_json_file(project_path: &str, file_name: &str) -> Result<Value, String> {
    let path = hw_path(project_path, file_name);
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

fn write_json_file(project_path: &str, file_name: &str, data: &Value) -> Result<(), String> {
    let path = hw_path(project_path, file_name);
    let contents = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[tauri::command]
fn get_config(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "config.json")
}

#[tauri::command]
fn save_config(project_path: &str, config: Value) -> Result<Value, String> {
    write_json_file(project_path, "config.json", &config)?;
    Ok(config)
}

#[tauri::command]
fn get_state(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "state.json")
}

#[tauri::command]
fn get_memories(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "memories.json")
}

#[tauri::command]
fn get_sessions(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "sessions.json")
}

#[tauri::command]
fn get_brain_state(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "brain-state.json")
}

#[tauri::command]
fn get_activity(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "activity.json")
}

#[tauri::command]
fn start_watching(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&project_path).join(".hello-world");

    if !watch_path.exists() {
        return Err(format!("{} does not exist", watch_path.display()));
    }

    std::thread::spawn(move || {
        let app_handle = app.clone();
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(_) => return,
        };

        if debouncer
            .watcher()
            .watch(&watch_path, notify::RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    let mut changed_files: Vec<String> = Vec::new();
                    for event in events {
                        if event.kind == DebouncedEventKind::Any {
                            if let Some(name) = event.path.file_name() {
                                let name_str = name.to_string_lossy().to_string();
                                if name_str.ends_with(".json") && !changed_files.contains(&name_str) {
                                    changed_files.push(name_str);
                                }
                            }
                        }
                    }
                    if !changed_files.is_empty() {
                        let _ = app_handle.emit("hw-files-changed", &changed_files);
                    }
                }
                Ok(Err(_)) => {}
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_state,
            get_memories,
            get_sessions,
            get_brain_state,
            get_activity,
            start_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
