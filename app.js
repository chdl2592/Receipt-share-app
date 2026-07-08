const imageInput = document.querySelector("#imageInput");
const dropZone = document.querySelector("#dropZone");
const previewFrame = document.querySelector("#previewFrame");
const imagePreview = document.querySelector("#imagePreview");
const languageSelect = document.querySelector("#languageSelect");
const scanButton = document.querySelector("#scanButton");
const progressBar = document.querySelector("#progressBar");
const statusText = document.querySelector("#statusText");
const itemsList = document.querySelector("#itemsList");
const receiptTotal = document.querySelector("#receiptTotal");
const currencySelect = document.querySelector("#currencySelect");
const addItemButton = document.querySelector("#addItemButton");
const parseButton = document.querySelector("#parseButton");
const submitReceiptButton = document.querySelector("#submitReceiptButton");
const outputText = document.querySelector("#outputText");
const participantsPanel = document.querySelector("#participantsPanel");
const submittedItems = document.querySelector("#submittedItems");
const participantName = document.querySelector("#participantName");
const addParticipantButton = document.querySelector("#addParticipantButton");
const participantsList = document.querySelector("#participantsList");

const ignoredReceiptLabels = [
  "amount due",
  "balance",
  "card",
  "cash",
  "change",
  "credit",
  "debit",
  "discount",
  "paid",
  "payment",
  "subtotal",
  "tax",
  "tip",
  "total",
  "visa"
];

let selectedFile = null;
let previewUrl = null;
let items = [];
let submittedReceipt = [];
let participants = [];

function setStatus(message, progress = null) {
  statusText.textContent = message;
  if (progress !== null) {
    progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencySelect.value
  }).format(Number.isFinite(value) ? value : 0);
}

function parseMoney(value) {
  const cleaned = String(value)
    .replace(/[^\d.,-]/g, "")
    .replace(/,(?=\d{2}$)/, ".")
    .replace(/,/g, "");
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function toPositiveNumber(value, fallback = 0) {
  const number = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function toWholeCount(value, fallback = 0) {
  const number = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function makeItem({ name = "New item", quantity = 1, unitPrice = 0, lineTotal = null } = {}) {
  const normalizedQuantity = Math.max(toWholeCount(quantity, 1), 1);
  const normalizedUnit = Math.max(toPositiveNumber(unitPrice, 0), 0);
  const normalizedTotal = lineTotal === null
    ? normalizedQuantity * normalizedUnit
    : Math.max(toPositiveNumber(lineTotal, normalizedQuantity * normalizedUnit), 0);

  return {
    id: crypto.randomUUID(),
    name,
    quantity: normalizedQuantity,
    unitPrice: normalizedUnit || normalizedTotal / normalizedQuantity,
    lineTotal: normalizedTotal
  };
}

function getReceiptTotal(source = items) {
  return source.reduce((sum, item) => sum + item.lineTotal, 0);
}

function getParticipantTotal(participant) {
  return submittedReceipt.reduce((sum, item) => {
    const count = participant.claims[item.id] || 0;
    return sum + count * item.unitPrice;
  }, 0);
}

function getClaimedCount(itemId, exceptParticipantId = null) {
  return participants.reduce((sum, participant) => {
    if (participant.id === exceptParticipantId) return sum;
    return sum + (participant.claims[itemId] || 0);
  }, 0);
}

function looksLikeNonItem(label) {
  const normalized = label.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return ignoredReceiptLabels.some((word) => normalized === word || normalized.includes(word));
}

function isDividerLine(line) {
  const marks = line.replace(/\s/g, "");
  return marks.length >= 8 && /^[-_=~.]+$/.test(marks);
}

function getLikelyItemSection(lines) {
  const dividerIndexes = lines
    .map((line, index) => isDividerLine(line) ? index : -1)
    .filter((index) => index >= 0);

  for (let i = 0; i < dividerIndexes.length - 1; i += 1) {
    const start = dividerIndexes[i] + 1;
    const end = dividerIndexes[i + 1];
    const section = lines.slice(start, end);
    const itemLikeCount = section.filter((line) => /^\d+(?:[.,]\d{1,2})?\s+/.test(line)).length;

    if (itemLikeCount > 0) {
      return section;
    }
  }

  return lines;
}

function normalizeReceiptLines(text) {
  const allLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = getLikelyItemSection(allLines);
  const merged = [];

  lines.forEach((line) => {
    const startsItem = /^\d+[.,]\d{1,2}\s+/.test(line);
    const previous = merged[merged.length - 1];
    const previousLooksIncompleteItem = previous
      && /^\d+(?:[.,]\d{1,2})?\s+/.test(previous)
      && !/\d+(?:[.,]\d{2})?\s*$/.test(previous);
    const continuationLooksLikeName = previousLooksIncompleteItem
      && !/^\d/.test(line)
      && !/^-{3,}/.test(line)
      && !looksLikeNonItem(line);

    if (continuationLooksLikeName) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else if (startsItem || !previousLooksIncompleteItem) {
      merged.push(line);
    } else {
      merged[merged.length - 1] = `${previous} ${line}`;
    }
  });

  return merged;
}

function parseReceiptItems(text) {
  const rows = normalizeReceiptLines(text);
  const parsed = [];

  rows.forEach((line) => {
    const itemMatch = line.match(/^(\d+(?:[.,]\d{1,2})?)\s+(.+?)\s+\(?\s*(-?\s*\d+(?:[.,]\d{2})?)\s*\)?\s+(-?\s*\d+(?:[.,]\d{2})?)\s*$/i);
    if (itemMatch) {
      const quantity = toWholeCount(itemMatch[1], 1);
      const name = itemMatch[2].replace(/[|*_]/g, " ").replace(/\s+/g, " ").trim();
      const unitPrice = Math.abs(parseMoney(itemMatch[3]));
      const lineTotal = Math.abs(parseMoney(itemMatch[4]));

      if (!name || looksLikeNonItem(name) || lineTotal === 0) return;
      parsed.push(makeItem({ name, quantity, unitPrice, lineTotal }));
      return;
    }

    const simpleMatch = line.match(/^(.*?)(-?\s*\d+(?:[.,]\d{2})?(?:\s*(?:kr|sek|usd|eur|gbp))?)\s*$/i);
    if (!simpleMatch) return;

    const name = simpleMatch[1].replace(/[|*_]/g, " ").replace(/\s+/g, " ").trim();
    const lineTotal = Math.abs(parseMoney(simpleMatch[2]));

    if (!name || lineTotal === 0 || looksLikeNonItem(name)) return;
    parsed.push(makeItem({ name, quantity: 1, unitPrice: lineTotal, lineTotal }));
  });

  return parsed;
}

function updateReceiptTotal() {
  receiptTotal.textContent = formatMoney(getReceiptTotal());
  submitReceiptButton.disabled = items.length === 0;
}

function renderReviewItems() {
  itemsList.innerHTML = "";

  if (items.length === 0) {
    itemsList.innerHTML = '<div class="empty-state">Scanned receipt items will appear here.</div>';
    updateReceiptTotal();
    return;
  }

  const header = document.createElement("div");
  header.className = "items-header";
  header.innerHTML = `
    <span>Item</span>
    <span>Qty</span>
    <span>Unit</span>
    <span>Total</span>
    <span></span>
  `;
  itemsList.append(header);

  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "item-row";
    row.dataset.id = item.id;

    row.innerHTML = `
      <input class="item-name" type="text" value="${escapeAttribute(item.name)}" aria-label="Item name">
      <input class="item-quantity" type="number" min="1" step="1" value="${item.quantity}" aria-label="Number of items">
      <input class="item-unit" type="number" min="0" step="0.01" value="${item.unitPrice.toFixed(2)}" aria-label="Cost per item">
      <input class="item-total" type="number" min="0" step="0.01" value="${item.lineTotal.toFixed(2)}" aria-label="Total cost">
      <button class="remove-button" type="button" aria-label="Remove item">Remove</button>
    `;

    itemsList.append(row);
  });

  updateReceiptTotal();
}

function renderSubmittedItems() {
  submittedItems.innerHTML = "";

  if (submittedReceipt.length === 0) {
    submittedItems.innerHTML = '<div class="empty-state">Submit the reviewed receipt to create the participant table.</div>';
    return;
  }

  const header = document.createElement("div");
  header.className = "submitted-header";
  header.innerHTML = `
    <span>Submitted item</span>
    <span>Qty</span>
    <span>Claimed</span>
    <span>Unit</span>
    <span>Total</span>
  `;
  submittedItems.append(header);

  submittedReceipt.forEach((item) => {
    const row = document.createElement("article");
    row.className = "submitted-row";
    const claimed = getClaimedCount(item.id);
    row.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <span>${item.quantity}</span>
      <span>${claimed} / ${item.quantity}</span>
      <span>${formatMoney(item.unitPrice)}</span>
      <strong>${formatMoney(item.lineTotal)}</strong>
    `;
    submittedItems.append(row);
  });
}

function renderParticipants() {
  participantsList.innerHTML = "";

  if (participants.length === 0) {
    participantsList.innerHTML = '<div class="empty-state compact">Add a person to start claiming item quantities.</div>';
    return;
  }

  participants.forEach((participant) => {
    const card = document.createElement("article");
    card.className = "participant-card";
    card.dataset.id = participant.id;

    const itemInputs = submittedReceipt.map((item) => `
      <label class="claim-row">
        <span>${escapeHtml(item.name)}</span>
        <input class="claim-input" type="number" min="0" max="${(participant.claims[item.id] || 0) + item.quantity - getClaimedCount(item.id, participant.id)}" step="1" value="${participant.claims[item.id] || 0}" data-item-id="${item.id}">
        <small>of ${item.quantity}</small>
      </label>
    `).join("");

    card.innerHTML = `
      <div class="participant-card-top">
        <strong>${escapeHtml(participant.name)}</strong>
        <span>${formatMoney(getParticipantTotal(participant))}</span>
      </div>
      <div class="claims-grid">${itemInputs}</div>
      <button class="remove-participant" type="button">Remove person</button>
    `;

    participantsList.append(card);
  });
}

function renderParticipantArea() {
  participantsPanel.classList.toggle("is-disabled", submittedReceipt.length === 0);
  addParticipantButton.disabled = submittedReceipt.length === 0 || participantName.value.trim().length === 0;
  renderSubmittedItems();
  renderParticipants();
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resetSubmittedReceipt() {
  submittedReceipt = [];
  participants = [];
  renderParticipantArea();
}

function rebuildItemsFromText() {
  items = parseReceiptItems(outputText.value);
  resetSubmittedReceipt();
  renderReviewItems();
  setStatus(items.length ? `Found ${items.length} likely receipt item${items.length === 1 ? "" : "s"}.` : "No item lines with quantities and prices were found.", 100);
}

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Please choose a valid image file.", 0);
    return;
  }

  selectedFile = file;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  previewUrl = URL.createObjectURL(file);
  imagePreview.src = previewUrl;
  previewFrame.hidden = false;
  scanButton.disabled = false;
  outputText.value = "";
  parseButton.disabled = true;
  items = [];
  resetSubmittedReceipt();
  renderReviewItems();
  setStatus(`${file.name} is ready to scan.`, 0);
}

imageInput.addEventListener("change", (event) => {
  loadFile(event.target.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  loadFile(event.dataTransfer.files[0]);
});

scanButton.addEventListener("click", async () => {
  if (!selectedFile) return;

  if (!window.Tesseract) {
    setStatus("OCR library could not load. Check your internet connection and refresh.", 0);
    return;
  }

  scanButton.disabled = true;
  parseButton.disabled = true;
  items = [];
  resetSubmittedReceipt();
  renderReviewItems();
  outputText.value = "";
  setStatus("Preparing receipt scan...", 6);

  try {
    const result = await Tesseract.recognize(selectedFile, languageSelect.value, {
      logger: (message) => {
        if (message.status) {
          const percent = message.progress ? Math.round(message.progress * 100) : 0;
          setStatus(`${message.status.replace(/_/g, " ")} ${percent ? `${percent}%` : ""}`.trim(), percent);
        }
      }
    });

    outputText.value = result.data.text.trim();
    parseButton.disabled = outputText.value.length === 0;
    rebuildItemsFromText();
  } catch (error) {
    console.error(error);
    setStatus("The scan failed. Try a clearer receipt photo or a different file.", 0);
  } finally {
    scanButton.disabled = false;
  }
});

itemsList.addEventListener("input", (event) => {
  const row = event.target.closest(".item-row");
  if (!row) return;

  const item = items.find((entry) => entry.id === row.dataset.id);
  if (!item) return;

  if (event.target.classList.contains("item-name")) {
    item.name = event.target.value;
  }

  if (event.target.classList.contains("item-quantity")) {
    item.quantity = Math.max(toWholeCount(event.target.value, item.quantity), 1);
    event.target.value = item.quantity;
    item.lineTotal = item.quantity * item.unitPrice;
    row.querySelector(".item-total").value = item.lineTotal.toFixed(2);
  }

  if (event.target.classList.contains("item-unit")) {
    item.unitPrice = Math.max(toPositiveNumber(event.target.value, 0), 0);
    item.lineTotal = item.quantity * item.unitPrice;
    row.querySelector(".item-total").value = item.lineTotal.toFixed(2);
  }

  if (event.target.classList.contains("item-total")) {
    item.lineTotal = Math.max(toPositiveNumber(event.target.value, 0), 0);
    item.unitPrice = item.quantity > 0 ? item.lineTotal / item.quantity : 0;
    row.querySelector(".item-unit").value = item.unitPrice.toFixed(2);
  }

  resetSubmittedReceipt();
  updateReceiptTotal();
});

itemsList.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-button")) return;

  const row = event.target.closest(".item-row");
  items = items.filter((item) => item.id !== row.dataset.id);
  resetSubmittedReceipt();
  renderReviewItems();
});

addItemButton.addEventListener("click", () => {
  items.push(makeItem({ name: "New item", quantity: 1, unitPrice: 0 }));
  resetSubmittedReceipt();
  renderReviewItems();
  itemsList.querySelector(".item-row:last-child .item-name").select();
});

submitReceiptButton.addEventListener("click", () => {
  submittedReceipt = items
    .filter((item) => item.name.trim() && item.quantity > 0)
    .map((item) => ({ ...item, id: crypto.randomUUID(), lineTotal: item.lineTotal }));
  participants = [];
  renderParticipantArea();
  setStatus(`Receipt submitted with ${submittedReceipt.length} item${submittedReceipt.length === 1 ? "" : "s"}.`, 100);
});

currencySelect.addEventListener("change", () => {
  renderReviewItems();
  renderParticipantArea();
});

parseButton.addEventListener("click", rebuildItemsFromText);

outputText.addEventListener("input", () => {
  parseButton.disabled = outputText.value.trim().length === 0;
});

participantName.addEventListener("input", () => {
  addParticipantButton.disabled = submittedReceipt.length === 0 || participantName.value.trim().length === 0;
});

addParticipantButton.addEventListener("click", () => {
  const name = participantName.value.trim();
  if (!name || submittedReceipt.length === 0) return;

  participants.push({
    id: crypto.randomUUID(),
    name,
    claims: Object.fromEntries(submittedReceipt.map((item) => [item.id, 0]))
  });
  participantName.value = "";
  addParticipantButton.disabled = true;
  renderParticipants();
});

participantsList.addEventListener("input", (event) => {
  if (!event.target.classList.contains("claim-input")) return;

  const card = event.target.closest(".participant-card");
  const participant = participants.find((entry) => entry.id === card.dataset.id);
  const item = submittedReceipt.find((entry) => entry.id === event.target.dataset.itemId);
  if (!participant || !item) return;

  const claim = Math.min(Math.max(toWholeCount(event.target.value, 0), 0), item.quantity);
  const available = item.quantity - getClaimedCount(item.id, participant.id);
  const cappedClaim = Math.min(claim, available + (participant.claims[item.id] || 0));
  participant.claims[item.id] = cappedClaim;
  event.target.value = cappedClaim;
  card.querySelector(".participant-card-top span").textContent = formatMoney(getParticipantTotal(participant));
  renderSubmittedItems();
});

participantsList.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-participant")) return;

  const card = event.target.closest(".participant-card");
  participants = participants.filter((participant) => participant.id !== card.dataset.id);
  renderSubmittedItems();
  renderParticipants();
});

renderReviewItems();
renderParticipantArea();
