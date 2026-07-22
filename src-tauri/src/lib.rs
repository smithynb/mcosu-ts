use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::RwLock,
};
use tauri::{AppHandle, Manager, State};

const ROOT_CONFIG_FILE: &str = "selected-osu-root.txt";

#[derive(Default)]
struct RootState(RwLock<Option<PathBuf>>);

#[derive(Clone, Serialize)]
struct RootInfo {
    path: String,
    name: String,
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    kind: &'static str,
}

#[tauri::command]
fn get_root(state: State<'_, RootState>) -> Result<Option<RootInfo>, String> {
    state
        .0
        .read()
        .map_err(|_| "Native filesystem root lock is poisoned.".to_string())?
        .as_ref()
        .map(|root| root_info(root.as_path()))
        .transpose()
}

#[tauri::command]
fn set_root(path: String, app: AppHandle, state: State<'_, RootState>) -> Result<RootInfo, String> {
    let root = fs::canonicalize(&path)
        .map_err(|error| format!("Could not open selected folder: {error}"))?;
    if !root.is_dir() {
        return Err("The selected path is not a directory.".to_string());
    }
    persist_root(&app, &root)?;
    *state
        .0
        .write()
        .map_err(|_| "Native filesystem root lock is poisoned.".to_string())? = Some(root.clone());
    root_info(&root)
}

#[tauri::command]
async fn read_file(path: String, state: State<'_, RootState>) -> Result<Vec<u8>, String> {
    let root = selected_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve_existing(&root, &path)?;
        if !target.is_file() {
            return Err("Requested path is not a file.".to_string());
        }
        fs::read(target).map_err(|error| format!("Could not read file: {error}"))
    })
    .await
    .map_err(|error| format!("Native file task failed: {error}"))?
}

#[tauri::command]
async fn list_dir(
    path: String,
    state: State<'_, RootState>,
) -> Result<Vec<DirectoryEntry>, String> {
    let root = selected_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve_existing(&root, &path)?;
        if !target.is_dir() {
            return Err("Requested path is not a directory.".to_string());
        }
        let mut result = Vec::new();
        for entry in
            fs::read_dir(target).map_err(|error| format!("Could not list directory: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Could not inspect directory entry: {error}"))?;
            let kind = if metadata.is_file() {
                "file"
            } else if metadata.is_dir() {
                "directory"
            } else {
                continue;
            };
            result.push(DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind,
            });
        }
        result.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        Ok(result)
    })
    .await
    .map_err(|error| format!("Native directory task failed: {error}"))?
}

#[tauri::command]
async fn path_exists(path: String, state: State<'_, RootState>) -> Result<bool, String> {
    let root = selected_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || match resolve_existing(&root, &path) {
        Ok(_) => Ok(true),
        Err(error) if error.starts_with("Path does not exist:") => Ok(false),
        Err(error) => Err(error),
    })
    .await
    .map_err(|error| format!("Native existence task failed: {error}"))?
}

fn selected_root(state: &State<'_, RootState>) -> Result<PathBuf, String> {
    state
        .0
        .read()
        .map_err(|_| "Native filesystem root lock is poisoned.".to_string())?
        .clone()
        .ok_or_else(|| "No osu! folder has been selected.".to_string())
}

fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = checked_relative_path(relative)?;
    let target = root.join(relative);
    let canonical = fs::canonicalize(&target)
        .map_err(|error| format!("Path does not exist: {} ({error})", target.display()))?;
    if !canonical.starts_with(root) {
        return Err("Path escapes the selected osu! folder.".to_string());
    }
    Ok(canonical)
}

fn checked_relative_path(value: &str) -> Result<PathBuf, String> {
    let normalized = value.replace('\\', "/");
    let bytes = normalized.as_bytes();
    if normalized.starts_with('/')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/')
    {
        return Err("Paths must stay inside the selected osu! folder.".to_string());
    }
    let path = Path::new(&normalized);
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => result.push(segment),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err("Paths must stay inside the selected osu! folder.".to_string())
            }
        }
    }
    Ok(result)
}

fn root_info(root: &Path) -> Result<RootInfo, String> {
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    Ok(RootInfo {
        path: root.to_string_lossy().into_owned(),
        name,
    })
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not locate app config directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(directory.join(ROOT_CONFIG_FILE))
}

fn persist_root(app: &AppHandle, root: &Path) -> Result<(), String> {
    fs::write(config_path(app)?, root.to_string_lossy().as_bytes())
        .map_err(|error| format!("Could not persist selected folder: {error}"))
}

fn load_persisted_root(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = config_path(app)?;
    let stored = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read selected folder config: {error}")),
    };
    let root = match fs::canonicalize(stored.trim()) {
        Ok(root) if root.is_dir() => root,
        _ => return Ok(None),
    };
    Ok(Some(root))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RootState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let saved = load_persisted_root(app.handle()).map_err(std::io::Error::other)?;
            *app.state::<RootState>()
                .0
                .write()
                .map_err(|_| std::io::Error::other("Native filesystem root lock is poisoned."))? =
                saved;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_root,
            set_root,
            read_file,
            list_dir,
            path_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{checked_relative_path, resolve_existing};

    #[test]
    fn relative_paths_reject_traversal_and_absolute_components() {
        assert_eq!(
            checked_relative_path("Songs/map.osu").unwrap(),
            std::path::PathBuf::from("Songs/map.osu")
        );
        for invalid in [
            "../secret",
            "Songs/../secret",
            "/etc/passwd",
            "C:\\osu!\\osu!.db",
            ".",
        ] {
            assert!(checked_relative_path(invalid).is_err(), "{invalid}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn canonical_resolution_rejects_symlink_escapes() {
        use std::{fs, os::unix::fs::symlink, time::SystemTime};

        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("mcosu-ts-root-test-{unique}"));
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("inside.txt"), b"inside").unwrap();
        fs::write(outside.join("secret.txt"), b"outside").unwrap();
        symlink(outside.join("secret.txt"), root.join("escape.txt")).unwrap();

        let canonical_root = fs::canonicalize(&root).unwrap();
        assert!(resolve_existing(&canonical_root, "inside.txt").is_ok());
        assert_eq!(
            resolve_existing(&canonical_root, "escape.txt").unwrap_err(),
            "Path escapes the selected osu! folder."
        );

        fs::remove_dir_all(base).unwrap();
    }
}
