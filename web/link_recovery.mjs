// ComfyUI rebuilds DynamicCombo and Autogrow sockets while configuring a node.
// Keep incoming links tied to their saved socket names, even if the socket
// order changes during that rebuild (for example when switching workflow tabs).
export function captureIncomingLinks(node, info) {
  const links = node.graph?._links || node.graph?.links;
  if (!links || !Array.isArray(info?.inputs)) return [];
  const captured = [];
  for (const input of info.inputs) {
    if (input.link == null || !input.name?.startsWith("model.")) continue;
    const link = links.get(input.link);
    if (link && String(link.target_id) === String(node.id)) {
      captured.push({ name: input.name, type: input.type, link });
    }
  }
  return captured;
}

export function restoreModelWidgetValues(node, info) {
  const named = info?.widgets_values_named;
  if (!named || !node.widgets) return;
  const model = node.widgets.find((widget) => widget.name === "model");
  if (model && named.model != null && model.value !== named.model) {
    model.value = named.model;
  }
  for (const widget of node.widgets) {
    if (!widget.name?.startsWith("model.") || !(widget.name in named)) continue;
    if (widget.value !== named[widget.name]) widget.value = named[widget.name];
  }
}

export function restoreIncomingLinks(node, info, captured) {
  if (!captured.length) return false;
  const links = node.graph?._links || node.graph?.links;
  if (!links) return false;
  const savedModel = info?.widgets_values_named?.model;
  const currentModel = node.widgets?.find((widget) => widget.name === "model")?.value;
  if (savedModel && currentModel !== savedModel) return false;

  let repaired = false;
  const restoredByGroup = new Map();
  for (const { name, type, link } of captured) {
    const groupName = name.slice(0, name.lastIndexOf("."));
    let slot = node.inputs?.findIndex((input) => input.name === name) ?? -1;
    if (slot < 0 && node.comfyDynamic?.autogrow?.[groupName]) {
      const previousName = restoredByGroup.get(groupName);
      const previousSlot = node.inputs.findIndex((input) => input.name === previousName);
      if (previousSlot >= 0) {
        const previousInput = node.inputs[previousSlot];
        const previousLink = links.get(previousInput.link);
        if (previousLink) {
          node.onConnectionsChange?.(1, previousSlot, true, previousLink, previousInput);
          slot = node.inputs.findIndex((input) => input.name === name);
        }
      }
    }
    if (slot < 0) {
      // Autogrow may have collapsed a connected socket while reloading.
      node.addInput(name, type);
      slot = node.inputs.findIndex((input) => input.name === name);
    }
    if (slot < 0) continue;
    restoredByGroup.set(groupName, name);

    for (const [index, input] of node.inputs.entries()) {
      if (index !== slot && input.link === link.id) input.link = null;
    }
    const input = node.inputs[slot];
    if (input.link === link.id && link.target_slot === slot && links.has(link.id)) continue;
    input.link = link.id;
    link.target_slot = slot;
    links.set(link.id, link);
    const source = node.graph.getNodeById?.(link.origin_id);
    const output = source?.outputs?.[link.origin_slot];
    if (output) {
      output.links ||= [];
      if (!output.links.includes(link.id)) output.links.push(link.id);
    }
    repaired = true;
  }
  // Rebuild the next free Autogrow socket after restoring the connected one.
  // Without this, image_1 survives a tab switch but image_2 disappears.
  const autogrow = node.comfyDynamic?.autogrow || {};
  for (const groupName of new Set(captured.map(({ name }) => name.slice(0, name.lastIndexOf("."))))) {
    if (!autogrow[groupName]) continue;
    const connected = node.inputs
      .map((input, index) => ({ input, index }))
      .filter(({ input }) => input.name.startsWith(`${groupName}.`) && input.link != null);
    const last = connected.at(-1);
    if (!last) continue;
    const hasFreeSocket = node.inputs.slice(last.index + 1).some(
      (input) => input.name.startsWith(`${groupName}.`) && input.link == null,
    );
    if (!hasFreeSocket) {
      const link = links.get(last.input.link);
      if (link) node.onConnectionsChange?.(1, last.index, true, link, last.input);
    }
  }
  if (repaired) node.setDirtyCanvas?.(true, true);
  return repaired;
}
