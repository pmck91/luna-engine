use fs2::FileExt;
use std::{fs::File, io};

/// An advisory exclusive file lock released when its guard leaves scope.
///
/// The guard explicitly unlocks before closing its file. On Unix, closing alone
/// can leave a lock held by a descriptor inherited during a concurrent process
/// spawn, even when that descriptor will be closed on exec.
#[derive(Debug)]
#[must_use = "Keep the guard alive for the entire protected operation"]
pub struct ExclusiveFileLock {
    file: File,
}

impl ExclusiveFileLock {
    /// Acquires the lock without waiting, taking ownership of the open file.
    ///
    /// # Errors
    ///
    /// Returns the operating system's locking error, including contention with
    /// another open handle. The file must be open for reading or writing.
    pub fn try_lock(file: File) -> io::Result<Self> {
        file.try_lock_exclusive()?;
        Ok(Self { file })
    }
}

impl Drop for ExclusiveFileLock {
    fn drop(&mut self) {
        // Closing remains the fallback if unlocking fails; Drop must not panic.
        let _ = FileExt::unlock(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs::OpenOptions, path::Path};

    fn open(path: &Path) -> File {
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .unwrap()
    }

    #[test]
    fn drop_unlocks_while_a_duplicate_handle_is_still_open() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("lock");
        let guard = ExclusiveFileLock::try_lock(open(&path)).unwrap();
        // Duplicating the handle retains the same open file description as a
        // forked child. This makes the spawn race reproducible without timing.
        let duplicate = guard.file.try_clone().unwrap();
        let error = ExclusiveFileLock::try_lock(open(&path)).unwrap_err();
        assert_eq!(
            error.raw_os_error(),
            fs2::lock_contended_error().raw_os_error()
        );
        drop(guard);

        let _next = ExclusiveFileLock::try_lock(open(&path)).unwrap();
        drop(duplicate);
    }

    #[test]
    fn an_early_error_releases_the_lock_while_a_duplicate_remains_open() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("lock");
        let file = open(&path);
        let duplicate = file.try_clone().unwrap();
        let result = (|| -> io::Result<()> {
            let _guard = ExclusiveFileLock::try_lock(file)?;
            Err(io::Error::other("Protected operation failed"))
        })();
        assert_eq!(
            result.unwrap_err().to_string(),
            "Protected operation failed"
        );

        let _next = ExclusiveFileLock::try_lock(open(&path)).unwrap();
        drop(duplicate);
    }

    #[test]
    fn failed_acquisition_preserves_the_active_lock() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("lock");
        let guard = ExclusiveFileLock::try_lock(open(&path)).unwrap();
        for _ in 0..2 {
            let error = ExclusiveFileLock::try_lock(open(&path)).unwrap_err();
            assert_eq!(
                error.raw_os_error(),
                fs2::lock_contended_error().raw_os_error()
            );
        }
        drop(guard);
        let _next = ExclusiveFileLock::try_lock(open(&path)).unwrap();
    }
}
