(function () {
  "use strict";

  // Config
  const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1MB allowed by API
  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif"];

  // Elements
  const chooseBtn = document.getElementById("chooseImage");
  const clearBtn = document.getElementById("clearImageBtn");
  const fileInput = document.getElementById("imageInput");
  const fileNameSpan = document.getElementById("fileName");
  const form = document.getElementById("productForm");
  const result = document.getElementById("result");
  const submitBtn = document.getElementById("submitBtn");
  const thumb = document.getElementById("thumb");
  const previewArea = document.getElementById("previewArea");
  const previewInfo = document.getElementById("previewInfo");

  // Message style mapping
  const messageStyles = {
    success: { bg: "var(--ok-bg)", border: "var(--ok-border)" },
    error: { bg: "var(--err-bg)", border: "var(--err-border)" },
    info: { bg: "var(--info-bg)", border: "var(--info-border)" },
  };

  // Utility: set result area with styled message
  function showMessage(text, kind = "info") {
    result.innerHTML = "";
    const div = document.createElement("div");
    div.textContent = text;
    const style = messageStyles[kind] || messageStyles.info;
    Object.assign(div.style, {
      padding: "10px",
      borderRadius: "6px",
      fontSize: "0.98rem",
      background: style.bg,
      border: `1px solid ${style.border}`,
    });
    result.appendChild(div);
  }

  // Utility: make a status row (label + check/X)
  function statusRow(label, value, ok) {
    const el = document.createElement("div");
    el.className = "status-row";

    const left = document.createElement("div");
    left.textContent = value ? `${label}: ${value}` : label;

    const right = document.createElement("div");
    right.setAttribute("aria-hidden", "true");
    right.style.fontSize = "1.1rem";
    right.textContent = ok ? "✅" : "❌";

    el.appendChild(left);
    el.appendChild(right);
    return el;
  }

  // Cleanly enable/disable form UI during upload
  function setUploading(isUploading) {
    chooseBtn.disabled = isUploading;
    clearBtn.disabled = isUploading;
    submitBtn.disabled = isUploading;
    submitBtn.textContent = isUploading ? "Uploading..." : "Submit";
  }

  // Update UI with selected file (name + preview)
  function updateSelectedFileUI(file) {
    if (!file) {
      fileNameSpan.textContent = "No file chosen";
      previewArea.style.display = "none";
      thumb.src = "";
      previewInfo.textContent = "";
      return;
    }

    const prettySizeKB = Math.round(file.size / 1024);
    fileNameSpan.textContent = `${file.name} (${prettySizeKB} KB)`;

    // Create preview
    const reader = new FileReader();
    reader.onload = () => {
      thumb.src = reader.result;
      previewInfo.textContent = `${file.type || ""} • ${prettySizeKB} KB`;
      previewArea.style.display = "grid";
    };
    reader.readAsDataURL(file);
  }

  // Validate selected file
  function validateFile(file) {
    if (!file) return "Please select an image file to upload.";
    if (file.size === 0) return "Selected file is empty.";
    if (file.size > MAX_SIZE_BYTES)
      return `File is too large (max ${Math.round(
        MAX_SIZE_BYTES / 1024 / 1024
      )} MB).`;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Unsupported file type. Use JPEG, PNG, or GIF.";
    }
    return null;
  }

  // Parse labelChecks from various response shapes
  function parseLabelChecks(resp, arrayPath) {
    const set = new Set();
    (arrayPath || []).forEach((k) => set.add(String(k)));
    return set;
  }

  // Extract a tolerant "foundSet" / "missingSet" from server response
  function parseServerLabelChecks(resp) {
    const found = new Set();
    const missing = new Set();

    try {
      if (!resp || typeof resp !== "object")
        return { foundSet: found, missingSet: missing };

      if (resp.labelChecks) {
        const foundSet = parseLabelChecks(resp, resp.labelChecks.found);
        const missingSet = parseLabelChecks(resp, resp.labelChecks.missing);
        foundSet.forEach((k) => found.add(k));
        missingSet.forEach((k) => missing.add(k));
      } else if (resp.fields && typeof resp.fields === "object") {
        Object.keys(resp.fields).forEach((k) => {
          const val = resp.fields[k];
          if (
            val &&
            (val.found === true || val.detected === true || val.match)
          ) {
            found.add(k);
          } else {
            missing.add(k);
          }
        });
      } else {
        const foundSet = parseLabelChecks(resp, resp.found);
        const missingSet = parseLabelChecks(resp, resp.missing);
        foundSet.forEach((k) => found.add(k));
        missingSet.forEach((k) => missing.add(k));
      }
    } catch (e) {
      // swallow and return empty sets
    }

    return { foundSet: found, missingSet: missing };
  }

  // Field metadata
  const FIELDS = ["brandName", "productClass", "alcoholContent"];
  const FIELD_LABELS = {
    brandName: "Brand Name",
    productClass: "Product Class",
    alcoholContent: "Alcohol Content",
  };

  // Show message for response
  function showResponseMessage(respJson, { foundSet, missingSet }) {
    // Prefer server reason if provided
    if (respJson && respJson.reason) {
      const reasonText = String(respJson.reason);
      if (reasonText.toLowerCase().includes("timed out")) {
        showMessage(
          "Image processing timed out. Please try again or use a clearer photo.",
          "error"
        );
      } else if (respJson.success === true) {
        showMessage(reasonText, "success");
      } else if (respJson.success === false) {
        showMessage(reasonText, "error");
      } else {
        showMessage(reasonText, "info");
      }
      return;
    }

    // Fallback: infer from labelChecks
    const allFound = FIELDS.every((k) => foundSet.has(k) && !missingSet.has(k));
    if (foundSet.size > 0 && allFound) {
      showMessage(
        "Label verification successful — all submitted fields were found.",
        "success"
      );
    } else if (missingSet.size > 0) {
      showMessage(
        "Label verification incomplete — some fields were not found.",
        "error"
      );
    } else {
      showMessage("Unable to verify label fields.", "error");
    }
  }

  // Render verification results using tolerant parsing
  function renderVerification(respJson, formValues) {
    const container = document.createElement("div");
    const labelChecks = parseServerLabelChecks(respJson);

    showResponseMessage(respJson, labelChecks);

    // Append per-field rows
    FIELDS.forEach((key) => {
      const val = formValues[key] || "";
      const { foundSet, missingSet } = labelChecks;
      const ok = foundSet.has(key) && !missingSet.has(key);
      container.appendChild(statusRow(FIELD_LABELS[key], val, ok));
    });

    result.appendChild(container);
  }

  // Event handlers
  chooseBtn.addEventListener("click", () => fileInput.click());

  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    updateSelectedFileUI(null);
  });

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    updateSelectedFileUI(f);
  });

  // Submit handler
  form.addEventListener("submit", async (ev) => {
    if (!form.reportValidity()) return;

    ev.preventDefault();
    result.innerHTML = "";

    const fd = new FormData(form);
    const formValues = {
      brandName: String(fd.get("brandName") || "").trim(),
      productClass: String(fd.get("productClass") || "").trim(),
      alcoholContent: String(fd.get("alcoholContent") || "").trim(),
    };

    const file = fileInput.files && fileInput.files[0];
    const validationError = validateFile(file);
    if (validationError) {
      showMessage(validationError, "error");
      return;
    }

    showMessage("Uploading image and verifying label — uploading...", "info");
    setUploading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch(form.action || "/upload", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (err) {
        showMessage("Unexpected server response. Please try again.", "error");
        return;
      }
      renderVerification(json, formValues);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err && err.name === "AbortError") {
        showMessage(
          "Request timed out. Try again or use a smaller/clearer image.",
          "error"
        );
      } else {
        showMessage(
          "Network error while sending image. Check your connection and try again.",
          "error"
        );
        console.error("Upload error:", err);
      }
    } finally {
      setUploading(false);
    }
  });

  // Initialize UI (if file pre-selected by browser)
  if (fileInput.files && fileInput.files[0]) {
    updateSelectedFileUI(fileInput.files[0]);
  }
})();
