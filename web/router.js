import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { routerLocale, routerText } from "./i18n.js";
import { tokenPriceReference } from "./pricing.js";
import { captureIncomingLinks, restoreIncomingLinks, restoreModelWidgetValues } from "./link_recovery.mjs?v=1.0.1";

const NODE_ID = "SoylabComfyRouter";
const TITLE = "SOYLAB Comfy Router";
const CORAL = "#FF705B";
const HEADER_PURPLE = "#2E104B";
const HEADER_GRADIENT = `linear-gradient(90deg, ${HEADER_PURPLE} 0%, #3D6574 50%, #00ED08 100%)`;
const BODY_BG = "#1E1B25";
const FOOTER_BG = "#28173E";
const COST_BUTTON_BG = "#422670";
const tr = (key, values) => routerText(app, key, values);
const keyLabels = ["API KEY.INI 열기", "INI 파일 생성 및 키 입력하기", "Open API KEY.INI", "Create INI file and enter key", "API KEY.INI を開く", "INI ファイルを作成してキーを入力", "打开 API KEY.INI", "创建 INI 文件并输入密钥"];
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
let keyFileExists = null;
try {
  const saved = JSON.parse(localStorage.getItem(PRICE_HISTORY_KEY) || "[]");
  if (Array.isArray(saved)) {
    priceHistory = saved.filter((entry) => typeof entry?.signature === "string" && Number.isFinite(Number(entry.credits)) && Number(entry.credits) > 0);
    if (priceHistory.length !== saved.length) localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(priceHistory));
  }
} catch (_) {}

function priceSignature(node, spec, route) {
  const frames = frameSelection(node, spec);
  return JSON.stringify([
    spec.model_id, route,
    field(node, "resolution", ""), field(node, "ratio", ""), field(node, "duration", ""),
    field(node, "quality", ""), field(node, "generate_audio", ""), field(node, "mode", ""),
    field(node, "output_format", ""), field(node, "generation_type", ""), field(node, "type", ""),
    frames.firstFrame, frames.lastFrame,
    frames.images, refCount(node, "videos"), refCount(node, "audios"),
  ]);
}

function observedCost(node, spec, route) {
  if (!spec) return null;
  return priceHistory.find((entry) => entry.signature === priceSignature(node, spec, route) && Number(entry.credits) > 0) || null;
}

function rememberCost(node, spec, route, credits) {
  if (!spec || credits == null || !Number.isFinite(Number(credits)) || Number(credits) <= 0) return;
  const signature = priceSignature(node, spec, route);
  priceHistory = [{ signature, credits: Number(credits), at: Date.now() },
    ...priceHistory.filter((entry) => entry.signature !== signature)].slice(0, 40);
  try { localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(priceHistory)); } catch (_) {}
}

function routeResolutions(spec, route) {
  return spec?.providers?.find((item) => item.name === route)?.resolutions || null;
}

function localizedField(item, key) {
  return item?.[`${key}_i18n`]?.[routerLocale(app)] || item?.[key] || "";
}

function comfyReferenceLabel(spec) {
  return localizedField(spec?.pricing?.comfy_reference, "label");
}

function routeResolutionNote(spec, route, resolution) {
  const note = spec?.providers?.find((item) => item.name === route)?.resolution_notes?.[resolution];
  return note ? { ...note, text: localizedField(note, "text") } : null;
}

function directReference(node, spec, route) {
  const entry = pricing.models?.[spec?.model_id]?.[route];
  if (!entry || field(node, "mode") === "edit" || field(node, "mode") === "extend") return null;
  const { firstFrame, lastFrame, images } = frameSelection(node, spec);
  const videos = refCount(node, "videos");
  const audios = refCount(node, "audios");
  const allowed = entry.reference_inputs;
  if (allowed === false) {
    if (firstFrame || lastFrame || images || videos || audios) return null;
  } else if (!allowed || images > allowed.images || Number(firstFrame) + Number(lastFrame) > (allowed.frames ?? allowed.images) || videos > allowed.videos || audios > allowed.audios || (lastFrame && !allowed.last_frame)) {
    return null;
  }
  const duration = Number(field(node, "duration", 0));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", ""));
  const supported = routeResolutions(spec, route);
  if (supported && !supported.includes(resolution)) return null;
  if (entry.priced_resolutions && !entry.priced_resolutions.includes(resolution)) return null;
  if (!Number.isFinite(duration) || duration <= 0 || (entry.aspect_ratio && entry.aspect_ratio !== ratio)) return null;
  const tokenQuote = entry.token_pricing ? tokenPriceReference(entry.token_pricing, resolution, ratio, duration) : null;
  if (entry.token_pricing && !tokenQuote) return null;
  const range = tokenQuote ? [tokenQuote.rate, tokenQuote.rate]
    : entry.range || (Number.isFinite(entry.rates?.[resolution]) ? [entry.rates[resolution], entry.rates[resolution]] : null);
  if (!range) return null;
  const rateDollars = (value) => `$${Number(value.toFixed(5))}`;
  const totalDollars = (value) => `$${value.toFixed(2)}`;
  const rateText = range[0] === range[1] ? rateDollars(range[0]) : `${rateDollars(range[0])}–${rateDollars(range[1])}`;
  const totalText = tokenQuote ? totalDollars(tokenQuote.total)
    : range[0] === range[1] ? totalDollars(range[0] * duration) : `${totalDollars(range[0] * duration)}–${totalDollars(range[1] * duration)}`;
  const credits = (value) => (value * COMFY_CREDITS_PER_USD).toFixed(1);
  const creditRateText = `${credits(range[0])}${range[0] === range[1] ? "" : `–${credits(range[1])}`} C`;
  const creditTotalText = tokenQuote ? `${credits(tokenQuote.total)} C`
    : `${credits(range[0] * duration)}${range[0] === range[1] ? "" : `–${credits(range[1] * duration)}`} C`;
  return { rateText, totalText, creditRateText, creditTotalText, duration, rangeScope: localizedField(entry, "range_scope"), source: entry.source, checkedAt: entry.checked_at, note: entry.note, approximate: !!entry.approximate, tokenEstimate: !!tokenQuote };
}

function directResolutionNotice(node, spec, route) {
  const entry = pricing.models?.[spec?.model_id]?.[route];
  const resolution = String(field(node, "resolution", ""));
  const note = routeResolutionNote(spec, route, resolution);
  if (note?.text) return note.text;
  const supported = routeResolutions(spec, route);
  return entry && supported && !supported.includes(resolution)
    ? tr("resolutionUnsupported", { provider: route, resolution, supported: supported.join("·") })
    : "";
}

function publicReference(spec, route) {
  const reference = pricing.models?.[spec?.model_id]?.[route]?.public_reference;
  return reference ? { ...reference, label: localizedField(reference, "label") } : null;
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

function keyButtonLabel() {
  return tr(keyFileExists === false ? "keyCreate" : "keyOpen");
}

function syncKeyPlaceholder(node, host) {
  const input = widget(node, "api_key")?.inputEl;
  const fields = [input, input?.querySelector?.("input"), host?.querySelector?.('input[aria-label="api_key"]'), host?.querySelector?.('[aria-label="api_key"] input')];
  const label = tr("keyPlaceholder");
  for (const field of fields) if (field?.placeholder != null && field.placeholder !== label) field.placeholder = label;
}

function syncKeyButtons() {
  for (const node of app.graph?._nodes || []) {
    if (node.type !== NODE_ID) continue;
    const button = node.widgets?.find((item) => item._soylabKeyButton);
    if (button && button.name !== keyButtonLabel()) {
      button.name = keyButtonLabel();
      node.setDirtyCanvas?.(true, true);
    }
    queueVueSync(node.id);
  }
}

async function refreshKeyFileStatus() {
  try {
    const response = await fetch(api.apiURL("/soylab_router/api_key_file_status"), { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    if (typeof status.exists === "boolean" && keyFileExists !== status.exists) {
      keyFileExists = status.exists;
      syncKeyButtons();
    }
  } catch (_) {}
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
  const prefix = inputPrefix(node);
  const direct = widget(node, prefix + "." + name);
  if (direct) return direct.value ?? fallback;
  const spec = selected(node).spec;
  const aliases = name === "ratio" ? ["ratio", "aspect_ratio", "aspectRatio"]
    : name === "resolution" ? ["resolution", "size", "target_resolution"] : [name];
  const control = spec?.controls?.find((item) => aliases.includes(item.path?.[item.path.length - 1]));
  return control ? widget(node, prefix + "." + control.name)?.value ?? fallback : fallback;
}

function refCount(node, type) {
  return node.inputs?.filter((input) => input.name?.startsWith(`${inputPrefix(node)}.reference_${type}.`) && input.link != null).length ?? 0;
}

function frameSelection(node, spec) {
  const connected = (name) => !!node.inputs?.some((input) => input.name === `${inputPrefix(node)}.${name}` && input.link != null);
  const mode = field(node, "mode");
  const imageMode = spec?.adapter === "seedance" && (mode === "image" || (mode === "auto" && !refCount(node, "videos") && !refCount(node, "audios")
    && !connected("first_frame") && !connected("last_frame")));
  const aliasFirst = imageMode && connected("reference_images.image_1");
  const aliasLast = imageMode && connected("reference_images.image_2");
  return {
    firstFrame: connected("first_frame") || aliasFirst,
    lastFrame: connected("last_frame") || aliasLast,
    images: refCount(node, "images") - Number(aliasFirst) - Number(aliasLast),
  };
}

function usd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 0.1 ? 3 : 2)}` : tr("estimateUnavailable");
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
  if (!spec) return { provider: "", comfy: tr("pickModelShort") };
  const duration = Number(field(node, "duration", 5));
  const execution = String(field(node, "execution_provider", "Comfy"));
  const maker = spec.pricing?.maker;
  const makerPrice = maker?.type === "usd_per_second" ? usd(maker.rate * duration) : localizedField(maker, "value");
  const quote = comfyQuote(node, spec);
  const actual = node.properties?.soylabActualCredits;
  const providerText = makerPrice ? tr("makerReference", { maker: spec.service, price: makerPrice }) : "";
  let comfyText = tr("estimateUnavailable");
  const observed = observedCost(node, spec, execution);
  const directRef = execution === "Comfy" ? null : directReference(node, spec, execution);
  const published = execution === "Comfy" ? null : publicReference(spec, execution);
  const resolutionNotice = execution === "Comfy" ? "" : directResolutionNotice(node, spec, execution);
  const sameRunWithoutCredits = actual == null && node.properties?.soylabActualSignature === priceSignature(node, spec, execution)
    && node.properties?.soylabActualModel === spec.model_id && node.properties?.soylabActualProvider === execution;
  if (actual != null && Number.isFinite(Number(actual)) && node.properties?.soylabActualSignature === priceSignature(node, spec, execution)) {
    comfyText = tr("actualInline", { credits: `${Number(actual).toFixed(2)} C` });
  } else if (sameRunWithoutCredits) {
    comfyText = tr("historyCheck", { provider: execution });
  } else if (execution !== "Comfy" && observed) {
    comfyText = tr("recent", { credits: `${observed.credits.toFixed(1)} C` });
  } else if (execution !== "Comfy") {
    comfyText = directRef
      ? tr("directTotal", { provider: execution, credits: directRef.creditTotalText, seconds: directRef.duration, scope: "" })
      : resolutionNotice || (published ? tr("directPublished", { provider: execution, label: published.label }) : tr("providerPreRunUnavailable", { provider: execution }));
  } else if (quote) {
    const low = quote.total.toFixed(1);
    const high = quote.maxTotal == null ? low : quote.maxTotal.toFixed(1);
    comfyText = tr("comfyEstimate", { credits: `${low}${low === high ? "" : `–${high}`}` });
  } else if (execution === "Comfy" && spec.pricing?.comfy_reference) {
    comfyText = tr("comfyReference", { label: comfyReferenceLabel(spec) });
  }
  return { provider: providerText, comfy: comfyText, estimatedCredits: quote?.total ?? null };
}

let pricePopup = null;
let pricePopupObserver = null;
let priceTooltip = null;
let modelPopup = null;

function closeModelSearch() {
  modelPopup?.remove();
  modelPopup = null;
}

function openModelSearch(node) {
  closeModelSearch();
  const popup = document.createElement("section");
  popup.className = "soylab-model-search";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", tr("modelSearch"));
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = tr("modelSearchHint");
  input.setAttribute("aria-label", tr("modelSearch"));
  const list = document.createElement("div");
  list.className = "soylab-model-search-list";
  const render = () => {
    const term = input.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    const matches = catalog.filter((spec) => (modelLabel(spec) + " " + spec.model_id).toLocaleLowerCase().includes(term));
    for (const spec of matches) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = modelLabel(spec);
      option.title = spec.model_id;
      option.onclick = () => {
        const selectedWidget = widget(node, "model");
        if (selectedWidget) {
          const old = selectedWidget.value;
          selectedWidget.value = modelLabel(spec);
          selectedWidget.callback?.(selectedWidget.value, app.canvas, node);
          node.onWidgetChanged?.("model", selectedWidget.value, old, selectedWidget);
          node.setDirtyCanvas?.(true, true);
          queueVueSync(node.id);
        }
        closeModelSearch();
      };
      list.append(option);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.textContent = tr("modelNoMatch");
      list.append(empty);
    }
  };
  input.oninput = render;
  popup.onkeydown = (event) => {
    if (event.key === "Escape") closeModelSearch();
    if (event.key === "Enter" && document.activeElement === input) list.querySelector("button")?.click();
  };
  popup.append(input, list);
  document.body.append(popup);
  modelPopup = popup;
  render();
  input.focus();
}

function showPriceTooltip(label, event) {
  if (!label || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return;
  if (!priceTooltip) {
    priceTooltip = document.createElement("div");
    priceTooltip.className = "soylab-price-tooltip";
    document.body.append(priceTooltip);
  }
  if (priceTooltip.textContent !== label) priceTooltip.textContent = label;
  const left = Math.min(event.clientX + 14, innerWidth - priceTooltip.offsetWidth - 8);
  const top = Math.min(event.clientY + 18, innerHeight - priceTooltip.offsetHeight - 8);
  priceTooltip.style.left = `${Math.max(8, left)}px`;
  priceTooltip.style.top = `${Math.max(8, top)}px`;
}

function hidePriceTooltip() {
  priceTooltip?.remove();
  priceTooltip = null;
}

function closePricePopup() {
  pricePopupObserver?.disconnect();
  pricePopupObserver = null;
  pricePopup?.remove();
  pricePopup = null;
}

function makePricePopupDraggable(handle) {
  handle.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest("button, a")) return;
    event.preventDefault();
    const popup = pricePopup;
    const bounds = popup.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    popup.style.left = `${bounds.left}px`;
    popup.style.top = `${bounds.top}px`;
    popup.style.right = "auto";
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = (move) => {
      const left = Math.min(Math.max(0, bounds.left + move.clientX - startX), Math.max(0, innerWidth - popup.offsetWidth));
      const top = Math.min(Math.max(0, bounds.top + move.clientY - startY), Math.max(0, innerHeight - popup.offsetHeight));
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; };
  };
}

function priceText(value) {
  return `${value.toFixed(1)} C`;
}

function refreshPricePopup() {
  if (!pricePopup) return;
  const node = app.graph?.getNodeById?.(Number(pricePopup.dataset.nodeId));
  if (node?.type !== NODE_ID) {
    closePricePopup();
    return;
  }
  const { spec } = selected(node);
  const route = String(field(node, "execution_provider", "Comfy"));
  const quote = comfyQuote(node, spec);
  const estimateInfo = estimate(node, spec);
  const observed = observedCost(node, spec, route);
  const directRef = directReference(node, spec, route);
  const published = publicReference(spec, route);
  const resolutionNotice = directResolutionNotice(node, spec, route);
  const duration = Number(field(node, "duration", 5));
  const resolution = String(field(node, "resolution", ""));
  const ratio = String(field(node, "ratio", ""));
  const sameRunWithoutCredits = node.properties?.soylabActualCredits == null
    && node.properties?.soylabActualSignature === priceSignature(node, spec || {}, route)
    && node.properties?.soylabActualModel === spec?.model_id && node.properties?.soylabActualProvider === route;
  const actualCredits = node.properties?.soylabActualCredits;
  const actualForSelection = actualCredits != null && Number.isFinite(Number(actualCredits))
    && node.properties?.soylabActualSignature === priceSignature(node, spec || {}, route)
    && node.properties?.soylabActualModel === spec?.model_id && node.properties?.soylabActualProvider === route;
  const signature = JSON.stringify([routerLocale(app), priceSignature(node, spec || {}, route), node.properties?.soylabActualCredits, directRef?.rateText]);
  if (pricePopup.dataset.signature === signature) return;
  pricePopup.dataset.signature = signature;
  pricePopup.replaceChildren();

  const line = (tag, className, value) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  };
  const heading = line("div", "soylab-price-heading", tr("costTitle"));
  const close = line("button", "soylab-price-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", tr("costClose"));
  close.onclick = closePricePopup;
  const top = line("div", "soylab-price-top", "");
  top.append(heading, close);
  makePricePopupDraggable(top);
  pricePopup.append(top);
  if (!spec) {
    pricePopup.append(line("p", "soylab-price-note", tr("pickModel")));
    return;
  }
  pricePopup.append(line("div", "soylab-price-model", modelLabel(spec)));
  const settings = [resolution, (spec.output === "VIDEO" || spec.dual_output && (field(node, "generation_type") || field(node, "type")) === "video") ? tr("seconds", { seconds: duration }) : "", ratio].filter(Boolean).join(" · ");
  if (settings) pricePopup.append(line("div", "soylab-price-settings", settings));
  const selectedRate = actualForSelection
    ? tr("actualInline", { credits: priceText(Number(actualCredits)) })
    : sameRunWithoutCredits
    ? tr("actualUnavailable")
    : route !== "Comfy" && observed
    ? tr("recent", { credits: priceText(observed.credits) })
    : route !== "Comfy" && directRef
      ? tr("directSelected", { usd: directRef.totalText, credits: directRef.creditTotalText })
    : resolutionNotice
      ? resolutionNotice
    : published
      ? tr("directPublishedSelected", { label: published.label })
    : route === "Comfy" && Number.isFinite(quote?.perSecond)
    ? tr("perSecond", { rate: priceText(quote.perSecond) })
    : route === "Comfy" && Number.isFinite(estimateInfo.estimatedCredits)
      ? tr("perRun", { rate: priceText(estimateInfo.estimatedCredits) })
      : route === "Comfy" && spec.pricing?.comfy_reference
        ? comfyReferenceLabel(spec)
        : tr("preRunUnavailable");
  pricePopup.append(line("div", "soylab-price-selected", tr("route", { route, rate: selectedRate })));
  if (route !== "Comfy" && quote) {
    pricePopup.append(line("div", "soylab-price-baseline", tr("comfyBaseline", { credits: `${priceText(quote.total)}${quote.maxTotal == null ? "" : `–${priceText(quote.maxTotal)}`}` })));
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const key of ["providers", "published", "usedOrConverted"]) headRow.append(line("th", "", tr(key)));
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
    const publicRate = publicReference(spec, provider);
    const outsideNotice = directResolutionNotice(node, spec, provider);
    const outsideSource = pricing.models?.[spec.model_id]?.[provider];
    const rate = known && Number.isFinite(quote.perSecond) ? tr("comfyRate", { rate: priceText(quote.perSecond) }) : estimated ? tr("comfyRun", { rate: priceText(estimateInfo.estimatedCredits) }) : provider === "Comfy" && spec.pricing?.comfy_reference ? `Comfy ${comfyReferenceLabel(spec)}` : outside ? tr("directRate", { scope: outside.rangeScope || tr("directRateLabel"), rate: outside.rateText, total: outside.totalText }) : outsideNotice || (publicRate ? tr("directPublicRate", { label: publicRate.label }) : tr("noPublicReference"));
    const total = known
      ? tr("approx", { value: quote.maxTotal == null ? priceText(quote.total) : `${priceText(quote.total)}–${priceText(quote.maxTotal)}` })
      : estimated ? tr("approx", { value: priceText(estimateInfo.estimatedCredits) }) : recent ? tr("recent", { credits: priceText(recent.credits) }) : outside ? tr("directCreditReference", { credits: outside.creditTotalText }) : tr("routerAfterRun");
    row.append(line("td", "", provider));
    const rateCell = line("td", "", rate);
    const noteSource = routeResolutionNote(spec, provider, resolution)?.source;
    if ((outside || outsideNotice || publicRate) && (noteSource || outsideSource?.source || publicRate?.source)) {
      const link = document.createElement("a");
      link.href = noteSource || outsideSource?.source || publicRate.source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " ↗";
      link.title = noteSource ? tr("sourceResolution") : tr("sourceDirect", { date: outsideSource?.checked_at || publicRate?.checked_at });
      rateCell.append(link);
    }
    row.append(rateCell, line("td", "", total));
    body.append(row);
  }
  table.append(body);
  pricePopup.append(table);
  const actual = node.properties?.soylabActualCredits;
  if (actual != null && node.properties?.soylabActualSignature === priceSignature(node, spec, route)) {
    pricePopup.append(line("div", "soylab-price-actual", tr("actual", { credits: priceText(Number(actual)) })));
  }
  pricePopup.append(line("p", "soylab-price-note", tr("costMethod", { date: pricing.updated_at || tr("recentDate"), conversion: COMFY_CREDITS_PER_USD })));
  if (directRef?.note) pricePopup.append(line("p", "soylab-price-note", tr(directRef.tokenEstimate ? "tokenNote" : "rangeNote", { provider: route })));
  const pricingLink = document.createElement("a");
  pricingLink.href = "https://docs.comfy.org/tutorials/partner-nodes/pricing";
  pricingLink.target = "_blank";
  pricingLink.rel = "noopener noreferrer";
  pricingLink.textContent = tr("officialPricing");
  pricePopup.append(pricingLink, document.createTextNode("  ·  "));
  const source = document.createElement("a");
  source.href = "https://docs.comfy.org/development/comfy-router/reference";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = tr("routerPricing");
  pricePopup.append(source, document.createTextNode("  ·  "));
  const conversion = document.createElement("a");
  conversion.href = "https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy";
  conversion.target = "_blank";
  conversion.rel = "noopener noreferrer";
  conversion.textContent = tr("creditsGuide");
  pricePopup.append(conversion);
}

function openPricePopup(node) {
  closePricePopup();
  pricePopup = document.createElement("aside");
  pricePopup.className = "soylab-price-popup";
  pricePopup.dataset.nodeId = String(node.id);
  pricePopup.setAttribute("aria-label", tr("costAria"));
  document.body.append(pricePopup);
  pricePopupObserver = new ResizeObserver(([entry]) => {
    if (pricePopup !== entry.target) return;
    const width = entry.contentRect.width;
    pricePopup.style.setProperty("--soylab-popup-font", `${Math.min(21, Math.max(14, width / 40))}px`);
  });
  pricePopupObserver.observe(pricePopup);
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

function attachPromptResize(node, textarea) {
  if (textarea?.tagName !== "TEXTAREA" || !textarea.isConnected) return;
  const wrapper = textarea.parentElement;
  const existingGrip = wrapper?.querySelector(":scope > .soylab-prompt-grip");
  if (existingGrip) {
    existingGrip.setAttribute("aria-label", tr("promptResizeAria"));
    existingGrip.title = tr("promptResize");
    return;
  }
  if (!wrapper) return;
  const row = textarea.closest(".lg-node-widget") || wrapper;
  const savedHeight = Number(node.properties?.soylabPromptHeight);
  if (Number.isFinite(savedHeight) && savedHeight >= 96) {
    textarea.style.height = `${savedHeight}px`;
  }
  row.style.minHeight = "96px";
  wrapper.style.position = "relative";
  textarea.style.resize = "none";
  textarea.style.overflowY = "auto";
  const grip = document.createElement("span");
  grip.className = "soylab-prompt-grip";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", tr("promptResizeAria"));
  grip.title = tr("promptResize");
  wrapper.append(grip);
  grip.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const scale = app.canvas?.ds?.scale || 1;
    const initialHeight = textarea.offsetHeight;
    const initialRowHeight = row.offsetHeight;
    const initialNodeHeight = node.size?.[1] || 0;
    grip.setPointerCapture(event.pointerId);
    grip.onpointermove = (move) => {
      const height = Math.max(96, Math.round(initialHeight + (move.clientY - startY) / scale));
      const delta = height - initialHeight;
      textarea.style.height = `${height}px`;
      row.style.height = `${Math.max(height, initialRowHeight + delta)}px`;
      node.setSize?.([node.size[0], Math.max(160, initialNodeHeight + delta)]);
      node.setDirtyCanvas?.(true, true);
    };
    grip.onpointerup = grip.onpointercancel = () => {
      grip.onpointermove = null;
      node.properties ||= {};
      node.properties.soylabPromptHeight = textarea.offsetHeight;
      queueVueSync(node.id);
    };
  };
}

function syncVueNode(id) {
  const node = app.graph?.getNodeById?.(Number(id));
  if (node?.type !== NODE_ID) return;
  const host = [...document.querySelectorAll("[data-node-id]")].find((element) => element.dataset.nodeId === id);
  const header = host?.querySelector(".lg-node-header");
  if (!header) return;
  syncKeyPlaceholder(node, host);
  if (!host.classList.contains("soylab-router-vue")) host.classList.add("soylab-router-vue");
  header.style.setProperty("background", HEADER_GRADIENT, "important");
  header.style.setProperty("color", "#fff", "important");
  host.querySelector(".bg-component-node-background")?.style.setProperty("background-color", BODY_BG, "important");
  host.querySelector('[data-testid="advanced-inputs-button"]')?.style.setProperty("background-color", FOOTER_BG, "important");
  attachPromptResize(node, host.querySelector('textarea[aria-label="prompt"]') || host.querySelector(".lg-node-widget textarea"));
  const costButton = host.querySelector("button.soylab-cost-button") || [...host.querySelectorAll("button")].find((button) => ["Router 공급자별 비용 확인", "Compare Router provider costs", "Router の供給元別料金を比較", "比较 Router 各供应商费用"].includes(button.textContent.trim()));
  if (costButton) {
    costButton.classList.add("soylab-cost-button");
    if (costButton.textContent.trim() !== tr("costButton")) costButton.textContent = tr("costButton");
  }
  const searchButton = host.querySelector("button.soylab-model-search-button")
    || [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === tr("modelSearch"));
  if (searchButton) {
    searchButton.classList.add("soylab-model-search-button");
    if (searchButton.textContent.trim() !== tr("modelSearch")) searchButton.textContent = tr("modelSearch");
  }
  const keyButton = host.querySelector("button.soylab-key-button") || [...host.querySelectorAll("button")].find((button) => keyLabels.includes(button.textContent.trim()));
  if (keyButton) {
    keyButton.classList.add("soylab-key-button");
    if (keyButton.textContent.trim() !== keyButtonLabel()) keyButton.textContent = keyButtonLabel();
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
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    badge.onclick = (event) => { event.stopPropagation(); openPricePopup(node); };
    badge.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPricePopup(node); }
    };
    badge.onpointermove = (event) => showPriceTooltip(badge.dataset.fullLabel, event);
    badge.onpointerleave = hidePriceTooltip;
    badge.onblur = hidePriceTooltip;
    header.firstElementChild?.append(badge);
  }
  const { spec } = selected(node);
  const price = estimate(node, spec);
  const label = [price.provider, price.comfy].filter(Boolean).join("  |  ");
  if (badge.textContent !== label) badge.textContent = label;
  badge.dataset.fullLabel = label;
  badge.setAttribute("aria-label", label);
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
    const published = publicReference(spec, route);
    const resolutionNotice = directResolutionNotice(node, spec, route);
    const sameRunWithoutCredits = node.properties?.soylabActualCredits == null
      && node.properties?.soylabActualSignature === priceSignature(node, spec || {}, route)
      && node.properties?.soylabActualModel === spec?.model_id && node.properties?.soylabActualProvider === route;
    const rate = sameRunWithoutCredits
      ? tr("actualUnavailable")
      : route === "Comfy" && Number.isFinite(quote?.perSecond)
        ? tr("comfyRateHint", { credits: priceText(quote.perSecond) })
      : route === "Comfy" && quote
        ? tr("comfyRunHint", { credits: priceText(quote.total) })
      : route === "Comfy" && spec?.pricing?.comfy_reference
        ? tr("comfyReferenceHint", { label: comfyReferenceLabel(spec) })
      : route !== "Comfy" && observed
        ? tr("recentHint", { provider: route, credits: priceText(observed.credits) })
        : route !== "Comfy" && directRef
          ? tr("directHint", { provider: route, rate: directRef.rateText, seconds: directRef.duration, credits: directRef.creditTotalText, scope: directRef.rangeScope ? ` · ${directRef.rangeScope}` : "" })
        : resolutionNotice
          ? tr("resolutionHint", { notice: resolutionNotice })
        : published
          ? tr("publishedHint", { provider: route, label: published.label })
        : route !== "Comfy" && quote
          ? tr("baselineHint", { provider: route, credits: priceText(quote.total) })
          : tr("unknownHint", { provider: route });
    const soleRoute = route === "Comfy" && !spec?.alternates?.length;
    const message = soleRoute ? tr("soleRoute", { rate, maker: spec.service }) : rate;
    if (hint.textContent !== message) hint.textContent = message;
  }

  const kinds = ["IMAGE", "VIDEO", "AUDIO"];
  const slots = host.querySelectorAll(".lg-slot--output");
  kinds.forEach((kind, index) => {
    const slot = slots[index];
    const text = slot?.querySelector("span.truncate");
    if (!text) return;
    const supported = spec?.output === kind || (spec?.dual_output && kind === "VIDEO");
    slot.classList.toggle("soylab-unsupported-output", !supported);
    const wanted = supported ? tr(`output${kind[0]}${kind.slice(1).toLowerCase()}`) : "";
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
    .soylab-price-tooltip {
      position: fixed; z-index: 100001; pointer-events: none;
      max-width: min(520px, calc(100vw - 16px)); padding: 9px 12px;
      border: 1px solid #a788c7; border-radius: 9px;
      background: #21182b; color: #fff; box-shadow: 0 8px 24px #0009;
      font: 13px/1.4 Inter, Arial, sans-serif; white-space: normal;
      overflow-wrap: anywhere;
    }
    .soylab-model-search {
      position: fixed; z-index: 100002; top: max(48px, 8vh); left: 50%;
      transform: translateX(-50%); width: min(540px, calc(100vw - 24px));
      max-height: min(620px, 78vh); display: flex; flex-direction: column;
      padding: 12px; border: 1px solid #765ca0; border-radius: 14px;
      background: #21192c; color: #fff; box-shadow: 0 18px 50px #000a;
      font: 14px/1.4 Inter, Arial, sans-serif;
    }
    .soylab-model-search input {
      box-sizing: border-box; width: 100%; padding: 12px;
      border: 1px solid #8066a5; border-radius: 9px;
      background: #332b3e; color: #fff; outline: none;
    }
    .soylab-model-search-list { overflow-y: auto; margin-top: 8px; }
    .soylab-model-search-list button {
      display: block; width: 100%; padding: 10px 12px; border: 0;
      border-radius: 7px; background: transparent; color: #fff;
      text-align: left; cursor: pointer;
    }
    .soylab-model-search-list button:hover, .soylab-model-search-list button:focus {
      background: #422670;
    }
    .soylab-router-vue .soylab-provider-rate {
      grid-column: 1 / -1; margin: -2px 12px 4px; color: #dcc5f2;
      font-size: 10px; line-height: 1.35;
    }
    .soylab-router-vue .soylab-unsupported-value { color: ${CORAL} !important; }
    .soylab-router-vue .soylab-unsupported-output { display: none !important; }
    .soylab-prompt-grip {
      position: absolute; right: 4px; bottom: 4px; z-index: 3;
      width: 24px; height: 24px; cursor: ns-resize; touch-action: none;
      border-radius: 5px; background: rgba(35, 23, 50, .75);
    }
    .soylab-prompt-grip::after {
      content: ""; position: absolute; right: 5px; bottom: 5px;
      width: 12px; height: 12px;
      border-right: 2px solid #c9a8ed; border-bottom: 2px solid #c9a8ed;
    }
    .soylab-prompt-grip:hover { background: #513071; }
    .soylab-price-popup {
      position: fixed; z-index: 100000; top: 72px; right: 24px;
      width: min(720px, calc(100vw - 32px)); height: min(560px, calc(100vh - 96px));
      min-width: min(360px, calc(100vw - 16px)); min-height: 240px;
      max-width: calc(100vw - 8px); max-height: calc(100vh - 8px);
      resize: both; overflow: auto; box-sizing: border-box; padding: 18px;
      border: 1px solid #9262ca; border-radius: 12px;
      background: #241530; color: #f8f3ff; box-shadow: 0 18px 52px #0009;
      font: var(--soylab-popup-font, 15px)/1.45 Inter, Arial, sans-serif;
    }
    .soylab-price-popup .soylab-price-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: move; touch-action: none; }
    .soylab-price-popup .soylab-price-heading { font-size: 1.2em; font-weight: 700; }
    .soylab-price-popup .soylab-price-close { border: 0; background: transparent; color: #fff; font-size: 1.6em; cursor: pointer; }
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
  node._soylabBadgeBounds = [width - textWidth - 7, y + 5, textWidth, titleHeight - 10];
  node._soylabBadgeLabel = label;
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
    const name = (spec?.output === kind || (spec?.dual_output && kind === "VIDEO")) ? tr(`output${kind[0]}${kind.slice(1).toLowerCase()}`) : "";
    const color = (spec?.output === kind || (spec?.dual_output && kind === "VIDEO")) ? "#BB7BFF" : BODY_BG;
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
  const previousMouseMove = node.onMouseMove;
  node.onMouseMove = function (event, localPosition, ...args) {
    const result = previousMouseMove?.call(this, event, localPosition, ...args);
    const x = Array.isArray(localPosition) ? localPosition[0] : event.canvasX - this.pos[0];
    const y = Array.isArray(localPosition) ? localPosition[1] : event.canvasY - this.pos[1];
    const [left, top, width, height] = this._soylabBadgeBounds || [];
    if (x >= left && x <= left + width && y >= top && y <= top + height) {
      showPriceTooltip(this._soylabBadgeLabel, event);
    } else {
      hidePriceTooltip();
    }
    return result;
  };
  const previousMouseLeave = node.onMouseLeave;
  node.onMouseLeave = function (...args) {
    hidePriceTooltip();
    return previousMouseLeave?.apply(this, args);
  };
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
    for (const button of this.widgets || []) {
      if (button._soylabKeyButton) button.name = keyButtonLabel();
      if (button._soylabPriceButton) button.name = tr("costButton");
    }
    syncKeyPlaceholder(this);
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
      ctx.fillText(tr("keyHelp"), 14, y + 13, width - 24);
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
  const button = node.addWidget("button", tr("costButton"), null, () => openPricePopup(node));
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

function addModelSearchButton(node) {
  if (node.widgets?.some((item) => item._soylabModelSearchButton)) return;
  const button = node.addWidget("button", tr("modelSearch"), null, () => openModelSearch(node));
  button._soylabModelSearchButton = true;
  button.serialize = false;
  const index = node.widgets.indexOf(button);
  const modelIndex = node.widgets.findIndex((item) => item.name === "model");
  if (index >= 0 && modelIndex >= 0) {
    node.widgets.splice(index, 1);
    node.widgets.splice(modelIndex, 0, button);
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
    window.alert(tr("keyError", { error: error.message }));
  } finally {
    await refreshKeyFileStatus();
  }
}

function addKeyButton(node) {
  if (node.widgets?.some((item) => item._soylabKeyButton)) return;
  const button = node.addWidget("button", keyButtonLabel(), null, openApiKeyFile);
  button._soylabKeyButton = true;
  button.serialize = false;
  const current = node.widgets.indexOf(button);
  const help = node.widgets.findIndex((item) => item.name === "soylab_key_help");
  if (current >= 0 && help >= 0) {
    node.widgets.splice(current, 1);
    node.widgets.splice(help + 1, 0, button);
  }
}

app.registerExtension({
  name: "soylab.comfy.router",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const configure = nodeType.prototype.configure;
    nodeType.prototype.configure = function (info) {
      const incoming = captureIncomingLinks(this, info);
      const result = configure.call(this, info);
      restoreModelWidgetValues(this, info);
      restoreIncomingLinks(this, info, incoming);
      return result;
    };
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = created?.apply(this, args);
      this.color = HEADER_PURPLE;
      this.bgcolor = BODY_BG;
      this.title = TITLE;
      addKeyHelp(this);
      addKeyButton(this);
      addPriceButton(this);
      addModelSearchButton(this);
      installSelectionWatch(this);
      setTimeout(() => {
        updateOutputLabels(this);
        const promptWidget = this.widgets?.find((item) => item.name === "model.prompt" || item.name === "service.model.version.prompt");
        const input = promptWidget?.inputEl;
        attachPromptResize(this, input?.tagName === "TEXTAREA" ? input
          : input?.querySelector?.("textarea") || promptWidget?.element?.querySelector?.("textarea"));
        queueVueSync(this.id);
      }, 0);
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
  const { spec } = selected(node);
  if (spec?.model_id === cost.model_id && field(node, "execution_provider", "Comfy") === cost.provider) {
    node.properties.soylabActualSignature = priceSignature(node, spec, cost.provider);
    rememberCost(node, spec, cost.provider, cost.credits);
  }
  node.setDirtyCanvas?.(true, true);
  queueVueSync(node.id);
});

refreshKeyFileStatus();
window.addEventListener("focus", refreshKeyFileStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshKeyFileStatus();
});

let activeLocale = routerLocale(app);
setInterval(() => {
  const next = routerLocale(app);
  if (next === activeLocale) return;
  activeLocale = next;
  syncKeyButtons();
  for (const node of app.graph?._nodes || []) if (node.type === NODE_ID) {
    const search = node.widgets?.find((item) => item._soylabModelSearchButton);
    if (search) search.name = tr("modelSearch");
    node.setDirtyCanvas?.(true, true);
    queueVueSync(node.id);
  }
  refreshPricePopup();
}, 1000);
