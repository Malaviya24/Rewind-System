const form = document.getElementById("licenseForm");
const message = document.getElementById("message");
const resultPanel = document.getElementById("resultPanel");
const licenseKeyField = document.getElementById("licenseKey");
const payloadPreview = document.getElementById("payloadPreview");
const copyButton = document.getElementById("copyButton");
const generateButton = document.getElementById("generateButton");
const adminTokenField = document.getElementById("adminToken");
const deviceIdField = document.getElementById("deviceId");

adminTokenField.value = sessionStorage.getItem("rewindLicenseAdminToken") || "";

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function showPayload(payload) {
  const rows = [
    ["Customer", payload.customerName],
    ["Platform", payload.platform],
    ["Device", payload.deviceId],
    ["Issued", payload.issuedAt],
    ["Type", payload.licenseType]
  ];
  payloadPreview.innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

function normalizeDeviceCode() {
  deviceIdField.value = deviceIdField.value.trim().toUpperCase().replace(/\s+/g, "");
}

deviceIdField.addEventListener("blur", normalizeDeviceCode);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  normalizeDeviceCode();
  setMessage("Generating license...");
  resultPanel.classList.add("hidden");
  generateButton.disabled = true;

  const data = new FormData(form);
  const adminToken = String(data.get("adminToken") || "").trim();
  sessionStorage.setItem("rewindLicenseAdminToken", adminToken);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        platform: data.get("platform"),
        deviceId: data.get("deviceId"),
        customerName: data.get("customerName"),
        appId: data.get("appId")
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "License could not be generated.");
    }
    licenseKeyField.value = result.licenseKey;
    showPayload(result.payload);
    resultPanel.classList.remove("hidden");
    setMessage("License generated successfully.", "success");
  } catch (error) {
    setMessage(error.message || "License could not be generated.", "error");
  } finally {
    generateButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(licenseKeyField.value);
    setMessage("License copied.", "success");
  } catch {
    licenseKeyField.select();
    document.execCommand("copy");
    setMessage("License copied.", "success");
  }
});
