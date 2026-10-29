import { useState } from 'react';
import Modal from './Modal';
import { Text } from './Forms';

export default function SaveAs({
  save,
  close,
}: {
  save: (folder: string) => Promise<void>;
  close: () => void;
}) {
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dismiss = () => {
    if (!busy) close();
  };
  return (
    <Modal title="Save project as" close={dismiss}>
      <h2>Save project as</h2>
      <p>
        Copy the current project, including unsaved edits, into a new folder in your projects
        directory.
      </p>
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const name = folder.trim();
          if (!name) {
            setError('Enter a new project folder name.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await save(name);
            close();
          } catch (error) {
            setError(String(error).replace(/^Error: /, ''));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text
          label="New project folder name"
          value={folder}
          onChange={(value) => {
            setFolder(value);
            setError('');
          }}
        />
        {error && <p role="alert">{error}</p>}
        <div className="inline">
          <button type="button" disabled={busy} onClick={dismiss}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Copying…' : 'Save copy'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
