import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "SoylabComfyRouter";
const TITLE = "SOYLAB Comfy Router";
const CORAL = "#FF705B";
const logo = new Image();
logo.src = new URL("./soylab-logo.png", import.meta.url).href;
logo.onload = () => app.graph?.setDirtyCanvas?.(true, true);

let catalog = [];
fetch(new URL("./catalog.json", import.meta.url))
  .then((response) => response.ok ? response.json() : [])
  .then((items) => { catalog = items; app.graph?.setDirtyCanvas?.(true, true); })
  .catch(() => {});

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name) ?? null;
}

function selected(node) {
  const service = widget(node, "service")?.value;
  const family = widget(node, "service.model")?.value;
  const version = widget(node, "service.model.version")?.value;
  const spec = catalog.find((item) => item.service === service && item.family === family && item.version === version);
  return { service, family, version, spec };
}

function field(node, name, fallback = undefined) {
  return widget(node, `service.model.version.${name}`)?.value ?? fallback;
}

function refCount(node, type) {
  return node.inputs?.filter((input) => input.name?.startsWith(`service.model.version.reference_${type}.`) && input.link != null).length ?? 0;
}

function usd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 0.1 ? 3 : 2)}` : "확인 불가";
}

function estimate(node, spec) {
  if (!spec) return { provider: "서비스: 확인 불가", comfy: "Comfy: 확인 불가" };
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const quality = String(field(node, "quality", "low"));
  const execution = String(field(node, "execution_provider", "Comfy"));
  const id = spec.model_id;
  let direct = null;
  let comfyUsd = null;
  let comfyRange = null;
  if (id === "runway/gen4_turbo") {
    direct = 0.05 * duration; // Runway Dev: 5 credits/s, $0.01/credit.
    comfyUsd = 0.0715 * duration;
  } else if (id === "runway/gen4_image") {
    // The ratio label alone is insufficient to determine Runway's 720p/1080p
    // billing tier for every aspect ratio, so show the official price range.
    direct = "$0.05–$0.08";
    comfyUsd = 0.11;
  } else if (id === "runway/aleph2") {
    // Input video length determines the total charge.
    direct = "$0.28/초";
    comfyUsd = null;
  } else if (id === "byteplus/seedream-5-0-pro-260628") {
    comfyUsd = resolution === "2K" ? 0.09 : 0.045;
  } else if (id === "byteplus/seedream-5-0-260128") {
    comfyUsd = 0.035;
  } else if (id === "vertexai/gemini-3.1-flash-image") {
    comfyUsd = { "1K": 0.0835, "2K": 0.1217, "4K": 0.1848 }[resolution];
  } else if (id === "vertexai/gemini-3.1-flash-lite-image") {
    comfyUsd = 0.0835;
  } else if (id === "vertexai/gemini-3-pro-image") {
    comfyUsd = resolution === "4K" ? 0.288 : 0.1608;
  } else if (id.startsWith("openai/gpt-image-2")) {
    const is25 = id.includes("2.5");
    const table = is25
      ? { low: { "1024x1024": .0084, "2048x2048": .017 }, medium: { "1024x1024": .0188, "2048x2048": .0383 }, high: { "1024x1024": .0753, "2048x2048": .1531 }, xhigh: { "1024x1024": .1339, "2048x2048": .2721 }, max: { "1024x1024": .3013, "2048x2048": .6123 } }
      : { low: { "1024x1024": .0071, "2048x2048": .0143 }, medium: { "1024x1024": .0632, "2048x2048": .1284 }, high: { "1024x1024": .2529, "2048x2048": .5138 } };
    comfyUsd = table[quality]?.[resolution] ?? null;
    if (comfyUsd !== null) comfyUsd += refCount(node, "images") * (is25 ? .0117 : .0098);
  } else if (id.includes("dreamina-seedance-2-5")) {
    // Native Partner node publishes a range because incoming video length matters.
    const seconds = duration || 5;
    const pxPerFrame = resolution === "480p" ? 400 : resolution === "1080p" ? 2025 : 900;
    const perK = resolution === "1080p" ? .016731 : .015301;
    const base = Math.floor(pxPerFrame * (24 * seconds + 1)) / 1000 * perK;
    comfyRange = [base, base + (refCount(node, "videos") ? base : 0)];
  }
  const actual = node.properties?.soylabActualCredits;
  const providerText = `서비스 ${direct === null ? "확인 불가" : typeof direct === "string" ? direct : usd(direct)}`;
  let comfyText = "Comfy 예상 확인 불가";
  if (actual != null && Number.isFinite(Number(actual)) && node.properties?.soylabActualModel === id && node.properties?.soylabActualProvider === execution) {
    comfyText = `Comfy 실제 ${Number(actual).toFixed(2)} C`;
  } else if (execution !== "Comfy") {
    comfyText = `Comfy ${execution} 경로: 실행 후 확인`;
  } else if (comfyUsd !== null && Number.isFinite(comfyUsd)) {
    comfyText = `Comfy 약 ${(comfyUsd * 211).toFixed(1)} C`;
  } else if (comfyRange) {
    comfyText = `Comfy 약 ${(comfyRange[0] * 211).toFixed(0)}–${(comfyRange[1] * 211).toFixed(0)} C`;
  }
  return { provider: providerText, comfy: comfyText };
}

function drawHeader(node, ctx) {
  if (node.flags?.collapsed) return;
  const width = node.size?.[0] || 480;
  const titleHeight = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const y = -titleHeight;
  ctx.save();
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#542080");
  gradient.addColorStop(.50, "#3D6574");
  gradient.addColorStop(1, "#00ED08");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect?.(0, y, width, titleHeight, 10);
  if (!ctx.roundRect) ctx.rect(0, y, width, titleHeight);
  ctx.fill();
  if (logo.complete && logo.naturalWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect?.(7, y + 4, 22, 22, 3);
    if (!ctx.roundRect) ctx.rect(7, y + 4, 22, 22);
    ctx.clip();
    ctx.drawImage(logo, 7, y + 4, 22, 22);
    ctx.restore();
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 14px Inter, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(TITLE, 36, y + titleHeight / 2, 240);
  const { spec } = selected(node);
  const price = estimate(node, spec);
  const label = `${price.provider}  |  ${price.comfy}`;
  ctx.font = "10px Inter, Arial, sans-serif";
  const textWidth = Math.min(ctx.measureText(label).width + 16, Math.max(width - 260, 80));
  ctx.fillStyle = "rgba(20, 8, 40, .82)";
  ctx.beginPath();
  ctx.roundRect?.(width - textWidth - 7, y + 5, textWidth, titleHeight - 10, 6);
  if (!ctx.roundRect) ctx.rect(width - textWidth - 7, y + 5, textWidth, titleHeight - 10);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "right";
  ctx.fillText(label, width - 15, y + titleHeight / 2, textWidth - 13);
  ctx.restore();
}

function updateOutputLabels(node) {
  const { spec } = selected(node);
  if (!node.outputs) return;
  let changed = false;
  ["IMAGE", "VIDEO", "AUDIO"].forEach((kind, index) => {
    const output = node.outputs[index];
    if (!output) return;
    const name = spec?.output === kind ? kind : "Not Support";
    const color = spec?.output === kind ? "#BB7BFF" : CORAL;
    if (output.name !== name || output.color !== color) changed = true;
    output.name = name;
    output.color = color;
  });
  if (changed) node.setDirtyCanvas?.(true, true);
}

function markUnsupported(node) {
  for (const item of node.widgets || []) {
    if (item.value === "Not Support") {
      item.options = { ...(item.options || {}), textColor: CORAL, color: CORAL };
    }
  }
}

function installSelectionWatch(node) {
  const serviceWidget = widget(node, "service");
  if (!serviceWidget || serviceWidget._soylabWatch) return;
  serviceWidget._soylabWatch = true;
  const original = serviceWidget.callback;
  serviceWidget.callback = function (...args) {
    const previous = selected(node);
    const result = original?.apply(this, args);
    setTimeout(() => {
      const current = selected(node);
      const modelWidget = widget(node, "service.model");
      if (modelWidget && previous.family && previous.family !== "Not Support" && current.service !== previous.service) {
        const stillSupported = catalog.some((item) => item.service === current.service && item.family === previous.family);
        modelWidget.value = stillSupported ? previous.family : "Not Support";
        modelWidget.callback?.(modelWidget.value);
      }
      updateOutputLabels(node);
      markUnsupported(node);
    }, 0);
    return result;
  };
  const watchModel = () => {
    const modelWidget = widget(node, "service.model");
    if (!modelWidget || modelWidget._soylabWatch) return;
    modelWidget._soylabWatch = true;
    const old = modelWidget.callback;
    modelWidget.callback = function (...args) {
      const previous = selected(node);
      const result = old?.apply(this, args);
      setTimeout(() => {
        const current = selected(node);
        const versionWidget = widget(node, "service.model.version");
        if (versionWidget && previous.version && current.family !== previous.family) {
          const supported = catalog.some((item) => item.service === current.service && item.family === current.family && item.version === previous.version);
          versionWidget.value = supported ? previous.version : "Not Support";
          versionWidget.callback?.(versionWidget.value);
        }
        updateOutputLabels(node);
        markUnsupported(node);
      }, 0);
      return result;
    };
  };
  watchModel();
  const previousDraw = node.onDrawForeground;
  node.onDrawForeground = function (ctx, ...args) {
    watchModel();
    previousDraw?.call(this, ctx, ...args);
    updateOutputLabels(this);
    markUnsupported(this);
    drawHeader(this, ctx);
  };
}

function addKeyHelp(node) {
  if (node.widgets?.some((item) => item.name === "soylab_key_help")) return;
  const help = {
    name: "soylab_key_help",
    type: "soylab_key_help",
    serialize: false,
    computeSize: () => [0, 21],
    draw(ctx, _node, width, y) {
      ctx.save();
      ctx.fillStyle = "#C7AFDA";
      ctx.font = "10px Inter, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("커스텀 노드 폴더의 API KEY.INI 파일에 직접 입력할 수 있습니다", 14, y + 13, width - 24);
      ctx.restore();
    },
  };
  node.addCustomWidget(help);
  const index = node.widgets.findIndex((item) => item.name === "api_key");
  const current = node.widgets.indexOf(help);
  if (index >= 0 && current >= 0) {
    node.widgets.splice(current, 1);
    node.widgets.splice(index + 1, 0, help);
  }
  node.setSize([Math.max(node.size[0], 560), node.size[1] + 22]);
}

app.registerExtension({
  name: "soylab.comfy.router",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = created?.apply(this, args);
      this.color = "#6A25B3";
      this.bgcolor = "#221232";
      this.title = TITLE;
      addKeyHelp(this);
      installSelectionWatch(this);
      setTimeout(() => updateOutputLabels(this), 0);
      return result;
    };
  },
});

api.addEventListener("executed", (event) => {
  const detail = event.detail || {};
  const cost = detail.output?.soylab_router_cost?.[0];
  if (!cost) return;
  const node = app.graph?.getNodeById?.(Number(detail.node));
  if (!node || node.type !== NODE_ID) return;
  node.properties ||= {};
  node.properties.soylabActualCredits = cost.credits;
  node.properties.soylabActualModel = cost.model_id;
  node.properties.soylabActualProvider = cost.provider;
  node.setDirtyCanvas?.(true, true);
});
