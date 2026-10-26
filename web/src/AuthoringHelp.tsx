import { useState } from 'react';
import Modal from './Modal';
export default function AuthoringHelp({
  initial = 'start',
  block,
  close,
  tutorial,
}: {
  initial?: string;
  block?: string;
  close: () => void;
  tutorial: () => void;
}) {
  const [topic, setTopic] = useState(initial);
  return (
    <Modal title="Authoring guide" close={close} className="authoring-help">
      <div className="section-heading">
        <h2>Authoring guide</h2>
        <button onClick={close}>Close</button>
      </div>
      <nav aria-label="Guide topics">
        {[
          ['start', 'First adventure'],
          ['blocks', 'Blocks and conditions'],
          ['containers', 'Containers and surfaces'],
          ['test', 'Testing and sharing'],
          ['keyboard', 'Keyboard shortcuts'],
        ].map(([id, name]) => (
          <button key={id} aria-pressed={topic === id} onClick={() => setTopic(id)}>
            {name}
          </button>
        ))}
      </nav>
      {topic === 'start' ? (
        <section>
          <h3>Start small</h3>
          <p>
            Begin with a room, one object, and a command that prints a reply. Then add a condition
            and an ending. Playtest each change before adding more.
          </p>
          <p>
            The optional checklist links directly to your project's room, object, actions, and
            endings. It can be hidden and resumed without changing the game.
          </p>
          <button
            onClick={() => {
              tutorial();
              close();
            }}
          >
            Show first-adventure tutorial
          </button>
          <p>
            For a complete example, create another project and choose The Locked Study. Existing
            projects are never replaced by opening this guide.
          </p>
        </section>
      ) : topic === 'blocks' ? (
        <section>
          <h3>{block ? `Block help · ${block}` : 'Build the flow'}</h3>
          <p>
            Effects run in order from the action or trigger. SAY prints a message; PRINT DESCRIPTION
            prints the referenced entity's current description. END GAME completes the game with the
            chosen ending.
          </p>
          <p>
            Requirements decide whether the command can run. IF / ELSE chooses which effects run
            after it starts. CARRYING and CHARACTER CARRYING test directly held items. HAS ITEM also
            includes items inside carried containers; CAN REACH checks access through their lids and
            placement. VARIABLE reads a global value; PROPERTY reads a value on one entity. ALL
            requires every child, ANY requires one, and NOT reverses a test.
          </p>
          <p>
            Use Add block to choose a compatible connection and preview the insertion. Use Flow
            outline to select, insert, or reorder effects with buttons. A replaced input is saved as
            a disconnected draft. Drafts do not run and do not enter an exported game.
          </p>
          <p>
            Messages accept colour controls and live placeholders such as %chances% or
            %entity_id.health%. Use Insert variable / property to choose an existing value. Double
            percent signs print a literal percent sign.
          </p>
          <p>
            Validate links to exact problems. Used by previews references; Rename updates
            variable/property keys together. Project Undo restores a complete editing operation.
          </p>
        </section>
      ) : topic === 'containers' ? (
        <section>
          <h3>Create a container or surface</h3>
          <p>
            Add or select an object. In its Storage settings, enable Can contain items, Items can be
            placed on top, or both. Choose Always open or Can be opened and closed. Can be taken
            makes the holder portable. Older projects first need Enable container features; this is
            an explicit project upgrade.
          </p>
          <p>
            Open Contents to create an item inside or on top, or move an existing object there. Move
            previews its destination and keeps nested contents with it. Cancel leaves the project
            alone; project Undo restores the whole change. Initial placement is another way to
            choose a holder, with paths to distinguish objects with the same name.
          </p>
          <p>
            Use Set up standard interactions to choose verbs and review commands and responses.
            These become ordinary editable Actions, marked Standard behaviour. Existing custom
            commands keep precedence even when their requirements fail. Setup adds each standard
            interaction once. You can disable one from its action settings.
          </p>
          <p>
            In an interaction that accepts an item, Command item refers to the object the player
            named. PUT OBJECT, IS INSIDE / ON, and CAN TRANSFER can use it or a fixed object. SAY
            WITH NAMES offers labelled name insertions alongside your variables and properties.
          </p>
          <p>
            For a lock, add your usual property requirement. Can use carried item adds visible HAS
            ITEM and CAN REACH requirements: a key in a closed carried bag is possessed but cannot
            be used until the bag is opened. Closed interiors conceal contents from the player;
            items on top remain accessible. The author-only World state inspector shows nested paths
            and what blocks access.
          </p>
          <p>
            Removing storage shows affected contents and logic for reassignment. Captured playtest
            setups are preserved; replace or remove affected setups before applying an incompatible
            storage change.
          </p>
        </section>
      ) : topic === 'test' ? (
        <section>
          <h3>Check success and failure</h3>
          <p>
            Start playtest from the beginning or a selected room. For a locked door, try the command
            before and after taking the key. For a value trigger, check an update that leaves its
            condition false and another that makes it true.
          </p>
          <p>
            Game changes require restarting to use the new version. Navigation, panel sizes, and
            personal canvas views do not. Focus playtest gives the transcript more space; Return to
            editor restores the authoring view.
          </p>
          <p>
            After fixing game errors in Validate, export a .luna file. In the terminal runner, use
            import to add the bundle and run to play it. Player saves and authoring preferences are
            separate.
          </p>
        </section>
      ) : (
        <section>
          <h3>Available keyboard controls</h3>
          <dl>
            <dt>Tab / Shift+Tab</dt>
            <dd>Move between labelled controls.</dd>
            <dt>Ctrl/Cmd+K</dt>
            <dd>
              Open project search when outside a text field or dialog. The Search project button is
              always available.
            </dd>
            <dt>Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z</dt>
            <dd>
              Undo and redo project changes outside text fields. Inside a text field, normal text
              undo stays in that field. Header Undo/Redo explicitly use project history.
            </dd>
            <dt>Splitters: arrow keys; Shift+arrow; Home / End</dt>
            <dd>
              Resize a panel by 10 pixels, 40 pixels, or its allowed limits. Double-click a splitter
              to reset that size.
            </dd>
            <dt>Add block: Enter / Escape</dt>
            <dd>
              Insert the selected compatible block or cancel. Use Flow outline buttons to select
              effects and move them up/down without dragging.
            </dd>
            <dt>Project search: Arrow Down / Enter / Escape</dt>
            <dd>
              Move to results, open the first result, or close and restore focus. Navigate back
              returns to the original authoring context.
            </dd>
          </dl>
        </section>
      )}
    </Modal>
  );
}
