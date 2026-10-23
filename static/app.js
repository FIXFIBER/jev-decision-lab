const HISTORY_KEY = "decisionLab.history.v7.shared";
const WORKSPACE_KEY = "decisionLab.workspace.v4.shared";
const ACTIVE_MODEL_KEY = "decisionLab.activeModel.v2";
const THEME_KEY = "decisionLab.theme";
const INPUT_MODE_KEY = "decisionLab.inputMode.v2";
const HISTORY_LIMIT = 80;
const CUSTOM_PRESETS_KEY = "decisionLab.customPresets.v1";

let sessionToken = "";
let providers = {};
let serverProviderIds = new Set();
let currentProvider = "";
let currentResponses = {};
let currentPayloads = {};
let currentQuestions = {};
let history = loadHistory();
let currentInputMode = normalizeStoredInputMode(localStorage.getItem(INPUT_MODE_KEY));
let runInFlight = false;
const activeRuns = new Map();
let comparisonBatch = null;
let runSerial = 0;
let runTimer = null;
let restoringWorkspace = false;
let settingsDrafts = [];
let settingsActiveTab = "models";
let focusBeforeModal = null;
let advancedProviderId = "";
let stateCanonical = "";
let stateFieldsKind = "object";
let stateViewDirty = {text:false, fields:false, json:false};
let requestJsonSyncTimer = null;
let syncingRequestJson = false;
let requestJsonUserDirty = false;
let customPresets = loadCustomPresets();
let whatIfBaseline = null;
let whatIfVariant = null;
let shareMode = "export";
let pendingImport = null;
let distributionPreference = null;
let whatIfExpandPreference = null;

const els = {
  brandSubtitle: document.querySelector("#brandSubtitle"),
  modelSelect: document.querySelector("#modelSelect"),
  modelSelectWrap: document.querySelector(".model-select-wrap"),
  activeModelDot: document.querySelector("#activeModelDot"),
  modelSettings: document.querySelector("#modelSettingsBtn"),
  themeToggle: document.querySelector("#themeToggleBtn"),
  modelSettingsModal: document.querySelector("#modelSettingsModal"),
  closeModelSettings: document.querySelector("#closeModelSettingsBtn"),
  modelSettingsList: document.querySelector("#modelSettingsList"),
  modelTemplateSelect: document.querySelector("#modelTemplateSelect"),
  comparisonModelList: document.querySelector("#comparisonModelList"),
  usageModelList: document.querySelector("#usageModelList"),
  advancedProviderSelect: document.querySelector("#advancedProviderSelect"),
  advancedProviderEditor: document.querySelector("#advancedProviderEditor"),
  settingsTabs: [...document.querySelectorAll("[data-settings-tab]")],
  settingsViews: [...document.querySelectorAll("[data-settings-view]")],
  addModel: document.querySelector("#addModelBtn"),
  reloadModels: document.querySelector("#reloadModelsBtn"),
  saveModels: document.querySelector("#saveModelsBtn"),

  state: document.querySelector("#stateInput"),
  jsonState: document.querySelector("#jsonStateInput"),
  inputExample: document.querySelector("#inputExample"),
  inputModeButtons: [...document.querySelectorAll("[data-input-mode]")],
  textInputMode: document.querySelector("#textInputMode"),
  fieldsInputMode: document.querySelector("#fieldsInputMode"),
  jsonInputMode: document.querySelector("#jsonInputMode"),
  stateFields: document.querySelector("#stateFields"),
  addStateField: document.querySelector("#addStateFieldBtn"),

  decisionList: document.querySelector("#decisionList"),
  decisionTemplate: document.querySelector("#decisionTemplate"),
  blankBuilder: document.querySelector("#blankBuilder"),
  preset: document.querySelector("#presetSelect"),
  newBlank: document.querySelector("#newBlankBtn"),
  customPresetsGroup: document.querySelector("#customPresetsGroup"),
  savePreset: document.querySelector("#savePresetBtn"),
  deletePreset: document.querySelector("#deletePresetBtn"),
  presetSaveModal: document.querySelector("#presetSaveModal"),
  presetNameInput: document.querySelector("#presetNameInput"),
  closePresetSave: document.querySelector("#closePresetSaveBtn"),
  cancelPresetSave: document.querySelector("#cancelPresetSaveBtn"),
  confirmPresetSave: document.querySelector("#confirmPresetSaveBtn"),
  importExperiment: document.querySelector("#importExperimentBtn"),
  exportExperiment: document.querySelector("#exportExperimentBtn"),
  importFile: document.querySelector("#importExperimentFile"),
  shareModal: document.querySelector("#shareModal"),
  shareTitle: document.querySelector("#shareTitle"),
  shareSummary: document.querySelector("#shareSummary"),
  shareError: document.querySelector("#shareError"),
  includeResultsWrap: document.querySelector("#includeResultsWrap"),
  includeResults: document.querySelector("#includeResultsCheck"),
  importConnectionsWrap: document.querySelector("#importConnectionsWrap"),
  importConnections: document.querySelector("#importConnectionsCheck"),
  closeShare: document.querySelector("#closeShareBtn"),
  cancelShare: document.querySelector("#cancelShareBtn"),
  confirmShare: document.querySelector("#confirmShareBtn"),

  requestJsonEditor: document.querySelector("#requestJsonEditor"),
  requestJsonSyncState: document.querySelector("#requestJsonSyncState"),
  editorTabs: [...document.querySelectorAll("[data-editor-tab]")],
  editorViews: {form:document.querySelector("#formEditorView"), json:document.querySelector("#jsonEditorView")},

  run: document.querySelector("#runBtn"),
  runText: document.querySelector("#runBtnText"),
  runCompare: document.querySelector("#runCompareBtn"),
  runCompareText: document.querySelector("#runCompareBtnText"),
  spinner: document.querySelector("#runSpinner"),
  runState: document.querySelector("#runStateBadge"),
  elapsed: document.querySelector("#elapsedTimer"),
  runningCount: document.querySelector("#runningCount"),
  validation: document.querySelector("#validationMessage"),
  activeRuns: document.querySelector("#activeRuns"),
  callInfoBar: document.querySelector("#callInfoBar"),

  readyDot: document.querySelector("#readyDot"),
  readyText: document.querySelector("#readyText"),
  predictionCount: document.querySelector("#predictionCount"),
  tokenCount: document.querySelector("#tokenCount"),
  costTotal: document.querySelector("#costTotal"),
  averageLatency: document.querySelector("#averageLatency"),

  inferenceLabel: document.querySelector("#inferenceLabel"),
  inferenceTiming: document.querySelector("#inferenceTiming"),
  totalTiming: document.querySelector("#totalTiming"),
  emptyResults: document.querySelector("#emptyResults"),
  emptyResultsCopy: document.querySelector("#emptyResultsCopy"),
  outputTitle: document.querySelector("#outputTitle"),
  outputModelBadge: document.querySelector("#outputModelBadge"),
  toggleDistributions: document.querySelector("#toggleDistributionsBtn"),
  resultCards: document.querySelector("#resultCards"),
  rawRequestJson: document.querySelector("#rawRequestJson"),
  rawResponseJson: document.querySelector("#rawResponseJson"),
  pythonRequestCode: document.querySelector("#pythonRequestCode"),
  copyRawRequest: document.querySelector("#copyRawRequestBtn"),
  copyRawResponse: document.querySelector("#copyRawResponseBtn"),
  copyPython: document.querySelector("#copyPythonBtn"),
  whatIfBaseline: document.querySelector("#whatIfBaselineBtn"),
  whatIfRun: document.querySelector("#whatIfRunBtn"),
  whatIfClear: document.querySelector("#whatIfClearBtn"),
  whatIfStatus: document.querySelector("#whatIfStatus"),
  whatIfChanges: document.querySelector("#whatIfChanges"),
  whatIfDiff: document.querySelector("#whatIfDiff"),
  compareContent: document.querySelector("#compareContent"),
  historyList: document.querySelector("#historyList"),
  clearHistory: document.querySelector("#clearHistoryBtn"),
};

function normalizeStoredInputMode(value) {
  if (value === "fields" || value === "json" || value === "text") return value;
  return value === "raw" ? "text" : "text";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function cloneJsonValue(value) {
  if (value === undefined) return "";
  return JSON.parse(JSON.stringify(value));
}

function loadCustomPresets() {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function saveCustomPresets() {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(customPresets));
}

function refreshCustomPresetOptions() {
  if (!els.customPresetsGroup) return;
  els.customPresetsGroup.innerHTML = "";
  for (const preset of customPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    els.customPresetsGroup.appendChild(option);
  }
  els.customPresetsGroup.hidden = customPresets.length === 0;
  updateDeletePresetButton();
}

function updateDeletePresetButton() {
  const selected = customPresets.find((item) => item.id === els.preset.value);
  els.deletePreset.disabled = !selected;
  els.deletePreset.setAttribute("aria-label", selected ? `Delete preset ${selected.name}` : "Select a saved preset to delete");
}

function resolvePreset(id) {
  if (presets[id]) return presets[id];
  const custom = customPresets.find((item) => item.id === id);
  if (!custom) return null;
  return {
    title: custom.name,
    state: cloneJsonValue(custom.payload.state),
    decisions: questionsToDecisions(custom.payload.questions || {}),
    custom: true,
  };
}

function openPresetSaveModal() {
  const {payload, error} = buildPayload();
  if (!payload) { toast(error); return; }
  els.presetNameInput.value = "";
  focusBeforeModal = document.activeElement;
  els.presetSaveModal.classList.remove("hidden");
  window.setTimeout(() => els.presetNameInput.focus(), 0);
}

function closePresetSaveModal() {
  els.presetSaveModal.classList.add("hidden");
  focusBeforeModal?.focus?.();
}

function confirmSavePreset() {
  const name = els.presetNameInput.value.trim();
  if (!name) { els.presetNameInput.focus(); return; }
  const {payload, error} = buildPayload();
  if (!payload) { toast(error); return; }
  const id = `custom:${slugify(name)}:${Date.now()}`;
  customPresets.unshift({id, name, payload: cloneJsonValue(payload), savedAt: new Date().toISOString()});
  saveCustomPresets();
  refreshCustomPresetOptions();
  els.preset.value = id;
  updateDeletePresetButton();
  closePresetSaveModal();
  saveWorkspace();
  toast(`Saved preset “${name}”`);
}

function deleteSelectedPreset() {
  const selected = customPresets.find((item) => item.id === els.preset.value);
  if (!selected || !window.confirm(`Delete your preset “${selected.name}”? This cannot be undone.`)) return;
  customPresets = customPresets.filter((item) => item.id !== selected.id);
  saveCustomPresets();
  els.preset.value = "";
  refreshCustomPresetOptions();
  saveWorkspace();
  toast(`Deleted preset “${selected.name}”`);
}

function jsonHighlight(value) {
  const json = String(value || "{}");
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
  let output = "", end = 0;
  for (const match of json.matchAll(tokens)) {
    output += escapeHtml(json.slice(end, match.index));
    const token = match[0];
    const kind = token[0] === '"' ? (/^\s*:/.test(json.slice(match.index + token.length)) ? "key" : "string") :
      token === "true" || token === "false" ? "boolean" : token === "null" ? "null" :
      "{}[],:".includes(token) ? "punctuation" : "number";
    output += `<span class="json-${kind}">${escapeHtml(token)}</span>`;
    end = match.index + token.length;
  }
  return output + escapeHtml(json.slice(end));
}

function formatJsonText(raw) {
  try { JSON.parse(raw); } catch { return raw; }
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || [];
  let result = "", depth = 0, previous = "";
  const indent = () => "  ".repeat(depth);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "{" || token === "[") {
      result += token;
      if (tokens[index + 1] !== (token === "{" ? "}" : "]")) { depth += 1; result += `\n${indent()}`; }
    } else if (token === "}" || token === "]") {
      if (previous !== (token === "}" ? "{" : "[")) { depth = Math.max(0, depth - 1); result += `\n${indent()}`; }
      result += token;
    } else if (token === ",") result += `,\n${indent()}`;
    else if (token === ":") result += ": ";
    else result += token;
    previous = token;
  }
  return result;
}

function renderStyledJson(element, value) {
  if (!element) return;
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
  element.dataset.raw = raw || "{}";
  element.innerHTML = jsonHighlight(formatJsonText(raw || "{}"));
}

function renderPythonExample() {
  const provider = activeProvider();
  if (provider?.demo) {
    els.pythonRequestCode.textContent = "# This built-in demo is a local simulation, not an HTTP model.\n# Connect a real endpoint in Settings to see its Python request.";
    return;
  }
  const {payload,error} = buildPayload();
  if (!provider || !payload || requestJsonUserDirty) {
    els.pythonRequestCode.textContent = provider ? `# ${error || "Finish editing the request JSON first."}` : "# Configure a model in Settings first.";
    return;
  }
  const body = upstreamRequestPreview(payload, provider);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `Decision-Lab/${document.querySelector('meta[name="decision-lab-version"]')?.content || "1.0.0"}`,
  };
  const lines = [
    "# Python 3 standard library",
    "import json",
    "import os",
    "from urllib.request import Request, urlopen",
    "",
    `payload = json.loads(${JSON.stringify(JSON.stringify(body))})`,
    "body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(\"utf-8\")",
    `headers = ${JSON.stringify(headers)}`,
  ];
  if (provider.auth_type !== "none") {
    lines.unshift(
      "# Set the API key in your terminal before running:",
      "# Linux/macOS: export SYSTEM_ONE_API_KEY='your-key'",
      "# Windows PowerShell: $env:SYSTEM_ONE_API_KEY='your-key'",
      "# Windows Command Prompt: set SYSTEM_ONE_API_KEY=your-key",
    );
    const header = provider.auth_header || (provider.auth_type === "bearer" ? "Authorization" : "X-API-Key");
    const prefix = provider.auth_prefix ?? (provider.auth_type === "bearer" ? "Bearer " : "");
    lines.push(`headers[${JSON.stringify(header)}] = ${JSON.stringify(prefix)} + os.environ["SYSTEM_ONE_API_KEY"]`);
  }
  lines.push(`request = Request(${JSON.stringify(provider.endpoint)}, data=body, headers=headers, method="POST")`);
  lines.push(`with urlopen(request, timeout=${Number(provider.timeout_seconds || 30)}) as response:`);
  lines.push('    print(response.read().decode("utf-8"))');
  els.pythonRequestCode.textContent = lines.join("\n");
}

function editorValue(input) {
  const original = input?.dataset?.originalJson;
  if (original !== undefined && input.value === JSON.stringify(JSON.parse(original), input instanceof HTMLTextAreaElement ? null : undefined, input instanceof HTMLTextAreaElement ? 2 : undefined)) return JSON.parse(original);
  const value = input?.value ?? "";
  return value.trim() ? value : "";
}

function setEditorValue(input, value) {
  input.value = typeof value === "string" ? value : JSON.stringify(value, input instanceof HTMLTextAreaElement ? null : undefined, input instanceof HTMLTextAreaElement ? 2 : undefined);
  if (typeof value !== "string") input.dataset.originalJson = JSON.stringify(value);
  else delete input.dataset.originalJson;
}

async function copyText(text, successMessage = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(successMessage); }
  catch { toast("Clipboard unavailable"); }
}

const PORTABLE_MODEL_FIELDS = ["id","name","endpoint","model","enabled","compare","status_endpoint","models_endpoint","auth_type","auth_header","auth_prefix","timeout_seconds","max_retries","retry_statuses","preset","input_cost_per_million","output_cost_per_million","pricing_note"];

function portableModel(provider) {
  return Object.fromEntries(PORTABLE_MODEL_FIELDS.filter((field)=>provider[field] !== undefined).map((field)=>[field,cloneJsonValue(provider[field])]));
}

function portableResult(body) {
  const meta = responseMeta(body);
  return {result:{model:body?.result?.model || meta.model || "",answers:cloneJsonValue(responseAnswers(body)),demo:meta.demo === true},meta:{model:meta.model || "",demo:meta.demo === true,request_ms:meta.request_ms ?? null,upstream_status:meta.upstream_status ?? null,usage:meta.usage || null,cost_usd:meta.cost_usd ?? null,fresh:meta.fresh === true}};
}

function credentialPath(value, path = "") {
  if (typeof value === "string") return /(?:apikey_[A-Za-z0-9_-]{20,}|sk-codiv-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{20,})/i.test(value) ? path || "experiment" : null;
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token)$/i.test(key)) return `${path}.${key}`;
    const found = credentialPath(item, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function buildPortableExperiment(includeResults = false) {
  const {payload,error} = buildPayload();
  if (!payload) throw new Error(error);
  const file = {
    format:"decision-lab-experiment",version:1,exportedAt:new Date().toISOString(),
    experiment:{...cloneJsonValue(payload),name:experimentName(),inputMode:currentInputMode},
    configuration:{selectedModelId:currentProvider,theme:document.documentElement.dataset.theme,models:providerList().filter((p)=>!p.demo).map(portableModel)},
  };
  if (includeResults) {
    const responses = {};
    for (const [id,body] of Object.entries(currentResponses)) {
      if (body && payloadSignature(currentPayloads[id]) === payloadSignature(payload)) responses[id] = portableResult(body);
    }
    file.results = {responses};
  }
  if (credentialPath(file)) throw new Error("This experiment contains a credential-like value or secret field. Remove it before sharing.");
  return file;
}

function closeShareModal() {
  els.shareModal.classList.add("hidden");
  pendingImport = null;
  els.importFile.value = "";
  focusBeforeModal?.focus?.();
}

function showShareModal(mode, data = null) {
  shareMode = mode;
  pendingImport = data;
  focusBeforeModal = document.activeElement;
  els.shareTitle.textContent = mode === "export" ? "Export experiment" : "Import experiment";
  els.confirmShare.textContent = mode === "export" ? "Export JSON" : "Import experiment";
  els.includeResultsWrap.classList.toggle("hidden", mode !== "export");
  els.importConnectionsWrap.classList.toggle("hidden", mode !== "import" || !data?.configuration?.models?.length);
  els.includeResults.checked = false;
  els.importConnections.checked = false;
  els.shareError.textContent = "";
  els.shareSummary.textContent = mode === "export" ? "Exports state, decisions, editor preferences, and connection settings. Provider keys are excluded. Choose whether to include completed results." :
    `${data.experiment.name || "Experiment"} · ${decisionTypeSummary(data.experiment.questions)}. ${providerList().some((provider)=>provider.demo) ? "Built-in demos are ready to run" : "Run with a configured model"}; existing saved connections are preserved.`;
  els.shareModal.classList.remove("hidden");
  window.setTimeout(()=>els.confirmShare.focus(),0);
}

async function importExperimentFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("Import file must be 5 MiB or smaller."); return; }
  try {
    const data = JSON.parse(await file.text());
    if (data?.format !== "decision-lab-experiment" || data.version !== 1 || !data.experiment || !data.configuration) throw new Error("This is not a Decision Lab experiment export.");
    if (credentialPath(data)) throw new Error("The import contains a credential-like value or secret field and cannot be opened.");
    if (!data.experiment.questions || typeof data.experiment.questions !== "object" || !Object.keys(data.experiment.questions).length || !("state" in data.experiment)) throw new Error("The experiment needs state and decisions.");
    validateRequestPayload({state:data.experiment.state,questions:data.experiment.questions});
    if (!Array.isArray(data.configuration.models) || data.configuration.models.length > 64) throw new Error("Model configuration is missing or too large.");
    showShareModal("import",data);
  } catch (error) { toast(error.message || "Could not read the import file."); }
}

async function confirmShareAction() {
  try {
    els.shareError.textContent = "";
    if (shareMode === "export") {
      const data = buildPortableExperiment(els.includeResults.checked);
      const blob = new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(data.experiment.name)}-${new Date().toISOString().slice(0,10)}.decision-lab.json`;
      link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      closeShareModal();
      toast("Experiment exported without API keys.");
      return;
    }
    const data = pendingImport;
    if (!data) throw new Error("Choose an experiment file first.");
    validateRequestPayload({state:data.experiment.state,questions:data.experiment.questions});
    if (els.importConnections.checked) {
      const current = providerList().map(portableModel);
      const used = new Set(current.map((item)=>item.id));
      const additions = data.configuration.models.filter((item)=>item && typeof item.id === "string" && !used.has(item.id)).map((item)=>{
        used.add(item.id);
        const clean = portableModel(item);
        if (clean.auth_type && clean.auth_type !== "none") clean.enabled = false;
        return clean;
      });
      if (additions.length) {
        await apiFetch("/api/providers",{method:"PUT",body:JSON.stringify({providers:[...current,...additions]})},{token:true});
        await loadProviders();
      }
    }
    applyRequestPayload({state:data.experiment.state,questions:data.experiment.questions},{keepEditor:false});
    clearWhatIf();
    setInputMode(normalizeStoredInputMode(data.experiment.inputMode),{force:true});
    if (["light","dark"].includes(data.configuration.theme)) applyTheme(data.configuration.theme);
    resetModelResults();
    comparisonBatch = null;
    const imported = data.results?.responses;
    if (imported && typeof imported === "object") {
      const ids = Object.keys(imported).filter((id)=>providers[id] && providers[id].enabled !== false && imported[id]?.result?.answers);
      ids.forEach((id)=>{ currentResponses[id] = imported[id]; currentPayloads[id] = {state:data.experiment.state,questions:data.experiment.questions}; });
      if (ids.length > 1) comparisonBatch = {id:"imported",targets:ids,completed:new Set(ids),stopped:new Set(),failures:[],running:false};
    }
    const selected = data.configuration.selectedModelId;
    if (selected && providers[selected] && providers[selected].enabled !== false) switchProvider(selected);
    currentQuestions = data.experiment.questions;
    renderActiveOutput(); renderModelComparison(); renderWhatIf(); renderHistory(); saveWorkspace();
    activateTab(comparisonBatch ? "compare" : "cards");
    closeShareModal();
    toast(providers["demo-a"] ? "Experiment imported. Run it with a built-in demo." : "Experiment imported. Run it with a configured model.");
  } catch (error) { els.shareError.textContent = error.message || String(error); }
}

function autoGrowTextarea(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  if (textarea.classList.contains("request-json-editor")) return;
  if (!textarea.getClientRects().length) return;
  textarea.style.height = "auto";
  const max = Number(textarea.dataset.maxHeight || (textarea.classList.contains("state-input") ? 280 : 160));
  const needed = textarea.scrollHeight + 2;
  textarea.style.height = `${Math.min(needed, max)}px`;
  textarea.style.overflowY = needed > max ? "auto" : "hidden";
}

function autoGrowWithin(root = document) {
  root.querySelectorAll?.("textarea.auto-grow, .state-field-value").forEach(autoGrowTextarea);
}

function slugify(value) {
  const slug = String(value || "decision")
    .trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "decision";
}

function providerList({enabledOnly = false, compareOnly = false} = {}) {
  return Object.values(providers).filter((p) =>
    (!enabledOnly || p.enabled !== false) && (!compareOnly || p.compare !== false)
  );
}

function providerLabel(id) {
  if (id === "demo-a") return "Demo A · simulated, no AI";
  if (id === "demo-b") return "Demo B · simulated, no AI";
  return providers[id]?.name || id || "Unknown model";
}

let hueCacheKey = "";
let hueCache = new Map();
function providerHue(id) {
  const ids = [...new Set([...Object.keys(providers), ...settingsDrafts.map((draft) => draft.id), id])].filter(Boolean).sort();
  const key = ids.map((modelId) => `${modelId}:${providers[modelId]?.preset || settingsDrafts.find((draft) => draft.id === modelId)?.preset || ""}`).join("\u0000");
  if (key !== hueCacheKey) {
    hueCacheKey = key;
    hueCache = new Map([["jev", 330], ["openjev", 0]]);
    const layaAnchor = ids.includes("laya-local") ? "laya-local" : ids.find((modelId) => modelId === "laya" || providers[modelId]?.preset === "laya" || settingsDrafts.find((draft) => draft.id === modelId)?.preset === "laya");
    if (layaAnchor) hueCache.set(layaAnchor, 48);
    const occupied = [330, 0, 48];
    const candidates = Array.from({length:72}, (_, index) => (index * 137.508) % 360);
    for (const modelId of ids) {
      if (hueCache.has(modelId)) continue;
      const distance = (a, b) => Math.min(Math.abs(a-b), 360-Math.abs(a-b));
      const hue = candidates.reduce((best, candidate) =>
        Math.min(...occupied.map((used) => distance(candidate, used))) > Math.min(...occupied.map((used) => distance(best, used))) ? candidate : best);
      hueCache.set(modelId, Math.round(hue));
      occupied.push(hue);
    }
  }
  return hueCache.get(id) ?? 330;
}

function providerBadgeClass(id) {
  return `model-${String(id || "model").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function providerAccent(id, hue = providerHue(id)) {
  if (id === "jev") return "#e852a8";
  if (id === "laya" || id === "laya-local") return "#ffd54a";
  if (id === "openjev") return "#121417";
  return `hsl(${hue} 72% 58%)`;
}

const MODEL_TEMPLATES = {
  jev: {
    id: "jev",
    name: "Jev",
    preset: "jev",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    status_endpoint: "",
    models_endpoint: "https://api.typesafe.ai/v1/models",
    auth_type: "bearer",
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    timeout_seconds: 30,
    max_retries: 0,
    retry_statuses: [429, 503, 529],
    enabled: true,
    compare: true,
    input_cost_per_million: 0.042,
    output_cost_per_million: 0,
    pricing_note: "TypeSafe published rate: $0.042 / 1M input tokens; output tokens free.",
  },
  openjev: {
    id: "openjev",
    name: "OpenJEV",
    preset: "openjev",
    endpoint: "https://api.codiv.ai/v1/systemone",
    model: "openjev-latest",
    status_endpoint: "",
    models_endpoint: "https://api.codiv.ai/v1/models",
    auth_type: "bearer",
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    timeout_seconds: 60,
    max_retries: 0,
    retry_statuses: [429, 503, 529],
    enabled: true,
    compare: true,
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    pricing_note: "Codiv is currently a free public experiment. Change pricing here if the service changes.",
  },
  laya: {
    id: "laya-local",
    name: "Laya Local",
    preset: "laya",
    endpoint: "http://127.0.0.1:7861/v1/systemone",
    model: "",
    status_endpoint: "http://127.0.0.1:7861/health",
    models_endpoint: "http://127.0.0.1:7861/v1/models",
    auth_type: "none",
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    timeout_seconds: 120,
    max_retries: 0,
    retry_statuses: [429, 503, 529],
    enabled: true,
    compare: true,
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    pricing_note: "Local model; API cost is $0. Hardware/electricity cost is not estimated.",
  },
  custom: {
    id: "custom-model",
    name: "Custom model",
    preset: "custom",
    endpoint: "",
    model: "",
    status_endpoint: "",
    models_endpoint: "",
    auth_type: "none",
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    timeout_seconds: 30,
    max_retries: 0,
    retry_statuses: [429, 503, 529],
    enabled: true,
    compare: false,
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    pricing_note: "",
  },
};

function templateLabel(preset) {
  return preset === "jev" ? "TypeSafe Jev" : preset === "openjev" ? "OpenJEV · Codiv" : preset === "laya" ? "Laya · local" : "Custom endpoint";
}

function makeUniqueId(base) {
  const used = new Set([...Object.keys(providers), ...settingsDrafts.map((d) => d.id)]);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function formatTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return n === 0 ? "0" : "—";
  return new Intl.NumberFormat(undefined, {notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1}).format(n);
}

function formatCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

async function apiFetch(url, options = {}, {token = false} = {}) {
  const headers = new Headers(options.headers || {});
  if (token) {
    if (!sessionToken) await loadSession();
    headers.set("X-Decision-Lab-Token", sessionToken);
  }
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {...options, headers, cache: "no-store"});
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const detail = body?.detail || body?.message;
    const message = Array.isArray(detail) ? detail.map((item) => item?.msg || String(item)).join(" · ") :
      typeof detail === "object" && detail !== null ? JSON.stringify(detail) : detail;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return body;
}

async function loadSession() {
  const body = await apiFetch("/api/session");
  sessionToken = body.token || "";
  if (!sessionToken) throw new Error("Decision Lab session token unavailable.");
}

async function loadProviders({openSettingsIfEmpty = false} = {}) {
  const body = await apiFetch("/api/providers");
  const previousIds = Object.keys(providers);
  providers = Object.fromEntries((body.providers || []).map((p) => [p.id, p]));
  serverProviderIds = new Set(Object.keys(providers));
  const hiddenIds = previousIds.filter((id)=>!providers[id]);
  for (const id of hiddenIds) {
    if (activeRuns.has(id)) stopModelRun(id);
    delete currentResponses[id];
    delete currentPayloads[id];
  }
  if (comparisonBatch?.targets.some((id)=>!providers[id])) comparisonBatch = null;
  if (whatIfBaseline && !providers[whatIfBaseline.providerId]) {
    whatIfBaseline = null;
    whatIfVariant = null;
  }

  const enabled = providerList({enabledOnly: true});
  const saved = localStorage.getItem(ACTIVE_MODEL_KEY);
  if (!currentProvider || !providers[currentProvider] || providers[currentProvider].enabled === false) {
    currentProvider = (saved && providers[saved] && providers[saved].enabled !== false) ? saved : (enabled[0]?.id || "");
  }

  ensureModelResultSlots();
  renderModelSelector();
  applyProviderUi();
  renderActiveOutput();
  renderModelComparison();
  renderWhatIf();
  renderHistory();

  if (!enabled.length && openSettingsIfEmpty) openModelSettings();
}


const presets = {
  "support-triage": {
    title: "Customer support triage",
    summary: "Route a messy customer message, judge urgency, and decide whether a human escalation is warranted.",
    lesson: "This shows a decision model turning one natural-language message into three different decision types at once.",
    tryChanging: "Remove the cancellation threat, change the issue from billing to login, or make the customer fully blocked.",
    state: "I was charged twice for the same annual invoice. I already emailed yesterday, my finance team is waiting, and if this is not fixed today we may cancel the renewal.",
    decisions: [
      { id: "needs_human_escalation", type: "noul", instructions: "Does this request need prompt human escalation rather than ordinary queue handling?" },
      {
        id: "route_to",
        type: "choice",
        instructions: "Which support team should own this request?",
        criteria: {
          billing: "payments, invoices, refunds, taxes, or duplicate charges",
          technical: "bugs, errors, outages, integrations, or product behavior",
          account: "login, access, profile, subscription administration, or permissions",
          sales: "pricing, upgrades, contracts, purchasing, or plan selection",
        },
      },
      { id: "urgency", type: "score", instructions: "How urgent is the customer request?", criteria: ["routine", "soon", "urgent", "critical / blocking"] },
    ],
  },
  "refund-exception": {
    title: "Refund exception review",
    state: {
      request: "Customer asks for a full refund 18 days after a 14-day return window.",
      order: "Annual subscription, $240, first purchase",
      evidence: "Customer reported duplicate billing 3 days ago; payment ledger shows two successful charges for the same order.",
      policy: "Duplicate charges are refunded regardless of the normal return window. Other late requests need specialist review.",
    },
    decisions: [
      { id: "duplicate_charge_supported", type: "noul", instructions: "Does the provided evidence support a duplicate charge rather than merely a late cancellation request?" },
      { id: "next_action", type: "choice", instructions: "What is the appropriate next step under the stated policy?", criteria: {
        refund_duplicate: "refund the extra charge because the evidence supports duplicate billing",
        request_evidence: "ask for missing transaction details before deciding",
        specialist_review: "route a non-duplicate late request to a specialist for policy review",
        deny_request: "deny a clearly ineligible request with no unresolved billing issue",
      } },
      { id: "evidence_strength", type: "score", instructions: "How strong is the evidence for the selected action?", criteria: ["insufficient", "weak", "mixed", "strong", "conclusive"] },
    ],
  },
  "churn-retention": {
    title: "Churn and retention",
    summary: "Turn account signals into a cancellation judgment, intervention choice, and ordered risk level.",
    lesson: "Useful when the decision is not just classification: you can ask whether something is true, what action fits, and how severe it is.",
    tryChanging: "Increase recent usage, remove the competitor mention, or add a successful support resolution and compare the result.",
    state: {
      account_age_months: 18,
      usage_change_30d: "-61%",
      recent_support_tickets: 4,
      customer_message: "The product has become unreliable. We are testing two competitors before our renewal next month.",
    },
    decisions: [
      { id: "churn_likely", type: "noul", instructions: "Is this customer meaningfully likely to cancel or not renew in the near term?" },
      {
        id: "best_intervention",
        type: "choice",
        instructions: "What is the most appropriate retention intervention?",
        criteria: {
          monitor: "no immediate intervention; continue normal account monitoring",
          success_outreach: "customer-success outreach to understand friction and restore value",
          technical_recovery: "prioritize reliability or technical remediation before commercial discussion",
          executive_save: "high-touch retention plan involving senior account ownership or commercial intervention",
        },
      },
      { id: "risk_level", type: "score", instructions: "Rate the overall churn risk.", criteria: ["very low", "low", "moderate", "high", "very high"] },
    ],
  },
  "product-feedback": {
    title: "Product feedback triage",
    summary: "Convert free-form feedback into product theme, impact, and whether product follow-up is needed.",
    lesson: "A practical pattern for tagging feedback without brittle keyword rules.",
    tryChanging: "Make the complaint cosmetic instead of workflow-blocking, or turn it into a feature request rather than a bug.",
    state: "Since the new dashboard shipped, exported CSV files are missing two columns we rely on for month-end reporting. Three analysts are manually reconstructing the data every Friday.",
    decisions: [
      { id: "needs_product_followup", type: "noul", instructions: "Should the product team actively follow up on this feedback?" },
      {
        id: "theme",
        type: "choice",
        instructions: "What is the primary product-feedback theme?",
        criteria: {
          bug: "existing functionality is broken, incorrect, or regressed",
          usability: "the product works but is confusing, slow, or difficult to use",
          feature_request: "the user wants capability that does not currently exist",
          performance: "latency, throughput, resource usage, or responsiveness is the main problem",
        },
      },
      { id: "impact", type: "score", instructions: "How much user impact does this feedback indicate?", criteria: ["minor", "noticeable", "high", "workflow blocking"] },
    ],
  },
  "shipment-exception": {
    title: "Shipment exception handling",
    summary: "Choose an operational response to a delayed shipment and judge communication urgency.",
    lesson: "Shows decision support over an operational event where several reasonable actions exist.",
    tryChanging: "Make the package one day late instead of five, or change the item from medical equipment to a low-value accessory.",
    state: {
      shipment: "EXP-88421",
      promised_delivery: "Monday",
      current_status: "Held at regional hub since Thursday after routing error",
      customer: "Hospital procurement department",
      item: "replacement diagnostic equipment component",
    },
    decisions: [
      { id: "notify_customer_now", type: "noul", instructions: "Should the customer be proactively contacted now?" },
      {
        id: "next_action",
        type: "choice",
        instructions: "What is the best next operational action?",
        criteria: {
          monitor: "continue monitoring without intervention",
          carrier_trace: "open a carrier trace or investigation",
          expedite_replacement: "send a replacement or alternate expedited shipment",
          manual_escalation: "escalate to an operations specialist for coordinated recovery",
        },
      },
      { id: "urgency", type: "score", instructions: "How urgent is this shipment exception?", criteria: ["low", "normal", "urgent", "critical"] },
    ],
  },
  "invoice-exception": {
    title: "Invoice exception routing",
    summary: "Route a finance-operations exception, judge business impact, and detect whether payment is blocked.",
    lesson: "Demonstrates a decision model as a lightweight decision layer around back-office workflows.",
    tryChanging: "Make the PO valid, remove the month-end deadline, or change the problem to a tax mismatch.",
    state: "Invoice INV-4418 for $38,200 was rejected because the purchase-order number does not match the customer's portal. Month-end closes tomorrow and the customer says payment cannot be released until corrected.",
    decisions: [
      { id: "payment_blocked", type: "noul", instructions: "Is the exception currently blocking payment?" },
      {
        id: "owner",
        type: "choice",
        instructions: "Which team should own resolution?",
        criteria: {
          accounts_receivable: "collections, payment receipt, customer remittance, or invoice follow-up",
          billing_operations: "invoice creation, corrections, line items, or billing-system issues",
          sales_operations: "commercial terms, quote/order data, purchase orders, or account ownership",
          tax_finance: "tax treatment, jurisdiction, exemptions, or accounting-policy issues",
        },
      },
      { id: "business_impact", type: "score", instructions: "Rate the business impact if this is not resolved promptly.", criteria: ["minimal", "low", "moderate", "high", "critical"] },
    ],
  },

  "security-alert": {
    title: "Security alert triage",
    summary: "Decide whether compromise is likely, classify an alert, and assign incident severity.",
    lesson: "A good example of using natural-language evidence as state while keeping the decision schema explicit.",
    tryChanging: "Remove credential access, change the binary to a signed internal tool, or add known-good admin context.",
    state: {
      source: "EDR",
      host: "finance-ws-17",
      event: "PowerShell spawned from WINWORD.exe and downloaded an unsigned binary.",
      user: "a.rahman",
      signals: ["macro execution", "new outbound domain", "credential-store access attempt"],
    },
    decisions: [
      { id: "compromise_likely", type: "noul", instructions: "Is endpoint compromise likely based on the available evidence?" },
      {
        id: "disposition",
        type: "choice",
        instructions: "What is the best alert disposition?",
        criteria: {
          benign: "expected or clearly legitimate activity",
          suspicious: "unusual activity requiring investigation but not yet confirmed malicious",
          malicious: "clear malicious behavior requiring containment or response",
        },
      },
      { id: "severity", type: "score", instructions: "How severe is the security incident?", criteria: ["informational", "low", "medium", "high", "critical"] },
    ],
  },
  "fraud-review": {
    title: "Fraud transaction review",
    summary: "Turn transaction context into a fraud judgment, action, and ordered risk assessment.",
    lesson: "Shows how Choice can represent the action while Score captures graduated risk.",
    tryChanging: "Use a long-established account, known device, normal country, or much smaller purchase and rerun.",
    state: {
      amount_usd: 4870,
      merchant_category: "electronics",
      account_age_days: 9,
      device: "new device",
      geography: "first purchase from new country",
      attempts: "6 attempts in 12 minutes",
      prior_chargebacks: 1,
    },
    decisions: [
      { id: "fraud_likely", type: "noul", instructions: "Is this transaction likely fraudulent based on the provided signals?" },
      {
        id: "action",
        type: "choice",
        instructions: "What review action best fits the transaction?",
        criteria: {
          approve: "risk appears normal enough to allow the transaction",
          step_up: "require additional verification before allowing the transaction",
          manual_review: "hold for a human fraud analyst",
          decline: "risk is high enough to block the transaction",
        },
      },
      { id: "risk", type: "score", instructions: "Rate transaction risk.", criteria: ["minimal", "low", "medium", "high", "extreme"] },
    ],
  },
  "phishing-email": {
    title: "Phishing and email safety",
    summary: "Classify an email, estimate risk, and answer a direct phishing question.",
    lesson: "Useful for understanding the difference between a categorical label and a binary decision over the same input.",
    tryChanging: "Replace the credential request with a normal password-expiry notice from a trusted internal domain.",
    state: "From: security-update@example-check.net\nSubject: Action required: mailbox expires today\n\nYour mailbox will be disabled. Sign in immediately using the secure verification link and confirm your password.",
    decisions: [
      { id: "is_phishing", type: "noul", instructions: "Is this email a phishing attempt?" },
      {
        id: "classification",
        type: "choice",
        instructions: "How should this message be classified?",
        criteria: {
          legitimate: "ordinary legitimate email",
          marketing: "promotional or bulk commercial email",
          spam: "unwanted or low-trust bulk email without a clear credential-theft attempt",
          phishing: "attempt to steal credentials, money, or sensitive information through deception",
        },
      },
      { id: "risk", type: "score", instructions: "How risky is this message to a recipient?", criteria: ["safe", "low", "moderate", "high", "critical"] },
    ],
  },
  "account-takeover": {
    title: "Account takeover signals",
    summary: "Assess login telemetry and choose the safest response without relying on one hard-coded rule.",
    lesson: "Shows structured Fields/JSON input particularly well because the state is a set of independent signals.",
    tryChanging: "Make the device trusted, geography normal, and MFA successful to see how the decision shifts.",
    state: {
      login_location: "Romania",
      normal_locations: ["Morocco", "Spain"],
      device: "unseen browser fingerprint",
      password_reset: "27 minutes before login",
      mfa: "three failures followed by SMS success",
      session_behavior: "email forwarding rule created immediately after login",
    },
    decisions: [
      { id: "takeover_likely", type: "noul", instructions: "Is account takeover likely?" },
      {
        id: "response",
        type: "choice",
        instructions: "What is the best immediate account-security response?",
        criteria: {
          allow: "continue the session normally",
          challenge: "require additional authentication or verification",
          revoke_sessions: "terminate active sessions and force reauthentication",
          lock_and_investigate: "temporarily lock access and escalate for security investigation",
        },
      },
      { id: "risk", type: "score", instructions: "Rate account-compromise risk.", criteria: ["very low", "low", "moderate", "high", "very high"] },
    ],
  },
  "content-moderation": {
    title: "Content moderation triage",
    summary: "Evaluate a piece of user content, select a moderation action, and assign severity.",
    lesson: "Demonstrates policy-oriented routing where the model receives both the content and explicit action definitions.",
    tryChanging: "Make the message merely rude, remove the threat, or add clear context that it is fictional dialogue.",
    state: "User post: 'I know where you work. Keep talking and I will come there tonight and make you regret it.'",
    decisions: [
      { id: "policy_violation", type: "noul", instructions: "Does this content plausibly violate a policy against threats of violence?" },
      {
        id: "action",
        type: "choice",
        instructions: "What moderation action best fits the content?",
        criteria: {
          allow: "no meaningful policy violation",
          warn: "borderline or low-severity violation appropriate for a warning",
          remove: "clear violation that should be removed",
          escalate: "credible or severe threat requiring specialist review or escalation",
        },
      },
      { id: "severity", type: "score", instructions: "How severe is the content?", criteria: ["none", "low", "moderate", "high", "severe"] },
    ],
  },

  "ai-task-routing": {
    title: "AI task routing",
    summary: "Route an AI request to an execution path, estimate complexity, and decide whether tools are needed.",
    lesson: "This is a meta-use case: a decision model can sit in front of other AI systems and decide how a task should run.",
    tryChanging: "Replace the debugging task with a one-line rewrite or a simple extraction request.",
    state: "Review this 2,000-line Python service, identify the race condition, propose a patch, run focused tests, and explain possible regressions. Repository context is available; correctness matters more than speed.",
    decisions: [
      { id: "needs_tools", type: "noul", instructions: "Does this task likely require code execution, repository access, search, or another external tool?" },
      {
        id: "execution_path",
        type: "choice",
        instructions: "Which AI execution path best fits this task?",
        criteria: {
          fast_model: "simple transformation, extraction, classification, or short answer",
          standard_model: "normal writing or reasoning with moderate complexity",
          reasoning_model: "complex multi-step reasoning or debugging where correctness is important",
          agentic_workflow: "multi-step work requiring tools, files, browsing, execution, or iterative verification",
        },
      },
      { id: "complexity", type: "score", instructions: "How complex is the requested task?", criteria: ["trivial", "simple", "moderate", "complex", "very complex"] },
    ],
  },
  "release-gate": {
    title: "Release readiness gate",
    state: {
      change: "New checkout tax calculation for three regions",
      tests: "Unit and integration suites pass; end-to-end test for refunds is intermittently failing in staging.",
      rollout: "Flagged rollout planned for 10% of traffic; rollback takes 4 minutes.",
      monitoring: "Tax mismatch alert exists, but the refund path has no dedicated metric.",
      deadline: "Release requested today; no contractual deadline.",
    },
    decisions: [
      { id: "safe_to_roll_out_now", type: "noul", instructions: "Is the release ready for the proposed 10% rollout based on the available evidence?" },
      { id: "primary_blocker", type: "choice", instructions: "What is the most important unresolved release risk?", criteria: {
        failing_test: "intermittently failing or unexplained end-to-end test",
        missing_observability: "insufficient monitoring for a critical changed path",
        rollback: "rollback is too slow, untested, or incomplete",
        none: "no material blocker is evident",
      } },
      { id: "rollout_risk", type: "score", instructions: "Rate the risk of shipping this release now.", criteria: ["minimal", "low", "moderate", "high", "critical"] },
    ],
  },
  "bug-triage": {
    title: "Software bug triage",
    summary: "Turn a bug report into release-blocking judgment, engineering ownership, and severity.",
    lesson: "Shows a decision model working on semi-structured engineering context instead of conversational text only.",
    tryChanging: "Make the bug affect only a cosmetic tooltip or say it occurs only in a deprecated browser.",
    state: {
      title: "Checkout returns 500 after applying store credit",
      environment: "production",
      reproducibility: "8/8 attempts",
      affected_users: "all users with store credit",
      workaround: "remove store credit and retry with card only",
      introduced_after: "release 2026.09.18",
    },
    decisions: [
      { id: "blocks_release", type: "noul", instructions: "Should this bug block the next production release until addressed?" },
      {
        id: "owner",
        type: "choice",
        instructions: "Which engineering area most likely owns first investigation?",
        criteria: {
          checkout_backend: "checkout service, order creation, payment orchestration, server-side failures",
          payments: "payment provider, charging, refunds, card handling, transaction state",
          frontend: "browser UI, client state, rendering, or interaction behavior",
          platform: "shared infrastructure, deployment, database, networking, or platform services",
        },
      },
      { id: "severity", type: "score", instructions: "How severe is this bug?", criteria: ["cosmetic", "minor", "moderate", "major", "critical"] },
    ],
  },
  "code-change-risk": {
    title: "Code-change risk review",
    summary: "Read a change summary and decide if senior review is needed, identify the main risk, and score overall change risk.",
    lesson: "Useful as a pre-review routing layer before expensive automated or human review.",
    tryChanging: "Turn the migration into an additive index-only change, or remove the rollback limitation.",
    state: "PR changes the customer table primary key from integer to UUID, migrates 48M rows online, updates six services, and includes a one-way data backfill. Rollback restores code but cannot automatically restore old IDs.",
    decisions: [
      { id: "needs_senior_review", type: "noul", instructions: "Does this change warrant senior or specialist review before deployment?" },
      {
        id: "primary_risk",
        type: "choice",
        instructions: "What is the primary source of deployment risk?",
        criteria: {
          data_integrity: "data loss, corruption, irreversible migration, or consistency issues",
          compatibility: "cross-service schema/API compatibility or version skew",
          performance: "latency, resource use, lock contention, or throughput degradation",
          operational: "deployment sequencing, observability, rollback, or recovery complexity",
        },
      },
      { id: "change_risk", type: "score", instructions: "Rate the overall deployment risk.", criteria: ["low", "moderate", "high", "very high", "exceptional"] },
    ],
  },
  "data-pipeline": {
    title: "Data pipeline incident",
    summary: "Classify a data failure, decide whether downstream processing should stop, and score impact.",
    lesson: "Shows how a decision model can turn observability context into operational decisions without relying only on fixed numeric thresholds.",
    tryChanging: "Reduce the missing rows to 0.1%, make the source non-critical, or state that automatic replay is available.",
    state: {
      pipeline: "daily_revenue_rollup",
      symptom: "18% of source rows missing after upstream schema change",
      consumers: ["executive dashboard", "billing reconciliation", "forecast model"],
      detected_at: "07:10",
      automatic_recovery: "none",
    },
    decisions: [
      { id: "pipeline_should_stop", type: "noul", instructions: "Should downstream publication be stopped until this issue is resolved?" },
      {
        id: "issue_type",
        type: "choice",
        instructions: "What type of data incident is this primarily?",
        criteria: {
          freshness: "data is late or stale but otherwise expected to be correct",
          completeness: "records or fields are missing",
          correctness: "values are present but wrong or inconsistent",
          schema: "schema or contract changed incompatibly",
        },
      },
      { id: "impact", type: "score", instructions: "How severe is the downstream impact?", criteria: ["minor", "limited", "significant", "major", "critical"] },
    ],
  },
  "observability-alert": {
    title: "Production alert triage",
    summary: "Decide whether to page on-call, select a likely failure area, and score incident severity.",
    lesson: "A compact example of using a decision model as an alert-enrichment and routing layer.",
    tryChanging: "Set error rate to 0.3%, note that only internal traffic is affected, or say the metric recovered after two minutes.",
    state: "Checkout API error rate jumped from 0.2% to 14% after a deployment 11 minutes ago. p95 latency is 4.8s, payment-provider health is normal, and failed requests cluster around inventory reservation timeouts.",
    decisions: [
      { id: "page_oncall", type: "noul", instructions: "Should the primary on-call engineer be paged now?" },
      {
        id: "likely_cause",
        type: "choice",
        instructions: "Which area is the most plausible first investigation target?",
        criteria: {
          application_release: "recent application code or configuration deployment",
          dependency: "external provider or internal downstream dependency",
          database: "database saturation, locking, query failure, or connection problems",
          infrastructure: "compute, network, orchestration, capacity, or host-level issues",
        },
      },
      { id: "severity", type: "score", instructions: "Rate the production incident severity.", criteria: ["minor", "low", "moderate", "high", "critical"] },
    ],
  },

  "document-routing": {
    title: "Document / inbox routing",
    summary: "Route an incoming document, judge priority, and decide whether it needs human review.",
    lesson: "A general-purpose pattern for shared inboxes, forms, documents, and workflow automation.",
    tryChanging: "Turn the document into a normal receipt, remove the legal deadline, or make it an ordinary vendor question.",
    state: "Incoming PDF: Notice of contract breach from a customer. It alleges missed service-level commitments, requests a remediation plan within 5 business days, and cites a right to terminate for cause.",
    decisions: [
      { id: "needs_human_review", type: "noul", instructions: "Should this document receive human review rather than automatic processing only?" },
      {
        id: "department",
        type: "choice",
        instructions: "Which department should receive this document first?",
        criteria: {
          customer_success: "customer relationship, adoption, service concerns, or account coordination",
          finance: "payments, invoices, taxes, accounting, or financial records",
          legal: "contracts, claims, legal notices, compliance obligations, or disputes",
          operations: "service delivery, logistics, process execution, or operational coordination",
        },
      },
      { id: "priority", type: "score", instructions: "How quickly should the organization act on this document?", criteria: ["routine", "normal", "priority", "urgent", "immediate"] },
    ],
  },
  "lead-intent": {
    title: "Inbound lead intent",
    summary: "Interpret an inbound sales message, choose intent category, and judge whether it is ready for direct sales engagement.",
    lesson: "Shows semantic qualification without forcing rigid form fields or keyword lists.",
    tryChanging: "Make the message a student doing research, a support request, or a customer asking only for documentation.",
    state: "We have 220 support agents and want to replace our current ticket-routing system this quarter. Can you send enterprise pricing, SSO requirements, security documentation, and times for a technical evaluation next week?",
    decisions: [
      { id: "sales_ready", type: "noul", instructions: "Is this inquiry ready for direct sales engagement?" },
      {
        id: "intent",
        type: "choice",
        instructions: "What is the primary intent of this inbound message?",
        criteria: {
          research: "general information gathering without clear buying motion",
          product_evaluation: "actively evaluating product fit or technical capability",
          commercial: "pricing, procurement, contract, or purchase discussion",
          support: "existing-user help or troubleshooting rather than buying intent",
        },
      },
      { id: "buying_intent", type: "score", instructions: "How strong is the buying intent?", criteria: ["none", "weak", "developing", "strong", "immediate"] },
    ],
  },
  "task-priority": {
    title: "Project / task prioritization",
    summary: "Decide whether work belongs in the current sprint, route it to a workstream, and assign priority.",
    lesson: "Useful for experimenting with policy-like decisions over unstructured work requests.",
    tryChanging: "Remove the customer impact, make the task purely cosmetic, or add a regulatory deadline.",
    state: "Request: Add retry logic to webhook delivery. Three enterprise customers reported missed events this week, support has a manual replay workaround, and one renewal is blocked pending a reliability plan.",
    decisions: [
      { id: "do_this_sprint", type: "noul", instructions: "Should this work be pulled into the current sprint rather than left in backlog?" },
      {
        id: "workstream",
        type: "choice",
        instructions: "Which workstream should own this request?",
        criteria: {
          reliability: "resilience, retries, fault tolerance, incident prevention, or operational robustness",
          product: "user-facing capability or workflow improvement",
          platform: "shared infrastructure, developer platform, or foundational systems",
          support_enablement: "tooling or workflow primarily intended to help support operations",
        },
      },
      { id: "priority", type: "score", instructions: "How high should this task be prioritized?", criteria: ["low", "normal", "high", "urgent", "top priority"] },
    ],
  },
};


function loadHistory() {
  const keys = [HISTORY_KEY, "decisionLab.history.v6.shared", "decisionLab.history.v5.shared"];
  for (const key of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (Array.isArray(parsed)) {
        if (key !== HISTORY_KEY) localStorage.setItem(HISTORY_KEY, JSON.stringify(parsed.slice(0, HISTORY_LIMIT)));
        return parsed.slice(0, HISTORY_LIMIT);
      }
    } catch { /* ignore */ }
  }
  return [];
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT))); } catch {}
}

function resetModelResults() {
  currentResponses = {};
  currentPayloads = {};
  ensureModelResultSlots();
}

function ensureModelResultSlots() {
  for (const provider of providerList()) {
    if (!(provider.id in currentResponses)) currentResponses[provider.id] = null;
    if (!(provider.id in currentPayloads)) currentPayloads[provider.id] = null;
  }
}

function uniqueId(base) {
  const root = slugify(base);
  const ids = new Set([...els.decisionList.querySelectorAll(".decision-card")].flatMap((card) =>
    [card.dataset.generatedId, card.querySelector(".decision-id").value.trim()]).filter(Boolean));
  let i = 1;
  while (ids.has(`${root}_${i}`)) i += 1;
  return `${root}_${i}`;
}

function typeLabel(type) {
  if (type === "noul") return "Yes / No";
  if (type === "choice") return "Choice";
  if (type === "score") return "Score";
  return type || "Decision";
}

function typeHelp(type) {
  if (type === "noul") return "Probability that a proposition is true";
  if (type === "choice") return "Pick one labeled option";
  if (type === "score") return "Position on an ordered rubric";
  return "Decision";
}

function defaultInstructions(type) {
  if (type === "noul") return "";
  if (type === "choice") return "";
  if (type === "score") return "";
  return "";
}

function addDecision(type, data = {}) {
  const node = els.decisionTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.type = type;
  node.classList.add(`type-${type}`);
  node.querySelector(".decision-kind-icon").textContent = type === "noul" ? "✓" : type === "choice" ? "◇" : "▤";
  node.querySelector(".type-badge").textContent = typeLabel(type);
  node.querySelector(".decision-kind-help").textContent = typeHelp(type);
  node.querySelector(".decision-type").value = type === "noul" ? "noul (Yes / No)" : type;
  const generatedId = data.generatedId || uniqueId(type === "noul" ? "yes_no" : type);
  node.dataset.generatedId = generatedId;
  node.querySelector(".decision-id").placeholder = generatedId;
  node.querySelector(".decision-id").value = data.id ?? "";
  setEditorValue(node.querySelector(".decision-instructions"), data.instructions ?? defaultInstructions(type));
  node.dataset.extraQuestion = JSON.stringify(data.extraQuestion || {});

  const editor = node.querySelector(".criteria-editor");
  if (type === "choice") {
    const rows = data.optionRows || (data.criteria && typeof data.criteria === "object" && !Array.isArray(data.criteria)
      ? Object.entries(data.criteria).map(([label, description]) => ({label, description: description ?? ""}))
      : [{label: "", description: ""}, {label: "", description: ""}]);
    renderChoiceEditor(editor, rows);
  } else if (type === "score") {
    renderScoreEditor(editor, Array.isArray(data.criteria) && data.criteria.length ? data.criteria : ["low", "normal", "high"]);
  } else if (type === "noul") {
    renderNoulEditor(editor, data.criteria);
  }

  node.querySelector(".remove-decision").addEventListener("click", () => {
    node.remove();
    updateBlankBuilder();
    markExperimentChanged();
  });
  node.addEventListener("input", markExperimentChanged);
  node.addEventListener("change", markExperimentChanged);
  els.decisionList.appendChild(node);
  autoGrowWithin(node);
  updateBlankBuilder();
  updateGeneratedJson();
  saveWorkspace();
  return node;
}

function renderNoulEditor(container, criteria) {
  const trueValue = criteria && typeof criteria === "object" ? (criteria.true ?? criteria["true"] ?? "") : "";
  const falseValue = criteria && typeof criteria === "object" ? (criteria.false ?? criteria["false"] ?? "") : "";
  container.innerHTML = `
    <details class="noul-options">
      <summary>Optional Yes / No meaning</summary>
      <p class="field-help">Clarify what counts as Yes and No when the proposition could otherwise be ambiguous.</p>
      <div class="noul-stack">
        <label><span>Yes / True means</span><textarea class="noul-true auto-grow" rows="1" data-max-height="120" placeholder="Example: suspicious, fraudulent, or unauthorized">${escapeHtml(typeof trueValue === "string" ? trueValue : JSON.stringify(trueValue))}</textarea></label>
        <label><span>No / False means</span><textarea class="noul-false auto-grow" rows="1" data-max-height="120" placeholder="Example: expected, legitimate activity">${escapeHtml(typeof falseValue === "string" ? falseValue : JSON.stringify(falseValue))}</textarea></label>
      </div>
    </details>`;
  setEditorValue(container.querySelector(".noul-true"), trueValue);
  setEditorValue(container.querySelector(".noul-false"), falseValue);
  autoGrowWithin(container);
}

function renderChoiceEditor(container, rowsData) {
  container.innerHTML = `
    <div class="criteria-head"><span>Options <small>Order is preserved</small></span></div>
    <div class="criteria-rows option-rows"></div><button type="button" class="btn btn-small ghost add-option">+ Add option</button>`;
  const rows = container.querySelector(".option-rows");
  (rowsData.length ? rowsData : [{label:"",description:""},{label:"",description:""}]).forEach((row) => addChoiceRow(rows, row.label ?? "", row.description ?? ""));
  container.querySelector(".add-option").addEventListener("click", () => {
    addChoiceRow(rows, "", "");
    rows.lastElementChild?.querySelector(".option-label")?.focus();
    markExperimentChanged();
  });
}

function addChoiceRow(rows, label = "", description = "") {
  const row = document.createElement("div");
  row.className = "option-row reorder-row";
  row.innerHTML = `
    <span class="drag-index"></span>
    <input class="option-label" type="text" placeholder="Option name" value="${escapeHtml(label)}" />
    <input class="option-description" type="text" placeholder="Optional description" />
    <div class="reorder-actions">
      <button class="mini-btn move-up" type="button" title="Move up">↑</button>
      <button class="mini-btn move-down" type="button" title="Move down">↓</button>
      <button class="mini-btn danger remove-row" type="button" title="Remove option">×</button>
    </div>`;
  setEditorValue(row.querySelector(".option-description"), description);
  row.querySelector(".move-up").addEventListener("click", () => {
    reorderRow(rows, row, -1, refreshChoiceIndexes);
  });
  row.querySelector(".move-down").addEventListener("click", () => {
    reorderRow(rows, row, 1, refreshChoiceIndexes);
  });
  row.querySelector(".remove-row").addEventListener("click", () => { row.remove(); refreshChoiceIndexes(rows); markExperimentChanged(); });
  rows.appendChild(row);
  refreshChoiceIndexes(rows);
}

function refreshChoiceIndexes(rows) {
  [...rows.children].forEach((row, index, all) => {
    row.querySelector(".drag-index").textContent = String(index + 1);
    row.querySelector(".move-up").disabled = index === 0;
    row.querySelector(".move-down").disabled = index === all.length - 1;
  });
}

function reorderRow(rows, row, direction, refreshIndexes) {
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  for (const item of [row, sibling]) item.getAnimations().forEach((animation) => animation.cancel());
  const before = new Map([row, sibling].map((item) => [item, item.getBoundingClientRect().top]));
  if (direction < 0) rows.insertBefore(row, sibling);
  else rows.insertBefore(sibling, row);
  refreshIndexes(rows);
  markExperimentChanged();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const item of [row, sibling]) {
    const distance = before.get(item) - item.getBoundingClientRect().top;
    if (distance) item.animate(
      [{transform: `translateY(${distance}px)`}, {transform: "translateY(0)"}],
      {duration: 190, easing: "cubic-bezier(.2,.8,.2,1)"},
    );
  }
}

function renderScoreEditor(container, levels) {
  container.innerHTML = `
    <div class="criteria-head"><span>Ordered levels <small>Lowest → highest</small></span></div>
    <div class="criteria-rows level-rows"></div><button type="button" class="btn btn-small ghost add-level">+ Add level</button>`;
  const rows = container.querySelector(".level-rows");
  levels.forEach((level) => addLevelRow(rows, level));
  container.querySelector(".add-level").addEventListener("click", () => {
    addLevelRow(rows, "");
    rows.lastElementChild?.querySelector(".level-text")?.focus();
    markExperimentChanged();
  });
}

function addLevelRow(rows, level = "") {
  const row = document.createElement("div");
  row.className = "level-row reorder-row";
  row.innerHTML = `
    <span class="drag-index"></span>
    <input class="level-text" type="text" placeholder="Level" />
    <div class="reorder-actions">
      <button class="mini-btn move-up" type="button" title="Move up">↑</button>
      <button class="mini-btn move-down" type="button" title="Move down">↓</button>
      <button class="mini-btn danger remove-row" type="button" title="Remove level">×</button>
    </div>`;
  setEditorValue(row.querySelector(".level-text"), level);
  row.querySelector(".move-up").addEventListener("click", () => {
    reorderRow(rows, row, -1, refreshLevelIndexes);
  });
  row.querySelector(".move-down").addEventListener("click", () => {
    reorderRow(rows, row, 1, refreshLevelIndexes);
  });
  row.querySelector(".remove-row").addEventListener("click", () => { row.remove(); refreshLevelIndexes(rows); markExperimentChanged(); });
  rows.appendChild(row);
  refreshLevelIndexes(rows);
}

function refreshLevelIndexes(rows) {
  [...rows.children].forEach((row, index, all) => {
    row.querySelector(".drag-index").textContent = String(index);
    row.querySelector(".move-up").disabled = index === 0;
    row.querySelector(".move-down").disabled = index === all.length - 1;
  });
}

function serializeDecisionCards() {
  return [...els.decisionList.querySelectorAll(".decision-card")].map((card) => {
    const type = card.dataset.type;
    const data = {
      type,
      id: card.querySelector(".decision-id").value,
      generatedId: card.dataset.generatedId,
      instructions: editorValue(card.querySelector(".decision-instructions")),
      extraQuestion: JSON.parse(card.dataset.extraQuestion || "{}"),
    };
    if (type === "choice") {
      data.optionRows = [...card.querySelectorAll(".option-row")].map((row) => ({
        label: row.querySelector(".option-label").value,
        description: editorValue(row.querySelector(".option-description")),
      }));
    } else if (type === "score") {
      data.criteria = [...card.querySelectorAll(".level-text")].map(editorValue);
    } else if (type === "noul") {
      const yes = editorValue(card.querySelector(".noul-true"));
      const no = editorValue(card.querySelector(".noul-false"));
      if (yes !== "" || no !== "") data.criteria = { ...(yes !== "" ? {true: yes} : {}), ...(no !== "" ? {false: no} : {}) };
    }
    return data;
  });
}

function updateBlankBuilder() {
  els.blankBuilder.classList.toggle("hidden", Boolean(els.decisionList.children.length));
  const counts = {noul:0, choice:0, score:0};
  els.decisionList.querySelectorAll(".decision-card").forEach((card) => { if (card.dataset.type in counts) counts[card.dataset.type] += 1; });
  document.querySelectorAll(".add-actions [data-add-type]").forEach((button) => {
    button.querySelector(".decision-count").textContent = String(counts[button.dataset.addType] || 0);
  });
}

function updateInputExample() {
  els.inputExample.classList.toggle("hidden", Boolean(els.state.value.trim()));
}

function parseFieldValue(raw) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) return "";
  // Parse deliberately structured values, but leave ordinary IDs/numbers as text.
  if (/^[\[{]/.test(trimmed) || /^(true|false|null)$/i.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { return text; }
  }
  return text;
}

function structuredStateFromText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return null;
  try {
    const value = JSON.parse(trimmed);
    return (Array.isArray(value) || (value && typeof value === "object")) ? value : null;
  } catch {
    return null;
  }
}

function fieldValueText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function fieldRowValue(input) {
  const original = input.dataset.originalJson;
  if (original !== undefined && input.value === JSON.stringify(JSON.parse(original), null, 2)) return JSON.parse(original);
  return parseFieldValue(input.value);
}

function addStateField(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "state-field-row";
  row.innerHTML = `
    <input class="state-field-name" type="text" placeholder="Field name" value="${escapeHtml(name)}" />
    <textarea class="state-field-value auto-grow" rows="1" data-max-height="150" placeholder="Value">${escapeHtml(fieldValueText(value))}</textarea>
    <button class="mini-btn danger remove-field" type="button" title="Remove field" aria-label="Remove field">×</button>`;
  row.querySelector(".remove-field").addEventListener("click", () => {
    row.remove();
    if (!els.stateFields.children.length) addStateField("", "");
    stateFieldsKind = "object";
    stateViewDirty.fields = true;
    syncCanonicalFromFields();
    markExperimentChanged();
  });
  setEditorValue(row.querySelector(".state-field-value"), value);
  row.querySelector(".state-field-value").addEventListener("input", (event) => autoGrowTextarea(event.target));
  els.stateFields.appendChild(row);
  autoGrowWithin(row);
}

function renderFieldsFromCanonical() {
  els.stateFields.innerHTML = "";
  const value = stateCanonical;
  if (Array.isArray(value)) {
    stateFieldsKind = "array";
    if (value.length) value.forEach((item, index) => addStateField(String(index), item));
    else addStateField("0", "");
  } else if (value && typeof value === "object") {
    stateFieldsKind = "object";
    const entries = Object.entries(value);
    if (entries.length) entries.forEach(([key, item]) => addStateField(key, item));
    else addStateField("", "");
  } else if (typeof value === "string") {
    stateFieldsKind = "string";
    addStateField("message", value);
  } else {
    stateFieldsKind = "object";
    addStateField("", "");
  }
  stateViewDirty.fields = false;
}

function collectFieldsState({requireNamed = true} = {}) {
  const rows = [...els.stateFields.querySelectorAll(".state-field-row")].map((row) => ({
    name: row.querySelector(".state-field-name").value.trim(),
    value: fieldRowValue(row.querySelector(".state-field-value")),
  }));

  if (stateFieldsKind === "string" && rows.length === 1 && (!rows[0].name || rows[0].name === "message")) {
    return typeof rows[0].value === "string" ? rows[0].value : fieldValueText(rows[0].value);
  }

  if (stateFieldsKind === "array" && rows.length && rows.every((row) => /^\d+$/.test(row.name))) {
    return rows.sort((a,b) => Number(a.name)-Number(b.name)).map((row) => row.value);
  }

  const result = {};
  for (const row of rows) {
    if (!row.name) continue;
    if (requireNamed && Object.prototype.hasOwnProperty.call(result, row.name)) throw new Error(`Field “${row.name}” is duplicated.`);
    result[row.name] = row.value;
  }
  // An empty object is a valid, intentional state in Fields mode.
  return result;
}

function syncCanonicalFromFields() {
  try { stateCanonical = collectFieldsState({requireNamed:false}); return true; }
  catch { return false; }
}

function renderTextFromCanonical() {
  els.state.value = typeof stateCanonical === "string"
    ? stateCanonical
    : (stateCanonical === "" || stateCanonical == null ? "" : JSON.stringify(stateCanonical, null, 2));
  stateViewDirty.text = false;
  updateInputExample();
  autoGrowTextarea(els.state);
}

function renderJsonStateFromCanonical() {
  els.jsonState.value = stateCanonical === "" || stateCanonical === undefined
    ? ""
    : JSON.stringify(stateCanonical, null, 2);
  stateViewDirty.json = false;
  autoGrowTextarea(els.jsonState);
}

function renderCurrentStateMode() {
  if (currentInputMode === "text") renderTextFromCanonical();
  else if (currentInputMode === "fields") renderFieldsFromCanonical();
  else renderJsonStateFromCanonical();
}

function commitCurrentStateMode({strict = false} = {}) {
  if (currentInputMode === "text") {
    if (stateViewDirty.text) stateCanonical = els.state.value;
    stateViewDirty.text = false;
    return true;
  }
  if (currentInputMode === "fields") {
    if (stateViewDirty.fields) stateCanonical = collectFieldsState({requireNamed: strict});
    stateViewDirty.fields = false;
    return true;
  }
  if (!stateViewDirty.json) return true;
  const raw = els.jsonState.value.trim();
  if (!raw) { stateCanonical = ""; stateViewDirty.json = false; return true; }
  try {
    stateCanonical = JSON.parse(raw);
    stateViewDirty.json = false;
    return true;
  } catch (error) {
    if (strict) throw new Error(`Invalid JSON state: ${error.message}`);
    return false;
  }
}

function collectState() {
  commitCurrentStateMode({strict:true});
  if (!(typeof stateCanonical === "string" || Array.isArray(stateCanonical) || (stateCanonical && typeof stateCanonical === "object"))) {
    throw new Error("State must be text, a JSON object, or a JSON array.");
  }
  return cloneJsonValue(stateCanonical);
}

function setCanonicalState(value, {render = true} = {}) {
  stateCanonical = cloneJsonValue(value ?? "");
  stateViewDirty = {text:false, fields:false, json:false};
  if (render) renderCurrentStateMode();
}

function setInputMode(mode, {force = false} = {}) {
  if (!["text", "fields", "json"].includes(mode)) mode = "text";
  if (mode === currentInputMode && !force) return;
  const previousMode = currentInputMode;
  try {
    if (!force && !commitCurrentStateMode({strict: currentInputMode === "json"})) {
      toast("Fix the JSON state before switching views.");
      return;
    }
  } catch (error) {
    toast(error.message);
    return;
  }

  // If somebody pasted an object/array into Text, switching to Fields or JSON
  // should reveal that structure instead of creating one giant `message` field.
  // Ordinary prose remains an ordinary string and becomes a single message row.
  if (!force && previousMode === "text" && (mode === "fields" || mode === "json") && typeof stateCanonical === "string") {
    const structured = structuredStateFromText(stateCanonical);
    if (structured !== null) {
      stateCanonical = structured;
      stateViewDirty = {text:false, fields:false, json:false};
    }
  }

  currentInputMode = mode;
  localStorage.setItem(INPUT_MODE_KEY, mode);
  els.inputModeButtons.forEach((button) => button.classList.toggle("active", button.dataset.inputMode === mode));
  els.inputModeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.inputMode === mode)));
  els.textInputMode.classList.toggle("active", mode === "text");
  els.fieldsInputMode.classList.toggle("active", mode === "fields");
  els.jsonInputMode.classList.toggle("active", mode === "json");
  renderCurrentStateMode();
  requestAnimationFrame(() => autoGrowWithin());
  updateGeneratedJson();
  renderModelComparison();
  renderWhatIf();
  saveWorkspace();
}

function collectQuestions() {
  const questions = Object.create(null);
  for (const card of els.decisionList.querySelectorAll(".decision-card")) {
    const type = card.dataset.type;
    const id = card.querySelector(".decision-id").value.trim() || card.dataset.generatedId;
    const instructions = editorValue(card.querySelector(".decision-instructions"));
    if (Object.prototype.hasOwnProperty.call(questions, id)) throw new Error(`Decision ID “${id}” is duplicated. Choose another ID or leave it blank to use the suggested one.`);
    if (instructions === "" || instructions === null) throw new Error(`Decision “${id}” needs a question / instruction.`);
    const extra = JSON.parse(card.dataset.extraQuestion || "{}");

    if (type === "choice") {
      const criteria = {};
      for (const row of card.querySelectorAll(".option-row")) {
        const label = row.querySelector(".option-label").value.trim();
        const description = editorValue(row.querySelector(".option-description"));
        if (!label) continue;
        if (Object.prototype.hasOwnProperty.call(criteria, label)) throw new Error(`Choice “${id}” contains duplicate option “${label}”.`);
        criteria[label] = description === "" ? null : description;
      }
      if (Object.keys(criteria).length < 1) throw new Error(`Choice “${id}” needs at least one named option.`);
      questions[id] = {...extra, type, instructions, criteria};
    } else if (type === "score") {
      const criteria = [...card.querySelectorAll(".level-text")].map(editorValue).filter((value) => value !== "" && value !== null);
      if (criteria.length < 2) throw new Error(`Score “${id}” needs at least two levels.`);
      questions[id] = {...extra, type, instructions, criteria};
    } else {
      const question = {...extra, type: "noul", instructions};
      const yes = editorValue(card.querySelector(".noul-true"));
      const no = editorValue(card.querySelector(".noul-false"));
      if (yes !== "" || no !== "") question.criteria = {...(yes !== "" ? {true: yes} : {}), ...(no !== "" ? {false: no} : {})};
      questions[id] = question;
    }
  }
  if (!Object.keys(questions).length) throw new Error("Add at least one decision.");
  return questions;
}

function buildPayload() {
  try {
    const payload = {state: collectState(), questions: collectQuestions()};
    return {payload, error: null};
  } catch (error) {
    return {payload: null, error: error.message || String(error)};
  }
}

function upstreamRequestPreview(payload, provider = activeProvider()) {
  if (!payload) return null;
  return {...payload,...(provider?.model ? {model:provider.model} : {})};
}

function updateGeneratedJson({forceEditor = false} = {}) {
  const {payload, error} = buildPayload();
  const display = payload || {error};
  const response = currentResponses[currentProvider];
  renderStyledJson(els.rawRequestJson, response?.upstream_request ?? upstreamRequestPreview(payload) ?? display);
  if (els.requestJsonEditor && (forceEditor || document.activeElement !== els.requestJsonEditor)) {
    syncingRequestJson = true;
    els.requestJsonEditor.value = JSON.stringify(display, null, 2);
    autoGrowTextarea(els.requestJsonEditor);
    syncingRequestJson = false;
    requestJsonUserDirty = false;
    els.requestJsonSyncState.textContent = error ? "Form needs attention" : "Synced";
    els.requestJsonSyncState.className = `json-sync-state ${error ? "error" : "ok"}`;
  }
  els.validation.textContent = error && (els.decisionList.children.length || stateCanonical !== "") ? error : "";
  renderPythonExample();
}

function validateRequestPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Request JSON must be an object.");
  if (!("state" in payload)) throw new Error("Request JSON needs a state property.");
  if (!payload.questions || typeof payload.questions !== "object" || Array.isArray(payload.questions)) throw new Error("Request JSON needs a questions object.");
  if (!(typeof payload.state === "string" || Array.isArray(payload.state) || (payload.state && typeof payload.state === "object"))) throw new Error("State must be text, an object, or an array.");
  const entries = Object.entries(payload.questions);
  if (!entries.length || entries.length > 128) throw new Error("Request JSON needs between 1 and 128 decisions.");
  for (const [id, question] of entries) {
    if (!id.trim() || !question || typeof question !== "object" || Array.isArray(question)) throw new Error("Every decision needs an ID and an object definition.");
    if (!["noul", "choice", "score"].includes(question.type)) throw new Error(`Decision “${id}” has an unsupported type.`);
    if (question.instructions == null || question.instructions === "") throw new Error(`Decision “${id}” needs instructions.`);
    if (question.type === "choice" && (!question.criteria || typeof question.criteria !== "object" || Array.isArray(question.criteria) || !Object.keys(question.criteria).length)) throw new Error(`Choice “${id}” needs options.`);
    if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2)) throw new Error(`Score “${id}” needs at least two levels.`);
    if (question.type === "noul" && question.criteria != null && (typeof question.criteria !== "object" || Array.isArray(question.criteria) || Object.keys(question.criteria).some((key) => !["true","false"].includes(key)))) throw new Error(`Yes / No “${id}” has invalid criteria.`);
  }
}

function applyRequestPayload(payload, {keepEditor = true} = {}) {
  validateRequestPayload(payload);
  setCanonicalState(payload.state, {render:true});
  els.decisionList.innerHTML = "";
  questionsToDecisions(payload.questions).forEach((decision) => addDecision(decision.type, decision));
  currentQuestions = payload.questions;
  els.preset.value = "";
  updateDeletePresetButton();
  updateBlankBuilder();
  if (!keepEditor) updateGeneratedJson({forceEditor:true});
  renderModelComparison();
  saveWorkspace();
}

function scheduleRequestJsonSync() {
  if (syncingRequestJson) return;
  requestJsonUserDirty = true;
  window.clearTimeout(requestJsonSyncTimer);
  els.requestJsonSyncState.textContent = "Editing…";
  els.requestJsonSyncState.className = "json-sync-state editing";
  renderPythonExample();
  renderWhatIf();
  requestJsonSyncTimer = window.setTimeout(syncRequestJsonEditor, 260);
}

function syncRequestJsonEditor() {
  window.clearTimeout(requestJsonSyncTimer);
  requestJsonSyncTimer = null;
  try {
    const payload = JSON.parse(els.requestJsonEditor.value);
    applyRequestPayload(payload, {keepEditor:true});
    els.requestJsonSyncState.textContent = "Synced to forms";
    els.requestJsonSyncState.className = "json-sync-state ok";
    renderStyledJson(els.rawRequestJson, currentResponses[currentProvider]?.upstream_request ?? payload);
    els.validation.textContent = "";
    requestJsonUserDirty = false;
    renderPythonExample();
    renderWhatIf();
    saveWorkspace();
    return true;
  } catch (error) {
    els.requestJsonSyncState.textContent = "Invalid / incomplete JSON";
    els.requestJsonSyncState.className = "json-sync-state error";
    els.validation.textContent = error.message;
    renderWhatIf();
    return false;
  }
}

function requestJsonReadyForRun() {
  return !requestJsonUserDirty || syncRequestJsonEditor();
}

function switchEditorTab(name) {
  if (name === "form" && !requestJsonReadyForRun()) return false;
  if (name === "json" && !requestJsonUserDirty) updateGeneratedJson({forceEditor:true});
  els.editorTabs.forEach((button) => {
    const active = button.dataset.editorTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  Object.entries(els.editorViews).forEach(([key, view]) => view.classList.toggle("active", key === name));
  els.requestJsonEditor.closest(".input-scroll").classList.toggle("json-editor-open",name === "json");
  requestAnimationFrame(() => autoGrowWithin());
  return true;
}

function captureWorkspace() {
  return {
    stateCanonical: cloneJsonValue(stateCanonical),
    text: els.state.value,
    jsonText: els.jsonState.value,
    fields: [...els.stateFields.querySelectorAll(".state-field-row")].map((row) => ({
      name: row.querySelector(".state-field-name").value,
      value: row.querySelector(".state-field-value").value,
    })),
    inputMode: currentInputMode,
    decisions: serializeDecisionCards(),
    preset: els.preset.value || "",
    currentResponses,
    currentPayloads,
    currentQuestions,
    whatIfBaseline,
    whatIfVariant,
  };
}

function saveWorkspace() {
  if (restoringWorkspace) return;
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(captureWorkspace())); } catch {}
}

function loadWorkspaceData() {
  for (const key of [WORKSPACE_KEY, "decisionLab.workspace.v3.shared", "decisionLab.workspace.v2.shared"]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (key !== WORKSPACE_KEY) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
      return data;
    } catch {}
  }
  return null;
}

function legacyWorkspaceState(workspace) {
  if (Object.prototype.hasOwnProperty.call(workspace, "stateCanonical")) return cloneJsonValue(workspace.stateCanonical);
  const mode = normalizeStoredInputMode(workspace.inputMode);
  if (mode === "json" && workspace.jsonText) {
    try { return JSON.parse(workspace.jsonText); } catch {}
  }
  if (mode === "fields" && Array.isArray(workspace.fields)) {
    const object = {};
    for (const field of workspace.fields) if (field?.name) object[field.name] = parseFieldValue(field.value);
    if (Object.keys(object).length) return object;
  }
  return workspace.text ?? workspace.rawText ?? "";
}

function restoreWorkspace() {
  const workspace = loadWorkspaceData();
  restoringWorkspace = true;
  try {
    els.decisionList.innerHTML = "";
    if (!workspace) {
      stateCanonical = "";
      resetModelResults();
      currentQuestions = {};
    } else {
      stateCanonical = legacyWorkspaceState(workspace);
      currentResponses = Object.fromEntries(Object.entries(workspace.currentResponses || {}).filter(([id])=>providers[id]));
      currentPayloads = Object.fromEntries(Object.entries(workspace.currentPayloads || {}).filter(([id])=>providers[id]));
      currentQuestions = workspace.currentQuestions || {};
      whatIfBaseline = workspace.whatIfBaseline?.providerSignature && providers[workspace.whatIfBaseline.providerId] ? workspace.whatIfBaseline : null;
      whatIfVariant = whatIfBaseline ? workspace.whatIfVariant || null : null;
      (workspace.decisions || []).forEach((d) => addDecision(d.type, d));
      const storedPreset = workspace.preset || "";
      els.preset.value = resolvePreset(storedPreset) ? storedPreset : "";
      updateDeletePresetButton();
      currentInputMode = normalizeStoredInputMode(workspace.inputMode);
    }
    stateViewDirty = {text:false, fields:false, json:false};
    setInputMode(currentInputMode, {force:true});
    ensureModelResultSlots();
    updateBlankBuilder();
    updateInputExample();
    updateGeneratedJson({forceEditor:true});
    renderActiveOutput();
    renderModelComparison();
    renderWhatIf();
    autoGrowWithin();
  } finally {
    restoringWorkspace = false;
  }
}

function markExperimentChanged() {
  updateGeneratedJson();
  renderModelComparison();
  renderWhatIf();
  saveWorkspace();
}

function populateEditor(state, decisions, mode = null) {
  stateCanonical = cloneJsonValue(state ?? "");
  stateViewDirty = {text:false, fields:false, json:false};
  els.decisionList.innerHTML = "";
  (decisions || []).forEach((decision) => addDecision(decision.type, decision));
  currentInputMode = mode || (typeof state === "string" ? "text" : "fields");
  setInputMode(currentInputMode, {force:true});
  updateBlankBuilder();
  updateGeneratedJson({forceEditor:true});
  autoGrowWithin();
  requestAnimationFrame(() => autoGrowWithin());
}

function newBlankExperiment() {
  clearWhatIf();
  els.preset.value = "";
  updateDeletePresetButton();
  stateCanonical = "";
  stateViewDirty = {text:false, fields:false, json:false};
  els.decisionList.innerHTML = "";
  resetModelResults();
  comparisonBatch = null;
  currentQuestions = {};
  setInputMode(currentInputMode, {force:true});
  updateBlankBuilder();
  updateGeneratedJson({forceEditor:true});
  renderActiveOutput();
  renderModelComparison();
  renderWhatIf();
  saveWorkspace();
  if (currentInputMode === "text") els.state.focus();
}

function applyPreset(name) {
  const preset = resolvePreset(name);
  if (!preset) return;
  clearWhatIf();
  updateDeletePresetButton();
  const mode = typeof preset.state === "string" ? "text" : "fields";
  populateEditor(preset.state, preset.decisions, mode);
  resetModelResults();
  comparisonBatch = null;
  currentQuestions = {};
  renderActiveOutput();
  renderModelComparison();
  renderWhatIf();
  saveWorkspace();
}

function renderModelSelector() {
  const enabled = providerList({enabledOnly: true});
  els.modelSelect.innerHTML = "";
  if (!enabled.length) {
    els.modelSelect.innerHTML = `<option value="">No models configured</option>`;
    els.modelSelect.disabled = true;
    return;
  }
  els.modelSelect.disabled = false;
  enabled.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.model ? `${provider.name} · ${provider.model}` : provider.name;
    els.modelSelect.appendChild(option);
  });
  if (!currentProvider || !providers[currentProvider] || providers[currentProvider].enabled === false) currentProvider = enabled[0].id;
  els.modelSelect.value = currentProvider;
  localStorage.setItem(ACTIVE_MODEL_KEY, currentProvider);
}

function activeProvider() {
  return providers[currentProvider] || null;
}

function runActionLabel(provider, running = false) {
  if (!provider) return "Configure a model";
  const name = provider.demo ? (provider.id === "demo-a" ? "Demo A" : "Demo B") : provider.name;
  return `${running ? "Stop" : "Run"} ${name.length > 16 ? "model" : name}`;
}

function applyProviderUi() {
  const provider = activeProvider();
  const has = Boolean(provider);
  els.run.disabled = !has || (comparisonBatch?.running && !activeRuns.has(provider?.id));
  els.runCompare.disabled = !comparisonBatch?.running && (providerList({enabledOnly:true, compareOnly:true}).length < 2 || runInFlight);

  if (!provider) {
    els.brandSubtitle.textContent = "System One playground";
    els.activeModelDot.style.setProperty("--model-h", 160);
    els.activeModelDot.className = "model-dot pending";
    els.modelSelectWrap.className = "model-select-wrap";
    els.modelSelectWrap.style.removeProperty("--active-model-color");
    els.runText.textContent = "Configure a model";
    els.run.classList.remove("stop-run");
    els.spinner.classList.add("hidden");
    els.outputModelBadge.textContent = "No model";
    els.outputModelBadge.removeAttribute("style");
    els.readyDot.className = "dot pending";
    els.readyText.textContent = "Configure a model";
    els.predictionCount.textContent = "0";
    els.tokenCount.textContent = "—";
    els.costTotal.textContent = "—";
    els.averageLatency.textContent = "—";
    return;
  }

  const hue = providerHue(provider.id);
  els.modelSelectWrap.className = `model-select-wrap ${providerBadgeClass(provider.id)}`;
  els.modelSelectWrap.style.setProperty("--active-model-color",providerAccent(provider.id,hue));
  els.brandSubtitle.innerHTML = `${escapeHtml(provider.name)}${provider.model ? ` · <code>${escapeHtml(provider.model)}</code>` : ""}`;
  els.activeModelDot.className = `model-dot ${providerBadgeClass(provider.id)}`;
  els.activeModelDot.style.setProperty("--model-h", hue);
  els.runText.textContent = runActionLabel(provider, activeRuns.has(provider.id));
  els.run.title = `${activeRuns.has(provider.id) ? "Stop" : "Run"} ${provider.name}`;
  els.run.classList.toggle("stop-run", activeRuns.has(provider.id));
  els.spinner.classList.toggle("hidden", !activeRuns.has(provider.id));
  els.outputModelBadge.className = `model-badge ${providerBadgeClass(provider.id)}`;
  els.outputModelBadge.style.setProperty("--model-h", hue);
  els.outputModelBadge.textContent = provider.name;
  els.predictionCount.textContent = provider.total_calls ?? provider.prediction_count ?? history.filter((h) => h.provider === provider.id).length;
  els.tokenCount.textContent = provider.usage_reported_calls || provider.total_tokens ? formatTokenCount(provider.total_tokens) : "—";
  els.costTotal.textContent = provider.cost_recorded_calls || provider.total_cost_usd ? formatCost(provider.total_cost_usd) : "—";
  els.averageLatency.textContent = formatMs(provider.average_request_ms);
}

function switchProvider(id) {
  if (!providers[id] || providers[id].enabled === false) return;
  currentProvider = id;
  localStorage.setItem(ACTIVE_MODEL_KEY, id);
  els.modelSelect.value = id;
  applyProviderUi();
  renderActiveOutput();
  renderWhatIf();
  refreshStatus();
  saveWorkspace();
}

function inferPreset(provider) {
  const endpoint = String(provider?.endpoint || "").toLowerCase();
  const model = String(provider?.model || "").toLowerCase();
  if (endpoint.includes("api.typesafe.ai") || model.startsWith("jev-")) return "jev";
  if (endpoint.includes("api.codiv.ai") || model.startsWith("openjev-")) return "openjev";
  if (endpoint.includes("127.0.0.1:7861") || endpoint.includes("localhost:7861") || String(provider?.id || "").includes("laya")) return "laya";
  return provider?.preset || "custom";
}

function draftFromProvider(provider) {
  const inferredPreset = provider.preset && provider.preset !== "custom" ? provider.preset : inferPreset(provider);
  return {
    id: provider.id || "",
    name: provider.name || "",
    endpoint: provider.endpoint || "",
    model: provider.model || "",
    enabled: provider.enabled !== false,
    compare: provider.compare !== false,
    status_endpoint: provider.status_endpoint || "",
    models_endpoint: provider.models_endpoint || "",
    auth_type: provider.auth_type || "none",
    auth_header: provider.auth_header || "Authorization",
    auth_prefix: provider.auth_prefix ?? "Bearer ",
    timeout_seconds: Number(provider.timeout_seconds ?? 30),
    max_retries: Number(provider.max_retries ?? 0),
    retry_statuses: Array.isArray(provider.retry_statuses) ? [...provider.retry_statuses] : [429,503,529],
    preset: inferredPreset,
    input_cost_per_million: Number(provider.input_cost_per_million ?? MODEL_TEMPLATES[inferredPreset]?.input_cost_per_million ?? 0),
    output_cost_per_million: Number(provider.output_cost_per_million ?? MODEL_TEMPLATES[inferredPreset]?.output_cost_per_million ?? 0),
    pricing_note: provider.pricing_note || (MODEL_TEMPLATES[inferredPreset]?.pricing_note || ""),
    has_api_key: Boolean(provider.has_api_key),
    demo: provider.demo === true,
    api_key: "",
    clear_api_key: false,
    _existing: Boolean(provider.id && serverProviderIds.has(provider.id)),
  };
}

function draftFromTemplate(key) {
  const source = MODEL_TEMPLATES[key] || MODEL_TEMPLATES.custom;
  const draft = structuredClone(source);
  draft.id = makeUniqueId(source.id);
  if (draft.id !== source.id) draft.name = `${source.name} ${draft.id.match(/-(\d+)$/)?.[1] || ""}`.trim();
  draft.has_api_key = false;
  draft.api_key = "";
  draft.clear_api_key = false;
  draft._existing = false;
  return draft;
}

function getDraft(id) {
  return settingsDrafts.find((draft) => draft.id === id) || null;
}

function updateDraft(id, patch) {
  const draft = getDraft(id);
  if (!draft) return;
  Object.assign(draft, patch);
}

function authNeedsKey(draft) {
  return (draft.auth_type || "none") !== "none";
}

function apiKeyPlaceholder(draft) {
  const prefix = draft.preset === "jev" ? "apikey_…" : draft.preset === "openjev" ? "sk-codiv-…" : "";
  if (prefix) return `${prefix} · ${draft.has_api_key ? "saved; blank keeps it" : "paste key"}`;
  return draft.has_api_key ? "Saved key · blank keeps it" : authNeedsKey(draft) ? "Paste API key" : "Optional API key";
}

function connectionSubtitle(draft) {
  if (draft.demo) return "Built in · deterministic example, not an AI model";
  if (draft.preset === "jev") return "TypeSafe hosted Jev";
  if (draft.preset === "openjev") return "Codiv hosted OpenJEV";
  if (draft.preset === "laya") return "Local Laya adapter";
  if (!draft.endpoint) return "Custom System One endpoint";
  try { return new URL(draft.endpoint).host; }
  catch { return "Custom System One endpoint"; }
}

function switchSettingsTab(name) {
  if (!["models","runset","usage","advanced"].includes(name)) name = "models";
  settingsActiveTab = name;
  els.settingsTabs.forEach((button) => {
    const active = button.dataset.settingsTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.settingsViews.forEach((view) => view.classList.toggle("active", view.dataset.settingsView === name));
  if (name === "runset") renderComparisonSettings();
  if (name === "usage") renderUsageSettings();
  if (name === "advanced") renderAdvancedProviderEditor();
}

function simpleModelCard(draft) {
  const card = document.createElement("article");
  card.className = "simple-model-card";
  card.dataset.id = draft.id;
  if (draft.demo) {
    card.innerHTML = `<div class="simple-model-head"><div class="model-identity"><span class="model-color-dot ${providerBadgeClass(draft.id)}" style="--model-h:${providerHue(draft.id)}"></span><div><strong>${escapeHtml(draft.name)}</strong><span>Built in · deterministic example, not an AI model</span></div></div><span class="connection-badge ready">No API key</span></div>`;
    return card;
  }
  const keyState = draft.has_api_key ? "Saved key" : authNeedsKey(draft) ? "API key needed" : "No API key required";
  const isLocal = draft.preset === "laya";
  const isCustom = draft.preset === "custom";
  card.innerHTML = `
    <div class="simple-model-head">
      <div class="model-identity">
        <span class="model-color-dot ${providerBadgeClass(draft.id)}" style="--model-h:${providerHue(draft.id)}"></span>
        <div><strong>${escapeHtml(draft.name || "Unnamed model")}</strong><span>${escapeHtml(connectionSubtitle(draft))}</span></div>
      </div>
      <div class="simple-model-actions">
        <span class="connection-badge ${draft.has_api_key || !authNeedsKey(draft) ? "ready" : "needs-key"}">${escapeHtml(keyState)}</span>
        <button class="btn btn-small subtle check-draft" type="button">Check</button>
        <button class="icon-btn remove-draft" type="button" title="Remove model" aria-label="Remove model">×</button>
      </div>
    </div>
    <div class="simple-model-fields">
      ${isCustom ? `<label><span>Name</span><input class="simple-name" type="text" placeholder="My model" value="${escapeHtml(draft.name)}" /></label>` : ""}
      ${isLocal || isCustom ? `<label class="wide"><span>Endpoint</span><input class="simple-endpoint" type="url" placeholder="${isLocal ? "http://127.0.0.1:7861/v1/systemone" : "https://example.com/v1/systemone"}" value="${escapeHtml(draft.endpoint)}" /></label>` : ""}
      ${authNeedsKey(draft) || isCustom ? `<label class="wide"><span>API key${authNeedsKey(draft) ? "" : " (optional)"}</span><input class="simple-key" type="password" autocomplete="new-password" placeholder="${escapeHtml(apiKeyPlaceholder(draft))}" /></label>` : ""}
    </div>
    <div class="simple-model-foot">
      <label class="toggle-line"><input class="simple-enabled" type="checkbox" ${draft.enabled ? "checked" : ""}/><span>Enabled</span></label>
      <button class="text-button open-advanced" type="button">Advanced settings →</button>
      <span class="draft-check-result" aria-live="polite"></span>
    </div>`;

  card.querySelector(".simple-name")?.addEventListener("input", (event) => { draft.name = event.target.value; card.querySelector(".model-identity strong").textContent = draft.name || "Unnamed model"; });
  card.querySelector(".simple-endpoint")?.addEventListener("input", (event) => { draft.endpoint = event.target.value.trim(); });
  card.querySelector(".simple-key")?.addEventListener("input", (event) => { draft.api_key = event.target.value; draft.clear_api_key = false; });
  card.querySelector(".simple-enabled").addEventListener("change", (event) => { draft.enabled = event.target.checked; });
  card.querySelector(".remove-draft").addEventListener("click", () => {
    settingsDrafts = settingsDrafts.filter((item) => item !== draft);
    if (advancedProviderId === draft.id) advancedProviderId = settingsDrafts[0]?.id || "";
    renderSettingsModels();
    renderComparisonSettings();
  });
  card.querySelector(".open-advanced").addEventListener("click", () => {
    advancedProviderId = draft.id;
    switchSettingsTab("advanced");
  });
  card.querySelector(".check-draft").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = card.querySelector(".draft-check-result");
    button.disabled = true;
    status.className = "draft-check-result checking";
    status.textContent = "Checking…";
    try {
      const result = await checkDraftConnection(draft);
      status.className = `draft-check-result ${result.ready ? "ok" : "bad"}`;
      status.textContent = result.ready ? `Connected · ${result.probe_ms ?? "—"} ms` : `Not ready · ${result.detail || `HTTP ${result.status || "?"}`}`;
    } catch (error) {
      status.className = "draft-check-result bad";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  return card;
}

function renderSettingsModels() {
  els.modelSettingsList.innerHTML = "";
  if (!settingsDrafts.length) {
    els.modelSettingsList.innerHTML = `<div class="settings-empty"><strong>No models configured</strong><span>Choose a preset above and add your first model.</span></div>`;
    return;
  }
  settingsDrafts.forEach((draft) => els.modelSettingsList.appendChild(simpleModelCard(draft)));
}

function renderComparisonSettings() {
  els.comparisonModelList.innerHTML = "";
  if (!settingsDrafts.length) {
    els.comparisonModelList.innerHTML = `<div class="settings-empty">Add models first.</div>`;
    return;
  }
  settingsDrafts.forEach((draft) => {
    const row = document.createElement("label");
    row.className = `comparison-model-option${draft.enabled ? "" : " disabled"}`;
    row.innerHTML = `<input type="checkbox" ${draft.compare ? "checked" : ""} ${draft.enabled ? "" : "disabled"}/><span class="model-color-dot ${providerBadgeClass(draft.id)}" style="--model-h:${providerHue(draft.id)}"></span><span class="comparison-model-copy"><strong>${escapeHtml(draft.name)}</strong><small>${escapeHtml(draft.model || templateLabel(draft.preset))}</small></span><span class="compare-state">${draft.compare ? "Selected" : "Not selected"}</span>`;
    const box = row.querySelector("input");
    box.addEventListener("change", () => {
      draft.compare = box.checked;
      row.querySelector(".compare-state").textContent = box.checked ? "Selected" : "Not selected";
    });
    els.comparisonModelList.appendChild(row);
  });
}

function renderUsageSettings() {
  els.usageModelList.innerHTML = "";
  const list = providerList();
  if (!list.length) {
    els.usageModelList.innerHTML = `<div class="settings-empty">Usage appears after you save and run a model.</div>`;
    return;
  }
  list.forEach((provider) => {
    const card = document.createElement("article");
    card.className = "usage-card";
    card.innerHTML = `
      <div class="usage-card-head"><div class="model-identity"><span class="model-color-dot ${providerBadgeClass(provider.id)}" style="--model-h:${providerHue(provider.id)}"></span><div><strong>${escapeHtml(provider.name)}</strong><span>${escapeHtml(provider.model || templateLabel(provider.preset))}</span></div></div><button class="btn btn-small subtle reset-usage" type="button">Reset totals</button></div>
      <div class="usage-stats-grid">
        <span><small>Calls</small><b>${escapeHtml(provider.total_calls ?? provider.prediction_count ?? 0)}</b></span>
        <span><small>Input tokens</small><b>${escapeHtml(formatTokenCount(provider.input_tokens ?? 0))}</b></span>
        <span><small>Output tokens</small><b>${escapeHtml(formatTokenCount(provider.output_tokens ?? 0))}</b></span>
        <span><small>Tracked cost</small><b>${escapeHtml(provider.cost_recorded_calls || provider.total_cost_usd ? formatCost(provider.total_cost_usd) : "—")}</b></span>
        <span><small>Errors</small><b>${escapeHtml(provider.error_count ?? 0)}</b></span>
        <span><small>Avg request</small><b>${escapeHtml(formatMs(provider.average_request_ms))}</b></span>
      </div>
      <p class="usage-pricing-note">${escapeHtml(provider.pricing_note || `Pricing: $${provider.input_cost_per_million ?? 0}/1M input · $${provider.output_cost_per_million ?? 0}/1M output`)}</p>`;
    card.querySelector(".reset-usage").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await apiFetch(`/api/usage/reset/${encodeURIComponent(provider.id)}`, {method:"POST"}, {token:true});
        await loadProviders();
        renderUsageSettings();
        toast(`${provider.name} usage totals reset`);
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
    els.usageModelList.appendChild(card);
  });
}

function renderAdvancedProviderEditor() {
  els.advancedProviderSelect.innerHTML = "";
  const editableDrafts = settingsDrafts.filter((draft)=>!draft.demo);
  editableDrafts.forEach((draft) => {
    const option = document.createElement("option");
    option.value = draft.id;
    option.textContent = draft.name || draft.id;
    els.advancedProviderSelect.appendChild(option);
  });
  if (!editableDrafts.length) {
    els.advancedProviderEditor.innerHTML = `<div class="settings-empty">Add a model in the Models tab first.</div>`;
    return;
  }
  if (!advancedProviderId || !editableDrafts.some((draft)=>draft.id===advancedProviderId)) advancedProviderId = editableDrafts[0].id;
  els.advancedProviderSelect.value = advancedProviderId;
  const draft = getDraft(advancedProviderId);
  const retryText = (draft.retry_statuses || [429,503,529]).join(", ");
  els.advancedProviderEditor.innerHTML = `
    <div class="advanced-grid">
      <label><span>Name</span><input data-advanced="name" type="text" placeholder="Display name" value="${escapeHtml(draft.name)}" /></label>
      <label><span>ID</span><input data-advanced="id" type="text" placeholder="model-id" value="${escapeHtml(draft.id)}" ${draft._existing ? "readonly" : ""}/></label>
      <label class="wide"><span>System One endpoint</span><input data-advanced="endpoint" type="url" placeholder="https://example.com/v1/systemone" value="${escapeHtml(draft.endpoint)}" /></label>
      <label><span>Model / version</span><input data-advanced="model" type="text" placeholder="Optional model ID" value="${escapeHtml(draft.model)}" /></label>
      <label><span>Preset type</span><select data-advanced="preset"><option value="custom">Custom</option><option value="jev">TypeSafe Jev</option><option value="openjev">OpenJEV</option><option value="laya">Laya local</option></select></label>
      <label class="wide"><span>Status endpoint</span><input data-advanced="status_endpoint" type="url" placeholder="Optional health/status URL" value="${escapeHtml(draft.status_endpoint)}" /></label>
      <label class="wide"><span>Models endpoint</span><input data-advanced="models_endpoint" type="url" placeholder="Optional /v1/models URL" value="${escapeHtml(draft.models_endpoint)}" /></label>
      <label><span>Authentication</span><select data-advanced="auth_type"><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">Custom header</option></select></label>
      <label><span>Auth header</span><input data-advanced="auth_header" type="text" placeholder="Authorization" value="${escapeHtml(draft.auth_header)}" /></label>
      <label><span>Auth prefix</span><input data-advanced="auth_prefix" type="text" placeholder="Bearer " value="${escapeHtml(draft.auth_prefix)}" /></label>
      <label><span>API key</span><input data-advanced="api_key" type="password" autocomplete="new-password" placeholder="${escapeHtml(apiKeyPlaceholder(draft))}" /></label>
      <label><span>Timeout (seconds)</span><input data-advanced="timeout_seconds" type="number" min="1" max="300" value="${escapeHtml(draft.timeout_seconds)}" /></label>
      <label><span>Retries</span><input data-advanced="max_retries" type="number" min="0" max="8" value="${escapeHtml(draft.max_retries)}" /></label>
      <label class="wide"><span>Retry HTTP statuses</span><input data-advanced="retry_statuses" type="text" placeholder="429, 503, 529" value="${escapeHtml(retryText)}" /></label>
      <label><span>Input $ / 1M tokens</span><input data-advanced="input_cost_per_million" type="number" min="0" step="0.001" value="${escapeHtml(draft.input_cost_per_million)}" /></label>
      <label><span>Output $ / 1M tokens</span><input data-advanced="output_cost_per_million" type="number" min="0" step="0.001" value="${escapeHtml(draft.output_cost_per_million)}" /></label>
      <label class="wide"><span>Pricing note</span><input data-advanced="pricing_note" type="text" placeholder="Optional note shown with usage totals" value="${escapeHtml(draft.pricing_note)}" /></label>
    </div>
    <div class="advanced-actions-row">
      <button class="btn subtle advanced-check" type="button">Check connection</button>
      <button class="btn subtle advanced-models" type="button" ${draft.models_endpoint ? "" : "disabled"}>Discover models</button>
      ${draft.has_api_key ? '<label class="danger-toggle"><input class="advanced-clear-key" type="checkbox"/> Remove saved API key on save</label>' : ""}
      <span class="advanced-result"></span>
    </div>`;
  els.advancedProviderEditor.querySelector('[data-advanced="preset"]').value = draft.preset || "custom";
  els.advancedProviderEditor.querySelector('[data-advanced="auth_type"]').value = draft.auth_type || "none";
  els.advancedProviderEditor.querySelectorAll("[data-advanced]").forEach((input) => {
    input.addEventListener("input", () => updateDraftFromAdvanced(draft, input));
    input.addEventListener("change", () => updateDraftFromAdvanced(draft, input));
  });
  els.advancedProviderEditor.querySelector(".advanced-clear-key")?.addEventListener("change", (event) => { draft.clear_api_key = event.target.checked; });
  els.advancedProviderEditor.querySelector(".advanced-check").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const out = els.advancedProviderEditor.querySelector(".advanced-result");
    button.disabled = true; out.textContent = "Checking…";
    try { const result = await checkDraftConnection(draft); out.textContent = result.ready ? `Connected · ${result.probe_ms ?? "—"} ms` : `Not ready · ${result.detail || result.status || "probe failed"}`; }
    catch (error) { out.textContent = error.message; }
    finally { button.disabled = false; }
  });
  els.advancedProviderEditor.querySelector(".advanced-models").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const out = els.advancedProviderEditor.querySelector(".advanced-result");
    if (!draft._existing) { out.textContent = "Save this model once before discovering its model list."; return; }
    button.disabled = true; out.textContent = "Loading models…";
    try {
      const result = await apiFetch(`/api/providers/${encodeURIComponent(draft.id)}/models`, {}, {token:true});
      const raw = result.data?.data ?? result.data?.models ?? result.data ?? [];
      const names = (Array.isArray(raw) ? raw : []).map((item) => typeof item === "string" ? item : item?.id || item?.name).filter(Boolean);
      out.textContent = names.length ? `Available: ${names.slice(0,12).join(", ")}${names.length>12?` +${names.length-12} more`:""}` : "Models endpoint responded.";
    } catch (error) { out.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function updateDraftFromAdvanced(draft, input) {
  const key = input.dataset.advanced;
  let value = input.value;
  if (["timeout_seconds","max_retries","input_cost_per_million","output_cost_per_million"].includes(key)) value = Number(value) || 0;
  if (key === "retry_statuses") value = input.value.split(",").map((v)=>Number(v.trim())).filter(Number.isInteger);
  if (key === "api_key") { draft.api_key = input.value; draft.clear_api_key = false; return; }
  if (key === "id" && !draft._existing) {
    const old = draft.id;
    draft.id = input.value.trim();
    if (advancedProviderId === old) advancedProviderId = draft.id;
    return;
  }
  draft[key] = typeof value === "string" && key !== "auth_prefix" ? value.trim() : value;
}

async function checkDraftConnection(draft) {
  if (!draft.endpoint?.trim()) throw new Error("Enter an endpoint first.");
  const payload = providerPayloadFromDraft(draft);
  return apiFetch("/api/providers/check", {method:"POST", body:JSON.stringify(payload)}, {token:true});
}

function providerPayloadFromDraft(draft) {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    endpoint: draft.endpoint.trim(),
    model: (draft.model || "").trim(),
    enabled: draft.enabled !== false,
    compare: draft.compare !== false,
    status_endpoint: (draft.status_endpoint || "").trim(),
    models_endpoint: (draft.models_endpoint || "").trim(),
    auth_type: draft.auth_type || "none",
    auth_header: (draft.auth_header || "Authorization").trim() || "Authorization",
    auth_prefix: draft.auth_prefix ?? "",
    timeout_seconds: Number(draft.timeout_seconds) || 30,
    max_retries: Math.max(0, Number(draft.max_retries) || 0),
    retry_statuses: Array.isArray(draft.retry_statuses) && draft.retry_statuses.length ? draft.retry_statuses : [429,503,529],
    preset: draft.preset || "custom",
    input_cost_per_million: Math.max(0, Number(draft.input_cost_per_million) || 0),
    output_cost_per_million: Math.max(0, Number(draft.output_cost_per_million) || 0),
    pricing_note: draft.pricing_note || "",
    api_key: draft.api_key || null,
    clear_api_key: Boolean(draft.clear_api_key),
  };
}

async function openModelSettings() {
  focusBeforeModal = document.activeElement;
  settingsDrafts = providerList().map(draftFromProvider);
  advancedProviderId = settingsDrafts.find((draft)=>!draft.demo)?.id || "";
  renderSettingsModels();
  renderComparisonSettings();
  renderUsageSettings();
  switchSettingsTab("models");
  els.modelSettingsModal.classList.remove("hidden");
  els.closeModelSettings.focus();
}

function closeModelSettings() {
  els.modelSettingsModal.classList.add("hidden");
  settingsDrafts.forEach((draft) => { draft.api_key = ""; });
  els.modelSettingsList.replaceChildren();
  els.advancedProviderEditor.replaceChildren();
  focusBeforeModal?.focus?.();
}

function addModelSettingsRow() {
  const key = els.modelTemplateSelect.value || "custom";
  const draft = draftFromTemplate(key);
  settingsDrafts.unshift(draft);
  advancedProviderId = draft.id;
  renderSettingsModels();
  const card = els.modelSettingsList.querySelector(`[data-id="${CSS.escape(draft.id)}"]`);
  card?.scrollIntoView({block:"nearest",behavior:"smooth"});
  card?.querySelector(".simple-key, .simple-endpoint, .simple-name")?.focus();
}

async function saveModelSettings() {
  try {
    const desired = settingsDrafts.map(providerPayloadFromDraft);
    for (const payload of desired) {
      if (!payload.id || !payload.name || !payload.endpoint) throw new Error("Every model needs a name, ID, and endpoint.");
    }
    const ids = desired.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error("Model IDs must be unique.");

    els.saveModels.disabled = true;
    await apiFetch("/api/providers", {method:"PUT", body:JSON.stringify({providers:desired})}, {token:true});
    await loadProviders();
    closeModelSettings();
    toast("Settings saved");
    if (activeProvider()) refreshStatus();
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    els.saveModels.disabled = false;
  }
}

function applyTheme(theme) {
  if (!["light","dark"].includes(theme)) {
    theme = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  if (els.themeToggle) {
    const target = theme === "dark" ? "light" : "dark";
    els.themeToggle.title = `Switch to ${target} mode`;
    els.themeToggle.setAttribute("aria-label", `Switch to ${target} mode`);
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function payloadSignature(payload) {
  return payload ? JSON.stringify(payload) : "";
}

function whatIfConnectionSignature(provider) {
  return provider ? JSON.stringify([provider.endpoint, provider.model, provider.auth_type]) : "";
}

function clearWhatIf() {
  whatIfBaseline = null;
  whatIfVariant = null;
  renderWhatIf();
}

function elapsedSeconds() {
  const starts = [...activeRuns.values()].map((task) => task.startedAt);
  return starts.length ? Math.max(0, (performance.now() - Math.min(...starts)) / 1000) : 0;
}

function updateElapsed() {
  els.elapsed.textContent = `${elapsedSeconds().toFixed(1)}s`;
  els.activeRuns.querySelectorAll("[data-run-timer]").forEach((timer) => {
    const task = activeRuns.get(timer.dataset.runTimer);
    if (task) timer.textContent = `${((performance.now() - task.startedAt) / 1000).toFixed(1)}s`;
  });
}

function renderActiveRuns() {
  els.activeRuns.replaceChildren();
  for (const task of activeRuns.values()) {
    const chip = document.createElement("span");
    chip.className = "active-run-chip";
    chip.innerHTML = `<span class="pulse-dot"></span><span>Running ${escapeHtml(task.name)}</span><b data-run-timer="${escapeHtml(task.providerId)}">0.0s</b>`;
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "Stop";
    stop.setAttribute("aria-label", `Stop ${task.name}`);
    stop.addEventListener("click", () => stopModelRun(task.providerId));
    chip.appendChild(stop);
    els.activeRuns.appendChild(chip);
  }
  updateElapsed();
}

function updateRunUi() {
  runInFlight = activeRuns.size > 0;
  const currentTask = activeRuns.get(currentProvider);
  const batchRunning = Boolean(comparisonBatch?.running);
  els.run.disabled = !activeProvider();
  els.runText.textContent = runActionLabel(activeProvider(), Boolean(currentTask));
  els.run.title = activeProvider() ? `${currentTask ? "Stop" : "Run"} ${activeProvider().name}` : "Configure a model";
  els.run.classList.toggle("stop-run", Boolean(currentTask));
  els.spinner.classList.toggle("hidden", !currentTask);
  els.runCompare.disabled = !batchRunning && (runInFlight || providerList({enabledOnly:true, compareOnly:true}).length < 2);
  els.runCompareText.textContent = batchRunning ? "Stop selected models" : "Run selected models";
  els.runState.className = `run-state ${runInFlight ? "running" : "ready"}`;
  els.runState.textContent = runInFlight ? "Running" : "Ready";
  els.runningCount.textContent = `${activeRuns.size} running`;
  if (runInFlight && !runTimer) runTimer = window.setInterval(updateElapsed, 100);
  if (!runInFlight && runTimer) { window.clearInterval(runTimer); runTimer = null; }
  renderActiveRuns();
  applyProviderUi();
  renderWhatIf();
}

function normalizeProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function probabilityEntries(value) {
  if (!value || typeof value !== "object") return [];
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
  return entries.map(([key, raw]) => [String(key), normalizeProbability(raw)]).filter(([,p]) => p !== null);
}

function pct(value, digits = 1) {
  const p = normalizeProbability(value);
  return p === null ? "—" : `${(p * 100).toFixed(digits)}%`;
}

function numberish(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
function formatScore(value) { return numberish(value) ? Number(value).toFixed(2).replace(/\.00$/,"") : "—"; }
function formatMs(value) { return numberish(value) ? `${Number(value).toFixed(Number(value) >= 100 ? 0 : 1)} ms` : "—"; }

function responseAnswers(body) {
  return body?.result?.answers || body?.answers || {};
}

function responseMeta(body) {
  return body?.meta || body?.result?.meta || {};
}

function experimentName() {
  return resolvePreset(els.preset.value)?.title || "Custom experiment";
}

function statePreview(state) {
  const value = typeof state === "string" ? state : JSON.stringify(state);
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function decisionTypeSummary(questions = {}) {
  const counts = {noul:0, choice:0, score:0};
  Object.values(questions).forEach((question) => { if (question?.type in counts) counts[question.type] += 1; });
  return `${Object.keys(questions).length} decisions · ${counts.noul} Yes/No · ${counts.choice} Choice · ${counts.score} Score`;
}

async function requestModel(providerId, payload, signal, runId) {
  return apiFetch(`/api/providers/${encodeURIComponent(providerId)}/predict`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
    headers: {"X-Decision-Run-Id": runId},
  }, {token:true});
}

function rememberModelResult(providerId, payload, body) {
  currentResponses[providerId] = body;
  currentPayloads[providerId] = payload;
  currentQuestions = payload.questions;
  const meta = responseMeta(body);
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    time: new Date().toISOString(),
    provider: providerId,
    providerName: providerLabel(providerId),
    experimentName: experimentName(),
    presetId: els.preset.value || "",
    state: payload.state,
    questions: payload.questions,
    inputMode: currentInputMode,
    response: body,
    request_ms: meta.request_ms ?? meta.api_ms ?? meta.inference_ms,
    total_backend_ms: meta.total_backend_ms,
  };
  history.unshift(item);
  history = history.slice(0, HISTORY_LIMIT);
  saveHistory();
  saveWorkspace();
  renderHistory();
}

function stopModelRun(providerId) {
  const task = activeRuns.get(providerId);
  if (!task) return;
  task.stopped = true;
  activeRuns.delete(providerId);
  apiFetch(`/api/runs/${encodeURIComponent(task.id)}/cancel`, {method:"POST"}, {token:true})
    .catch(() => {}).finally(() => task.controller.abort());
  if (comparisonBatch?.id === task.batchId) comparisonBatch.stopped.add(providerId);
  updateRunUi();
  renderModelComparison();
}

function startModelRun(provider, payload, batch = null, options = {}) {
  const task = {
    id: crypto.randomUUID(), providerId: provider.id, name: provider.name,
    startedAt: performance.now(), controller: new AbortController(),
    stopped: false, batchId: batch?.id || null, whatIf: Boolean(options.whatIf),
  };
  activeRuns.set(provider.id, task);
  updateRunUi();
  return (async () => {
    try {
      const body = await requestModel(provider.id, payload, task.controller.signal, task.id);
      if (task.stopped) return;
      rememberModelResult(provider.id, payload, body);
      if (batch) batch.completed.add(provider.id);
      if (options.whatIf) {
        whatIfVariant = {providerId: provider.id, payload: cloneJsonValue(payload), response: body, time: new Date().toISOString()};
        renderWhatIf();
      }
      if (currentProvider === provider.id) renderActiveOutput();
      renderModelComparison();
      activateTab(options.whatIf ? "whatif" : batch ? "compare" : "cards");
    } catch (errorObj) {
      if (!task.stopped && errorObj.name !== "AbortError") {
        const detail = errorObj.message || String(errorObj);
        const message = detail.startsWith(`${provider.name}:`) ? detail : `${provider.name}: ${detail}`;
        if (batch) batch.failures.push(message);
        els.validation.textContent = batch ? batch.failures.join(" · ") : message;
      }
    } finally {
      if (activeRuns.get(provider.id) === task) activeRuns.delete(provider.id);
      updateRunUi();
      renderModelComparison();
      if (!activeRuns.size) loadProviders().catch(() => {});
    }
  })();
}

async function runPrediction() {
  const provider = activeProvider();
  if (!provider) { openModelSettings(); return; }
  if (activeRuns.has(provider.id)) { stopModelRun(provider.id); return; }
  if (comparisonBatch?.running) return;
  if (!requestJsonReadyForRun()) return;
  const {payload, error} = buildPayload();
  if (!payload) { els.validation.textContent = error; return; }
  els.validation.textContent = "";
  if (!comparisonBatch?.running) comparisonBatch = null;
  await startModelRun(provider, payload);
}

async function runComparison() {
  if (comparisonBatch?.running) {
    for (const id of comparisonBatch.targets) stopModelRun(id);
    comparisonBatch.running = false;
    updateRunUi();
    return;
  }
  if (activeRuns.size) return;
  const targets = providerList({enabledOnly:true, compareOnly:true});
  if (targets.length < 2) {
    toast("Select at least two enabled models in Settings → Run set.");
    openModelSettings();
    return;
  }
  if (!requestJsonReadyForRun()) return;
  const {payload, error} = buildPayload();
  if (!payload) { els.validation.textContent = error; return; }
  els.validation.textContent = "";
  const batch = {id: ++runSerial, targets: targets.map((provider) => provider.id), completed: new Set(), stopped: new Set(), failures: [], running: true, payload: cloneJsonValue(payload), experimentName: experimentName(), presetId: els.preset.value || ""};
  comparisonBatch = batch;
  renderModelComparison();
  activateTab("compare");
  await Promise.allSettled(targets.map((provider) => startModelRun(provider, payload, batch)));
  batch.running = false;
  if (!batch.stopped.size && batch.completed.size) rememberComparisonRun(batch);
  updateRunUi();
  renderModelComparison();
}

function rememberComparisonRun(batch) {
  const models = batch.targets.filter((id) => batch.completed.has(id) && currentResponses[id]);
  if (!models.length) return;
  history.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    kind: "comparison",
    time: new Date().toISOString(),
    experimentName: batch.experimentName,
    presetId: batch.presetId,
    state: batch.payload.state,
    questions: batch.payload.questions,
    inputMode: currentInputMode,
    models,
    results: Object.fromEntries(models.map((id) => [id, currentResponses[id]])),
  });
  history = history.slice(0, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
}

function renderActiveOutput() {
  renderPythonExample();
  const provider = activeProvider();
  if (!provider) {
    els.emptyResults.classList.remove("hidden");
    els.emptyResultsCopy.textContent = "Open Settings and add a System One-compatible model endpoint.";
    els.resultCards.innerHTML = "";
    refreshExpandControl();
    renderStyledJson(els.rawResponseJson, {});
    renderStyledJson(els.rawRequestJson, buildPayload().payload || {});
    els.outputModelBadge.textContent = "No model";
    resetTiming();
    return;
  }
  const body = currentResponses[provider.id];
  if (!body) {
    els.emptyResults.classList.remove("hidden");
    els.emptyResultsCopy.textContent = provider.demo
      ? "Choose a preset, then run this built-in simulation. No API key needed. Its numbers are illustrative, not AI predictions."
      : `${provider.name} has no result for this experiment yet. Every run is fresh.`;
    els.resultCards.innerHTML = "";
    refreshExpandControl();
    renderStyledJson(els.rawResponseJson, {});
    document.querySelector(".raw-response-pane .json-card-head strong").textContent = provider.demo ? "Locally generated demo response" : "Raw server response";
    renderStyledJson(els.rawRequestJson, upstreamRequestPreview(buildPayload().payload,provider) || {});
    resetTiming();
    return;
  }
  renderResponse(body, currentPayloads[provider.id]?.questions || currentQuestions, provider.id);
}

function resetTiming() {
  els.inferenceTiming.textContent = "—";
  els.totalTiming.textContent = "—";
  els.callInfoBar.classList.add("hidden");
  els.callInfoBar.innerHTML = "";
}

function renderCallInfo(meta, providerId) {
  const provider = providers[providerId] || {};
  const usage = meta?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const hasUsage = usage.reported === true;
  const hasInput = hasUsage && usage.input_reported !== false;
  const hasOutput = hasUsage && usage.output_reported !== false;
  const fields = [
    ["Model", meta?.model || provider.model || provider.name || providerId],
    ["HTTP", meta?.demo ? "Local demo" : meta?.upstream_status != null ? String(meta.upstream_status) : "—"],
    ["Input", hasInput ? `${formatTokenCount(inputTokens)} tokens` : "—"],
    ["Output", hasOutput ? `${formatTokenCount(outputTokens)} tokens` : "—"],
    ["Total", hasUsage ? `${formatTokenCount(usage.total_tokens)} tokens` : "—"],
    ["Cost", meta?.cost_usd != null ? formatCost(meta.cost_usd) : "—"],
  ];
  if (meta?.prediction_number != null) fields.push(["Call", `#${meta.prediction_number}`]);
  if (meta?.request_id) fields.push(["Request", String(meta.request_id)]);
  if (meta?.attempts && Number(meta.attempts) > 1) fields.push(["Attempts", String(meta.attempts)]);
  els.callInfoBar.innerHTML = fields.map(([label,value]) => `<span class="call-info-item"><small>${escapeHtml(label)}</small><b title="${escapeHtml(value)}">${escapeHtml(value)}</b></span>`).join("");
  els.callInfoBar.classList.remove("hidden");
}

function activeExpandableDetails() {
  if (document.querySelector("#whatifTab").classList.contains("active")) return [...els.whatIfDiff.querySelectorAll(".whatif-tested-changes, .whatif-ranking")];
  if (document.querySelector("#cardsTab").classList.contains("active")) return [...els.resultCards.querySelectorAll(".result-details")];
  return [];
}

function refreshExpandControl() {
  const details = activeExpandableDetails();
  const expanded = details.length > 0 && details.every((item)=>item.open);
  els.toggleDistributions.disabled = details.length === 0;
  els.toggleDistributions.textContent = expanded ? "Collapse all" : "Expand all";
  els.toggleDistributions.setAttribute("aria-expanded",String(expanded));
}

function renderResponse(body, questions, providerId) {
  els.emptyResults.classList.add("hidden");
  els.resultCards.innerHTML = "";
  renderStyledJson(els.rawRequestJson, body?.upstream_request ?? currentPayloads[providerId] ?? {});
  renderStyledJson(els.rawResponseJson, body?.upstream_response_text ?? body?.upstream_response ?? body?.result ?? body);
  const meta = responseMeta(body);
  document.querySelector(".raw-response-pane .json-card-head strong").textContent = meta.demo ? "Locally generated demo response" : "Raw server response";
  els.inferenceTiming.textContent = formatMs(meta.inference_ms ?? meta.api_ms ?? meta.request_ms);
  els.totalTiming.textContent = formatMs(meta.total_backend_ms ?? meta.request_ms ?? meta.api_ms);
  els.inferenceLabel.textContent = meta.inference_ms != null ? "Inference" : "Request";
  renderCallInfo(meta, providerId);

  const answers = responseAnswers(body);
  const entries = Object.entries(answers);
  const expand = distributionPreference ?? entries.length <= 2;
  els.resultCards.classList.toggle("dense-results", entries.length >= 3);
  entries.forEach(([id, answer]) => els.resultCards.appendChild(buildResultCard(id, answer, questions?.[id] || {}, expand, providerId)));
  // Show web search sources if available
  const webSources = body?.upstream_response?.web_sources || body?.result?.web_sources || body?.web_sources;
  if (webSources && webSources.length) {
    const sourcesCard = document.createElement("div");
    sourcesCard.className = "result-card web-sources-card";
    sourcesCard.innerHTML = `<div class="result-card-head"><strong>Web sources used</strong><span class="tag">${webSources.length} sources</span></div><ul class="web-sources-list">${webSources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a><span class="web-source-snippet">${s.snippet || ''}</span></li>`).join("")}</ul>`;
    els.resultCards.appendChild(sourcesCard);
  }
  refreshExpandControl();
  if (!entries.length) els.resultCards.innerHTML = `<div class="empty-state compact"><p>No <code>answers</code> object was returned. Check Raw JSON.</p></div>`;
  els.resultCards.classList.remove("results-updated");
  requestAnimationFrame(() => els.resultCards.classList.add("results-updated"));
}

function inferType(answer) {
  if (answer && Object.prototype.hasOwnProperty.call(answer, "choice")) return "choice";
  if (answer && Object.prototype.hasOwnProperty.call(answer, "score")) return "score";
  if (answer && Object.prototype.hasOwnProperty.call(answer, "noul")) return "noul";
  return "unknown";
}

function resultSubtitle(type) {
  if (type === "choice") return "Categorical decision";
  if (type === "score") return "Ordered rubric";
  if (type === "noul") return "Boolean probability";
  return "Decision";
}

function questionHint(question) {
  const value = question?.instructions;
  if (value == null) return "";
  return (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ").trim();
}

function labelMapForScore(question, answer) {
  const labels = {};
  if (Array.isArray(question.criteria)) question.criteria.forEach((label,index) => labels[String(index)] = typeof label === "string" ? label : JSON.stringify(label));
  if (answer?.legend && typeof answer.legend === "object") Object.entries(answer.legend).forEach(([key,label]) => labels[String(key)] = String(label));
  return labels;
}

function addConfidence(card, confidence) {
  const p = normalizeProbability(confidence);
  if (p === null) {
    const block = document.createElement("div");
    block.className = "confidence-block confidence-unavailable";
    block.innerHTML = '<div class="confidence-head"><span class="confidence-label">Confidence</span><span class="confidence-value">Not provided</span></div>';
    card.appendChild(block);
    return;
  }
  const band = p >= .75 ? "high" : p >= .55 ? "medium" : "low";
  const label = band === "high" ? "High" : band === "medium" ? "Medium" : "Low";
  const block = document.createElement("div");
  block.className = `confidence-block confidence-${band}`;
  block.innerHTML = `
    <div class="confidence-head"><span class="confidence-label">Confidence</span><span class="confidence-value">${pct(p)}</span><span class="confidence-band">${label}</span></div>
    <div class="confidence-track"><span class="confidence-fill" style="width:${(p*100).toFixed(2)}%"></span></div>`;
  card.appendChild(block);
}

function renderProbabilityRows(list, entries, labels, winnerKey, booleanMode = false) {
  const sorted = [...entries].sort((a,b) => b[1]-a[1]);
  for (const [key,p] of sorted) {
    const winner = String(key) === String(winnerKey);
    const row = document.createElement("div");
    row.className = `prob-row${winner ? " winner" : ""}`;
    if (booleanMode) row.classList.add(String(key)==="true" ? "bool-yes" : "bool-no");
    const label = labels[String(key)] ?? key;
    const percent = (p*100).toFixed(1);
    row.innerHTML = `
      <span class="prob-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="prob-track">
        <span class="prob-fill" style="width:${percent}%"></span>
      </span>
      <span class="prob-value">${percent}%</span>`;
    list.appendChild(row);
  }
}

function appendDistribution(card, entries, labels, winnerKey, booleanMode = false, expanded = true) {
  if (!entries.length) return;
  const details = document.createElement("details");
  details.className = "result-details";
  details.open = expanded;
  details.innerHTML = `<summary><span>Probability distribution</span><span>${entries.length} outcome${entries.length===1?"":"s"}</span></summary>`;
  const list = document.createElement("div");
  list.className = "prob-list";
  details.appendChild(list);
  renderProbabilityRows(list, entries, labels, winnerKey, booleanMode);
  card.appendChild(details);
}

function addScorePosition(card, score, criteria) {
  if (!numberish(score) || !Array.isArray(criteria) || criteria.length < 2) return;
  const max = criteria.length - 1;
  const numeric = Math.max(0, Math.min(max, Number(score)));
  const position = max ? numeric / max : 0;
  const block = document.createElement("div");
  block.className = "score-position";
  block.innerHTML = `
    <div class="score-position-head"><span>Rubric position</span><b>${escapeHtml(formatScore(numeric))} / ${max}</b></div>
    <div class="score-position-track">
      <span class="score-position-fill" style="width:${(position*100).toFixed(2)}%"></span>
    </div>
    <div class="score-position-labels"><span>${escapeHtml(criteria[0])}</span><span>${escapeHtml(criteria[max])}</span></div>`;
  card.appendChild(block);
}

function buildResultCard(id, answer, question, expandDetails, providerId) {
  const type = answer?.type || question?.type || inferType(answer);
  const hint = questionHint(question);
  const card = document.createElement("article");
  card.className = `result-card type-${type}`;
  card.innerHTML = `
    <div class="result-head">
      <div class="result-heading-copy"><div class="result-label-line"><span class="result-title" title="${escapeHtml(id)}">${escapeHtml(id)}</span>${hint ? `<span class="result-question-hint" title="${escapeHtml(hint)}" aria-label="Question: ${escapeHtml(hint)}">${escapeHtml(hint)}</span>` : ""}</div><div class="result-subtitle">${escapeHtml(resultSubtitle(type))}</div></div>
      <div class="result-badges"><span class="model-badge ${providerBadgeClass(providerId)}" style="--model-h:${providerHue(providerId)}">${escapeHtml(providerLabel(providerId))}</span><span class="type-badge">${escapeHtml(typeLabel(type))}</span></div>
    </div>`;

  if (type === "choice") {
    const entries = probabilityEntries(answer?.probabilities);
    const selected = String(answer?.choice ?? [...entries].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "—");
    const selectedProbability = entries.find(([key]) => key === selected)?.[1] ?? null;
    const hero = document.createElement("div");
    hero.className = "answer-hero";
    hero.innerHTML = `<div class="primary-answer">${escapeHtml(selected)}</div><div class="primary-metric">${selectedProbability===null?"—":pct(selectedProbability)}<span class="primary-metric-label">probability</span></div>`;
    card.appendChild(hero);
    addConfidence(card, answer?.confidence);
    appendDistribution(card, entries, {}, selected, false, expandDetails);
    return card;
  }

  if (type === "score") {
    const entries = probabilityEntries(answer?.probabilities || answer?.distribution);
    const labels = labelMapForScore(question, answer);
    let winnerKey = entries.length ? [...entries].sort((a,b)=>b[1]-a[1])[0][0] : null;
    if (winnerKey === null && numberish(answer?.score) && Array.isArray(question.criteria)) winnerKey = String(Math.max(0,Math.min(question.criteria.length-1,Math.round(Number(answer.score)))));
    const level = winnerKey !== null ? (labels[winnerKey] ?? `Level ${winnerKey}`) : "—";
    const hero = document.createElement("div");
    hero.className = "answer-hero";
    hero.innerHTML = `<div class="primary-answer">${escapeHtml(level)}</div><div class="primary-metric">${escapeHtml(formatScore(answer?.score))}<span class="primary-metric-label">score${Array.isArray(question.criteria) ? ` / ${question.criteria.length-1}` : ""}</span></div>`;
    card.appendChild(hero);
    addConfidence(card, answer?.confidence);
    appendDistribution(card, entries, labels, winnerKey, false, expandDetails);
    return card;
  }

  if (type === "noul") {
    const pTrue = normalizeProbability(answer?.noul);
    const yes = pTrue !== null && pTrue >= .5;
    const win = pTrue === null ? null : (yes ? pTrue : 1-pTrue);
    card.classList.add(yes ? "answer-yes" : "answer-no");
    const hero = document.createElement("div");
    hero.className = "answer-hero";
    hero.innerHTML = `<div class="primary-answer">${win===null?"—":(yes?"YES":"NO")}</div><div class="primary-metric">${win===null?"—":pct(win)}<span class="primary-metric-label">probability</span></div>`;
    card.appendChild(hero);
    if (pTrue !== null) appendDistribution(card, [["true",pTrue],["false",1-pTrue]], {true:"Yes / True",false:"No / False"}, yes?"true":"false", true, expandDetails);
    return card;
  }

  card.insertAdjacentHTML("beforeend", `<div class="answer-hero"><div class="primary-answer">${escapeHtml(JSON.stringify(answer))}</div></div>`);
  return card;
}

function scoreWinnerLabel(answer, question) {
  const entries = probabilityEntries(answer?.probabilities || answer?.distribution);
  const labels = labelMapForScore(question || {}, answer || {});
  if (entries.length) {
    const key = [...entries].sort((a,b)=>b[1]-a[1])[0][0];
    return labels[key] ?? `Level ${key}`;
  }
  if (numberish(answer?.score) && Array.isArray(question?.criteria) && question.criteria.length) {
    return question.criteria[Math.max(0,Math.min(question.criteria.length-1,Math.round(Number(answer.score))))];
  }
  return "score";
}

function summarizeAnswer(answer, question = {}) {
  if (!answer) return {label:"—",metric:"No result",confidence:null,type:question.type||"unknown"};
  const type = question.type || answer.type || inferType(answer);
  if (type === "choice") {
    const entries = probabilityEntries(answer.probabilities);
    const selected = String(answer.choice ?? [...entries].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "—");
    const probability = entries.find(([key])=>key===selected)?.[1] ?? null;
    return {label:selected,metric:probability===null?"—":pct(probability),confidence:normalizeProbability(answer.confidence),type};
  }
  if (type === "score") return {label:scoreWinnerLabel(answer,question),metric:`Score ${formatScore(answer.score)}`,confidence:normalizeProbability(answer.confidence),type};
  if (type === "noul") {
    const p = normalizeProbability(answer.noul);
    if (p===null) return {label:"—",metric:"—",confidence:normalizeProbability(answer.confidence),type};
    const yes = p>=.5;
    return {label:yes?"YES":"NO",metric:pct(yes?p:1-p),confidence:normalizeProbability(answer.confidence),type};
  }
  return {label:"Result",metric:JSON.stringify(answer),confidence:normalizeProbability(answer.confidence),type};
}

function compareConfidenceHtml(value) {
  const p = normalizeProbability(value);
  if (p===null) return `<span class="compare-confidence muted">Confidence —</span>`;
  const band = p>=.75?"high":p>=.55?"medium":"low";
  return `<span class="compare-confidence confidence-${band}">Confidence ${pct(p)}</span>`;
}

function matchDecisions(beforeQuestions = {}, afterQuestions = {}) {
  const beforeIds = Object.keys(beforeQuestions), afterIds = Object.keys(afterQuestions);
  const usedBefore = new Set(), usedAfter = new Set(), pairs = [];
  const pair = (beforeId, afterId) => {
    usedBefore.add(beforeId); usedAfter.add(afterId);
    pairs.push({beforeId, afterId});
  };
  beforeIds.forEach((id) => { if (Object.prototype.hasOwnProperty.call(afterQuestions, id)) pair(id, id); });
  beforeIds.filter((id)=>!usedBefore.has(id)).forEach((beforeId) => {
    const body = JSON.stringify(beforeQuestions[beforeId]);
    const afterId = afterIds.find((id)=>!usedAfter.has(id) && JSON.stringify(afterQuestions[id]) === body);
    if (afterId !== undefined) pair(beforeId, afterId);
  });
  beforeIds.filter((id)=>!usedBefore.has(id)).forEach((beforeId) => {
    const afterId = afterIds[beforeIds.indexOf(beforeId)];
    if (afterId !== undefined && !usedAfter.has(afterId) && beforeQuestions[beforeId]?.type === afterQuestions[afterId]?.type) pair(beforeId, afterId);
  });
  const remainingBefore = beforeIds.filter((id)=>!usedBefore.has(id));
  const remainingAfter = afterIds.filter((id)=>!usedAfter.has(id));
  if (remainingBefore.length === 1 && remainingAfter.length === 1 && beforeQuestions[remainingBefore[0]]?.type === afterQuestions[remainingAfter[0]]?.type) {
    pair(remainingBefore[0], remainingAfter[0]);
  }
  return {pairs, removed:beforeIds.filter((id)=>!usedBefore.has(id)), added:afterIds.filter((id)=>!usedAfter.has(id))};
}

function changedInputFields(before, after) {
  const changes = [];
  const walk = (left, right, path) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    const leftObject = left !== null && typeof left === "object";
    const rightObject = right !== null && typeof right === "object";
    if (left === undefined && rightObject && Object.keys(right).length) {
      Object.keys(right).forEach((key)=>walk(undefined,right[key],`${path}${Array.isArray(right)?`[${key}]`:`.${key}`}`));
      return;
    }
    if (right === undefined && leftObject && Object.keys(left).length) {
      Object.keys(left).forEach((key)=>walk(left[key],undefined,`${path}${Array.isArray(left)?`[${key}]`:`.${key}`}`));
      return;
    }
    if (leftObject && rightObject && Array.isArray(left) === Array.isArray(right)) {
      if (!Array.isArray(left) && /\.criteria$/.test(path)) {
        const oldOrder = Object.keys(left), newOrder = Object.keys(right);
        if (oldOrder.length === newOrder.length && oldOrder.every((key)=>newOrder.includes(key)) && oldOrder.some((key,index)=>key !== newOrder[index])) {
          changes.push({label:`${path.replace(/^questions\.([^.[\]]+)/,"Decision $1").replace(/\./g," › ")} › option order`,kind:"reordered",before:oldOrder.join(" → "),after:newOrder.join(" → ")});
        }
      }
      if (Array.isArray(left) && /\.criteria$/.test(path) && left.length === right.length && left.some((value,index)=>JSON.stringify(value)!==JSON.stringify(right[index])) && [...left].map(JSON.stringify).sort().join("|") === [...right].map(JSON.stringify).sort().join("|")) {
        changes.push({label:`${path.replace(/^questions\.([^.[\]]+)/,"Decision $1").replace(/\./g," › ")} › level order`,kind:"reordered",before:left.join(" → "),after:right.join(" → ")});
        return;
      }
      const keys = Array.isArray(left) ? Array.from({length:Math.max(left.length,right.length)},(_,i)=>i) : [...new Set([...Object.keys(left),...Object.keys(right)])];
      keys.forEach((key) => walk(left[key], right[key], `${path}${Array.isArray(left) ? `[${key}]` : `.${key}`}`));
      return;
    }
    const label = path.replace(/^state/, "State").replace(/^questions\.([^.[\]]+)/, "Decision $1")
      .replace(/\.instructions$/, " · question").replace(/\.criteria\.(true|false)$/, " · $1 meaning").replace(/\.criteria\.([^.[\]]+)/g, " · option $1")
      .replace(/\.criteria\[(\d+)\]/g, " · level $1").replace(/\./g, " › ");
    changes.push({label, kind:left === undefined ? "added" : right === undefined ? "removed" : "changed", before:left, after:right});
  };
  walk(before.state, after.state, "state");
  const matched = matchDecisions(before.questions, after.questions);
  matched.pairs.forEach(({beforeId,afterId}) => {
    if (beforeId !== afterId) changes.push({label:"Decision ID",kind:"changed",before:beforeId,after:afterId});
    walk(before.questions[beforeId], after.questions[afterId], `questions.${afterId}`);
  });
  matched.removed.forEach((id)=>changes.push({label:`Decision ${id}`,kind:"removed",before:before.questions[id],after:undefined}));
  matched.added.forEach((id)=>changes.push({label:`Decision ${id}`,kind:"added",before:undefined,after:after.questions[id]}));
  return changes;
}

function changeValuePreview(value, counterpart) {
  if (value === undefined) return "—";
  const source = JSON.stringify(value);
  const other = counterpart === undefined ? "" : JSON.stringify(counterpart);
  if (source.length <= 100) return source;
  let first = 0;
  while (first < source.length && first < other.length && source[first] === other[first]) first += 1;
  const start = Math.max(0, first - 26), end = Math.min(source.length, first + 64);
  return `${start ? "…" : ""}${source.slice(start,end)}${end < source.length ? "…" : ""}`;
}

function renderInputChanges(changes, heading) {
  return `<strong>${escapeHtml(heading)} · ${changes.length} change${changes.length===1?"":"s"}</strong><div class="whatif-change-list">${changes.slice(0,30).map((item)=>`<div class="whatif-change ${item.kind}"><span class="whatif-change-path">${escapeHtml(item.label)}</span><span class="whatif-change-kind">${escapeHtml(item.kind)}</span><div class="whatif-change-values"><span title="${escapeHtml(item.before === undefined ? "Not present" : JSON.stringify(item.before))}"><small>Before</small><code>${escapeHtml(changeValuePreview(item.before,item.after))}</code></span><span aria-hidden="true">→</span><span title="${escapeHtml(item.after === undefined ? "Not present" : JSON.stringify(item.after))}"><small>After</small><code>${escapeHtml(changeValuePreview(item.after,item.before))}</code></span></div></div>`).join("")}${changes.length>30?`<span class="whatif-more">+${changes.length-30} more changes</span>`:""}</div>`;
}

function signedDelta(value, unit = "pp") {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= .05 ? 1 : Math.abs(value) >= .0005 ? 3 : 6;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)} ${unit}`;
}

function whatIfDeltaHtml(value, unit = "pp") {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const label = direction === "up" ? "Increase" : direction === "down" ? "Decrease" : "No movement";
  const delta = signedDelta(value, unit);
  return `<b class="whatif-delta ${direction}" aria-label="${label}: ${escapeHtml(delta)}">${escapeHtml(delta)}</b>`;
}

function whatIfPercentPair(before, after) {
  const digits = before !== null && after !== null && Math.abs(after-before)*100 < .05 ? 6 : 1;
  return `${pct(before,digits)} → ${pct(after,digits)}`;
}

function whatIfRanking(answer) {
  return probabilityEntries(answer?.probabilities || answer?.distribution)
    .sort((a,b) => b[1]-a[1]).map(([key],index) => [key,index+1]);
}

function whatIfDecisionHtml(id, beforeAnswer, afterAnswer, beforeQuestion, afterQuestion) {
  const question = afterQuestion || beforeQuestion || {};
  const type = question.type || inferType(afterAnswer || beforeAnswer);
  const before = summarizeAnswer(beforeAnswer, beforeQuestion || question);
  const after = summarizeAnswer(afterAnswer, afterQuestion || question);
  const answerChanged = before.label !== after.label;
  const answerLine = answerChanged ? `<div class="whatif-answer-line"><span>${escapeHtml(before.label)}</span><span aria-hidden="true">→</span><strong>${escapeHtml(after.label)}</strong></div>` : "";
  const metrics = [];
  const oldConfidence = normalizeProbability(beforeAnswer?.confidence);
  const newConfidence = normalizeProbability(afterAnswer?.confidence);
  if (type === "noul") {
    const a = normalizeProbability(beforeAnswer?.noul), b = normalizeProbability(afterAnswer?.noul);
    if (a !== b) metrics.push(`<span>P(Yes) ${whatIfPercentPair(a,b)}${a !== null && b !== null ? ` ${whatIfDeltaHtml((b-a)*100)}` : ""}</span>`);
  } else if (type === "choice") {
    const a = Object.fromEntries(probabilityEntries(beforeAnswer?.probabilities));
    const b = Object.fromEntries(probabilityEntries(afterAnswer?.probabilities));
    const oldSelected = beforeAnswer?.choice, newSelected = afterAnswer?.choice;
    const oldP = oldSelected == null ? null : a[oldSelected] ?? null;
    const newP = newSelected == null ? null : b[newSelected] ?? null;
    if (oldP !== newP) {
      metrics.push(`<span>Chosen-answer probability ${whatIfPercentPair(oldP,newP)}${oldP !== null && newP !== null ? ` ${whatIfDeltaHtml((newP-oldP)*100)}` : ""}</span>`);
    }
  } else if (type === "score") {
    const a = numberish(beforeAnswer?.score) ? Number(beforeAnswer.score) : null;
    const b = numberish(afterAnswer?.score) ? Number(afterAnswer.score) : null;
    if (a !== b) metrics.push(`<span>Score ${a === null ? "—" : escapeHtml(String(a))} → ${b === null ? "—" : escapeHtml(String(b))}${a !== null && b !== null ? ` ${whatIfDeltaHtml(b-a,"levels")}` : ""}</span>`);
  }
  if (oldConfidence !== newConfidence) metrics.push(`<span>Confidence ${whatIfPercentPair(oldConfidence,newConfidence)}${oldConfidence !== null && newConfidence !== null ? ` ${whatIfDeltaHtml((newConfidence-oldConfidence)*100)}` : ""}</span>`);
  const oldRanks = new Map(whatIfRanking(beforeAnswer)), newRanks = new Map(whatIfRanking(afterAnswer));
  const oldProb = Object.fromEntries(probabilityEntries(beforeAnswer?.probabilities || beforeAnswer?.distribution));
  const newProb = Object.fromEntries(probabilityEntries(afterAnswer?.probabilities || afterAnswer?.distribution));
  const rankKeys = [...new Set([...oldRanks.keys(),...newRanks.keys()])];
  const changedRankKeys = rankKeys.filter((key)=>oldRanks.get(key)!==newRanks.get(key) || oldProb[key]!==newProb[key]);
  const rankMoves = changedRankKeys.filter((key)=>oldRanks.get(key)!==newRanks.get(key)).length;
  const ranking = changedRankKeys.length ? `<details class="whatif-ranking"><summary>${rankMoves ? `${rankMoves} option ranking change${rankMoves===1?"":"s"}` : `${changedRankKeys.length} option probabilit${changedRankKeys.length===1?"y":"ies"} changed`} · view details</summary><div class="whatif-rank-list">${changedRankKeys.map((key) => {
    const oldRank = oldRanks.get(key), newRank = newRanks.get(key);
    const label = type === "score" ? (afterQuestion?.criteria?.[Number(key)] ?? beforeQuestion?.criteria?.[Number(key)] ?? key) : key;
    const oldP = oldProb[key] ?? null, newP = newProb[key] ?? null;
    const rankText = oldRank !== newRank ? `<span>#${oldRank ?? "—"} → #${newRank ?? "—"}</span>` : "";
    const probabilityText = oldP !== newP ? `<span class="whatif-rank-prob">${escapeHtml(whatIfPercentPair(oldP,newP))}${oldP !== null && newP !== null ? ` · ${whatIfDeltaHtml((newP-oldP)*100)}` : ""}</span>` : "";
    return `<div><span>${escapeHtml(label)}</span>${rankText}${probabilityText}</div>`;
  }).join("")}</div></details>` : "";
  if (!answerChanged && !metrics.length && !ranking) return "";
  const status = !beforeAnswer ? "Decision added" : !afterAnswer ? "Decision removed" : answerChanged ? "Answer changed" : "";
  return `<article class="whatif-decision ${answerChanged ? "answer-changed" : "output-changed"}"><div class="whatif-decision-head"><div><span class="eyebrow">${escapeHtml(typeLabel(type))}</span><strong>${escapeHtml(id)}</strong><small title="${escapeHtml(questionHint(question))}">${escapeHtml(questionHint(question))}</small></div>${status ? `<span class="whatif-answer-status">${status}</span>` : ""}</div>${answerLine}${metrics.length ? `<div class="whatif-metrics">${metrics.join("")}</div>` : ""}${ranking}</article>`;
}

function renderWhatIf() {
  const {payload:formPayload} = buildPayload();
  const edited = requestJsonUserDirty ? null : formPayload;
  const currentResult = currentResponses[currentProvider];
  const resultMatchesEditor = Boolean(currentResult && edited && payloadSignature(currentPayloads[currentProvider]) === payloadSignature(edited));
  els.whatIfBaseline.disabled = !resultMatchesEditor || Boolean(activeRuns.get(currentProvider));
  els.whatIfClear.disabled = !whatIfBaseline;
  if (!whatIfBaseline) {
    els.whatIfStatus.textContent = !currentResult ? "Step 1 · Run the current experiment. A result is needed for the baseline." : resultMatchesEditor ? "Step 2 · Capture this result as the baseline." : "The latest result belongs to a different experiment. Run the current form, then capture its result.";
    els.whatIfChanges.innerHTML = "";
    els.whatIfDiff.innerHTML = '<div class="empty-state compact"><p>After capturing a baseline, edit any field or rerun unchanged to explore how the answer moves.</p></div>';
    els.whatIfRun.disabled = true;
    els.whatIfRun.textContent = "Run variant";
    refreshExpandControl();
    return;
  }
  const baselineProvider = providers[whatIfBaseline.providerId];
  const connectionChanged = !baselineProvider || whatIfConnectionSignature(baselineProvider) !== whatIfBaseline.providerSignature;
  const changes = edited ? changedInputFields(whatIfBaseline.payload, edited) : [];
  const sameModel = currentProvider === whatIfBaseline.providerId;
  const variantRunning = Boolean(activeRuns.get(whatIfBaseline.providerId)?.whatIf);
  const otherRunActive = activeRuns.has(whatIfBaseline.providerId) && !variantRunning;
  const baselineDate = new Date(whatIfBaseline.time);
  const when = Number.isNaN(baselineDate.getTime()) ? "earlier" : baselineDate.toLocaleString();
  const note = connectionChanged ? " · Connection changed. Run and capture a new baseline." : !sameModel ? " · Select the baseline model to continue." : !edited ? " · Fix the form to run a variant." : changes.length ? ` · ${changes.length} draft input change${changes.length===1?"":"s"}` : " · No draft input changes";
  els.whatIfStatus.innerHTML = `Baseline: <b>${escapeHtml(providerLabel(whatIfBaseline.providerId))}</b> · ${escapeHtml(when)}${note}`;
  els.whatIfRun.disabled = !variantRunning && (!edited || !sameModel || connectionChanged || otherRunActive || Boolean(comparisonBatch?.running));
  els.whatIfRun.textContent = variantRunning ? "Stop variant" : "Run variant";
  els.whatIfChanges.innerHTML = changes.length ? renderInputChanges(changes,"Draft input changes") : `<p>No input changes. Run the same request again to check whether the model responds consistently.</p>`;
  if (connectionChanged || !sameModel) {
    els.whatIfDiff.innerHTML = `<div class="empty-state compact"><p>${connectionChanged ? "This baseline used the previous connection settings. Run and capture a new baseline." : "Select the baseline model to view and run this comparison."}</p></div>`;
    refreshExpandControl();
    return;
  }
  if (requestJsonUserDirty) {
    els.whatIfDiff.innerHTML = '<div class="empty-state compact"><p>Finish the Request JSON edit to refresh this comparison.</p></div>';
    refreshExpandControl();
    return;
  }
  const stale = whatIfVariant && (!edited || payloadSignature(edited) !== payloadSignature(whatIfVariant.payload));
  if (stale && !variantRunning) whatIfVariant = null;
  if (!whatIfVariant || whatIfVariant.providerId !== whatIfBaseline.providerId) {
    els.whatIfDiff.innerHTML = `<div class="empty-state compact"><p>${stale ? "The form changed after the previous variant. Run this draft to refresh the comparison." : variantRunning ? "Variant running… changes will appear when it finishes." : "Run this draft to compare it with the captured baseline."}</p></div>`;
    refreshExpandControl();
    return;
  }
  const runChanges = changedInputFields(whatIfBaseline.payload, whatIfVariant.payload);
  const beforeQuestions = whatIfBaseline.payload.questions, afterQuestions = whatIfVariant.payload.questions;
  const beforeAnswers = responseAnswers(whatIfBaseline.response), afterAnswers = responseAnswers(whatIfVariant.response);
  const matched = matchDecisions(beforeQuestions, afterQuestions);
  const outputChanges = [
    ...matched.pairs.map(({beforeId,afterId})=>whatIfDecisionHtml(afterId,beforeAnswers[beforeId],afterAnswers[afterId],beforeQuestions[beforeId],afterQuestions[afterId])),
    ...matched.removed.map((id)=>whatIfDecisionHtml(id,beforeAnswers[id],undefined,beforeQuestions[id],undefined)),
    ...matched.added.map((id)=>whatIfDecisionHtml(id,undefined,afterAnswers[id],undefined,afterQuestions[id])),
  ].filter(Boolean);
  els.whatIfDiff.innerHTML = `<div class="whatif-result-summary"><strong>${outputChanges.length} changed output${outputChanges.length===1?"":"s"} · ${runChanges.length} input change${runChanges.length===1?"":"s"} tested</strong><span>Same model · separate fresh calls</span></div><details class="whatif-tested-changes"><summary>Review the exact changes tested</summary>${renderInputChanges(runChanges,"Tested input changes")}</details>${outputChanges.length ? outputChanges.join("") : `<div class="whatif-no-output-change">No displayed output changed in this fresh run.</div>`}`;
  if (whatIfExpandPreference !== null) els.whatIfDiff.querySelectorAll(".whatif-tested-changes, .whatif-ranking").forEach((item)=>{ item.open = whatIfExpandPreference; });
  refreshExpandControl();
}

function captureWhatIfBaseline() {
  if (!requestJsonReadyForRun()) return;
  const response = currentResponses[currentProvider], payload = currentPayloads[currentProvider];
  if (!response || !payload) { toast("Run this model first, then capture its result as a baseline."); return; }
  const edited = buildPayload().payload;
  if (!edited || payloadSignature(edited) !== payloadSignature(payload)) { toast("This result belongs to a different form. Run the current form first."); return; }
  whatIfBaseline = {providerId:currentProvider,providerSignature:whatIfConnectionSignature(activeProvider()),payload:cloneJsonValue(payload),response:cloneJsonValue(response),time:new Date().toISOString()};
  whatIfVariant = null;
  renderWhatIf();
  saveWorkspace();
  activateTab("whatif");
}

async function runWhatIfVariant() {
  if (!whatIfBaseline) return;
  const provider = providers[whatIfBaseline.providerId];
  if (activeRuns.get(whatIfBaseline.providerId)?.whatIf) { stopModelRun(whatIfBaseline.providerId); renderWhatIf(); return; }
  if (!provider || provider.enabled === false || currentProvider !== provider.id || comparisonBatch?.running || activeRuns.has(provider.id) || whatIfConnectionSignature(provider) !== whatIfBaseline.providerSignature) return;
  if (!requestJsonReadyForRun()) return;
  const {payload,error} = buildPayload();
  if (!payload) { els.validation.textContent = error; return; }
  whatIfVariant = null;
  els.validation.textContent = "";
  renderWhatIf();
  await startModelRun(provider,payload,null,{whatIf:true});
}

function renderModelComparison() {
  const ids = comparisonBatch ? comparisonBatch.targets.filter((id) => providers[id] && comparisonBatch.completed.has(id) && currentResponses[id]) : providerList().map((p)=>p.id).filter((id)=>currentResponses[id]);
  if (!ids.length || (!comparisonBatch && ids.length < 2)) {
    const waiting = comparisonBatch?.running;
    els.compareContent.innerHTML = `<div class="empty-state compact"><p>${waiting ? `Running ${comparisonBatch.targets.length} models… results appear here as each finishes.` : ids.length ? "Run at least one more model on the same experiment, or click Run selected models." : "Run selected models to evaluate the same experiment across two or more models."}</p></div>`;
    return;
  }

  const current = buildPayload().payload;
  const currentSig = payloadSignature(current);
  const resultSigs = ids.map((id)=>payloadSignature(currentPayloads[id]));
  const sameResults = resultSigs.every((sig)=>sig && sig===resultSigs[0]);
  const matchesEditor = ids.every((id)=>payloadSignature(currentPayloads[id])===currentSig);
  const fair = sameResults && matchesEditor;

  const keys = new Set();
  ids.forEach((id)=>Object.keys(responseAnswers(currentResponses[id])).forEach((key)=>keys.add(key)));
  const progress = comparisonBatch ? `${ids.length} of ${comparisonBatch.targets.length} models finished${comparisonBatch.stopped.size ? ` · ${comparisonBatch.stopped.size} stopped` : ""}` : `${ids.length} models · same experiment`;
  els.compareContent.innerHTML = `
    <section class="compare-overview ${fair?"matched":"stale"}">
      <div><span class="eyebrow">Comparison</span><strong>${fair ? progress : "Results are not directly comparable yet"}</strong><p>${fair ? comparisonBatch?.running ? "Completed results are shown below while the remaining models run." : "Every model below evaluated the exact state and decision definitions currently in the editor." : "The editor or one of the model runs differs. Click Run selected models for a clean comparison."}</p></div>
      <div class="compare-speed">${ids.map((id)=>`<span class="compare-speed-item"><span class="model-badge ${providerBadgeClass(id)}" style="--model-h:${providerHue(id)}">${escapeHtml(providerLabel(id))}</span><b>${escapeHtml(formatMs(responseMeta(currentResponses[id]).request_ms ?? responseMeta(currentResponses[id]).api_ms ?? responseMeta(currentResponses[id]).inference_ms))}</b></span>`).join("")}${comparisonBatch?.running ? comparisonBatch.targets.filter((id)=>!comparisonBatch.completed.has(id) && !comparisonBatch.stopped.has(id)).map((id)=>`<span class="compare-speed-item pending"><span class="model-badge ${providerBadgeClass(id)}" style="--model-h:${providerHue(id)}">${escapeHtml(providerLabel(id))}</span><b>Running…</b></span>`).join("") : ""}</div>
    </section>`;

  for (const decisionId of keys) {
    const question = ids.map((id)=>currentPayloads[id]?.questions?.[decisionId]).find(Boolean) || currentQuestions[decisionId] || {};
    const hint = questionHint(question);
    const summaries = ids.map((id)=>({id,summary:summarizeAnswer(responseAnswers(currentResponses[id])[decisionId],question)}));
    const labels = summaries.map((x)=>String(x.summary.label).toLowerCase());
    const agree = labels.length > 1 && new Set(labels).size===1;
    const card = document.createElement("article");
    card.className = `model-compare-card type-${question.type || summaries[0]?.summary.type || "unknown"}`;
    card.innerHTML = `
      <div class="model-compare-head"><div><strong>${escapeHtml(decisionId)}</strong>${hint ? `<span class="compare-question-hint" title="${escapeHtml(hint)}" aria-label="Question: ${escapeHtml(hint)}">${escapeHtml(hint)}</span>` : ""}</div><span class="agreement-badge ${agree?"agree":"differ"}">${ids.length < 2 ? "Awaiting comparison" : agree ? "All agree" : "Outputs differ"}</span></div>
      <div class="model-compare-grid multi" style="--model-count:${summaries.length}">
        ${summaries.map(({id,summary})=>`<div class="model-side"><span class="model-badge ${providerBadgeClass(id)}" style="--model-h:${providerHue(id)}">${escapeHtml(providerLabel(id))}</span><div class="compare-answer">${escapeHtml(summary.label)}</div><div class="compare-metric">${escapeHtml(summary.metric)}</div>${summary.type === "noul" ? "" : compareConfidenceHtml(summary.confidence)}</div>`).join("")}
      </div>`;
    els.compareContent.appendChild(card);
  }
}

function historySummary(item) {
  if (item.kind === "comparison") {
    const firstId = Object.keys(item.questions || {})[0];
    return (item.models || []).map((id) => {
      const summary = summarizeAnswer(responseAnswers(item.results?.[id])[firstId],item.questions?.[firstId] || {});
      return `${providerLabel(id)}: ${summary.label} ${summary.metric}`;
    }).join(" · ") || "Comparison result";
  }
  const answers = responseAnswers(item.response);
  const pieces = [];
  for (const [id,answer] of Object.entries(answers).slice(0,3)) {
    const question = item.questions?.[id] || {};
    const summary = summarizeAnswer(answer, question);
    pieces.push(`${id}: ${summary.label} ${summary.metric}`);
  }
  return pieces.join(" · ") || "Prediction result";
}

function historyHasUnavailableModel(item) {
  const ids = item.kind === "comparison" ? (item.models || []) : [item.provider];
  return ids.some((id)=>!providers[id]);
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!history.length) {
    els.historyList.innerHTML = `<div class="history-empty">Fresh runs will appear here. “Use as example” reloads an old input but rerunning always makes a new model request.</div>`;
    return;
  }
  history.forEach((item,index) => {
    const name = item.provider?.startsWith("demo-") ? providerLabel(item.provider) : providers[item.provider]?.name || item.providerName || item.provider || "Model";
    const date = new Date(item.time);
    const meta = item.kind === "comparison" ? {} : responseMeta(item.response);
    const modelIds = item.kind === "comparison" ? (item.models || []) : [item.provider];
    const unavailable = historyHasUnavailableModel(item);
    const modelBadges = modelIds.map((id)=>`<span class="model-badge ${providerBadgeClass(id)}" style="--model-h:${providerHue(id)}">${escapeHtml(id === item.provider ? name : providerLabel(id))}</span>`).join("");
    const itemEl = document.createElement("article");
    itemEl.className = "history-item";
    itemEl.innerHTML = `
      <button class="history-main" type="button">
        <div class="history-time"><span>${escapeHtml(date.toLocaleString())}</span><span>${item.kind === "comparison" ? "Comparison" : "Single model"}</span></div>
        <div class="history-name">${escapeHtml(item.experimentName || "Experiment")}</div>
        <div class="history-preview">${escapeHtml(statePreview(item.state))}</div>
        <div class="history-model-line">${modelBadges}</div>
        <div class="history-summary">${escapeHtml(historySummary(item))}</div>
        <div class="history-meta">${escapeHtml(decisionTypeSummary(item.questions))}${item.kind === "comparison" ? ` · ${modelIds.length} models` : ` · ${escapeHtml(formatMs(meta.request_ms ?? meta.api_ms ?? meta.inference_ms))}`}</div>
      </button>
      <div class="history-actions"><button class="btn btn-small ghost history-view" type="button" ${unavailable ? 'disabled title="This model is not currently available. Use the experiment as an example."' : ""}>View result</button><button class="btn btn-small history-load" type="button">Use as example</button></div>`;
    itemEl.querySelector(".history-main").addEventListener("click",()=>unavailable ? loadHistoryIntoEditor(index) : viewHistoryRun(index));
    itemEl.querySelector(".history-view").addEventListener("click",()=>viewHistoryRun(index));
    itemEl.querySelector(".history-load").addEventListener("click",()=>loadHistoryIntoEditor(index));
    els.historyList.appendChild(itemEl);
  });
}

function questionsToDecisions(questions={}) {
  return Object.entries(questions).map(([id,q]) => {
    const {type, instructions, criteria, ...extraQuestion} = q;
    const data = {id,type,instructions,extraQuestion};
    if (q.type==="choice") data.optionRows = Object.entries(q.criteria || {}).map(([label,description])=>({label,description}));
    else if (q.type==="score") data.criteria = q.criteria || [];
    else if (q.type==="noul" && q.criteria) data.criteria = q.criteria;
    return data;
  });
}

function viewHistoryRun(index) {
  const item = history[index];
  if (!item) return;
  if (historyHasUnavailableModel(item)) { loadHistoryIntoEditor(index); return; }
  clearWhatIf();
  if (item.kind === "comparison") {
    resetModelResults();
    const models = item.models || [];
    models.forEach((id)=>{ currentResponses[id] = item.results?.[id] || null; currentPayloads[id] = {state:item.state,questions:item.questions}; });
    comparisonBatch = {id:`history-${item.id}`,targets:models,completed:new Set(models),stopped:new Set(),failures:[],running:false};
    currentQuestions = item.questions || {};
    if (models.find((id)=>providers[id]?.enabled !== false)) switchProvider(models.find((id)=>providers[id]?.enabled !== false));
    renderActiveOutput(); renderModelComparison(); activateTab("compare"); saveWorkspace();
    renderWhatIf();
    return;
  }
  comparisonBatch = null;
  if (providers[item.provider]) switchProvider(item.provider);
  currentResponses[item.provider] = item.response;
  currentPayloads[item.provider] = {state:item.state,questions:item.questions};
  currentQuestions = item.questions || {};
  renderActiveOutput();
  renderModelComparison();
  activateTab("cards");
  renderWhatIf();
  saveWorkspace();
}

function loadHistoryIntoEditor(index) {
  const item = history[index];
  if (!item) return;
  clearWhatIf();
  const mode = normalizeStoredInputMode(item.inputMode);
  populateEditor(item.state, questionsToDecisions(item.questions), mode);
  resetModelResults();
  if (historyHasUnavailableModel(item)) {
    comparisonBatch = null;
    currentQuestions = item.questions || {};
    renderActiveOutput(); renderModelComparison(); activateTab("cards"); saveWorkspace();
    toast("Experiment loaded. Its saved model is unavailable; run it with the current model.");
    return;
  }
  if (item.kind === "comparison") {
    const models = item.models || [];
    models.forEach((id)=>{ currentResponses[id] = item.results?.[id] || null; currentPayloads[id] = {state:item.state,questions:item.questions}; });
    comparisonBatch = {id:`history-${item.id}`,targets:models,completed:new Set(models),stopped:new Set(),failures:[],running:false};
    if (models.find((id)=>providers[id]?.enabled !== false)) switchProvider(models.find((id)=>providers[id]?.enabled !== false));
    currentQuestions = item.questions || {};
    renderActiveOutput(); renderModelComparison(); activateTab("compare"); saveWorkspace();
    renderWhatIf();
    toast("Comparison example loaded. Running it again makes fresh requests.");
    return;
  }
  comparisonBatch = null;
  if (providers[item.provider]) {
    currentResponses[item.provider] = item.response;
    currentPayloads[item.provider] = {state:item.state,questions:item.questions};
    switchProvider(item.provider);
  }
  currentQuestions = item.questions || {};
  renderActiveOutput();
  renderModelComparison();
  activateTab("cards");
  renderWhatIf();
  saveWorkspace();
  toast("History example loaded. Running it again will create a fresh result.");
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((button)=>{
    const active = button.dataset.tab===name;
    button.classList.toggle("active",active);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".tab-view").forEach((view)=>view.classList.remove("active"));
  document.querySelector(`#${name}Tab`)?.classList.add("active");
  if (name === "whatif") renderWhatIf();
  refreshExpandControl();
}

async function refreshStatus() {
  const provider = activeProvider();
  if (!provider) return;
  els.readyDot.className = "dot pending";
  els.readyText.textContent = "Checking…";
  try {
    const status = await apiFetch(`/api/providers/${encodeURIComponent(provider.id)}/status`, {}, {token:true});
    const p = status.provider || provider;
    providers[provider.id] = {...provider,...p};
    const ready = status.endpoint_ready !== false;
    els.readyDot.className = `dot ${ready?"ready":"error"}`;
    els.readyText.textContent = status.demo ? "Demo ready" : ready ? "Endpoint ready" : "Unavailable";
    els.readyText.title = status.demo ? "Built-in simulation, not an AI model" : status.error || provider.endpoint;
    els.predictionCount.textContent = p.total_calls ?? p.prediction_count ?? history.filter((x)=>x.provider===provider.id).length;
    els.tokenCount.textContent = p.usage_reported_calls || p.total_tokens ? formatTokenCount(p.total_tokens) : "—";
    els.costTotal.textContent = p.cost_recorded_calls || p.total_cost_usd ? formatCost(p.total_cost_usd) : "—";
    els.averageLatency.textContent = formatMs(p.average_request_ms);
  } catch (error) {
    els.readyDot.className = "dot error";
    els.readyText.textContent = "Status unavailable";
    els.readyText.title = error.message;
  }
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.setAttribute("role", "status");
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(()=>node.remove(),2200);
}

function currentRawRequestText() {
  return els.rawRequestJson?.dataset.raw || JSON.stringify(buildPayload().payload || {error: buildPayload().error}, null, 2);
}

function currentRawResponseText() {
  return els.rawResponseJson?.dataset.raw || "{}";
}

// Events
document.querySelectorAll("[data-add-type]").forEach((button)=>button.addEventListener("click",()=>addDecision(button.dataset.addType)));

els.modelSelect.addEventListener("change",()=>switchProvider(els.modelSelect.value));
els.modelSettings.addEventListener("click",openModelSettings);
els.themeToggle.addEventListener("click", toggleTheme);
els.closeModelSettings.addEventListener("click",closeModelSettings);
els.addModel.addEventListener("click",addModelSettingsRow);
els.reloadModels.addEventListener("click",async()=>{ await loadProviders(); await openModelSettings(); toast("Unsaved settings discarded"); });
els.saveModels.addEventListener("click",saveModelSettings);
els.settingsTabs.forEach((button)=>button.addEventListener("click",()=>switchSettingsTab(button.dataset.settingsTab)));
els.advancedProviderSelect.addEventListener("change",()=>{ advancedProviderId = els.advancedProviderSelect.value; renderAdvancedProviderEditor(); });
els.modelSettingsModal.addEventListener("click",(event)=>{ if (event.target===els.modelSettingsModal) closeModelSettings(); });

els.inputModeButtons.forEach((button)=>button.addEventListener("click",()=>setInputMode(button.dataset.inputMode)));
els.addStateField.addEventListener("click",()=>{
  const nextIndex = stateFieldsKind === "array" ? String(els.stateFields.children.length) : "";
  if (stateFieldsKind === "string") {
    if (stateCanonical === "" && els.stateFields.children.length === 1) els.stateFields.replaceChildren();
    stateFieldsKind = "object";
  }
  addStateField(nextIndex,"");
  els.stateFields.lastElementChild?.querySelector(".state-field-name")?.focus();
  stateViewDirty.fields = true;
  syncCanonicalFromFields();
  markExperimentChanged();
});
els.state.addEventListener("input",()=>{
  stateViewDirty.text = true;
  stateCanonical = els.state.value;
  autoGrowTextarea(els.state);
  updateInputExample();
  markExperimentChanged();
});
els.jsonState.addEventListener("input",()=>{
  stateViewDirty.json = true;
  autoGrowTextarea(els.jsonState);
  const raw = els.jsonState.value.trim();
  if (!raw) stateCanonical = "";
  else {
    try { stateCanonical = JSON.parse(raw); els.validation.textContent = ""; }
    catch { /* keep last valid canonical value until JSON becomes valid */ }
  }
  markExperimentChanged();
});
els.stateFields.addEventListener("input",(event)=>{
  if (event.target.matches(".state-field-value")) autoGrowTextarea(event.target);
  stateViewDirty.fields = true;
  syncCanonicalFromFields();
  markExperimentChanged();
});
els.decisionList.addEventListener("input",(event)=>{
  if (event.target instanceof HTMLTextAreaElement) autoGrowTextarea(event.target);
  markExperimentChanged();
});
els.requestJsonEditor.addEventListener("input",()=>{ autoGrowTextarea(els.requestJsonEditor); scheduleRequestJsonSync(); });
els.editorTabs.forEach((button)=>button.addEventListener("click",()=>switchEditorTab(button.dataset.editorTab)));
els.requestJsonEditor.addEventListener("blur",()=>{
  try {
    const payload = JSON.parse(els.requestJsonEditor.value);
    syncingRequestJson = true;
    els.requestJsonEditor.value = JSON.stringify(payload, null, 2);
    syncingRequestJson = false;
    autoGrowTextarea(els.requestJsonEditor);
  } catch {}
});

els.preset.addEventListener("change",()=>{ updateDeletePresetButton(); if (els.preset.value) applyPreset(els.preset.value); else saveWorkspace(); });
els.newBlank.addEventListener("click",newBlankExperiment);
els.savePreset.addEventListener("click", openPresetSaveModal);
els.deletePreset.addEventListener("click", deleteSelectedPreset);
els.closePresetSave.addEventListener("click", closePresetSaveModal);
els.cancelPresetSave.addEventListener("click", closePresetSaveModal);
els.confirmPresetSave.addEventListener("click", confirmSavePreset);
els.presetNameInput.addEventListener("keydown",(event)=>{ if (event.key === "Enter") { event.preventDefault(); confirmSavePreset(); } });
els.presetSaveModal.addEventListener("click",(event)=>{ if (event.target === els.presetSaveModal) closePresetSaveModal(); });
els.copyRawRequest.addEventListener("click",()=>copyText(currentRawRequestText(), "Request JSON copied"));
els.copyRawResponse.addEventListener("click",()=>copyText(currentRawResponseText(), "Response JSON copied"));
els.copyPython.addEventListener("click",()=>copyText(els.pythonRequestCode.textContent, "Python example copied"));
els.toggleDistributions.addEventListener("click",()=>{
  const details = activeExpandableDetails();
  if (!details.length) return;
  const expand = details.some((item)=>!item.open);
  if (document.querySelector("#whatifTab").classList.contains("active")) whatIfExpandPreference = expand;
  else distributionPreference = expand;
  details.forEach((item)=>{ item.open = expand; });
  refreshExpandControl();
});
els.resultCards.addEventListener("click",(event)=>{
  if (!(event.target instanceof Element) || event.target.closest(".result-details, button, a, input")) return;
  const card = event.target.closest(".result-card");
  if (!card || !els.resultCards.contains(card)) return;
  const details = card.querySelector(".result-details");
  if (details) details.open = !details.open;
});
els.resultCards.addEventListener("toggle",refreshExpandControl,true);
els.whatIfDiff.addEventListener("toggle",refreshExpandControl,true);
els.whatIfBaseline.addEventListener("click",captureWhatIfBaseline);
els.whatIfRun.addEventListener("click",runWhatIfVariant);
els.whatIfClear.addEventListener("click",()=>{ whatIfBaseline=null; whatIfVariant=null; renderWhatIf(); saveWorkspace(); });
els.exportExperiment.addEventListener("click",()=>{ if (!requestJsonReadyForRun()) return; const {payload,error}=buildPayload(); if (!payload) { toast(error); return; } showShareModal("export"); });
els.importExperiment.addEventListener("click",()=>els.importFile.click());
els.importFile.addEventListener("change",()=>importExperimentFile(els.importFile.files?.[0]));
els.closeShare.addEventListener("click",closeShareModal);
els.cancelShare.addEventListener("click",closeShareModal);
els.confirmShare.addEventListener("click",confirmShareAction);
els.shareModal.addEventListener("click",(event)=>{ if (event.target === els.shareModal) closeShareModal(); });
els.run.addEventListener("click",runPrediction);
els.runCompare.addEventListener("click",runComparison);
els.clearHistory.addEventListener("click",()=>{ history=[]; saveHistory(); renderHistory(); });
document.querySelectorAll(".tab").forEach((button)=>button.addEventListener("click",()=>activateTab(button.dataset.tab)));

document.addEventListener("keydown",(event)=>{
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (els.modelSettingsModal.classList.contains("hidden") && els.presetSaveModal.classList.contains("hidden") && els.shareModal.classList.contains("hidden")) runPrediction();
  }
  const modal = !els.shareModal.classList.contains("hidden") ? els.shareModal : !els.presetSaveModal.classList.contains("hidden") ? els.presetSaveModal : !els.modelSettingsModal.classList.contains("hidden") ? els.modelSettingsModal : null;
  if (event.key === "Tab" && modal) {
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((node) => node.getClientRects().length);
    if (focusable.length) {
      const first = focusable[0], last = focusable[focusable.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key === "Escape" && !els.shareModal.classList.contains("hidden")) closeShareModal();
  else if (event.key === "Escape" && !els.presetSaveModal.classList.contains("hidden")) closePresetSaveModal();
  else if (event.key === "Escape" && !els.modelSettingsModal.classList.contains("hidden")) closeModelSettings();
});

document.querySelectorAll('[role="tablist"]').forEach((list) => list.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  if (!tabs.includes(document.activeElement)) return;
  event.preventDefault();
  const index = tabs.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (index + (["ArrowRight","ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  if (tabs[next].dataset.tab) activateTab(tabs[next].dataset.tab);
  else if (tabs[next].dataset.editorTab) switchEditorTab(tabs[next].dataset.editorTab);
  else switchSettingsTab(tabs[next].dataset.settingsTab);
}));

async function init() {
  refreshCustomPresetOptions();
  applyTheme(localStorage.getItem(THEME_KEY) || "");
  try {
    await loadSession();
    await loadProviders();
  } catch (error) {
    els.validation.textContent = `Backend setup error: ${error.message}`;
  }
  restoreWorkspace();
  renderModelSelector();
  applyProviderUi();
  renderHistory();
  renderModelComparison();
  renderWhatIf();
  activateTab("cards");
  updateGeneratedJson();
  if (activeProvider()) refreshStatus();
  else window.setTimeout(openModelSettings, 250);
}

init();
