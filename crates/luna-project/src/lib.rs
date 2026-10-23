//! Canonical projects, conflict-aware recoverable writes, and the editor's bundle contract.
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use luna_model::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
};
pub const MAX_FILE: u64 = 64 * 1024 * 1024;
pub const MAX_BUNDLE: u64 = 256 * 1024 * 1024;

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("File needs a parent directory")?;
    fs::create_dir_all(parent)?;
    ensure!(
        !path.is_symlink(),
        "Refusing to replace a symlink: {}",
        path.display()
    );
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    sync_dir(parent)?;
    Ok(())
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    let _ = path;
    Ok(())
}
pub fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && !path.contains(':')
        && !path.chars().any(char::is_control)
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        && path
            .split('/')
            .all(|p| p != "." && p != ".." && !p.is_empty())
}
pub fn confined(root: &Path, relative: &str) -> Result<PathBuf> {
    ensure!(safe_relative(relative), "Unsafe relative path: {relative}");
    let mut current = root.canonicalize()?;
    for component in Path::new(relative).components() {
        current.push(component);
        ensure!(
            !current.is_symlink(),
            "Symlinks are not supported within projects: {}",
            current.display()
        );
    }
    Ok(current)
}
fn read_bytes(path: &Path) -> Result<Vec<u8>> {
    ensure!(
        !path.is_symlink(),
        "Symlink is not allowed: {}",
        path.display()
    );
    let f = File::open(path).with_context(|| format!("Cannot read {}", path.display()))?;
    ensure!(
        f.metadata()?.len() <= MAX_FILE,
        "File exceeds 64 MiB: {}",
        path.display()
    );
    let mut bytes = vec![];
    f.take(MAX_FILE + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= MAX_FILE, "File exceeds 64 MiB");
    Ok(bytes)
}
fn json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(&read_bytes(path)?)
        .with_context(|| format!("Invalid JSON in {}", path.display()))
}
fn pretty<T: Serialize>(v: &T) -> Result<String> {
    Ok(serde_json::to_string_pretty(v)? + "\n")
}
fn entity_files<T: serde::de::DeserializeOwned>(root: &Path, name: &str) -> Result<Vec<T>> {
    let dir = confined(root, name)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = fs::read_dir(&dir)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    files.sort();
    files
        .into_iter()
        .filter(|p| p.extension().is_some_and(|s| s == "json"))
        .map(|p| json(&p))
        .collect()
}
pub fn load_project(root: &Path) -> Result<Project> {
    ensure!(
        root.is_dir(),
        "Project directory does not exist: {}",
        root.display()
    );
    let _lock = write_lock(root)?;
    recover(root)?;
    load_unlocked(root)
}
fn load_unlocked(root: &Path) -> Result<Project> {
    let layout = confined(root, "editor/map-layout.json")?;
    Ok(Project {
        game: json(&confined(root, "game.json")?)?,
        vocabulary: json(&confined(root, "vocabulary.json")?)?,
        locations: entity_files(root, "locations")?,
        objects: entity_files(root, "objects")?,
        characters: entity_files(root, "characters")?,
        editor: if layout.exists() {
            json(&layout)?
        } else {
            EditorLayout::default()
        },
    })
}
fn collect(root: &Path, relative: &str, out: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    let path = confined(root, relative)?;
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        let mut entries = fs::read_dir(&path)?
            .map(|e| e.map(|e| e.file_name()))
            .collect::<std::io::Result<Vec<_>>>()?;
        entries.sort();
        for name in entries {
            let name = name.to_str().context("Non-Unicode project path")?;
            collect(root, &format!("{relative}/{name}"), out)?
        }
    } else {
        out.insert(relative.into(), read_bytes(&path)?);
    }
    Ok(())
}
pub fn revision(root: &Path) -> Result<String> {
    let mut files = BTreeMap::new();
    for name in [
        "game.json",
        "vocabulary.json",
        "locations",
        "objects",
        "characters",
        "editor",
        "assets",
    ] {
        collect(root, name, &mut files)?
    }
    let mut hash = Sha256::new();
    for (path, bytes) in files {
        hash.update((path.len() as u64).to_le_bytes());
        hash.update(path.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes)
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn project_files(p: &Project, editor: bool) -> Result<BTreeMap<String, String>> {
    let mut files = BTreeMap::from([
        ("game.json".into(), pretty(&p.game)?),
        ("vocabulary.json".into(), pretty(&p.vocabulary)?),
    ]);
    for l in &p.locations {
        ensure!(safe_id(&l.id), "Unsafe location ID");
        ensure!(
            files
                .insert(format!("locations/{}.json", l.id), pretty(l)?)
                .is_none(),
            "Duplicate location ID"
        );
    }
    for o in &p.objects {
        ensure!(safe_id(&o.id), "Unsafe object ID");
        ensure!(
            files
                .insert(format!("objects/{}.json", o.id), pretty(o)?)
                .is_none(),
            "Duplicate object ID"
        );
    }
    for c in &p.characters {
        ensure!(safe_id(&c.id), "Unsafe character ID");
        ensure!(
            files
                .insert(format!("characters/{}.json", c.id), pretty(c)?)
                .is_none(),
            "Duplicate character ID"
        );
    }
    if editor {
        files.insert("editor/map-layout.json".into(), pretty(&p.editor)?);
    }
    Ok(files)
}
fn write_lock(root: &Path) -> Result<File> {
    let path = root.join(".luna-write.lock");
    ensure!(!path.is_symlink(), "Unsafe project lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    file.try_lock_exclusive()
        .context("Project is busy in another operation")?;
    Ok(file)
}
#[derive(Serialize, Deserialize)]
struct Change {
    path: String,
    before: Option<String>,
    after: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Transaction {
    changes: Vec<Change>,
}
fn managed(path: &str) -> bool {
    path == "game.json"
        || path == "vocabulary.json"
        || path == "editor/map-layout.json"
        || ["locations/", "objects/", "characters/"]
            .iter()
            .any(|prefix| {
                path.starts_with(prefix) && path.ends_with(".json") && path.split('/').count() == 2
            })
}
fn recover(root: &Path) -> Result<()> {
    let journal = root.join(".luna-transaction.json");
    if !journal.exists() {
        return Ok(());
    }
    let transaction: Transaction = json(&journal)?;
    for change in &transaction.changes {
        ensure!(managed(&change.path), "Invalid recovery journal path");
        let path = confined(root, &change.path)?;
        let now = if path.exists() {
            Some(String::from_utf8(read_bytes(&path)?)?)
        } else {
            None
        };
        ensure!(
            now == change.before || now == change.after,
            "External changes conflict with recovery at {}; preserve the journal and compare the file before retrying",
            change.path
        );
    }
    for change in transaction.changes {
        let path = confined(root, &change.path)?;
        if let Some(contents) = change.after {
            atomic_write(&path, contents.as_bytes())?
        } else if path.exists() {
            fs::remove_file(&path)?;
            sync_dir(path.parent().unwrap())?
        }
    }
    fs::remove_file(journal)?;
    sync_dir(root)?;
    Ok(())
}
pub fn save_project(root: &Path, p: &Project, expected: Option<&str>) -> Result<String> {
    ensure!(!root.is_symlink(), "Project root must not be a symlink");
    fs::create_dir_all(root)?;
    let _lock = write_lock(root)?;
    recover(root)?;
    if let Some(expected) = expected {
        ensure!(
            revision(root)? == expected,
            "CONFLICT: Project files changed externally; reload, compare, or Save As before saving"
        )
    }
    let files = project_files(p, true)?;
    let mut old = BTreeMap::new();
    for name in [
        "game.json",
        "vocabulary.json",
        "locations",
        "objects",
        "characters",
    ] {
        collect(root, name, &mut old)?
    }
    collect(root, "editor/map-layout.json", &mut old)?;
    let keys = old
        .keys()
        .filter(|k| managed(k))
        .chain(files.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut changes = vec![];
    for key in keys {
        let before = old
            .get(&key)
            .map(|b| String::from_utf8(b.clone()))
            .transpose()?;
        let after = files.get(&key).cloned();
        if before != after {
            changes.push(Change {
                path: key,
                before,
                after,
            })
        }
    }
    if !changes.is_empty() {
        atomic_write(
            &root.join(".luna-transaction.json"),
            pretty(&Transaction { changes })?.as_bytes(),
        )?;
        recover(root)?;
    }
    let ignore = root.join(".gitignore");
    if !ignore.exists() {
        atomic_write(
            &ignore,
            b".luna-recovery/\n.luna-transaction.json\n.luna-write.lock\n",
        )?
    }
    revision(root)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format_version: u32,
    pub game_id: String,
    pub content_version: String,
    pub files: BTreeMap<String, String>,
}
pub fn export_bundle(root: &Path, p: &Project) -> Result<Vec<u8>> {
    let diagnostics = validate(p);
    ensure!(
        !has_errors(&diagnostics),
        "Fix validation errors before exporting: {}",
        diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .map(|d| format!("{}: {}", d.subject, d.message))
            .collect::<Vec<_>>()
            .join("; ")
    );
    let mut files = project_files(p, false)?
        .into_iter()
        .map(|(k, v)| (k, v.into_bytes()))
        .collect::<BTreeMap<_, _>>();
    for asset in &p.game.assets {
        files.insert(asset.clone(), read_bytes(&confined(root, asset)?)?);
    }
    let manifest = Manifest {
        format_version: FORMAT_VERSION,
        game_id: p.game.id.clone(),
        content_version: p.game.content_version.clone(),
        files: files.iter().map(|(k, v)| (k.clone(), digest(v))).collect(),
    };
    files.insert("manifest.json".into(), pretty(&manifest)?.into_bytes());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, data) in files {
        zip.start_file(path, options)?;
        zip.write_all(&data)?;
    }
    Ok(zip.finish()?.into_inner())
}
/// Extract and validate an editor bundle into an empty staging directory.
pub fn extract_bundle(bytes: &[u8], staging: &Path) -> Result<Project> {
    ensure!(bytes.len() as u64 <= MAX_BUNDLE, "Bundle exceeds 256 MiB");
    fs::create_dir_all(staging)?;
    ensure!(
        fs::read_dir(staging)?.next().is_none(),
        "Bundle staging directory must be empty"
    );
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).context("Not a readable ZIP archive")?;
    ensure!(zip.len() <= 10000, "Bundle contains too many entries");
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_owned();
        ensure!(safe_relative(&name), "Unsafe archive path: {name}");
        ensure!(seen.insert(name.clone()), "Duplicate archive entry: {name}");
        ensure!(
            !entry.is_dir(),
            "Bundle contains an unsupported directory entry: {name}"
        );
        ensure!(
            entry
                .unix_mode()
                .is_none_or(|m| m & 0o170000 == 0 || m & 0o170000 == 0o100000),
            "Archive symlinks and special files are forbidden: {name}"
        );
        ensure!(
            entry.size() <= MAX_FILE,
            "Archive file exceeds 64 MiB: {name}"
        );
        total = total
            .checked_add(entry.size())
            .context("Archive size overflow")?;
        ensure!(total <= MAX_BUNDLE, "Uncompressed bundle exceeds 256 MiB");
        let mut data = vec![];
        (&mut entry).take(MAX_FILE + 1).read_to_end(&mut data)?;
        ensure!(data.len() as u64 <= MAX_FILE, "Archive file is too large");
        ensure!(
            data.len() as u64 == entry.size(),
            "Archive size mismatch: {name}"
        );
        atomic_write(&confined(staging, &name)?, &data)?;
    }
    let manifest: Manifest = json(&confined(staging, "manifest.json")?)
        .context("Missing or malformed bundle manifest")?;
    ensure!(
        manifest.format_version == FORMAT_VERSION,
        "Unsupported game format {}; supported: {FORMAT_VERSION}",
        manifest.format_version
    );
    ensure!(
        seen.len() == manifest.files.len() + 1,
        "Manifest does not list exactly the bundle's files"
    );
    for (path, hash) in &manifest.files {
        ensure!(
            managed(path) && !path.starts_with("editor/") || safe_asset(path),
            "Unsupported bundle content: {path}"
        );
        let data = read_bytes(&confined(staging, path)?)?;
        ensure!(digest(&data) == *hash, "Bundle checksum mismatch: {path}")
    }
    let p = load_unlocked(staging)?;
    ensure!(
        p.game.id == manifest.game_id && p.game.content_version == manifest.content_version,
        "Manifest identity does not match game.json"
    );
    let diagnostics = validate(&p);
    ensure!(
        !has_errors(&diagnostics),
        "Invalid game content: {}",
        diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .map(|d| format!("{} {}: {}", d.subject, d.field, d.message))
            .collect::<Vec<_>>()
            .join("; ")
    );
    let expected = project_files(&p, false)?
        .keys()
        .cloned()
        .chain(p.game.assets.iter().cloned())
        .collect::<BTreeSet<_>>();
    ensure!(
        expected == manifest.files.keys().cloned().collect(),
        "Bundle has missing or unexpected game/asset files"
    );
    Ok(p)
}
pub fn read_bundle(path: &Path) -> Result<Vec<u8>> {
    ensure!(
        path.extension().is_some_and(|x| x == "luna"),
        "Expected a .luna ZIP archive"
    );
    let f = File::open(path).with_context(|| format!("Cannot open {}", path.display()))?;
    let mut bytes = vec![];
    f.take(MAX_BUNDLE + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= MAX_BUNDLE, "Bundle exceeds 256 MiB");
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_roundtrip_and_conflicts() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Roundtrip");
        p.editor.routes.insert(
            "exit-layout".into(),
            RouteLayout {
                source: Some(BorderAnchor {
                    side: BorderSide::Top,
                    offset: 0.3,
                }),
                target: Some(BorderAnchor {
                    side: BorderSide::Bottom,
                    offset: 0.7,
                }),
                label_offset: Some(Point { x: 40.0, y: -60.0 }),
            },
        );
        let rev = save_project(tmp.path(), &p, None).unwrap();
        let loaded = load_project(tmp.path()).unwrap();
        assert_eq!(p, loaded);
        assert_eq!(save_project(tmp.path(), &loaded, Some(&rev)).unwrap(), rev);
        fs::write(tmp.path().join("game.json"), "external").unwrap();
        assert!(
            save_project(tmp.path(), &p, Some(&rev))
                .unwrap_err()
                .to_string()
                .contains("CONFLICT")
        );
    }
    #[test]
    fn legacy_editor_layout_remains_readable() {
        let layout: EditorLayout = serde_json::from_str(r#"{"positions":{},"blocks":{}}"#).unwrap();
        assert!(layout.routes.is_empty());
        assert!(layout.templates.is_empty());
    }
    #[test]
    fn templates_persist_as_editor_metadata_and_do_not_block_or_enter_exports() {
        let temp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Template metadata");
        p.editor.templates = vec![
            BlockTemplate {
                id: "template-action".into(),
                name: "Stored action".into(),
                source_owner: Some("deleted-source".into()),
                entities: vec![TemplateEntity {
                    id: "deleted-source".into(),
                    name: "Old key".into(),
                    kind: TemplateEntityKind::Object,
                    properties: vec!["polish".into()],
                }],
                text_variables: vec!["score".into()],
                content: TemplateContent::Action {
                    action: Box::new(Action {
                        id: "stored-action".into(),
                        verb: "use".into(),
                        pattern: vec![PatternPart::Entity {
                            entity: "deleted-source".into(),
                        }],
                        effects: vec![Effect::Say {
                            text: "%deleted-source.polish% / %score%".into(),
                        }],
                        ..Default::default()
                    }),
                },
            },
            BlockTemplate {
                id: "template-effects".into(),
                name: "Stored blocks".into(),
                source_owner: None,
                entities: vec![],
                text_variables: vec![],
                content: TemplateContent::Effects {
                    effects: vec![Effect::Stop],
                },
            },
        ];
        let revision = save_project(temp.path(), &p, None).unwrap();
        let restored = load_project(temp.path()).unwrap();
        assert_eq!(restored, p);
        assert_eq!(
            save_project(temp.path(), &restored, Some(&revision)).unwrap(),
            revision
        );
        assert!(
            !has_errors(&validate(&restored)),
            "Unused templates can outlive their source entities/variables"
        );
        let bundle = export_bundle(temp.path(), &restored).unwrap();
        let stage = tempfile::tempdir().unwrap();
        let exported = extract_bundle(&bundle, stage.path()).unwrap();
        assert!(exported.editor.templates.is_empty());
        assert_eq!(exported.game, p.game);
        assert!(!stage.path().join("editor").exists());
    }
    #[test]
    fn export_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Bundle");
        p.game.ignored_words = vec!["this".into(), "the".into()];
        save_project(tmp.path(), &p, None).unwrap();
        let bytes = export_bundle(tmp.path(), &p).unwrap();
        let stage = tempfile::tempdir().unwrap();
        let loaded = extract_bundle(&bytes, stage.path()).unwrap();
        assert_eq!(loaded.game, p.game);
        assert!(!stage.path().join("editor").exists())
    }
    #[test]
    fn malicious_archives() {
        for names in [
            vec!["../escape"],
            vec!["C:/escape"],
            vec!["assets/../escape"],
        ] {
            let mut zip = zip::ZipWriter::new(Cursor::new(vec![]));
            for name in names {
                zip.start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                zip.write_all(b"bad").unwrap();
            }
            let b = zip.finish().unwrap().into_inner();
            let temp = tempfile::tempdir().unwrap();
            assert!(extract_bundle(&b, temp.path()).is_err())
        }
    }
    #[test]
    fn journal_recovers_partial_write() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Before");
        save_project(tmp.path(), &p, None).unwrap();
        let before = fs::read_to_string(tmp.path().join("game.json")).unwrap();
        p.game.title = "After".into();
        let after = pretty(&p.game).unwrap();
        let txn = Transaction {
            changes: vec![Change {
                path: "game.json".into(),
                before: Some(before),
                after: Some(after),
            }],
        };
        atomic_write(
            &tmp.path().join(".luna-transaction.json"),
            pretty(&txn).unwrap().as_bytes(),
        )
        .unwrap();
        assert_eq!(load_project(tmp.path()).unwrap().game.title, "After");
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/tmp", tmp.path().join("assets")).unwrap();
        assert!(confined(tmp.path(), "assets/secret").is_err());
    }
}
