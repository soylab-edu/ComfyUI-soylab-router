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

function comfyQuote(node, spec) {
  if (!spec) return null;
  const id = spec.model_id;
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", "16:9"));
  const hasVideo = refCount(node, "videos") > 0;
  const credits = (value) => value * 211;
  if (id === "runway/gen4_turbo") {
    return { perSecond: credits(.0715), total: credits(.0715 * duration), source: "Comfy Partner node" };
  }
  if (!id.includes("dreamina-seedance-2-")) return null;
  if (id.includes("dreamina-seedance-2-5")) {
    const is480 = resolution === "480p";
    const is1080 = resolution === "1080p";
    const frameSizes = {
      "1:1": [400, 900, 2025],
      "4:3": [411.25, 905.6719, 2028],
      "3:4": [411.25, 905.6719, 2028],
      "21:9": [418.5, 904.3945, 2037.9648],
    };
    const frame = (frameSizes[ratio] || [400.3125, 900, 2025])[is480 ? 0 : is1080 ? 2 : 1];
    const unitPrice = is1080 ? (hasVideo ? .01001 : .016731) : (hasVideo ? .009152 : .015301);
    const totalFor = (seconds) => credits(Math.floor(frame * (24 * seconds + 1)) / 1000 * unitPrice);
    return {
      perSecond: credits(frame * 24 / 1000 * unitPrice),
      total: totalFor(duration),
      maxTotal: hasVideo ? totalFor(duration + 30) : null,
      source: "Comfy Partner node",
    };
  }
  const frameRate = resolution === "4k" ? 195200 : resolution === "1080p" ? 48800 : resolution === "720p" ? 21600 : 10044;
  const noVideoPrice = resolution === "4k" ? .00572 : resolution === "1080p" ? .011011 : id.includes("mini") ? .005005 : id.includes("fast") ? .008008 : .01001;
  const videoPrice = resolution === "4k" ? .003432 : resolution === "1080p" ? .006721 : id.includes("mini") ? .003003 : id.includes("fast") ? .004719 : .006149;
  const unitPrice = hasVideo ? videoPrice : noVideoPrice;
  return {
    perSecond: credits(frameRate * unitPrice / 1000),
    total: credits((hasVideo ? Math.ceil(duration * 5 / 3) : duration) * frameRate * unitPrice / 1000),
    maxTotal: hasVideo ? credits((15 + duration) * frameRate * unitPrice / 1000) : null,
    source: "Comfy Partner node",
  };
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
    const quote = comfyQuote(node, spec);
    comfyRange = quote ? [quote.total / 211, (quote.maxTotal ?? quote.total) / 211] : null;
  } else if (id.includes("dreamina-seedance-2-0")) {
    const quote = comfyQuote(node, spec);
    comfyRange = quote ? [quote.total / 211, (quote.maxTotal ?? quote.total) / 211] : null;
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
    const low = (comfyRange[0] * 211).toFixed(0);
    const high = (comfyRange[1] * 211).toFixed(0);
    comfyText = `Comfy 약 ${low}${low === high ? "" : `–${high}`} C`;
  }
  return {
    provider: providerText,
    comfy: comfyText,
    estimatedCredits: Number.isFinite(comfyUsd) ? comfyUsd * 211 : comfyRange ? comfyRange[0] * 211 : null,
  };
}

let pricePopup = null;

function priceText(value) {
  return `${value.toFixed(1)} C`;
}

function refreshPricePopup() {
  if (!pricePopup) return;
  const node = app.graph?.getNodeById?.(Number(pricePopup.dataset.nodeId));
  if (node?.type !== NODE_ID) {
    pricePopup.remove();
    pricePopup = null;
    return;
  }
  const { spec } = selected(node);
  const route = String(field(node, "execution_provider", "Comfy"));
  const quote = comfyQuote(node, spec);
  const estimateInfo = estimate(node, spec);
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", ""));
  const signature = JSON.stringify([spec?.model_id, route, duration, resolution, ratio, refCount(node, "videos"), node.properties?.soylabActualCredits]);
  if (pricePopup.dataset.signature === signature) return;
  pricePopup.dataset.signature = signature;
  pricePopup.replaceChildren();

  const line = (tag, className, value) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  };
  const heading = line("div", "soylab-price-heading", "공급자별 비용 확인");
  const close = line("button", "soylab-price-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "비용 창 닫기");
  close.onclick = () => { pricePopup?.remove(); pricePopup = null; };
  const top = line("div", "soylab-price-top", "");
  top.append(heading, close);
  pricePopup.append(top);
  if (!spec) {
    pricePopup.append(line("p", "soylab-price-note", "서비스와 모델 버전을 먼저 선택하세요."));
    return;
  }
  pricePopup.append(line("div", "soylab-price-model", `${spec.service} · ${spec.family} ${spec.version}`));
  const settings = [resolution, spec.output === "VIDEO" ? `${duration}초` : "", ratio].filter(Boolean).join(" · ");
  if (settings) pricePopup.append(line("div", "soylab-price-settings", settings));
  const selectedRate = route === "Comfy" && quote
    ? `${priceText(quote.perSecond)}/초`
    : route === "Comfy" && Number.isFinite(estimateInfo.estimatedCredits)
      ? `약 ${priceText(estimateInfo.estimatedCredits)}/회`
      : "공개된 단가 없음";
  pricePopup.append(line("div", "soylab-price-selected", `현재 경로: ${route} · ${selectedRate}`));

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["공급자", "단가", "예상 총액"]) headRow.append(line("th", "", label));
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  for (const provider of ["Comfy", ...(spec.alternates || [])]) {
    const row = document.createElement("tr");
    if (provider === route) row.className = "soylab-price-current";
    const known = provider === "Comfy" && quote;
    const estimated = provider === "Comfy" && Number.isFinite(estimateInfo.estimatedCredits);
    const rate = known ? `${priceText(quote.perSecond)}/초` : estimated ? `약 ${priceText(estimateInfo.estimatedCredits)}/회` : "공개 정보 없음";
    const total = known
      ? quote.maxTotal == null ? `약 ${priceText(quote.total)}` : `약 ${priceText(quote.total)}–${priceText(quote.maxTotal)}`
      : estimated ? `약 ${priceText(estimateInfo.estimatedCredits)}` : "실행 후 확인";
    for (const cell of [provider, rate, total]) row.append(line("td", "", cell));
    body.append(row);
  }
  table.append(body);
  pricePopup.append(table);
  const actual = node.properties?.soylabActualCredits;
  if (actual != null && node.properties?.soylabActualModel === spec.model_id && node.properties?.soylabActualProvider === route) {
    pricePopup.append(line("div", "soylab-price-actual", `최근 실행 실제 사용량: ${priceText(Number(actual))}`));
  }
  pricePopup.append(line("p", "soylab-price-note", "Comfy 기본 경로의 예상치는 공식 Partner 노드 계산식을 따른 참고값입니다. Router 모델 목록과 Comfy 모델 소개 페이지에는 공급자별 요금표가 없어 다른 경로는 실행 후 실제 사용량을 확인합니다."));
  const source = document.createElement("a");
  source.href = "https://docs.comfy.org/development/comfy-router/reference";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "Router 요금 응답 설명 ↗";
  pricePopup.append(source);
}

function openPricePopup(node) {
  pricePopup?.remove();
  pricePopup = document.createElement("aside");
  pricePopup.className = "soylab-price-popup";
  pricePopup.dataset.nodeId = String(node.id);
  pricePopup.setAttribute("aria-label", "SOYLAB Comfy Router 비용 비교");
  document.body.append(pricePopup);
  refreshPricePopup();
}

// Nodes 2.0 renders Vue DOM instead of LiteGraph's title canvas. Keep its
// header in sync with the same model and price state used by the classic node.
const vueNodeIds = new Set();
let vueSyncPending = false;

function queueVueSync(id) {
  if (id == null) return;
  vueNodeIds.add(String(id));
  if (vueSyncPending) return;
  vueSyncPending = true;
  requestAnimationFrame(() => {
    vueSyncPending = false;
    for (const nodeId of vueNodeIds) syncVueNode(nodeId);
    vueNodeIds.clear();
  });
}

function syncVueNode(id) {
  const node = app.graph?.getNodeById?.(Number(id));
  if (node?.type !== NODE_ID) return;
  const host = [...document.querySelectorAll("[data-node-id]")].find((element) => element.dataset.nodeId === id);
  const header = host?.querySelector(".lg-node-header");
  if (!header) return;
  host.classList.add("soylab-router-vue");

  const title = header.querySelector('[data-testid="node-title"]');
  if (title && !title.querySelector(".soylab-header-logo")) {
    const mark = document.createElement("img");
    mark.className = "soylab-header-logo";
    mark.src = logo.src;
    mark.alt = "";
    title.prepend(mark);
  }
  let badge = header.querySelector(".soylab-price-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "soylab-price-badge";
    badge.title = "공급자별 비용 비교 열기";
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    badge.onclick = (event) => { event.stopPropagation(); openPricePopup(node); };
    badge.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPricePopup(node); }
    };
    header.firstElementChild?.append(badge);
  }
  const { spec } = selected(node);
  const price = estimate(node, spec);
  const label = `${price.provider}  |  ${price.comfy}`;
  if (badge.textContent !== label) badge.textContent = label;

  const providerRow = host.querySelector('[aria-label="execution_provider"]')?.closest(".lg-node-widget");
  if (providerRow) {
    let hint = host.querySelector(".soylab-provider-rate");
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "soylab-provider-rate";
      providerRow.after(hint);
    }
    const route = String(field(node, "execution_provider", "Comfy"));
    const quote = comfyQuote(node, spec);
    const rate = route === "Comfy" && quote
      ? `Comfy 예상 ${priceText(quote.perSecond)}/초 · 공급자별 비교는 ‘비용 확인’`
      : `${route} 경로의 Comfy 단가는 공개되지 않았습니다 · 실행 후 실제 크레딧 확인`;
    if (hint.textContent !== rate) hint.textContent = rate;
  }

  const kinds = ["IMAGE", "VIDEO", "AUDIO"];
  const slots = host.querySelectorAll(".lg-slot--output");
  kinds.forEach((kind, index) => {
    const slot = slots[index];
    const text = slot?.querySelector("span.truncate");
    if (!text) return;
    if (!text.dataset.soylabLabel) text.dataset.soylabLabel = text.textContent;
    const supported = spec?.output === kind;
    slot.classList.toggle("soylab-unsupported-output", !supported);
    const wanted = supported ? text.dataset.soylabLabel : "Not Support";
    if (text.textContent !== wanted) text.textContent = wanted;
  });
  for (const combo of host.querySelectorAll('[role="combobox"]')) {
    combo.classList.toggle("soylab-unsupported-value", combo.textContent.trim() === "Not Support");
  }
  if (pricePopup?.dataset.nodeId === id) refreshPricePopup();
}

function installVueHeaderSupport() {
  if (document.getElementById("soylab-router-vue-style")) return;
  const style = document.createElement("style");
  style.id = "soylab-router-vue-style";
  style.textContent = `
    .soylab-router-vue .lg-node-header {
      background: linear-gradient(90deg, #542080 0%, #3D6574 50%, #00ED08 100%) !important;
      color: #fff !important;
      min-height: 34px;
    }
    .soylab-router-vue .lg-node-header [data-testid="node-title"],
    .soylab-router-vue .lg-node-header [data-testid="node-title"] span,
    .soylab-router-vue .lg-node-header .text-node-component-header-icon {
      color: #fff !important;
    }
    .soylab-router-vue .lg-node-header [data-testid="node-title"] { min-width: 0; font-weight: 700; }
    .soylab-router-vue .soylab-header-logo {
      width: 22px; height: 22px; flex: none; object-fit: cover;
      border-radius: 3px; background: #fff;
    }
    .soylab-router-vue .soylab-price-badge {
      flex: none; max-width: 52%; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; padding: 5px 8px; border-radius: 6px;
      color: #fff; background: rgba(20, 8, 40, .85); font-size: 10px; cursor: pointer;
    }
    .soylab-router-vue .soylab-price-badge:hover { background: rgba(20, 8, 40, .98); }
    .soylab-router-vue .soylab-provider-rate {
      grid-column: 1 / -1; margin: -2px 12px 4px; color: #dcc5f2;
      font-size: 10px; line-height: 1.35;
    }
    .soylab-router-vue .soylab-unsupported-output span.truncate,
    .soylab-router-vue .soylab-unsupported-value { color: ${CORAL} !important; }
    .soylab-router-vue .soylab-unsupported-output .slot-dot {
      background-color: ${CORAL} !important; border-color: ${CORAL} !important;
    }
    .soylab-price-popup {
      position: fixed; z-index: 100000; top: 72px; right: 24px;
      width: min(410px, calc(100vw - 32px)); max-height: calc(100vh - 96px);
      overflow: auto; box-sizing: border-box; padding: 16px;
      border: 1px solid #9262ca; border-radius: 12px;
      background: #241530; color: #f8f3ff; box-shadow: 0 18px 52px #0009;
      font: 12px/1.45 Inter, Arial, sans-serif;
    }
    .soylab-price-popup .soylab-price-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .soylab-price-popup .soylab-price-heading { font-size: 16px; font-weight: 700; }
    .soylab-price-popup .soylab-price-close { border: 0; background: transparent; color: #fff; font-size: 22px; cursor: pointer; }
    .soylab-price-popup .soylab-price-model { margin-top: 7px; font-weight: 600; }
    .soylab-price-popup .soylab-price-settings { margin-top: 2px; color: #c9b4da; }
    .soylab-price-popup .soylab-price-selected {
      margin: 12px 0; padding: 8px 10px; border-radius: 7px;
      background: #462474; font-weight: 700;
    }
    .soylab-price-popup table { width: 100%; border-collapse: collapse; }
    .soylab-price-popup th, .soylab-price-popup td { padding: 7px 5px; border-bottom: 1px solid #604574; text-align: left; }
    .soylab-price-popup th { color: #c9b4da; font-weight: 600; }
    .soylab-price-popup .soylab-price-current { color: #fff; background: #543071; font-weight: 700; }
    .soylab-price-popup .soylab-price-note { color: #d3c0e0; margin: 12px 0 6px; }
    .soylab-price-popup .soylab-price-actual { margin-top: 10px; color: #baf7ba; }
    .soylab-price-popup a { color: #aadfff; }
  `;
  document.head.append(style);

  const enqueueFromElement = (element, scanChildren = false) => {
    if (element?.nodeType !== 1) return;
    const own = element.matches?.("[data-node-id]") ? element : element.closest?.("[data-node-id]");
    if (own) queueVueSync(own.dataset.nodeId);
    if (scanChildren) {
      for (const child of element.querySelectorAll?.("[data-node-id]") || []) queueVueSync(child.dataset.nodeId);
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      enqueueFromElement(mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement);
      for (const added of mutation.addedNodes) enqueueFromElement(added, true);
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  document.addEventListener("input", (event) => enqueueFromElement(event.target), true);
  document.addEventListener("change", (event) => enqueueFromElement(event.target), true);
  for (const existing of document.querySelectorAll("[data-node-id]")) queueVueSync(existing.dataset.nodeId);
}

if (document.body) installVueHeaderSupport();
else document.addEventListener("DOMContentLoaded", installVueHeaderSupport, { once: true });

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
      queueVueSync(node.id);
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
        queueVueSync(node.id);
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
    if (pricePopup?.dataset.nodeId === String(this.id)) refreshPricePopup();
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

function addPriceButton(node) {
  if (node.widgets?.some((item) => item._soylabPriceButton)) return;
  const button = node.addWidget("button", "공급자별 비용 확인", null, () => openPricePopup(node));
  button._soylabPriceButton = true;
  button.serialize = false;
  const oldIndex = node.widgets.indexOf(button);
  const helpIndex = node.widgets.findIndex((item) => item.name === "soylab_key_help");
  if (oldIndex >= 0 && helpIndex >= 0) {
    node.widgets.splice(oldIndex, 1);
    node.widgets.splice(helpIndex + 1, 0, button);
  }
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
      addPriceButton(this);
      installSelectionWatch(this);
      setTimeout(() => { updateOutputLabels(this); queueVueSync(this.id); }, 0);
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
  queueVueSync(node.id);
});
