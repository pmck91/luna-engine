import * as Blockly from 'blockly/core';

export type HistoryControls = {
  undoLabel?: string;
  redoLabel?: string;
  replay: (redo: boolean) => void;
};

/** Blockly menus and shortcuts use the same project timeline as forms and the map. */
export function bindWorkspaceHistory(ws: Blockly.WorkspaceSvg, controls: () => HistoryControls) {
  ws.MAX_UNDO = 0;
  ws.undo = (redo) => controls().replay(redo);
  ws.configureContextMenu = (options) => {
    for (let i = options.length - 1; i >= 0; i--)
      if (options[i].text === Blockly.Msg.UNDO || options[i].text === Blockly.Msg.REDO)
        options.splice(i, 1);
    const current = controls();
    options.unshift(
      {
        scope: { workspace: ws },
        weight: 0,
        enabled: !!current.undoLabel,
        text: `Undo project change${current.undoLabel ? `: ${current.undoLabel}` : ''}`,
        callback: () => controls().replay(false),
      },
      {
        scope: { workspace: ws },
        weight: 1,
        enabled: !!current.redoLabel,
        text: `Redo project change${current.redoLabel ? `: ${current.redoLabel}` : ''}`,
        callback: () => controls().replay(true),
      },
    );
  };
}
