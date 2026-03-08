const page = document.body.dataset.page;
const historyKey = "weblens-history-v1";
const state = {
  current: null,
  loadingTimer: null
};

document.addEventListener("DOMContentLoaded", () => {
  if (page === "home") {
    initHomePage();
  }

  if (page === "analyze") {
    initAnalyzePage();
  }
});

function initHomePage() {
  const form = document.getElementById("home-url-form");
  const input = document.getElementById("home-url-input");

  if (!form || !input) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const normalized = normalizeUrlInput(input.value);
    if (!normalized) {
      input.focus();
      return;
    }

    window.location.href = `/analyze?url=${encodeURIComponent(normalized)}`;
  });
}

function initAnalyzePage() {
  const form = document.getElementById("analyze-form");
  const input = document.getElementById("url-input");
  const resultsEl = document.getElementById("results");
  const loadingPanel = document.getElementById("loading-panel");
  const errorBox = document.getElementById("error-box");
  const askForm = document.getElementById("ask-form");
  const copyAnalysisBtn = document.getElementById("copy-analysis");
  const copyBlueprintBtn = document.getElementById("copy-blueprint");
  const shareAnalysisBtn = document.getElementById("share-analysis");

  renderHistory(loadHistory());

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const normalized = normalizeUrlInput(input.value);
    if (!normalized) {
      showError(errorBox, "Enter a valid website URL.");
      return;
    }

    await runAnalysis({
      url: normalized,
      input,
      loadingPanel,
      resultsEl,
      errorBox
    });
  });

  askForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const askInput = document.getElementById("ask-input");
    const answerEl = document.getElementById("ask-answer");
    const question = askInput?.value.trim();

    if (!question) {
      return;
    }

    if (!state.current) {
      answerEl.textContent = "Analyze a website first, then ask your question.";
      return;
    }

    answerEl.textContent = "Thinking...";

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          context: {
            url: state.current.url,
            analysis: state.current.analysis,
            blueprint: state.current.blueprint,
            scraped: {
              title: state.current.scraped.title,
              description: state.current.scraped.description,
              keywords: state.current.scraped.keywords,
              seoSignals: state.current.scraped.seoSignals
            }
          }
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not answer this question right now.");
      }

      answerEl.textContent = payload.data.answer;
      askInput.value = "";
    } catch (error) {
      answerEl.textContent = error.message || "Failed to get an answer.";
    }
  });

  copyAnalysisBtn?.addEventListener("click", () => {
    if (!state.current) {
      return;
    }

    copyToClipboard(buildAnalysisCopy(state.current), copyAnalysisBtn);
  });

  copyBlueprintBtn?.addEventListener("click", () => {
    if (!state.current) {
      return;
    }

    copyToClipboard(buildBlueprintCopy(state.current), copyBlueprintBtn);
  });

  shareAnalysisBtn?.addEventListener("click", () => {
    const currentUrl = new URL(window.location.href);
    copyToClipboard(currentUrl.href, shareAnalysisBtn);
  });

  const params = new URLSearchParams(window.location.search);
  const urlFromQuery = params.get("url");
  if (urlFromQuery) {
    const normalized = normalizeUrlInput(urlFromQuery);
    if (normalized) {
      input.value = normalized;
      runAnalysis({
        url: normalized,
        input,
        loadingPanel,
        resultsEl,
        errorBox
      });
    }
  }
}

async function runAnalysis({ url, input, loadingPanel, resultsEl, errorBox }) {
  clearError(errorBox);
  resultsEl.hidden = true;
  loadingPanel.hidden = false;
  input.value = url;
  setLoadingState(true);
  animateLoadingSteps();
  updateQueryParam(url);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Analysis failed.");
    }

    state.current = payload.data;
    renderResults(payload.data);
    saveHistory(payload.data);
    renderHistory(loadHistory());
    resultsEl.hidden = false;
  } catch (error) {
    showError(errorBox, error.message || "Could not analyze this URL.");
  } finally {
    setLoadingState(false);
    loadingPanel.hidden = true;
    stopLoadingSteps();
  }
}

function renderResults(data) {
  setText("source-badge", `Source: ${data.source}`);
  setText("site-domain", data.domain || "Unknown domain");
  setText("site-title", data.scraped.title || data.scraped.description || "No title extracted");

  const screenshot = document.getElementById("site-screenshot");
  if (screenshot) {
    screenshot.src = data.screenshotUrl;
    screenshot.alt = `Preview of ${data.domain}`;
  }

  const pills = document.getElementById("keyword-pills");
  if (pills) {
    pills.innerHTML = "";
    const topKeywords = (data.scraped.keywords || []).slice(0, 6);
    topKeywords.forEach((entry) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = entry.keyword;
      pills.appendChild(pill);
    });
  }

  setText("purpose-text", data.analysis.purpose || "No purpose generated.");
  setText("startup-text", data.analysis.startupIdea || "No startup idea generated.");
  setText("text-preview", data.scraped.textPreview || "No text preview extracted.");

  renderList("audience-list", data.analysis.targetAudience);
  renderList("business-list", data.analysis.businessModel);
  renderList("tech-list", data.analysis.techGuess);
  renderList("feature-list", data.analysis.likelyFeatures);
  renderList("improvements-list", data.analysis.improvementIdeas);
  renderList("marketing-list", data.analysis.marketingIdeas);
  renderList("seo-list", data.analysis.seoStrategy);
  renderList("competitor-list", data.analysis.competitorIdeas);
  renderList("traffic-list", data.analysis.trafficSources);

  renderList("blueprint-frontend", data.blueprint.frontend);
  renderList("blueprint-backend", data.blueprint.backend);
  renderList("blueprint-monetization", data.blueprint.monetization);
  renderList("blueprint-architecture", data.blueprint.architectureNotes);

  const headingItems = (data.scraped.headings || []).slice(0, 10).map((h) => `${h.level.toUpperCase()}: ${h.text}`);
  renderList("headings-list", headingItems);

  const linksList = document.getElementById("links-list");
  if (linksList) {
    linksList.innerHTML = "";
    const links = (data.scraped.links || []).slice(0, 8);
    if (!links.length) {
      const empty = document.createElement("li");
      empty.textContent = "No links captured.";
      linksList.appendChild(empty);
    }

    links.forEach((item) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = item.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.text || item.href;
      li.appendChild(a);
      linksList.appendChild(li);
    });
  }

  const askAnswer = document.getElementById("ask-answer");
  if (askAnswer) {
    askAnswer.textContent = "Ask a question to get a contextual answer.";
  }
}

function renderList(id, values) {
  const list = document.getElementById(id);
  if (!list) {
    return;
  }

  list.innerHTML = "";
  const items = Array.isArray(values) ? values.filter(Boolean) : [];

  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "No data available.";
    list.appendChild(li);
    return;
  }

  items.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    list.appendChild(li);
  });
}

function animateLoadingSteps() {
  stopLoadingSteps();
  const steps = [...document.querySelectorAll("#loading-steps li")];
  if (!steps.length) {
    return;
  }

  let current = 0;
  steps.forEach((step) => step.classList.remove("active", "done"));
  steps[0].classList.add("active");

  state.loadingTimer = setInterval(() => {
    const active = steps[current];
    if (active) {
      active.classList.remove("active");
      active.classList.add("done");
    }

    current = (current + 1) % steps.length;
    steps[current].classList.add("active");
  }, 1300);
}

function stopLoadingSteps() {
  if (state.loadingTimer) {
    clearInterval(state.loadingTimer);
    state.loadingTimer = null;
  }

  const steps = [...document.querySelectorAll("#loading-steps li")];
  steps.forEach((step) => step.classList.remove("active", "done"));
}

function setLoadingState(isLoading) {
  const btn = document.getElementById("analyze-button");
  const input = document.getElementById("url-input");
  if (btn) {
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? "0.8" : "1";
    btn.textContent = isLoading ? "Analyzing..." : "Analyze Website";
  }
  if (input) {
    input.disabled = isLoading;
  }
}

function showError(node, message) {
  if (!node) {
    return;
  }

  node.textContent = message;
  node.hidden = false;
}

function clearError(node) {
  if (!node) {
    return;
  }

  node.hidden = true;
  node.textContent = "";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function normalizeUrlInput(raw) {
  if (!raw || typeof raw !== "string") {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function updateQueryParam(url) {
  const next = new URL(window.location.href);
  next.searchParams.set("url", url);
  window.history.replaceState({}, "", next);
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(result) {
  const entry = {
    url: result.url,
    domain: result.domain,
    title: result.scraped.title || result.analysis.purpose || "Untitled analysis",
    timestamp: Date.now()
  };

  const existing = loadHistory().filter((item) => item.url !== entry.url);
  const next = [entry, ...existing].slice(0, 14);
  localStorage.setItem(historyKey, JSON.stringify(next));
}

function renderHistory(history) {
  const list = document.getElementById("history-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";

  if (!history.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No analyses yet.";
    list.appendChild(li);
    return;
  }

  history.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${escapeHtml(item.domain || item.url)}</strong><small>${new Date(item.timestamp).toLocaleString()}</small>`;

    button.addEventListener("click", () => {
      const input = document.getElementById("url-input");
      const resultsEl = document.getElementById("results");
      const loadingPanel = document.getElementById("loading-panel");
      const errorBox = document.getElementById("error-box");
      if (!input || !resultsEl || !loadingPanel || !errorBox) {
        return;
      }

      input.value = item.url;
      runAnalysis({
        url: item.url,
        input,
        loadingPanel,
        resultsEl,
        errorBox
      });
    });

    li.appendChild(button);
    list.appendChild(li);
  });
}

async function copyToClipboard(content, button) {
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const input = document.createElement("textarea");
    input.value = content;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  if (button) {
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }
}

function buildAnalysisCopy(data) {
  const lines = [
    `WebLens Analysis for ${data.domain}`,
    `URL: ${data.url}`,
    "",
    `Purpose: ${data.analysis.purpose}`,
    `Target Audience: ${(data.analysis.targetAudience || []).join(" | ")}`,
    `Business Model: ${(data.analysis.businessModel || []).join(" | ")}`,
    `Likely Features: ${(data.analysis.likelyFeatures || []).join(" | ")}`,
    `Tech Guess: ${(data.analysis.techGuess || []).join(" | ")}`,
    "",
    "Improvement Ideas:",
    ...(data.analysis.improvementIdeas || []).map((i) => `- ${i}`),
    "",
    "Marketing Ideas:",
    ...(data.analysis.marketingIdeas || []).map((i) => `- ${i}`)
  ];

  return lines.join("\n");
}

function buildBlueprintCopy(data) {
  const lines = [
    `WebLens Clone Blueprint for ${data.domain}`,
    "",
    "Frontend:",
    ...(data.blueprint.frontend || []).map((i) => `- ${i}`),
    "",
    "Backend:",
    ...(data.blueprint.backend || []).map((i) => `- ${i}`),
    "",
    "Monetization:",
    ...(data.blueprint.monetization || []).map((i) => `- ${i}`),
    "",
    "Architecture Notes:",
    ...(data.blueprint.architectureNotes || []).map((i) => `- ${i}`)
  ];

  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

