import * as Blockly from 'blockly/core';

// Keep the actual connection and snap position; only flatten an unused bottom notch.
class LunaDrawer extends Blockly.geras.Drawer {
  override drawBottom_() {
    const terminal =
      !!this.block_.nextConnection &&
      !this.block_.nextConnection.isConnected() &&
      !this.block_.isInsertionMarker();
    this.block_.getSvgRoot().classList.toggle('luna-chain-end', terminal);
    if (!terminal) {
      super.drawBottom_();
      return;
    }
    const row = this.info_.bottomRow;
    const elements = row.elements;
    const hasNextConnection = row.hasNextConnection;
    row.elements = elements.map((element) =>
      Blockly.blockRendering.Types.isNextConnection(element)
        ? new Blockly.blockRendering.InRowSpacer(this.constants_, element.width)
        : element,
    );
    row.hasNextConnection = false;
    try {
      super.drawBottom_();
    } finally {
      row.elements = elements;
      row.hasNextConnection = hasNextConnection;
    }
  }
}
class LunaRenderer extends Blockly.geras.Renderer {
  protected override makeDrawer_(block: Blockly.BlockSvg, info: Blockly.blockRendering.RenderInfo) {
    return new LunaDrawer(block, info as Blockly.geras.RenderInfo);
  }
}
if (!Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, 'luna'))
  Blockly.blockRendering.register('luna', LunaRenderer);

export function refreshChainEnds(workspace: Blockly.WorkspaceSvg) {
  for (const block of workspace.getAllBlocks(false)) {
    if (!block.nextConnection || block.isInsertionMarker()) continue;
    const terminal = !block.nextConnection.isConnected();
    if (block.getSvgRoot().classList.contains('luna-chain-end') !== terminal) block.render();
  }
}
