import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "SoylabComfyRouter";
const TITLE = "SOYLAB Comfy Router";
const CORAL = "#FF705B";
const HEADER_PURPLE = "#2E104B";
const HEADER_GRADIENT = `linear-gradient(90deg, ${HEADER_PURPLE} 0%, #3D6574 50%, #00ED08 100%)`;
const BODY_BG = "#1E1B25";
const FOOTER_BG = "#28173E";
const COST_BUTTON_BG = "#422670";
const STATUS_LABELS = {
  preparing: "입력 준비 중", uploading: "참조 파일 전송 중", submitting: "Router에 요청 전송 중",
  queued: "Router 전달 완료 · 대기 중", generating: "공급자 생성 중", sync_waiting: "공급자 응답 대기 중",
  collecting: "완료 · 결과 수신 중", downloading: "완료 · 파일 다운로드 중",
  completed: "완료", failed: "오류 · 실행 기록 확인",
};

function statusText(node) {
  const item = node._soylabStatus;
  if (!item) return "";
  const queue = item.stage === "queued" && Number.isInteger(item.queue_position) ? ` · 앞에 ${item.queue_position}건` : "";
  return `${STATUS_LABELS[item.stage] || item.stage}${queue}`;
}
let COMFY_CREDITS_PER_USD = NaN;
const PRICE_HISTORY_KEY = "soylab.router.priceHistory.v1";
const logo = new Image();
const logoUrl = new URL("./soylab-logo.png", import.meta.url);
logoUrl.searchParams.set("v", "64px");
logo.src = logoUrl.href;
logo.onload = () => app.graph?.setDirtyCanvas?.(true, true);

let catalog = [];
let pricing = { models: {} };
let priceHistory = [];
try {
  const saved = JSON.parse(localStorage.getItem(PRICE_HISTORY_KEY) || "[]");
  if (Array.isArray(saved)) priceHistory = saved;
} catch (_) {}

function priceSignature(node, spec, route) {
  return JSON.stringify([
    spec.model_id, route,
    field(node, "resolution", ""), field(node, "ratio", ""), field(node, "duration", ""),
    field(node, "quality", ""), field(node, "generate_audio", ""), field(node, "mode", ""),
    field(node, "output_format", ""),
    node.inputs?.some((input) => input.name === `${inputPrefix(node)}.first_frame` && input.link != null),
    node.inputs?.some((input) => input.name === `${inputPrefix(node)}.last_frame` && input.link != null),
    refCount(node, "images"), refCount(node, "videos"), refCount(node, "audios"),
  ]);
}

function observedCost(node, spec, route) {
  if (!spec) return null;
  return priceHistory.find((entry) => entry.signature === priceSignature(node, spec, route)) || null;
}

function rememberCost(node, spec, route, credits) {
  if (!spec || !Number.isFinite(Number(credits))) return;
  const signature = priceSignature(node, spec, route);
  priceHistory = [{ signature, credits: Number(credits), at: Date.now() },
    ...priceHistory.filter((entry) => entry.signature !== signature)].slice(0, 40);
  try { localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(priceHistory)); } catch (_) {}
}

function routeResolutions(spec, route) {
  return spec?.providers?.find((item) => item.name === route)?.resolutions || null;
}

function routeResolutionNote(spec, route, resolution) {
  return spec?.providers?.find((item) => item.name === route)?.resolution_notes?.[resolution] || null;
}

function directReference(node, spec, route) {
  const entry = pricing.models?.[spec?.model_id]?.[route];
  const framesConnected = node.inputs?.some((input) => (input.name === `${inputPrefix(node)}.first_frame` || input.name === `${inputPrefix(node)}.last_frame`) && input.link != null);
  if (!entry || field(node, "mode") === "edit" || framesConnected || refCount(node, "images") || refCount(node, "videos") || refCount(node, "audios") || entry.reference_inputs !== false) return null;
  const duration = Number(field(node, "duration", 0));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", ""));
  const supported = routeResolutions(spec, route);
  if (supported && !supported.includes(resolution)) return null;
  if (entry.priced_resolutions && !entry.priced_resolutions.includes(resolution)) return null;
  if (!Number.isFinite(duration) || duration <= 0 || (entry.aspect_ratio && entry.aspect_ratio !== ratio)) return null;
  const range = entry.range || (Number.isFinite(entry.rates?.[resolution]) ? [entry.rates[resolution], entry.rates[resolution]] : null);
  if (!range) return null;
  const rateDollars = (value) => `$${Number(value.toFixed(5))}`;
  const totalDollars = (value) => `$${value.toFixed(2)}`;
  const rateText = range[0] === range[1] ? rateDollars(range[0]) : `${rateDollars(range[0])}–${rateDollars(range[1])}`;
  const totalText = range[0] === range[1] ? totalDollars(range[0] * duration) : `${totalDollars(range[0] * duration)}–${totalDollars(range[1] * duration)}`;
  const credits = (value) => (value * COMFY_CREDITS_PER_USD).toFixed(1);
  const creditRateText = `${credits(range[0])}${range[0] === range[1] ? "" : `–${credits(range[1])}`} C`;
  const creditTotalText = `${credits(range[0] * duration)}${range[0] === range[1] ? "" : `–${credits(range[1] * duration)}`} C`;
  return { rateText, totalText, creditRateText, creditTotalText, rangeScope: entry.range_scope || "", source: entry.source, checkedAt: entry.checked_at, note: entry.note, approximate: !!entry.approximate };
}

function directResolutionNotice(node, spec, route) {
  const entry = pricing.models?.[spec?.model_id]?.[route];
  const resolution = String(field(node, "resolution", ""));
  const note = routeResolutionNote(spec, route, resolution);
  if (note?.text) return note.text;
  const supported = routeResolutions(spec, route);
  return entry && supported && !supported.includes(resolution)
    ? `${route} 현재 노드의 ${resolution} 경로 미지원 (공개 API: ${supported.join("·")})`
    : "";
}

fetch(new URL("./router-data.json", import.meta.url), { cache: "no-store" })
  .then((response) => response.ok ? response.json() : null)
  .then((data) => {
    if (!data || !Array.isArray(data.models)) return;
    COMFY_CREDITS_PER_USD = Number(data.comfy_credits_per_usd);
    if (!Number.isFinite(COMFY_CREDITS_PER_USD) || COMFY_CREDITS_PER_USD <= 0) throw new Error("router-data.json: comfy_credits_per_usd is invalid");
    catalog = data.models.map((item) => ({ ...item, alternates: item.providers.filter((route) => route.name !== "Comfy").map((route) => route.name) }));
    pricing = { updated_at: data.updated_at, models: Object.fromEntries(catalog.map((item) => [item.model_id, item.pricing?.alternates || {}])) };
    app.graph?.setDirtyCanvas?.(true, true);
    for (const node of app.graph?._nodes || []) if (node.type === NODE_ID) queueVueSync(node.id);
  })
  .catch(() => {});

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name) ?? null;
}

function modelLabel(spec) {
  return spec.display_name || `${spec.service} ${spec.family} ${spec.version}`;
}

function inputPrefix(node) {
  return widget(node, "model") ? "model" : "service.model.version";
}

function selected(node) {
  const label = widget(node, "model")?.value;
  const spec = inputPrefix(node) === "model"
    ? catalog.find((item) => modelLabel(item) === label || `${item.service} / ${item.family} ${item.version}` === label)
    : catalog.find((item) => item.service === widget(node, "service")?.value
      && item.family === widget(node, "service.model")?.value
      && item.version === widget(node, "service.model.version")?.value);
  return { spec };
}

function field(node, name, fallback = undefined) {
  return widget(node, `${inputPrefix(node)}.${name}`)?.value ?? fallback;
}

function refCount(node, type) {
  return node.inputs?.filter((input) => input.name?.startsWith(`${inputPrefix(node)}.reference_${type}.`) && input.link != null).length ?? 0;
}

function usd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 0.1 ? 3 : 2)}` : "확인 불가";
}

function comfyQuote(node, spec) {
  const rule = spec?.pricing?.comfy;
  if (!rule) return null;
  if (field(node, "mode") === "edit") return null;
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", "16:9"));
  const hasVideo = refCount(node, "videos") > 0;
  const credits = (value) => value * COMFY_CREDITS_PER_USD;
  if (rule.type === "usd_per_second") {
    return { perSecond: credits(rule.rate), total: credits(rule.rate * duration), source: rule.source };
  }
  if (rule.type === "usd_per_run" || rule.type === "usd_by_resolution" || rule.type === "usd_by_quality_resolution") {
    const quality = String(field(node, "quality", "low"));
    const rate = rule.type === "usd_per_run" ? rule.rate
      : rule.type === "usd_by_resolution" ? rule.rates?.[resolution]
      : rule.rates?.[quality]?.[resolution];
    if (!Number.isFinite(rate)) return null;
    const imageReferences = rule.reference_image_usd ? refCount(node, "images") * rule.reference_image_usd : 0;
    return { total: credits(rate + imageReferences), source: rule.source };
  }
  if (rule.type !== "video_tokens") return null;
  const tokenRate = rule.credits_per_1k?.[hasVideo ? "video" : "no_video"]?.[resolution];
  if (!Number.isFinite(tokenRate)) return null;
  const frameIndex = rule.resolution_order?.indexOf(resolution) ?? -1;
  const frame = frameIndex < 0 ? null : (rule.frame_tokens_per_frame?.[ratio] || rule.frame_tokens_per_frame?.default)?.[frameIndex];
  let tokensPerSecond = Number.isFinite(frame) ? frame * rule.fps : rule.tokens_per_second?.[resolution];
  if (!Number.isFinite(tokensPerSecond) && rule.short_side_pixels?.[resolution]) {
    const dimensions = ratio.match(/^(\d+):(\d+)$/);
    if (!dimensions) return null;
    const widthRatio = Number(dimensions[1]);
    const heightRatio = Number(dimensions[2]);
    const shortSide = rule.short_side_pixels[resolution];
    const width = widthRatio >= heightRatio ? Math.round(shortSide * widthRatio / heightRatio) : shortSide;
    const height = widthRatio >= heightRatio ? shortSide : Math.round(shortSide * heightRatio / widthRatio);
    const evenWidth = width - width % 2;
    const evenHeight = height - height % 2;
    tokensPerSecond = evenWidth * evenHeight * rule.fps / 1024;
  }
  if (!Number.isFinite(tokensPerSecond)) return null;
  const perSecond = tokensPerSecond / 1000 * tokenRate;
  const totalFor = (seconds) => rule.total_token_round === "floor_plus_one_frame"
    ? Math.floor(frame * (rule.fps * seconds + 1)) / 1000 * tokenRate
    : perSecond * seconds;
  const billedSeconds = hasVideo && rule.video_billed_seconds_factor
    ? Math.ceil(duration * rule.video_billed_seconds_factor) : duration;
  return {
    perSecond,
    total: totalFor(billedSeconds),
    maxTotal: hasVideo && rule.video_max_extra_seconds ? totalFor(duration + rule.video_max_extra_seconds) : null,
    source: rule.source,
  };
}

function estimate(node, spec) {
  if (!spec) return { provider: "", comfy: "모델을 선택하세요" };
  const duration = Number(field(node, "duration", 5));
  const execution = String(field(node, "execution_provider", "Comfy"));
  const maker = spec.pricing?.maker;
  const makerPrice = maker?.type === "usd_per_second" ? usd(maker.rate * duration) : maker?.value || "";
  const quote = comfyQuote(node, spec);
  const actual = node.properties?.soylabActualCredits;
  const providerText = makerPrice ? `${spec.service} API 참고 ${makerPrice}` : "";
  let comfyText = "Comfy 예상 확인 불가";
  const observed = observedCost(node, spec, execution);
  const directRef = execution === "Comfy" ? null : directReference(node, spec, execution);
  const resolutionNotice = execution === "Comfy" ? "" : directResolutionNotice(node, spec, execution);
  if (actual != null && Number.isFinite(Number(actual)) && node.properties?.soylabActualSignature === priceSignature(node, spec, execution)) {
    comfyText = `Comfy 실제 ${Number(actual).toFixed(2)} C`;
  } else if (execution !== "Comfy" && observed) {
    comfyText = `${execution} 최근 실측 ${observed.credits.toFixed(1)} C`;
  } else if (execution !== "Comfy") {
    comfyText = directRef
      ? `${execution} ${directRef.rangeScope ? "공개 범위 환산" : "직결가 환산 약"} ${directRef.creditRateText}/초`
      : resolutionNotice || `${execution} Router 사전 단가 미공개`;
  } else if (quote) {
    const low = quote.total.toFixed(1);
    const high = quote.maxTotal == null ? low : quote.maxTotal.toFixed(1);
    comfyText = `Comfy 약 ${low}${low === high ? "" : `–${high}`} C`;
  }
  return { provider: providerText, comfy: comfyText, estimatedCredits: quote?.total ?? null };
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
  const observed = observedCost(node, spec, route);
  const directRef = directReference(node, spec, route);
  const resolutionNotice = directResolutionNotice(node, spec, route);
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", ""));
  const signature = JSON.stringify([spec?.model_id, route, duration, resolution, ratio, field(node, "mode", ""), refCount(node, "videos"), node.properties?.soylabActualCredits, directRef?.rateText]);
  if (pricePopup.dataset.signature === signature) return;
  pricePopup.dataset.signature = signature;
  pricePopup.replaceChildren();

  const line = (tag, className, value) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  };
  const heading = line("div", "soylab-price-heading", "Router 실행 공급자별 비용");
  const close = line("button", "soylab-price-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "비용 창 닫기");
  close.onclick = () => { pricePopup?.remove(); pricePopup = null; };
  const top = line("div", "soylab-price-top", "");
  top.append(heading, close);
  pricePopup.append(top);
  if (!spec) {
    pricePopup.append(line("p", "soylab-price-note", "모델을 먼저 선택하세요."));
    return;
  }
  pricePopup.append(line("div", "soylab-price-model", modelLabel(spec)));
  const settings = [resolution, spec.output === "VIDEO" ? `${duration}초` : "", ratio].filter(Boolean).join(" · ");
  if (settings) pricePopup.append(line("div", "soylab-price-settings", settings));
  const selectedRate = route !== "Comfy" && observed
    ? `최근 같은 설정 ${priceText(observed.credits)}`
    : route !== "Comfy" && directRef
      ? `${directRef.rangeScope || "직결가"} ${directRef.totalText} · ${directRef.rangeScope ? "범위 환산" : "직결가 환산 약"} ${directRef.creditTotalText}`
    : resolutionNotice
      ? resolutionNotice
    : route === "Comfy" && Number.isFinite(quote?.perSecond)
    ? `${priceText(quote.perSecond)}/초`
    : route === "Comfy" && Number.isFinite(estimateInfo.estimatedCredits)
      ? `약 ${priceText(estimateInfo.estimatedCredits)}/회`
      : "실행 전 가격 미공개";
  pricePopup.append(line("div", "soylab-price-selected", `현재 경로: ${route} · ${selectedRate}`));
  if (route !== "Comfy" && quote) {
    pricePopup.append(line("div", "soylab-price-baseline", `Comfy 기본 경로 참고: 약 ${priceText(quote.total)}${quote.maxTotal == null ? "" : `–${priceText(quote.maxTotal)}`}`));
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Router 공급자", "공개 참고 가격", "Router 비용/실측"]) headRow.append(line("th", "", label));
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  for (const provider of ["Comfy", ...(spec.alternates || [])]) {
    const row = document.createElement("tr");
    if (provider === route) row.className = "soylab-price-current";
    const known = provider === "Comfy" && quote;
    const estimated = provider === "Comfy" && Number.isFinite(estimateInfo.estimatedCredits);
    const recent = observedCost(node, spec, provider);
    const outside = directReference(node, spec, provider);
    const outsideNotice = directResolutionNotice(node, spec, provider);
    const outsideSource = pricing.models?.[spec.model_id]?.[provider];
    const rate = known && Number.isFinite(quote.perSecond) ? `Comfy ${priceText(quote.perSecond)}/초` : estimated ? `Comfy 약 ${priceText(estimateInfo.estimatedCredits)}/회` : outside ? `${outside.rangeScope || "직결"} ${outside.rateText}/초 · ${outside.totalText} 참고` : outsideNotice || "공개 참고 없음";
    const total = known
      ? quote.maxTotal == null ? `약 ${priceText(quote.total)}` : `약 ${priceText(quote.total)}–${priceText(quote.maxTotal)}`
      : estimated ? `약 ${priceText(estimateInfo.estimatedCredits)}` : recent ? `최근 실측 ${priceText(recent.credits)}` : outside ? `${outside.rangeScope ? "공개 범위 환산" : "직결가 환산 약"} ${outside.creditTotalText}` : "사전 요금 미공개";
    row.append(line("td", "", provider));
    const rateCell = line("td", "", rate);
    const noteSource = routeResolutionNote(spec, provider, resolution)?.source;
    if ((outside || outsideNotice) && (noteSource || outsideSource?.source)) {
      const link = document.createElement("a");
      link.href = noteSource || outsideSource.source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " ↗";
      link.title = noteSource ? "해상도 지원 안내 출처 · Router 경로/가격은 별도 확인 필요" : `업체 직접 API 가격 출처 · 확인일 ${outsideSource.checked_at}`;
      rateCell.append(link);
    }
    row.append(rateCell, line("td", "", total));
    body.append(row);
  }
  table.append(body);
  pricePopup.append(table);
  const actual = node.properties?.soylabActualCredits;
  if (actual != null && node.properties?.soylabActualSignature === priceSignature(node, spec, route)) {
    pricePopup.append(line("div", "soylab-price-actual", `최근 실행 실제 사용량: ${priceText(Number(actual))}`));
  }
  pricePopup.append(line("p", "soylab-price-note", `직결 USD 가격은 각 업체 API 페이지를 ${pricing.updated_at || "최근"}에 확인해 Git에 기록했습니다. 직결가 환산 크레딧은 $1 = ${COMFY_CREDITS_PER_USD} C 기준의 참고값이며 Router의 실제 청구액을 보장하지 않습니다. Comfy 기본 경로는 공식 Partner Node 가격표의 참고값입니다. Router는 다른 공급자의 사전 요금을 공개하지 않습니다. 최근 실측은 이 브라우저의 이전 실행 기록이며 입력 내용에 따라 달라질 수 있습니다.`));
  if (directRef?.note) pricePopup.append(line("p", "soylab-price-note", `${route} 참고 가격은 제공 페이지 내부의 표기 차이가 있어 범위로 표시합니다.`));
  const pricingLink = document.createElement("a");
  pricingLink.href = "https://docs.comfy.org/tutorials/partner-nodes/pricing";
  pricingLink.target = "_blank";
  pricingLink.rel = "noopener noreferrer";
  pricingLink.textContent = "Comfy 공식 가격표 ↗";
  pricePopup.append(pricingLink, document.createTextNode("  ·  "));
  const source = document.createElement("a");
  source.href = "https://docs.comfy.org/development/comfy-router/reference";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "Router 요금 응답 설명 ↗";
  pricePopup.append(source, document.createTextNode("  ·  "));
  const conversion = document.createElement("a");
  conversion.href = "https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy";
  conversion.target = "_blank";
  conversion.rel = "noopener noreferrer";
  conversion.textContent = "크레딧 환산 기준 ↗";
  pricePopup.append(conversion);
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
  if (!host.classList.contains("soylab-router-vue")) host.classList.add("soylab-router-vue");
  header.style.setProperty("background", HEADER_GRADIENT, "important");
  header.style.setProperty("color", "#fff", "important");
  host.querySelector(".bg-component-node-background")?.style.setProperty("background-color", BODY_BG, "important");
  host.querySelector('[data-testid="advanced-inputs-button"]')?.style.setProperty("background-color", FOOTER_BG, "important");
  const costButton = [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Router 공급자별 비용 확인");
  costButton?.classList.add("soylab-cost-button");
  const keyButton = [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "API KEY.INI 열기");
  keyButton?.classList.add("soylab-key-button");
  if (costButton) {
    let status = host.querySelector(".soylab-run-status");
    if (!status) {
      status = document.createElement("div");
      status.className = "soylab-run-status";
      status.setAttribute("role", "status");
      (costButton.closest(".lg-node-widget") || costButton.parentElement)?.after(status);
    }
    const message = statusText(node);
    if (status && status.textContent !== message) status.textContent = message;
    if (status) status.hidden = !message;
    if (status) status.title = node._soylabStatus?.request_id ? `Router request_id: ${node._soylabStatus.request_id}` : "";
  }

  const title = header.querySelector('[data-testid="node-title"]');
  if (title) {
    title.style.setProperty("color", "#fff", "important");
    title.style.setProperty("gap", "2px", "important");
    let mark = title.querySelector(".soylab-header-logo");
    if (mark && mark.tagName !== "SPAN") {
      mark.remove();
      mark = null;
    }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "soylab-header-logo";
      mark.setAttribute("aria-hidden", "true");
      title.prepend(mark);
    }
    // A background on a span cannot be dragged into ComfyUI as an image file.
    mark.style.cssText = "display:inline-block!important;width:22px!important;height:22px!important;min-width:22px!important;max-width:22px!important;min-height:22px!important;max-height:22px!important;flex:0 0 22px!important;background-color:transparent!important;background-size:contain!important;background-position:center!important;background-repeat:no-repeat!important;pointer-events:none!important;user-select:none!important";
    mark.style.setProperty("background-image", `url("${logo.src}")`, "important");
  }
  let badge = header.querySelector(".soylab-price-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "soylab-price-badge";
    badge.title = "Router 실행 공급자별 비용 비교 열기";
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
  const label = [price.provider, price.comfy].filter(Boolean).join("  |  ");
  if (badge.textContent !== label) badge.textContent = label;
  const selectedRoute = String(field(node, "execution_provider", "Comfy"));
  const selectedReference = selectedRoute === "Comfy" ? null : directReference(node, spec, selectedRoute);
  badge.title = price.comfy.includes("공개 범위 환산")
    ? `${selectedReference?.rangeScope || "공개 가격 범위"}입니다. 선택한 해상도의 확정 단가가 아닙니다. 실제 Router 청구액은 실행 후 확인하세요.`
    : price.comfy.includes("직결가 환산")
      ? `외부 직접 API 가격을 $1 = ${COMFY_CREDITS_PER_USD} Comfy 크레딧으로 환산한 참고값입니다. 실제 Router 청구액은 실행 후 확인하세요.`
      : "Router 실행 공급자별 비용 비교 열기";

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
    const observed = observedCost(node, spec, route);
    const directRef = directReference(node, spec, route);
    const resolutionNotice = directResolutionNotice(node, spec, route);
    const rate = route === "Comfy" && Number.isFinite(quote?.perSecond)
      ? `Comfy 예상 ${priceText(quote.perSecond)}/초 · 자세한 비용은 위 가격 버튼`
      : route === "Comfy" && quote
        ? `Comfy 예상 ${priceText(quote.total)}/회 · 자세한 비용은 위 가격 버튼`
      : route !== "Comfy" && observed
        ? `${route} 최근 같은 설정 ${priceText(observed.credits)} · 사전 단가는 미공개`
        : route !== "Comfy" && directRef
          ? `${route} ${directRef.rangeScope || "직결"} ${directRef.rateText}/초 · ${directRef.rangeScope ? "범위 환산" : "직결가 환산 약"} ${directRef.creditRateText}/초`
        : resolutionNotice
          ? `${resolutionNotice} · Router 실제 요금은 실행 후 확인`
        : route !== "Comfy" && quote
          ? `${route} 사전 단가 미공개 · Comfy 기준 약 ${priceText(quote.total)} (선택 경로 요금 아님)`
          : `${route} 사전 단가 미공개 · 공식 가격표 링크는 비용 창에서 확인`;
    const soleRoute = route === "Comfy" && !spec?.alternates?.length;
    const message = soleRoute ? `${rate} · 이 모델의 대체 실행 경로는 현재 없음` : rate;
    if (hint.textContent !== message) hint.textContent = message;
  }

  const kinds = ["IMAGE", "VIDEO", "AUDIO"];
  const slots = host.querySelectorAll(".lg-slot--output");
  kinds.forEach((kind, index) => {
    const slot = slots[index];
    const text = slot?.querySelector("span.truncate");
    if (!text) return;
    if (!text.dataset.soylabLabel) text.dataset.soylabLabel = text.textContent.trim() || kind;
    const supported = spec?.output === kind;
    slot.classList.toggle("soylab-unsupported-output", !supported);
    const wanted = supported ? text.dataset.soylabLabel : "";
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
      background: ${HEADER_GRADIENT} !important;
      color: #fff !important;
      min-height: 34px;
    }
    .soylab-router-vue .bg-component-node-background { background-color: ${BODY_BG} !important; }
    .soylab-router-vue [data-testid="advanced-inputs-button"] { background-color: ${FOOTER_BG} !important; }
    .soylab-router-vue .soylab-cost-button { background-color: ${COST_BUTTON_BG} !important; color: #fff !important; }
    .soylab-router-vue .soylab-cost-button:hover { background-color: #523084 !important; }
    .soylab-router-vue .soylab-key-button { background-color: #37303f !important; color: #eee5f4 !important; }
    .soylab-router-vue .lg-node-header [data-testid="node-title"],
    .soylab-router-vue .lg-node-header [data-testid="node-title"] span,
    .soylab-router-vue .lg-node-header .text-node-component-header-icon {
      color: #fff !important;
    }
    .soylab-router-vue .lg-node-header [data-testid="node-title"] { min-width: 0; font-weight: 700; gap: 2px !important; }
    .soylab-router-vue .soylab-header-logo {
      width: 22px; height: 22px; flex: none; background-color: transparent;
      background-size: contain; background-position: center; background-repeat: no-repeat;
      pointer-events: none; user-select: none;
    }
    .soylab-router-vue .soylab-price-badge {
      flex: none; max-width: 52%; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; padding: 5px 8px; border-radius: 12px;
      color: #fff; background: rgba(20, 8, 40, .85); font-size: 10px; cursor: pointer;
    }
    .soylab-router-vue .soylab-price-badge:hover { background: rgba(20, 8, 40, .98); }
    .soylab-router-vue .soylab-provider-rate {
      grid-column: 1 / -1; margin: -2px 12px 4px; color: #dcc5f2;
      font-size: 10px; line-height: 1.35;
    }
    .soylab-router-vue .soylab-run-status {
      grid-column: 1 / -1; margin: 2px 12px 5px; padding: 5px 9px;
      border-radius: 7px; background: #302343; color: #d9f5df;
      font-size: 11px; font-weight: 600;
    }
    .soylab-router-vue .soylab-run-status[hidden] { display: none !important; }
    .soylab-router-vue .soylab-unsupported-value { color: ${CORAL} !important; }
    .soylab-router-vue .soylab-unsupported-output { display: none !important; }
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
    .soylab-price-popup .soylab-price-baseline { margin: -5px 0 9px; color: #d9c3ec; }
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
  observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ["class"], subtree: true });
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
  gradient.addColorStop(0, HEADER_PURPLE);
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
  ctx.fillText(TITLE, 32, y + titleHeight / 2, 240);
  const { spec } = selected(node);
  const price = estimate(node, spec);
  const label = [price.provider, price.comfy].filter(Boolean).join("  |  ");
  ctx.font = "10px Inter, Arial, sans-serif";
  const textWidth = Math.min(ctx.measureText(label).width + 16, Math.max(width - 260, 80));
  ctx.fillStyle = "rgba(20, 8, 40, .82)";
  ctx.beginPath();
  ctx.roundRect?.(width - textWidth - 7, y + 5, textWidth, titleHeight - 10, 12);
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
    const name = spec?.output === kind ? kind : "";
    const color = spec?.output === kind ? "#BB7BFF" : BODY_BG;
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
  for (const name of ["model", "service", "service.model", "service.model.version"]) {
    const control = widget(node, name);
    if (!control || control._soylabWatch) continue;
    control._soylabWatch = true;
    const original = control.callback;
    control.callback = function (...args) {
      const result = original?.apply(this, args);
      setTimeout(() => {
        updateOutputLabels(node);
        markUnsupported(node);
        queueVueSync(node.id);
      }, 0);
      return result;
    };
  }
  const previousDraw = node.onDrawForeground;
  node.onDrawForeground = function (ctx, ...args) {
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
  const button = node.addWidget("button", "Router 공급자별 비용 확인", null, () => openPricePopup(node));
  button._soylabPriceButton = true;
  button.draw = (ctx, _node, width, y, height) => {
    ctx.save();
    ctx.fillStyle = COST_BUTTON_BG;
    ctx.beginPath();
    ctx.roundRect?.(14, y, width - 28, height, 8);
    if (!ctx.roundRect) ctx.rect(14, y, width - 28, height);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "12px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(button.name, width / 2, y + height / 2);
    ctx.restore();
  };
  button.serialize = false;
  const oldIndex = node.widgets.indexOf(button);
  let helpIndex = node.widgets.findIndex((item) => item._soylabKeyButton);
  if (helpIndex < 0) helpIndex = node.widgets.findIndex((item) => item.name === "soylab_key_help");
  if (oldIndex >= 0 && helpIndex >= 0) {
    node.widgets.splice(oldIndex, 1);
    node.widgets.splice(helpIndex + 1, 0, button);
  }
}

async function openApiKeyFile() {
  try {
    const response = await fetch(api.apiURL("/soylab_router/open_api_key"), { method: "POST" });
    if (!response.ok) {
      const message = await response.json().catch(() => ({}));
      throw new Error(message.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    window.alert(`API KEY.INI를 열지 못했습니다: ${error.message}`);
  }
}

function addKeyButton(node) {
  if (node.widgets?.some((item) => item._soylabKeyButton)) return;
  const button = node.addWidget("button", "API KEY.INI 열기", null, openApiKeyFile);
  button._soylabKeyButton = true;
  button.serialize = false;
  const current = node.widgets.indexOf(button);
  const help = node.widgets.findIndex((item) => item.name === "soylab_key_help");
  if (current >= 0 && help >= 0) {
    node.widgets.splice(current, 1);
    node.widgets.splice(help + 1, 0, button);
  }
}

function addStatusWidget(node) {
  if (node.widgets?.some((item) => item.name === "soylab_run_status")) return;
  const status = {
    name: "soylab_run_status", type: "soylab_run_status", serialize: false,
    computeSize: () => [0, 20],
    draw(ctx, current, width, y) {
      const message = statusText(current);
      if (!message) return;
      ctx.save();
      ctx.fillStyle = current._soylabStatus?.stage === "failed" ? CORAL : "#D9F5DF";
      ctx.font = "bold 11px Inter, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(message, 14, y + 14, width - 24);
      ctx.restore();
    },
  };
  node.addCustomWidget(status);
  const current = node.widgets.indexOf(status);
  const button = node.widgets.findIndex((item) => item._soylabPriceButton);
  if (current >= 0 && button >= 0) {
    node.widgets.splice(current, 1);
    node.widgets.splice(button + 1, 0, status);
  }
  node.setSize([node.size[0], node.size[1] + 20]);
}

app.registerExtension({
  name: "soylab.comfy.router",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = created?.apply(this, args);
      this.color = HEADER_PURPLE;
      this.bgcolor = BODY_BG;
      this.title = TITLE;
      addKeyHelp(this);
      addKeyButton(this);
      addPriceButton(this);
      addStatusWidget(this);
      installSelectionWatch(this);
      setTimeout(() => { updateOutputLabels(this); queueVueSync(this.id); }, 0);
      return result;
    };
  },
});

api.addEventListener("soylab_router_status", (event) => {
  const detail = event.detail || {};
  const node = app.graph?.getNodeById?.(Number(detail.node_id));
  if (node?.type !== NODE_ID || !STATUS_LABELS[detail.stage]) return;
  node._soylabStatus = { stage: detail.stage, queue_position: detail.queue_position, request_id: detail.stage === "preparing" ? null : (detail.request_id || node._soylabStatus?.request_id) };
  node.setDirtyCanvas?.(true, true);
  queueVueSync(node.id);
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
  const { spec } = selected(node);
  if (spec?.model_id === cost.model_id && field(node, "execution_provider", "Comfy") === cost.provider) {
    node.properties.soylabActualSignature = priceSignature(node, spec, cost.provider);
    rememberCost(node, spec, cost.provider, cost.credits);
  }
  node.setDirtyCanvas?.(true, true);
  queueVueSync(node.id);
});
