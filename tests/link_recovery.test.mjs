import assert from "node:assert/strict";
import test from "node:test";
import { captureIncomingLinks, restoreIncomingLinks, restoreModelWidgetValues } from "../web/link_recovery.mjs";

function fixture() {
  const link = { id: 9, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 3 };
  const source = { outputs: [{ links: [9] }] };
  const node = {
    id: 2,
    graph: { _links: new Map([[9, link]]), getNodeById: (id) => id === 1 ? source : null },
    inputs: [{ name: "model.reference_images.image_1", link: 9, type: "IMAGE" }],
    widgets: [{ name: "model", value: "BytePlus Seedance 2.5" }],
    addInput(name, type) { this.inputs.push({ name, type, link: null }); },
  };
  const info = {
    inputs: [{ name: "model.reference_images.image_1", link: 9, type: "IMAGE" }],
    widgets_values_named: { model: "BytePlus Seedance 2.5" },
  };
  return { node, info, link, source };
}

test("restores an image link after dynamic inputs move to another slot", () => {
  const { node, info, link } = fixture();
  const captured = captureIncomingLinks(node, info);
  node.inputs = [{ name: "model.mode", link: null }, { name: "model.reference_images.image_1", link: null }];
  assert.equal(restoreIncomingLinks(node, info, captured), true);
  assert.equal(node.inputs[1].link, 9);
  assert.equal(link.target_slot, 1);
});

test("recreates an autogrow image socket and a link removed during reload", () => {
  const { node, info, source } = fixture();
  const captured = captureIncomingLinks(node, info);
  node.inputs = [{ name: "model.mode", link: null }];
  node.graph._links.delete(9);
  source.outputs[0].links = [];
  assert.equal(restoreIncomingLinks(node, info, captured), true);
  assert.equal(node.inputs[1].name, "model.reference_images.image_1");
  assert.equal(node.inputs[1].link, 9);
  assert.equal(node.graph._links.get(9).target_slot, 1);
  assert.deepEqual(source.outputs[0].links, [9]);
});

test("does not restore a connection the user had disconnected", () => {
  const { node, info } = fixture();
  info.inputs[0].link = null;
  assert.deepEqual(captureIncomingLinks(node, info), []);
});

test("does not attach old media sockets to another selected model", () => {
  const { node, info } = fixture();
  const captured = captureIncomingLinks(node, info);
  node.widgets[0].value = "Runway Gen-4";
  node.inputs = [];
  assert.equal(restoreIncomingLinks(node, info, captured), false);
  assert.deepEqual(node.inputs, []);
});

test("restores prompt and model controls after workflow reload", () => {
  const { node, info } = fixture();
  node.widgets[0].value = null;
  node.widgets.push({ name: "model.prompt", value: "" }, { name: "model.duration", value: 4 });
  info.widgets_values_named["model.prompt"] = "Keep the subject in frame";
  info.widgets_values_named["model.duration"] = 7;
  restoreModelWidgetValues(node, info);
  assert.equal(node.widgets[0].value, "BytePlus Seedance 2.5");
  assert.equal(node.widgets[1].value, "Keep the subject in frame");
  assert.equal(node.widgets[2].value, 7);
});

test("adds the next image socket after restoring a connected autogrow input", () => {
  const { node, info } = fixture();
  const captured = captureIncomingLinks(node, info);
  node.inputs = [{ name: "model.reference_images.image_1", link: null, type: "IMAGE" }];
  node.comfyDynamic = { autogrow: { "model.reference_images": { max: 30 } } };
  node.onConnectionsChange = (kind, slot, connected) => {
    assert.equal(kind, 1);
    assert.equal(slot, 0);
    assert.equal(connected, true);
    node.addInput("model.reference_images.image_2", "IMAGE");
  };
  restoreIncomingLinks(node, info, captured);
  assert.equal(node.inputs[0].link, 9);
  assert.equal(node.inputs[1].name, "model.reference_images.image_2");
});

test("keeps an existing free image socket without growing twice", () => {
  const { node, info } = fixture();
  const captured = captureIncomingLinks(node, info);
  node.inputs.push({ name: "model.reference_images.image_2", link: null, type: "IMAGE" });
  node.comfyDynamic = { autogrow: { "model.reference_images": { max: 30 } } };
  node.onConnectionsChange = () => assert.fail("A free socket already exists");
  restoreIncomingLinks(node, info, captured);
  assert.equal(node.inputs.length, 2);
});

test("restores two linked images in order and grows the third socket", () => {
  const { node, info, source } = fixture();
  const secondLink = { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 1 };
  node.graph._links.set(10, secondLink);
  source.outputs[0].links.push(10);
  info.inputs.push({ name: "model.reference_images.image_2", link: 10, type: "IMAGE" });
  const captured = captureIncomingLinks(node, info);
  node.inputs = [
    { name: "model.reference_images.image_1", link: 9, type: "IMAGE" },
    { name: "model.last_frame", link: null, type: "IMAGE" },
  ];
  node.comfyDynamic = { autogrow: { "model.reference_images": { max: 30 } } };
  node.onConnectionsChange = (_, slot) => {
    const previous = node.inputs[slot];
    const next = Number(previous.name.at(-1)) + 1;
    node.inputs.splice(slot + 1, 0, {
      name: `model.reference_images.image_${next}`,
      label: `이미지 ${next}`,
      type: "IMAGE",
      link: null,
    });
  };
  restoreIncomingLinks(node, info, captured);
  assert.deepEqual(node.inputs.slice(0, 4).map((input) => input.name), [
    "model.reference_images.image_1",
    "model.reference_images.image_2",
    "model.reference_images.image_3",
    "model.last_frame",
  ]);
  assert.equal(node.inputs[1].label, "이미지 2");
  assert.equal(node.inputs[1].link, 10);
  assert.equal(secondLink.target_slot, 1);
});
