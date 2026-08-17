use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchEvent {
    Modified,
    Deleted,
}

/// Returns an `OpenOptions` configured so file handles share read/write/delete
/// access with external processes. On Windows this is required for the editor
/// to observe external edits to a file it holds open.
pub fn create_open_options() -> std::fs::OpenOptions {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x00000001;
        const FILE_SHARE_WRITE: u32 = 0x00000002;
        const FILE_SHARE_DELETE: u32 = 0x00000004;
        let mut opts = std::fs::OpenOptions::new();
        opts.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
        opts
    }
    #[cfg(not(windows))]
    {
        std::fs::OpenOptions::new()
    }
}

/// Watches a single path and emits `Modified` vs `Deleted` events over a
/// channel. The parent directory is watched so atomic rename-replacements and
/// deletions of the target are both observed.
pub struct Watcher {
    _watcher: RecommendedWatcher,
    rx: Receiver<notify::Result<Event>>,
    path: PathBuf,
    _handle: Option<std::fs::File>,
}

fn classify(event: &Event) -> Option<WatchEvent> {
    match &event.kind {
        EventKind::Remove(_) => Some(WatchEvent::Deleted),
        EventKind::Create(_) => Some(WatchEvent::Modified),
        EventKind::Modify(m) => match m {
            ModifyKind::Name(RenameMode::From) => Some(WatchEvent::Deleted),
            ModifyKind::Name(_) => Some(WatchEvent::Modified),
            ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any => {
                Some(WatchEvent::Modified)
            }
            _ => None,
        },
        _ => None,
    }
}

impl Watcher {
    pub fn new(path: impl AsRef<Path>) -> notify::Result<Watcher> {
        let path = path.as_ref().to_path_buf();
        let dir = match path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => PathBuf::from("."),
        };

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(tx)?;
        watcher.watch(&dir, RecursiveMode::NonRecursive)?;

        let handle = create_open_options().read(true).open(&path).ok();

        Ok(Watcher {
            _watcher: watcher,
            rx,
            path,
            _handle: handle,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Blocks until the watched path changes, returning the first relevant
    /// `Modified`/`Deleted` event, or `None` once the channel is closed.
    pub fn recv(&self) -> Option<WatchEvent> {
        loop {
            match self.rx.recv() {
                Ok(Ok(event)) => {
                    if !event.paths.iter().any(|p| p == &self.path) {
                        continue;
                    }
                    if let Some(ev) = classify(&event) {
                        return Some(ev);
                    }
                }
                Ok(Err(_)) => continue,
                Err(_) => return None,
            }
        }
    }

    pub fn try_recv(&self) -> Option<WatchEvent> {
        loop {
            match self.rx.try_recv() {
                Ok(Ok(event)) => {
                    if !event.paths.iter().any(|p| p == &self.path) {
                        continue;
                    }
                    if let Some(ev) = classify(&event) {
                        return Some(ev);
                    }
                }
                Ok(Err(_)) => continue,
                Err(mpsc::TryRecvError::Empty) => return None,
                Err(mpsc::TryRecvError::Disconnected) => return None,
            }
        }
    }
}
