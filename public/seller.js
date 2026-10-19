(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  let products = [];
  let adminKey = sessionStorage.getItem("lk_admin_key") || "";

  // API helper with Admin key header
  async function api(path, method = "GET", body = null) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (adminKey) headers["x-admin-key"] = adminKey;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Server error occurred");
    return data;
  }

  /* ---------- AUTHENTICATION DIALOG ---------- */
  const authModal = $("#authModal");
  const authInput = $("#adminPinInput");
  const authBtn = $("#btnAuthLogin");
  const authError = $("#authError");
  const mainContent = $("#mainContentWrapper");

  function showAuthModal() {
    authModal.classList.add("show");
    mainContent.classList.add("blur-screen");
    authInput.value = "";
    authError.textContent = "";
    authInput.focus();
  }

  function hideAuthModal() {
    authModal.classList.remove("show");
    mainContent.classList.remove("blur-screen");
  }

  async function checkAuth(keyToTest) {
    try {
      const res = await fetch("/api/seller/verify-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminKey: keyToTest })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Incorrect Admin PIN.");
      
      adminKey = keyToTest;
      sessionStorage.setItem("lk_admin_key", adminKey);
      hideAuthModal();
      loadProducts();
    } catch (e) {
      authError.textContent = e.message;
      authInput.focus();
    }
  }

  authBtn.addEventListener("click", () => {
    const val = authInput.value.trim();
    if (!val) {
      authError.textContent = "Please enter Admin Password.";
      return;
    }
    checkAuth(val);
  });

  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      authBtn.click();
    }
  });

  $("#btnLogoutAdmin")?.addEventListener("click", () => {
    sessionStorage.removeItem("lk_admin_key");
    adminKey = "";
    showAuthModal();
  });

  /* ---------- CATALOG & INVENTORY ---------- */
  async function loadProducts() {
    try {
      const data = await api("/api/products");
      products = data.map(p => ({
        ...p,
        priceRupees: Math.round(p.price / 100),
        mrpRupees: Math.round(p.mrp / 100),
        stock: p.stock || 50
      }));
      renderTable();
      $("#totalCount").textContent = products.length;
    } catch (e) {
      console.error("Failed to load catalog", e);
    }
  }

  function renderTable(filterQuery = "") {
    const tbody = $("#inventoryTableBody");
    const q = filterQuery.toLowerCase().trim();
    const list = products.filter(p => (p.name + " " + p.id + " " + p.category).toLowerCase().includes(q));

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#888;">No products found in catalog.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(p => {
      const offPct = Math.round(100 - (p.priceRupees / p.mrpRupees) * 100);
      return `
        <tr>
          <td>
            <div class="product-cell">
              <span class="thumb">${p.emoji || "🛍️"}</span>
              <span class="product-title" title="${p.name}">${p.name}</span>
            </div>
          </td>
          <td><b>${p.id}</b></td>
          <td>${p.category}</td>
          <td><b>₹${p.priceRupees.toLocaleString("en-IN")}</b></td>
          <td><span style="color:#888;text-decoration:line-through;">₹${p.mrpRupees.toLocaleString("en-IN")}</span></td>
          <td><b style="color:#038d63;">${offPct}% OFF</b></td>
          <td>${p.stock} units</td>
          <td><span class="badge-live">Live</span></td>
          <td>
            <button class="btn-delete-row" data-del="${p.id}">Remove</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  function updateProfitCalc() {
    const price = Number($("#pPrice").value) || 0;
    const mrp = Number($("#pMrp").value) || 0;

    if (mrp > 0 && price > 0) {
      const disc = Math.max(0, Math.round(100 - (price / mrp) * 100));
      $("#calcDiscount").textContent = disc + "% OFF";
      $("#calcSettlement").textContent = "₹" + price.toLocaleString("en-IN");
    } else {
      $("#calcDiscount").textContent = "0% OFF";
      $("#calcSettlement").textContent = "₹0";
    }
  }

  $("#pPrice").addEventListener("input", updateProfitCalc);
  $("#pMrp").addEventListener("input", updateProfitCalc);

  // Tabs Switch
  $("#tabAddSingle").addEventListener("click", () => {
    $("#tabAddSingle").classList.add("active");
    $("#tabViewInventory").classList.remove("active");
    $("#sectionAddProduct").hidden = false;
    $("#sectionInventory").hidden = true;
  });

  $("#tabViewInventory").addEventListener("click", () => {
    $("#tabViewInventory").classList.add("active");
    $("#tabAddSingle").classList.remove("active");
    $("#sectionAddProduct").hidden = true;
    $("#sectionInventory").hidden = false;
    loadProducts();
  });

  $("#invSearch").addEventListener("input", (e) => {
    renderTable(e.target.value);
  });

  // Add Product Submit (Sent with x-admin-key header)
  $("#productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnSubmit");
    const statusBox = $("#formStatus");

    const newProduct = {
      id: $("#pSku").value.trim().toUpperCase(),
      name: $("#pName").value.trim(),
      category: $("#pCategory").value,
      price: Number($("#pPrice").value),
      mrp: Number($("#pMrp").value),
      emoji: $("#pEmoji").value.trim() || "🛍️",
      stock: Number($("#pStock").value) || 50
    };

    if (newProduct.price > newProduct.mrp) {
      statusBox.className = "form-status error";
      statusBox.textContent = "Error: Selling Price cannot be greater than MRP.";
      statusBox.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = "Uploading to Catalog...";

    try {
      const res = await api("/api/seller/add-product", "POST", newProduct);
      statusBox.className = "form-status success";
      statusBox.textContent = "🎉 " + (res.message || "Product published successfully to LuluKart!");
      statusBox.hidden = false;
      
      await loadProducts();
      $("#productForm").reset();
      updateProfitCalc();
    } catch (err) {
      statusBox.className = "form-status error";
      statusBox.textContent = "Failed to upload: " + err.message;
      statusBox.hidden = false;
      if (err.message.includes("Unauthorized")) {
        showAuthModal();
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "🚀 Publish Product to LuluKart Store";
    }
  });

  // Delete product action (Sent with x-admin-key header)
  document.addEventListener("click", async (e) => {
    if (e.target.matches("[data-del]")) {
      const id = e.target.dataset.del;
      if (!confirm(`Are you sure you want to remove SKU: ${id} from store?`)) return;

      try {
        await api(`/api/seller/delete-product/${id}`, "DELETE");
        products = products.filter(p => p.id !== id);
        renderTable();
        $("#totalCount").textContent = products.length;
      } catch (err) {
        alert("Failed to delete: " + err.message);
        if (err.message.includes("Unauthorized")) {
          showAuthModal();
        }
      }
    }
  });

  // Dropzone file preview
  const dropZone = $("#dropZone");
  const fileInput = $("#pImageInput");
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        $("#previewImg").src = ev.target.result;
        $("#imagePreviewBox").hidden = false;
      };
      reader.readAsDataURL(file);
    }
  });

  $("#removeImgBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.value = "";
    $("#previewImg").src = "";
    $("#imagePreviewBox").hidden = true;
  });

  $("#btnResetForm").addEventListener("click", () => {
    $("#productForm").reset();
    $("#formStatus").hidden = true;
    updateProfitCalc();
  });

  // Check auth on load
  if (!adminKey) {
    showAuthModal();
  } else {
    checkAuth(adminKey);
  }
})();