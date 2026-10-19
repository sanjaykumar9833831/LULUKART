(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const inr = (p) => "₹" + (p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0 });
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let products = [], cart = {}, coupon = "", busy = false, quote = null;
  try { cart = JSON.parse(localStorage.getItem("lk_cart")) || {}; } catch { cart = {}; }
  const save = () => { try { localStorage.setItem("lk_cart", JSON.stringify(cart)); } catch {} };
  const items = () => Object.entries(cart).map(([id, qty]) => ({ id, qty }));

  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
    return j;
  }

  /* ---------- catalog ---------- */
  const ICON = { Electronics: "📱", Fashion: "👗", Home: "🏠", Grocery: "🛒" };
  const SLIDES = [
    { t: "Big Savings on Electronics", s: "Shop headphones, smart watches & accessories", c: "linear-gradient(120deg,#1B7FE3,#4DA3FF)" },
    { t: "Extra 10% off with coupon LULU10", s: "Apply code at checkout on all categories", c: "linear-gradient(120deg,#F57C00,#FFC21A)" },
    { t: "100% Secure Payments", s: "UPI, Cards, Netbanking & Wallets via Razorpay", c: "linear-gradient(120deg,#12305A,#1B7FE3)" },
  ];
  let cat = "All", q = "", sort = "r", slide = 0;
  const off = (p) => Math.round(100 - (p.price / p.mrp) * 100);

  function card(p) {
    const n = cart[p.id] || 0;
    return `<article class="card"><div class="pic">${esc(p.emoji)}</div><div class="info"><h3>${esc(p.name)}</h3><span class="mut">${esc(p.category)}</span>
      <div class="price">${inr(p.price)}<s>${inr(p.mrp)}</s><b class="off">${off(p)}% off</b></div>
      ${n ? `<div class="qty big"><button data-dec="${esc(p.id)}" aria-label="Decrease">−</button><b>${n}</b><button data-inc="${esc(p.id)}" aria-label="Increase">+</button></div>` : `<button class="btn" data-add="${esc(p.id)}">Add to cart</button>`}</div></article>`;
  }

  function renderHero() {
    $("#hero").innerHTML = SLIDES.map((s, i) => `<div class="slide ${i === slide ? "on" : ""}" style="background:${s.c}"><h2>${esc(s.t)}</h2><p>${esc(s.s)}</p></div>`).join("")
      + `<div class="dots">${SLIDES.map((_, i) => `<button data-slide="${i}" class="${i === slide ? "on" : ""}" aria-label="Slide ${i + 1}"></button>`).join("")}</div>`;
  }

  function renderGrid() {
    const cats = ["All", ...new Set(products.map((p) => p.category))];
    $("#cats").innerHTML = cats.map((c) => `<button class="cat ${c === cat ? "on" : ""}" data-cat="${esc(c)}"><span>${c === "All" ? "🛍️" : ICON[c] || "🛍️"}</span>${esc(c)}</button>`).join("");
    const ql = q.trim().toLowerCase();
    const list = products.filter((p) => (cat === "All" || p.category === cat) && (p.name + " " + p.category).toLowerCase().includes(ql));
    if (sort === "l") list.sort((a, b) => a.price - b.price);
    else if (sort === "h") list.sort((a, b) => b.price - a.price);
    else if (sort === "d") list.sort((a, b) => off(b) - off(a));
    const home = cat === "All" && !ql;
    $("#hero").hidden = !home; $("#deals").hidden = !home || !products.length;
    $("#rail").innerHTML = [...products].sort((a, b) => off(b) - off(a)).slice(0, 6).map(card).join("");
    $("#st").textContent = ql ? `Results for "${q.trim()}"` : cat === "All" ? "All Products" : cat;
    $("#grid").innerHTML = list.length ? list.map(card).join("") : `<div class="empty">${products.length ? "No products found matching your search." : "Loading products..."}</div>`;
  }

  const go = (i) => { slide = (i + SLIDES.length) % SLIDES.length; renderHero(); };

  /* ---------- cart ---------- */
  const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
  async function renderCart() {
    save();
    renderGrid();
    $("#cc").textContent = count();
    const ids = Object.keys(cart);
    $("#db").innerHTML = ids.length
      ? ids.map((id) => { const p = products.find((x) => x.id === id); return p ? `<div class="row"><span class="e">${esc(p.emoji)}</span>
          <div class="t"><b>${esc(p.name)}</b><br><span class="mut">${inr(p.price)} each</span></div>
          <div class="qty"><button data-dec="${esc(id)}" aria-label="Decrease">−</button><b>${cart[id]}</b><button data-inc="${esc(id)}" aria-label="Increase">+</button></div></div>` : ""; }).join("")
      : `<div class="empty">Your cart is empty. Add something you like!</div>`;
    if (!ids.length) { $("#df").innerHTML = ""; return; }
    try { quote = await api("/api/cart/quote", { items: items(), coupon }); } catch (e) { $("#df").innerHTML = `<div class="status err">${esc(e.message)}</div>`; return; }
    if (!quote.coupon) coupon = "";
    $("#df").innerHTML = `<div class="cp"><input id="ci" placeholder="Coupon code" aria-label="Coupon code" value="${esc(coupon)}"><button class="btn alt" id="ca">Apply</button></div>
      <div class="sum"><span>Subtotal</span><span>${inr(quote.subtotal)}</span></div><div class="sum"><span>Discount</span><span>− ${inr(quote.discount)}</span></div>
      <div class="sum"><span>Delivery</span><span>${quote.shipping ? inr(quote.shipping) : "Free"}</span></div>
      <div class="sum tot"><span>Total</span><span>${inr(quote.total)}</span></div><button class="btn" id="co">Proceed to Checkout</button>`;
  }

  const openCart = () => { $("#dr").classList.add("show"); $("#ov").classList.add("show"); renderCart(); };
  const closeAll = () => { if (busy) return; $("#dr").classList.remove("show"); $("#md").classList.remove("show"); $("#ov").classList.remove("show"); };
  const status = (t, cls = "") => { const s = $("#st"); if (s) { s.textContent = t; s.className = "status " + cls; } };

  /* ---------- checkout ---------- */
  function checkout() {
    $("#dr").classList.remove("show");
    $("#md").innerHTML = `<h2>Checkout</h2><p class="mut">Payable Total: <b>${inr(quote.total)}</b> · 100% Secure Checkout via Razorpay</p>
      <label>Full Name<input id="fn" autocomplete="name" maxlength="80"></label>
      <label>Email Address<input id="fe" type="email" autocomplete="email" maxlength="120"></label>
      <label>Mobile Number (10 digits)<input id="fp" inputmode="numeric" maxlength="10" autocomplete="tel-national"></label>
      <label>Full Delivery Address<textarea id="fa" rows="2" maxlength="200" autocomplete="street-address"></textarea></label>
      <label>Delivery Pincode<input id="fz" inputmode="numeric" maxlength="6" autocomplete="postal-code"></label>
      <div class="status" id="st" role="status"></div>
      <div style="display:flex;gap:8px;margin-top:12px;"><button class="btn yel" id="pay" style="flex:1">Pay ${inr(quote.total)}</button><button class="btn alt" id="cx">Cancel</button></div>`;
    $("#md").classList.add("show"); $("#ov").classList.add("show");
  }

  function finish(orderId) {
    cart = {}; coupon = ""; save(); $("#cc").textContent = 0; busy = false;
    $("#md").innerHTML = `<div class="done"><img src="/logo.png" alt="LuluKart"><h2>Order Placed Successfully! 🎉</h2><p>Thank you for shopping at LuluKart. Your Order ID is <b>${esc(orderId)}</b>. Your order will be delivered within 3-5 business days.</p><button class="btn" id="cx" style="width:100%;margin-top:14px;">Continue Shopping</button></div>`;
  }
  function fail(msg) { busy = false; const b = $("#pay"); if (b) b.disabled = false; status(msg, "err"); }

  async function pay() {
    if (busy) return;
    const customer = { name: $("#fn").value.trim(), email: $("#fe").value.trim(), contact: $("#fp").value.trim(), address: $("#fa").value.trim(), pincode: $("#fz").value.trim() };
    busy = true; $("#pay").disabled = true; status("Creating your secure order…");
    let o;
    try { o = await api("/api/payment/create-order", { items: items(), coupon, customer }); } catch (e) { return fail(e.message); }
    if (typeof Razorpay === "undefined") return fail("The payment gateway window could not load. Please check your internet connection.");
    const rz = new Razorpay({
      key: o.keyId, order_id: o.razorpayOrderId, amount: o.amount, currency: o.currency,
      name: "LuluKart", description: "Order " + o.orderId, image: location.origin + "/logo.png",
      prefill: { name: customer.name, email: customer.email, contact: customer.contact },
      notes: { orderId: o.orderId }, theme: { color: "#2874f0" },
      handler: async (r) => {
        status("Confirming payment with bank…");
        try { await api("/api/payment/verify-payment", { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }); finish(o.orderId); }
        catch (e) { fail("We received your payment but could not confirm it yet. Quote order " + o.orderId + " to support."); }
      },
      modal: { ondismiss: () => fail("Payment was cancelled. You have not been charged.") },
    });
    rz.on("payment.failed", (r) => fail((r.error && r.error.description) || "Payment failed. Please try another card or UPI option."));
    rz.open(); status("Complete the payment in the Razorpay window.");
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.cat !== undefined) { cat = d.cat; renderGrid(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (d.slide !== undefined) { go(+d.slide); return; }
    if (d.add) { cart[d.add] = Math.min(10, (cart[d.add] || 0) + 1); renderCart(); }
    else if (d.inc) { cart[d.inc] = Math.min(10, cart[d.inc] + 1); renderCart(); }
    else if (d.dec) { cart[d.dec]--; if (cart[d.dec] < 1) delete cart[d.dec]; renderCart(); }
    else if (b.id === "ca") { coupon = $("#ci").value.trim().toUpperCase(); renderCart(); }
    else if (b.id === "co") checkout();
    else if (b.id === "pay") pay();
    else if (b.id === "cx") closeAll();
  });
  $("#q").oninput = (e) => { q = e.target.value; renderGrid(); };
  $("#so").onchange = (e) => { sort = e.target.value; renderGrid(); };
  $("#cbtn").onclick = openCart; $("#dx").onclick = closeAll; $("#ov").onclick = closeAll;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  (async () => {
    try { products = await api("/api/products"); } catch {}
    for (const id of Object.keys(cart)) if (!products.some((p) => p.id === id)) delete cart[id];
    renderHero(); renderGrid(); renderCart();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setInterval(() => go(slide + 1), 4500);
  })();
})();