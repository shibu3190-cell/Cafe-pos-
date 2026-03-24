document.getElementById('topbarDate').innerText = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const ALERT_THRESHOLD_MS = 15 * 60 * 1000; 

if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; }

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        let char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; 
    }
    return hash.toString(16); 
}

const defaultPinHash = hashString("1234");
let shopProfile = { name: "The bong bhoj Terminal", address: "", fssai: "", gstin: "", tableCount: 10, logo: "", adminPinHash: defaultPinHash, startInvoiceNo: 1001, openAiKey: "" };

let menuItems = [ 
    { id: 1, name: "Espresso", price: 80.00, category: "Tea/Coffee", gstRate: 5, trackStock: true, stockQty: 28 }, 
    { id: 2, name: "Chicken Sandwich", price: 150.00, category: "Food", gstRate: 5, trackStock: false, stockQty: 0, badge: "Popular" },
    { id: 3, name: "Gold flake", price: 8.00, category: "Cigarettes", gstRate: 0, trackStock: true, stockQty: 28 }
];

let orderHistory = []; let dailyExpenses = []; let tablesInfo = {}; let menuCategories = ["Tea/Coffee", "Cigarettes", "Food", "Other"];

const myClientID = localStorage.getItem('cafeLicenseKey') || 'unregistered';
let currentRole = null; let activeTable = 1; let activeCategory = "All"; let editingMenuItemId = null; let editingExpenseId = null; let syncQueue = [];

const idb = {
    db: null, initPromise: null,
    init: function() {
        if (this.initPromise) return this.initPromise;
        this.initPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('CafePOS_DB', 1);
            req.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains('store')) e.target.result.createObjectStore('store'); };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = (e) => reject();
        });
        return this.initPromise;
    },
    get: async function(key) {
        await this.init();
        return new Promise((resolve) => { const tx = this.db.transaction('store', 'readonly'); const req = tx.objectStore('store').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });
    },
    set: async function(key, val) {
        await this.init();
        const tx = this.db.transaction('store', 'readwrite'); tx.objectStore('store').put(val, key);
    }
};

async function loadFromLocal() {
    await idb.init();
    const lProf = await idb.get('cafe_profile'); if (lProf) shopProfile = lProf;
    const lMenu = await idb.get('cafe_menu'); if (lMenu) menuItems = lMenu;
    const lCat = await idb.get('cafe_categories'); if(lCat) menuCategories = lCat;
    const lHist = await idb.get('cafe_history'); if (lHist) orderHistory = lHist;
    const lExp = await idb.get('cafe_expenses'); if (lExp) dailyExpenses = lExp;
    const lQueue = await idb.get('cafe_syncQueue'); if(lQueue) syncQueue = lQueue;
    
    const lTab = await idb.get('cafe_tables'); 
    if (lTab) { tablesInfo = lTab; } else { for(let i = 1; i <= shopProfile.tableCount; i++) tablesInfo[i] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; }
    updateAllUI();
}

function saveToLocal() {
    idb.set('cafe_profile', shopProfile); idb.set('cafe_menu', menuItems); idb.set('cafe_categories', menuCategories);
    idb.set('cafe_history', orderHistory); idb.set('cafe_expenses', dailyExpenses); idb.set('cafe_tables', tablesInfo);
}

function updateAllUI() {
    updateProfileVisuals(); renderCategoryDropdown(); renderCategoryListUI(); renderTables(); renderMenuUI();
    if(document.getElementById('pos').classList.contains('active')) updateCartUI();
    if(document.getElementById('reports').classList.contains('active')) renderStatements();
    if(document.getElementById('expenses').classList.contains('active')) renderExpensesUI();
    
    document.getElementById('shopNameInput').value = shopProfile.name || ''; document.getElementById('shopAddressInput').value = shopProfile.address || '';
    document.getElementById('fssaiInput').value = shopProfile.fssai || ''; document.getElementById('gstinInput').value = shopProfile.gstin || '';
    document.getElementById('tableCountInput').value = shopProfile.tableCount || 10; document.getElementById('startInvoiceInput').value = shopProfile.startInvoiceNo || 1001; 
    document.getElementById('openAiKeyInput').value = shopProfile.openAiKey || '';
}

window.addEventListener('firebaseLoaded', () => {
    if(!navigator.onLine) return; 
    const dataRef = window.firebaseRef(window.firebaseDB, `clients/${myClientID}`);
    window.firebaseOnValue(dataRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            shopProfile = data.profile || shopProfile; if(!shopProfile.startInvoiceNo) shopProfile.startInvoiceNo = 1001;
            menuItems = data.menu || []; menuCategories = data.categories || menuCategories; 
            orderHistory = data.history ? (Array.isArray(data.history) ? data.history : Object.values(data.history).sort((a,b) => b.id - a.id)) : [];
            dailyExpenses = data.expenses ? (Array.isArray(data.expenses) ? data.expenses : Object.values(data.expenses).sort((a,b) => b.id - a.id)) : [];
            let fetchedTables = data.tables || {};
            for(let i = 1; i <= shopProfile.tableCount; i++) {
                if(fetchedTables[i]) { tablesInfo[i] = fetchedTables[i]; if(!tablesInfo[i].items) tablesInfo[i].items = []; } 
                else { tablesInfo[i] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; }
            }
            saveToLocal(); updateAllUI();
        } else { persistAllToFirebase(); }
    });
});

function persistAllToFirebase() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}`), { profile: shopProfile, menu: menuItems, categories: menuCategories, history: orderHistory, expenses: dailyExpenses, tables: tablesInfo }); }
function persistTables() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/tables`), tablesInfo); }
function persistMenu() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/menu`), menuItems); }
function persistCategories() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/categories`), menuCategories); }
function persistProfile() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/profile`), shopProfile); }

function getLocalISODate(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function updateConnectionStatus() {
    const badge = document.getElementById('offlineBadge');
    if (navigator.onLine) { badge.style.display = 'none'; if (syncQueue.length > 0) processSyncQueue(); persistAllToFirebase(); showToast("🌐 Online: Synced with Cloud"); } 
    else { badge.style.display = 'inline-block'; showToast("⚠️ Offline: Saving data locally"); }
}
window.addEventListener('online', updateConnectionStatus); window.addEventListener('offline', updateConnectionStatus);

let isSyncing = false;
function pushToGoogleSheetsQueue(action, payloadData) { syncQueue.push({ action: action, data: payloadData }); idb.set('cafe_syncQueue', syncQueue); processSyncQueue(); }

async function processSyncQueue() {
    if (isSyncing || syncQueue.length === 0 || !navigator.onLine) return; isSyncing = true;
    const scriptURL = 'https://script.google.com/macros/s/AKfycbyZiNTkt5uHGhAy9efNz-6bKYw41YrMbM4CBnuAFTTxJU_ubGpF4VnDuj6zS73NlA3S2w/exec';
    while (syncQueue.length > 0) {
        const item = syncQueue[0];
        try { await fetch(scriptURL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: item.action, clientId: myClientID, data: item.data }) }); syncQueue.shift(); idb.set('cafe_syncQueue', syncQueue); } catch (e) { break; }
    }
    isSyncing = false;
}

function getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('cafeDeviceId');
    if (!deviceId) { deviceId = 'TERM-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Math.floor(Date.now() / 1000).toString(36).toUpperCase(); localStorage.setItem('cafeDeviceId', deviceId); }
    return deviceId;
}

async function activateSoftware() {
    if(!navigator.onLine) return alert("You must be online to activate the software.");
    const enteredKey = document.getElementById('activationKeyInput').value.trim().toUpperCase();
    if (!enteredKey) return showToast("Please enter a key.");
    const btn = document.querySelector('#activationOverlay .btn'); btn.innerText = "⏳ Verifying & Locking Device..."; btn.disabled = true;
    const deviceId = getOrCreateDeviceId(); const scriptURL = 'https://script.google.com/macros/s/AKfycbyZiNTkt5uHGhAy9efNz-6bKYw41YrMbM4CBnuAFTTxJU_ubGpF4VnDuj6zS73NlA3S2w/exec';
    try {
        const response = await fetch(`${scriptURL}?action=verifyKey&key=${enteredKey}&deviceId=${deviceId}`); const data = await response.json();
        if (data.valid) { localStorage.setItem('cafeSoftwareActivated', 'true'); localStorage.setItem('cafeActivationDate', Date.now().toString()); localStorage.setItem('cafeLicenseKey', enteredKey); alert(`Welcome, ${data.clientName}! License Activated.`); location.reload(); } 
        else { alert(data.message); btn.innerText = "Verify & Activate"; btn.disabled = false; }
    } catch (e) { alert("Network Error."); btn.innerText = "Verify & Activate"; btn.disabled = false; }
}

window.onload = async function() {
    document.getElementById('displayDeviceId').value = getOrCreateDeviceId(); await loadFromLocal(); if (!navigator.onLine) document.getElementById('offlineBadge').style.display = 'inline-block';
    const isAct = localStorage.getItem('cafeSoftwareActivated'); const actDate = localStorage.getItem('cafeActivationDate');
    if (!isAct || !actDate || myClientID === 'unregistered') { document.getElementById('activationOverlay').style.display = 'flex'; return; }
    if ((Date.now() - parseInt(actDate)) / (1000 * 60 * 60 * 24) > 200) { localStorage.removeItem('cafeSoftwareActivated'); localStorage.removeItem('cafeActivationDate'); localStorage.removeItem('cafeLicenseKey'); alert("Your license has expired."); document.getElementById('activationOverlay').style.display = 'flex'; return; } 
    else { document.getElementById('activationOverlay').style.display = 'none'; if(currentRole === null) document.getElementById('loginOverlay').style.display = 'flex'; performRemoteLicenseCheck(); }
    document.getElementById('reportDateSelect').value = getLocalISODate(); checkDailyReset(); processSyncQueue(); renderCategoryFilters(); 
}

function checkDailyReset() {
    const today = new Date().toLocaleDateString();
    if (localStorage.getItem('cafeLastRunDate') && localStorage.getItem('cafeLastRunDate') !== today) { for(let i = 1; i <= shopProfile.tableCount; i++) tablesInfo[i] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; persistTables(); showToast("New day started! Tables reset."); }
    localStorage.setItem('cafeLastRunDate', today);
}

function factoryReset() {
    if(prompt("Type 'DELETE' in all caps to confirm:") === "DELETE") { if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}`), null); localStorage.clear(); indexedDB.deleteDatabase('CafePOS_DB'); location.reload(); }
}

function loginAsStaff() { currentRole = 'staff'; document.getElementById('loginOverlay').style.display = 'none'; enforcePermissions(); showToast("Logged in as Staff"); }
function loginAsAdmin() { if (hashString(document.getElementById('adminPinInput').value) === shopProfile.adminPinHash) { currentRole = 'admin'; document.getElementById('loginOverlay').style.display = 'none'; document.getElementById('adminPinInput').value = ''; enforcePermissions(); showToast("Admin Access Granted"); } else { showToast("Incorrect PIN!"); } }
function lockSystem() { currentRole = null; document.getElementById('loginOverlay').style.display = 'flex'; switchTab('pos'); enforcePermissions(); }
function enforcePermissions() { ['nav-menu', 'nav-expenses', 'nav-reports', 'nav-settings'].forEach(id => currentRole === 'staff' ? document.getElementById(id).classList.add('locked') : document.getElementById(id).classList.remove('locked')); }

// ✨ NAVIGATION ENGINE (MOBILE TAB BAR COMPATIBILITY) ✨
function switchTab(tabId) { 
    if (currentRole === 'staff' && tabId !== 'pos') return showToast("Admin access required."); 
    // Desktop Nav
    document.querySelectorAll('.sidebar .nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-' + tabId).classList.add('active');
    // Mobile Nav
    if(document.querySelector('.mobile-bottom-nav')) {
        document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(el => el.classList.remove('active'));
        document.getElementById('m-nav-' + tabId).classList.add('active');
    }
    // View Management
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); 
    document.getElementById(tabId).classList.add('active'); 
    if(tabId === 'reports') renderStatements(); 
}

function updateProfileVisuals() {
    document.getElementById('displayShopName').innerText = shopProfile.name; document.querySelector('.topbar-title').innerText = shopProfile.name;
    document.getElementById('printShopName').innerText = shopProfile.name; document.getElementById('printShopAddress').innerText = shopProfile.address;
    document.getElementById('printFssai').innerText = shopProfile.fssai ? `FSSAI: ${shopProfile.fssai}` : ""; document.getElementById('printGstin').innerText = shopProfile.gstin ? `GSTIN: ${shopProfile.gstin}` : "";
    if (shopProfile.logo) { document.getElementById('sidebarLogo').src = shopProfile.logo; document.getElementById('sidebarLogo').style.display = 'block'; document.getElementById('printLogo').src = shopProfile.logo; document.getElementById('printLogo').style.display = 'block'; }
}
function loadLogo(event) { const file = event.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = e => { shopProfile.logo = e.target.result; updateProfileVisuals(); persistProfile(); }; reader.readAsDataURL(file); } }
function saveSettings() {
    shopProfile.name = document.getElementById('shopNameInput').value; shopProfile.address = document.getElementById('shopAddressInput').value; shopProfile.fssai = document.getElementById('fssaiInput').value; shopProfile.gstin = document.getElementById('gstinInput').value; shopProfile.tableCount = parseInt(document.getElementById('tableCountInput').value); const newStartNo = parseInt(document.getElementById('startInvoiceInput').value); if(newStartNo) shopProfile.startInvoiceNo = newStartNo;
    if(document.getElementById('adminPinSetup').value.length >= 4) { shopProfile.adminPinHash = hashString(document.getElementById('adminPinSetup').value); document.getElementById('adminPinSetup').value = ''; }
    shopProfile.openAiKey = document.getElementById('openAiKeyInput').value;
    for(let i = 1; i <= shopProfile.tableCount; i++) if(!tablesInfo[i]) tablesInfo[i] = { items: [], status: 'empty', savedTime: null, lastReminder: null };
    persistProfile(); persistTables(); showToast("Settings Saved!"); updateProfileVisuals();
}

function renderCategoryDropdown() { const select = document.getElementById('newItemCategory'); select.innerHTML = menuCategories.map(c => `<option value="${c}">${c}</option>`).join(''); }
function renderCategoryFilters() { document.getElementById('categoryFiltersUI').innerHTML = ''; ["All", ...menuCategories].forEach(cat => { document.getElementById('categoryFiltersUI').innerHTML += `<div class="cat-chip ${cat === activeCategory ? 'active' : ''}" onclick="filterMenu('${cat}')">${cat}</div>`; }); }
function renderCategoryListUI() { const container = document.getElementById('categoryListUI'); container.innerHTML = menuCategories.map(c => `<span class="cat-chip" style="display:inline-flex; align-items:center; gap:8px;">${c} <b style="color:var(--danger); cursor:pointer; font-size:16px;" onclick="deleteCategory('${c}')">×</b></span>`).join(''); }
function addCategory() { const cat = document.getElementById('newCategoryName').value.trim(); if(cat && !menuCategories.includes(cat)) { menuCategories.push(cat); document.getElementById('newCategoryName').value = ''; persistCategories(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); showToast("Category added!"); } else if (menuCategories.includes(cat)) { showToast("Category already exists."); } }
function deleteCategory(cat) { if(confirm(`Delete category "${cat}"?`)) { menuCategories = menuCategories.filter(c => c !== cat); if(activeCategory === cat) activeCategory = "All"; persistCategories(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); renderMenuUI(); showToast("Category deleted."); } }
function filterMenu(category) { activeCategory = category; renderCategoryFilters(); renderMenuUI(); }

// ✨ SLEEK TABLE GRID ENGINE (IMG 1 FOCUS STYLE) ✨
function renderTables() {
    const grid = document.getElementById('tableGridUI'); grid.innerHTML = '';
    for(let i = 1; i <= shopProfile.tableCount; i++) {
        const tInfo = tablesInfo[i]; let classes = 'table-btn';
        if (tInfo.status !== 'empty') classes += ` ${tInfo.status}`;
        if (i === activeTable) classes += ' selected';
        let amt = tInfo.items.length > 0 ? `₹${tInfo.items.reduce((sum, item) => sum + (item.price * item.qty), 0).toFixed(2)}` : (tInfo.status === 'booked' ? `Rsrvd` : "");
        
        grid.innerHTML += `<div class="${classes}" onclick="selectTable(${i})"><div class="table-status-dot"></div>T-${i}<span class="amt">${amt}</span></div>`;
    }
    document.getElementById('activeTableUI').innerText = activeTable; document.getElementById('kotTableNoDisplay').innerText = activeTable; document.getElementById('checkoutTableNoDisplay').innerText = activeTable;
}

function selectTable(num) { activeTable = num; renderTables(); updateCartUI(); renderMenuUI(); }
function bookTable() { let tInfo = tablesInfo[activeTable]; if(tInfo.items.length > 0) return showToast("Cannot reserve active table!"); tInfo.status = tInfo.status === 'booked' ? 'empty' : 'booked'; persistTables(); renderTables(); }

function addToCart(itemId) {
    let tInfo = tablesInfo[activeTable]; const menuItem = menuItems.find(m => m.id === itemId); if(!menuItem) return;
    const existing = tInfo.items.find(i => i.id === itemId);
    if (menuItem.trackStock && (existing ? existing.qty + 1 : 1) > menuItem.stockQty) return showToast(`Only ${menuItem.stockQty} left!`);
    if(existing) existing.qty++; else tInfo.items.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, gstRate: menuItem.gstRate, qty: 1 });
    if(tInfo.status === 'empty' || tInfo.status === 'booked') tInfo.status = 'occupied'; persistTables(); renderTables(); updateCartUI(); renderMenuUI();
}

function modifyQty(itemId, delta) {
    let tInfo = tablesInfo[activeTable]; const item = tInfo.items.find(i => i.id === itemId); const menuItem = menuItems.find(m => m.id === itemId);
    if (item) {
        if (delta > 0 && menuItem && menuItem.trackStock && (item.qty + delta) > menuItem.stockQty) return showToast(`Only ${menuItem.stockQty} left!`);
        item.qty += delta; if(item.qty <= 0) tInfo.items = tInfo.items.filter(i => i.id !== itemId); 
        if(tInfo.items.length === 0 && tInfo.status !== 'booked') tInfo.status = 'empty'; persistTables(); renderTables(); updateCartUI(); renderMenuUI();
    }
}

function clearTable() { if(confirm("Clear this entire order?")) { tablesInfo[activeTable] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; persistTables(); renderTables(); updateCartUI(); renderMenuUI(); document.getElementById('cartDrawer').classList.remove('open'); } }

// ✨ MOBILE DRAWER LOGIC ✨
function toggleCartDrawer() { document.getElementById('cartDrawer').classList.toggle('open'); }

function renderMenuUI() {
    const posGrid = document.getElementById('menuGridUI'); posGrid.innerHTML = '';
    const searchText = (document.getElementById('menuSearchInput').value || '').toLowerCase();
    let currentCart = tablesInfo[activeTable]?.items || [];
    let filteredMenu = activeCategory === "All" ? menuItems : menuItems.filter(i => i.category === activeCategory);
    if (searchText) filteredMenu = filteredMenu.filter(i => i.name.toLowerCase().includes(searchText));

    filteredMenu.forEach(item => {
        let stockBadge = ''; let popularBadge = item.badge ? `<div class="badge-popular">${item.badge}</div>` : '';
        if(item.trackStock) { 
            const isLow = item.stockQty <= 5 && item.stockQty > 0; 
            stockBadge = isLow ? `<div class="stock-badge low">${item.stockQty} left</div>` : (item.stockQty > 5 ? `<div class="stock-badge">${item.stockQty} left</div>` : '');
        }

        let qtyInCart = 0; const existing = currentCart.find(i => i.id === item.id); if(existing) qtyInCart = existing.qty;
        
        let buttonHtml = (item.trackStock && item.stockQty <= 0) ? `<div class="out-stock-btn">Out of Stock</div>` : (qtyInCart > 0 ? `<div class="item-qty-control" onclick="event.stopPropagation()"><button onclick="modifyQty(${item.id}, -1)">−</button><span>${qtyInCart}</span><button onclick="addToCart(${item.id})">+</button></div>` : `<button class="add-btn" onclick="addToCart(${item.id})">+ Add</button>`);

        posGrid.innerHTML += `
        <div class="menu-card" onclick="addToCart(${item.id})">
            ${popularBadge}${stockBadge}
            <div class="cat-label">${item.category}</div>
            <div class="name">${item.name}</div>
            <div class="price">₹${item.price.toFixed(2)}</div>
            ${buttonHtml}
        </div>`;
    });
    document.getElementById('menuTableBody').innerHTML = menuItems.map(item => `<tr><td>${item.name}</td><td>${item.category}</td><td>₹${item.price.toFixed(2)}</td><td>${item.gstRate}%</td><td>${item.trackStock ? item.stockQty : '∞'}</td><td><button class="btn btn-outline" style="padding: 6px 10px; font-size: 13px;" onclick="editMenuItem(${item.id})">Edit</button><button class="btn btn-danger" style="padding: 6px 10px; font-size: 13px;" onclick="deleteMenuItem(${item.id})">Del</button></td></tr>`).join('');
}

function editMenuItem(id) { const item = menuItems.find(i => i.id === id); if(item) { renderCategoryDropdown(); document.getElementById('newItemName').value = item.name; document.getElementById('newItemCategory').value = item.category; document.getElementById('newItemPrice').value = item.price; document.getElementById('newItemGst').value = item.gstRate; document.getElementById('newItemTrackStock').checked = item.trackStock; document.getElementById('newItemStock').style.display = item.trackStock ? 'block' : 'none'; document.getElementById('newItemStock').value = item.stockQty; editingMenuItemId = id; document.getElementById('menuFormTitle').innerText = "Edit Menu Item"; document.getElementById('addMenuBtn').innerText = "💾 Update Item"; document.getElementById('menuItemModal').style.display = 'flex'; } }
function addMenuItem() {
    const name = document.getElementById('newItemName').value; const price = parseFloat(document.getElementById('newItemPrice').value); const category = document.getElementById('newItemCategory').value; 
    const gstRate = parseFloat(document.getElementById('newItemGst').value) || 0; const trackStock = document.getElementById('newItemTrackStock').checked; const stockQty = parseInt(document.getElementById('newItemStock').value) || 0;
    if(name && !isNaN(price)) { 
        if (editingMenuItemId) { const index = menuItems.findIndex(i => i.id === editingMenuItemId); if(index > -1) { menuItems[index] = { id: editingMenuItemId, name, category, price, gstRate, trackStock, stockQty }; } editingMenuItemId = null; showToast("Item updated."); } else { menuItems.push({ id: Date.now(), name, category, price, gstRate, trackStock, stockQty }); showToast("Item added."); }
        persistMenu(); renderMenuUI(); document.getElementById('menuItemModal').style.display = 'none';
    } else { showToast("Name and Price required."); }
}
function deleteMenuItem(id) { if(confirm("Delete this item permanently?")) { menuItems = menuItems.filter(item => item.id !== id); persistMenu(); renderMenuUI(); showToast("Deleted."); } }

// ✨ 6. AI SMART MENU ENGINE
async function processAIMenu(event) {
    const file = event.target.files[0]; if (!file) return;
    const apiKey = shopProfile.openAiKey ? shopProfile.openAiKey.trim() : ""; if (!apiKey) { showToast("⚠️ Enter Gemini API Key in Settings."); return; }
    const btn = document.getElementById('aiMenuBtn'); btn.disabled = true; btn.innerText = "⏳ Processing..."; showToast("🤖 AI is reading your menu. This takes a few seconds.");

    try {
        let base64Data = ""; let mimeType = 'image/jpeg';
        if (file.type === "application/pdf") {
            const fileReader = new FileReader();
            base64Data = await new Promise((resolve, reject) => {
                fileReader.onload = async function() {
                    const typedarray = new Uint8Array(this.result); const pdf = await pdfjsLib.getDocument(typedarray).promise; const page = await pdf.getPage(1); const viewport = page.getViewport({scale: 1.5}); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); canvas.height = viewport.height; canvas.width = viewport.width; await page.render({canvasContext: ctx, viewport: viewport}).promise;
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                }; fileReader.readAsArrayBuffer(file);
            });
        } else {
            base64Data = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.readAsDataURL(file); });
        }
        const base64Clean = base64Data.split(',')[1];
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [ { text: "Extract Menu Categories, Items, Prices, and GST percentages (if visible). Output only as a clean JSON object: { \"categories\": [ { \"name\": \"CategoryName\", \"items\": [ { \"name\": \"ItemName\", \"price\": 120, \"gst\": 5 } ] } ] }" }, { inline_data: { mime_type: mimeType, data: base64Clean } } ] }] })
        });
        const data = await response.json(); if (data.error) throw new Error("Gemini API Error: " + data.error.message);
        if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned empty data.");
        let jsonStr = data.candidates[0].content.parts[0].text.replace(/```json/g, "").replace(/```/g, "").trim(); const extracted = JSON.parse(jsonStr);
        let count = 0; extracted.categories.forEach(cat => { if(!menuCategories.includes(cat.name)) menuCategories.push(cat.name); cat.items.forEach(item => { menuItems.push({ id: Date.now() + Math.floor(Math.random()*1000), name: item.name, category: cat.name, price: item.price, gstRate: item.gst || 0, trackStock: false, stockQty: 0 }); count++; }); });
        persistCategories(); persistMenu(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); renderMenuUI(); showToast(`✅ Imported ${count} items from ${extracted.categories.length} categories!`);
    } catch (error) { console.error(error); showToast("❌ Import failed. Check API Key or Image Quality."); } finally { btn.disabled = false; btn.innerText = "📁 Upload File"; document.getElementById('aiMenuUploader').value = ''; }
}

function addExpense() { const name = document.getElementById('expenseName').value; const cost = parseFloat(document.getElementById('expenseCost').value); if(name && cost) { const newExpense = { id: Date.now(), date: new Date().toLocaleDateString(), filterDate: getLocalISODate(), time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), name: name, cost: cost }; dailyExpenses.unshift(newExpense); document.getElementById('expenseName').value = ''; document.getElementById('expenseCost').value = ''; persistExpensesFirebase(newExpense); renderExpensesUI(); pushToGoogleSheetsQueue('addExpense', newExpense); } else { showToast("Name and Cost required."); } }
function deleteExpense(id) { if(confirm("Delete this expense?")) { dailyExpenses = dailyExpenses.filter(e => e.id !== id); persistExpensesFirebase(); renderExpensesUI(); showToast("Deleted."); } }
function renderExpensesUI() { document.getElementById('expensesTableBody').innerHTML = dailyExpenses.map(exp => `<tr><td>${exp.time}</td><td>${exp.name}</td><td>-₹${exp.cost.toFixed(2)}</td><td><button class="btn btn-danger" style="padding: 6px 10px; font-size: 12px;" onclick="deleteExpense(${exp.id})">Del</button></td></tr>`).join(''); }

function renderStatements() {
    const dateInput = document.getElementById('reportDateSelect').value; if (!dateInput) return; const fallbackDateStr = new Date(dateInput.split('-')[0], dateInput.split('-')[1]-1, dateInput.split('-')[2]).toLocaleDateString();
    const filteredOrders = orderHistory.filter(order => order.filterDate === dateInput || order.date.startsWith(fallbackDateStr) || order.date.split(',')[0] === fallbackDateStr);
    const filteredExpenses = dailyExpenses.filter(exp => exp.filterDate === dateInput || exp.date === fallbackDateStr || !exp.date);
    const totalSales = filteredOrders.reduce((sum, order) => sum + order.amount, 0); const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.cost, 0); const netProfit = totalSales - totalExpenses;
    document.getElementById('statSales').innerText = `₹${totalSales.toFixed(2)}`; document.getElementById('statExpenses').innerText = `₹${totalExpenses.toFixed(2)}`; document.getElementById('statProfit').innerText = `₹${netProfit.toFixed(2)}`; document.getElementById('statProfit').style.color = (netProfit < 0) ? '#ffcccb' : 'white';
    document.getElementById('historyTableBody').innerHTML = filteredOrders.map(order => `<tr><td>${order.date.split(',')[1]}</td><td>#${order.billNo}</td><td>${String(order.table).startsWith('Takeaway') ? '🥡 Takeaway' : 'T-' + String(order.table).replace('Table ', '')}</td><td>${order.items}</td><td>+₹${order.amount.toFixed(2)}</td><td><button class="btn btn-outline" style="padding: 6px 12px; font-size: 12px;" onclick="openEditOrderModal(${order.id})">Edit</button><button class="btn" style="padding: 6px 12px; font-size: 12px; background: #64748b;" onclick="reprintReceipt(${order.id})">Print</button></td></tr>`).join('');
    if (dateInput === getLocalISODate()) renderExpensesUI();
}

function openEditOrderModal(id) { const order = orderHistory.find(o => o.id === id); if(!order) return; document.getElementById('editOrderId').value = id; document.getElementById('editBillNoDisplay').innerText = order.billNo; document.getElementById('editOrderType').value = order.orderType || (String(order.table).startsWith('Takeaway') ? 'Takeaway' : 'Dine-In'); selectPayment(order.paymentMode || 'Cash', 'edit'); document.getElementById('editCustomerName').value = order.customer || ''; document.getElementById('editBillerName').value = order.biller || ''; document.getElementById('editOrderModal').style.display = 'flex'; }
function saveEditedOrder() { const id = parseInt(document.getElementById('editOrderId').value); const order = orderHistory.find(o => o.id === id); if(order) { order.orderType = document.getElementById('editOrderType').value; order.paymentMode = document.getElementById('editSelectedPaymentMode').value; order.customer = document.getElementById('editCustomerName').value; order.biller = document.getElementById('editBillerName').value; if(order.orderType === 'Takeaway') order.table = 'Takeaway'; persistHistoryFirebase(); renderStatements(); showToast("Bill updated."); document.getElementById('editOrderModal').style.display = 'none'; } }
function exportHistoryToExcel() { if(orderHistory.length === 0) return showToast("No sales data to export!"); const dateInput = document.getElementById('reportDateSelect').value; const csv = "Date,Bill No,Table/Type,Items Ordered,Amount (INR)\n" + orderHistory.filter(o => o.filterDate === dateInput).map(o => `"${o.date}","${o.billNo}","${o.table}","${o.items}",${o.amount.toFixed(2)}`).join('\n'); const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))); link.setAttribute("download", `Sales_${dateInput}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }

function updateCartUI() {
    const cartDiv = document.getElementById('cartUI'); cartDiv.innerHTML = '';
    let total = 0; let totalGstAmt = 0; let currentCart = tablesInfo[activeTable].items || [];
    if (currentCart.length === 0) {
        cartDiv.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 40px; font-weight: 600;">Select items from the menu.</div>`;
    } else {
        currentCart.forEach((item) => {
            let itemTotal = item.price * item.qty; total += itemTotal; let gst = item.gstRate || 0;
            if (gst > 0) { let basePrice = itemTotal / (1 + (gst / 100)); totalGstAmt += (itemTotal - basePrice); }
            cartDiv.innerHTML += `<div class="cart-item"><div class="cart-item-top"><span class="cart-item-name">${item.name}</span><span class="cart-item-price">₹${itemTotal.toFixed(2)}</span></div><div class="cart-item-bottom"><span class="cart-item-math">₹${item.price.toFixed(2)} each</span><div class="qty-pill"><button onclick="modifyQty(${item.id}, -1)">-</button><span>${item.qty}</span><button onclick="modifyQty(${item.id}, 1)">+</button></div></div></div>`;
        });
    }
    document.getElementById('totalUI').innerText = total.toFixed(2); 
    document.getElementById('gstBreakdownUI').innerText = totalGstAmt > 0 ? `Includes ₹${totalGstAmt.toFixed(2)} GST` : "No GST Applied";
    
    // ✨ FLOATING CHECKOUT BAR logic ✨
    const totalItems = currentCart.reduce((sum, item) => sum + item.qty, 0);
    const fc = document.getElementById('floatingCart');
    if (totalItems > 0) {
        fc.style.display = 'flex';
        document.getElementById('fc-count').innerText = `📄 ${totalItems} items`;
        document.getElementById('fc-total').innerText = `₹${total.toFixed(2)}`;
    } else {
        fc.style.display = 'none';
        // Ensure Drawer is closed on mobile if cart is empty
        document.getElementById('cartDrawer').classList.remove('open');
    }
}

function sendToKitchen() { let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast("Order is empty!"); sendKotToPrinter(`T-${activeTable}`, tInfo.items); tInfo.status = 'saved'; tInfo.lastReminder = Date.now(); persistTables(); renderTables(); showToast(`👨‍🍳 Kitchen ticket sent for Table ${activeTable}.`); }

// ✨ SERVED TIMER ALERT ENGINE ✨
function markServed() { let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast("Table is empty!"); tInfo.status = 'served'; tInfo.lastReminder = Date.now(); persistTables(); renderTables(); showToast(`🍽️ Table ${activeTable} served. Timer started.`); }

// Background thread to check 'served' tables every 60s
setInterval(() => {
    const now = Date.now(); let needsUpdate = false;
    for(let i=1; i<=shopProfile.tableCount; i++) {
        let tInfo = tablesInfo[i];
        if(tInfo.status === 'served' && tInfo.lastReminder && (now - tInfo.lastReminder) > ALERT_THRESHOLD_MS) {
            tInfo.status = 'alert'; tInfo.lastReminder = now; needsUpdate = true; // Status Dot turns Red
            showToast(`⚠️ Table ${i} alert! Long time served, bill not cleared.`);
        }
    }
    if(needsUpdate) { persistTables(); renderTables(); }
}, 60000); // Check once a minute

function selectPayment(mode, context) {
    if(context === 'checkout') { document.getElementById('selectedPaymentMode').value = mode; document.querySelectorAll('#checkoutModal .pay-btn').forEach(b => b.classList.remove('selected')); document.getElementById('btnPay' + mode).classList.add('selected'); } 
    else if (context === 'edit') { document.getElementById('editSelectedPaymentMode').value = mode; document.querySelectorAll('#editOrderModal .pay-btn').forEach(b => b.classList.remove('selected')); document.getElementById('editBtnPay' + mode).classList.add('selected'); }
}

function openCheckoutModal() {
    let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast(`Table ${activeTable} is empty!`);
    let total = tInfo.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById('checkoutTotal').innerText = total.toFixed(2); document.getElementById('checkoutOrderType').value = "Dine-In"; selectPayment('Cash', 'checkout');
    document.getElementById('checkoutCustomerName').value = ''; document.getElementById('checkoutBillerName').value = ''; document.getElementById('checkoutModal').style.display = 'flex';
}

// ✨ ADVANCED ESC/POS BLUETOOTH ENGINE (Universal Android/iOS App Support) ✨
async function getLogoBytes(base64Image) {
    return new Promise((resolve) => {
        const img = new Image(); img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const maxWidth = 200; let width = img.width; let height = img.height;
            if (width > maxWidth) { const ratio = maxWidth / width; width = maxWidth; height = height * ratio; }
            width = Math.floor(width/8)*8; height = Math.floor(height); // Esc/Pos likes byte alignment
            canvas.width = width; canvas.height = height; ctx.fillStyle = 'white'; ctx.fillRect(0,0,width,height); ctx.drawImage(img, 0, 0, width, height);
            const imgData = ctx.getImageData(0,0,width,height).data; const widthBytes = width/8; const data = new Uint8Array(8 + (widthBytes*height));
            data[0] = 0x1D; data[1] = 0x76; data[2] = 0x30; data[3] = 0x00; // GS v 0 cmd
            data[4] = widthBytes & 0xFF; data[5] = (widthBytes >> 8) & 0xFF; // xL, xH (w bytes)
            data[6] = height & 0xFF; data[7] = (height >> 8) & 0xFF;     // yL, yH (h pixels)
            let offset = 8; for (let y = 0; y < height; y++) { for (let x = 0; x < width; x+=8) { let byte = 0; for (let b=0; b<8; b++) { const idx = ((y*width)+x+b)*4; const brightness = (imgData[idx]*0.299 + imgData[idx+1]*0.587 + imgData[idx+2]*0.114); if (brightness < 128) byte |= (1 << (7-b)); } data[offset++] = byte; } }
            resolve(data);
        }; img.src = base64Image;
    });
}

let bleDevice = null; let bleServer = null; let printCharacteristic = null;
async function connectBluetoothPrinter() {
    if (!navigator.bluetooth) return alert("❌ Bluetooth not supported on this device/browser.");
    try {
        showToast("Searching for Bluetooth printers...");
        bleDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455'] });
        bleDevice.addEventListener('gattserverdisconnected', () => { showToast("⚠️ Printer Disconnected."); printCharacteristic = null; document.getElementById('btnBleStatus').innerText = "📡 Pair BLE Printer"; });
        bleServer = await bleDevice.gatt.connect(); const services = await bleServer.getPrimaryServices();
        for (let service of services) { const characteristics = await service.getCharacteristics(); for (let characteristic of characteristics) { if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) { printCharacteristic = characteristic; showToast("🖨️ Printer Connected Successfully!"); document.getElementById('btnBleStatus').innerText = "✅ Connected"; return; } } }
        showToast("❌ Could not find a valid print service.");
    } catch (error) { console.error(error); showToast("Bluetooth Connection Cancelled."); }
}

async function sendEscPosToPrinter(order) {
    if (!printCharacteristic) { showToast("❌ Thermal Printer not paired."); reprintReceipt(order.id); return; } // Fallback: reprint in Reports if printer is off

    const ESC = '\x1B'; const GS = '\x1D'; const INIT = ESC + '@'; const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00'; const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00'; const DOUBLE_SIZE = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00'; const FEED_AND_CUT = '\x0A\x0A\x0A\x0A' + ESC + 'm'; 

    let receiptText = INIT; // Initialize
    receiptText += ALIGN_CENTER + DOUBLE_SIZE + BOLD_ON + shopProfile.name + '\n' + NORMAL_SIZE + BOLD_OFF;
    if(shopProfile.address) receiptText += shopProfile.address + '\n';
    if(shopProfile.fssai) receiptText += 'FSSAI: ' + shopProfile.fssai + '\n';
    if(shopProfile.gstin) receiptText += 'GSTIN: ' + shopProfile.gstin + '\n';
    receiptText += '--------------------------------\n'; // 32 chars separator for 58mm
    receiptText += ALIGN_LEFT;
    receiptText += BOLD_ON + 'Invoice: #' + order.billNo + '\n' + BOLD_OFF;
    if(!order.table.startsWith('Takeaway')) receiptText += 'Table: ' + order.table + '\n';
    receiptText += 'Date: ' + order.date + '\n';
    receiptText += 'Type: ' + (order.orderType || (order.table === 'Takeaway' ? 'Takeaway' : 'Dine-In')) + '\n';
    receiptText += 'Payment: ' + order.paymentMode + '\n';
    if(order.customer) receiptText += 'Customer: ' + order.customer + '\n';
    if(order.biller) receiptText += 'Staff: ' + order.biller + '\n';
    receiptText += '--------------------------------\n';
    order.rawItems.forEach(item => { let line = `${item.qty}x ${item.name}`; receiptText += line.padEnd(22,' ') + ` ${item.gstRate>0?'T':''} ` + `₹${(item.price*item.qty).toFixed(2)}`.padStart(8,' ') + '\n'; });
    receiptText += '--------------------------------\n';
    receiptText += ALIGN_CENTER + DOUBLE_SIZE + BOLD_ON + `TOTAL: Rs.${order.amount.toFixed(2)}\n` + NORMAL_SIZE + BOLD_OFF;
    receiptText += '--------------------------------\n';
    receiptText += ALIGN_CENTER + 'Thank You! Visit Again\n';
    receiptText += FEED_AND_CUT; // Final spacing and auto cut

    const encoder = new TextEncoder(); const textData = encoder.encode(receiptText); let payload = textData;
    // Prepend Logo if exists
    if (shopProfile.logo) { const logoBytes = await getLogoBytes(shopProfile.logo); if (logoBytes) { const finalPayload = new Uint8Array(logoBytes.length + 1 + textData.length); finalPayload.set(logoBytes, 0); finalPayload.set(new Uint8Array([0x0A]), logoBytes.length); finalPayload.set(textData, logoBytes.length + 1); payload = finalPayload; } }

    const CHUNK_SIZE = 100; // Small chunks for unreliable ble connections
    try { for (let i = 0; i < payload.length; i += CHUNK_SIZE) { const chunk = payload.slice(i, i + CHUNK_SIZE); await printCharacteristic.writeValue(chunk); await new Promise(resolve => setTimeout(resolve, 40)); } } catch(e) { console.error(e); showToast("❌ Print Failed. Printer might be off."); }
}

async function sendKotToPrinter(tableNo, items) {
    if (!printCharacteristic) { showToast("❌ Thermal Printer not paired."); return; }
    const ESC = '\x1B'; const GS = '\x1D'; const INIT = ESC + '@'; const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00'; const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00'; const DOUBLE_SIZE = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00'; const FEED_AND_CUT = '\x0A\x0A\x0A\x0A' + ESC + 'm'; 

    let kotText = INIT; kotText += ALIGN_CENTER + BOLD_ON + "KITCHEN TICKET\n" + BOLD_OFF; kotText += "--------------------------------\n"; kotText += DOUBLE_SIZE + BOLD_ON + `TABLE: ${tableNo}\n` + NORMAL_SIZE + BOLD_OFF; kotText += `Time: ${new Date().toLocaleTimeString()}\n`; kotText += "--------------------------------\n"; kotText += ALIGN_LEFT;
    items.forEach(item => { kotText += DOUBLE_SIZE + `${item.qty}x ${item.name}\n` + NORMAL_SIZE; kotText += "--------------------------------\n"; });
    kotText += ALIGN_CENTER + "*** END ***\n" + FEED_AND_CUT;
    const encoder = new TextEncoder(); const payload = encoder.encode(kotText); const CHUNK_SIZE = 100; 
    try { for (let i = 0; i < payload.length; i += CHUNK_SIZE) { const chunk = payload.slice(i, i + CHUNK_SIZE); await printCharacteristic.writeValue(chunk); await new Promise(resolve => setTimeout(resolve, 40)); } } catch(e) { console.error(e); showToast("❌ KOT Print Failed."); }
}

// ✨ TOAST Restored ✨
function showToast(message) { 
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div'); toast.className = 'toast'; 
    toast.innerHTML = `<span>🔔</span> ${message}`; container.appendChild(toast); 
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-10px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3000); 
}
window.showToast = showToast; // Add to global scope

document.addEventListener('keydown', function(event) { if (event.key === 'Enter') { const activeId = document.activeElement.id; if (!activeId) return; if (activeId === 'newCategoryName') { addCategory(); } if (['newItemName', 'newItemPrice', 'newItemGst', 'newItemStock'].includes(activeId)) { addMenuItem(); document.getElementById('newItemName').focus(); } if (['expenseName', 'expenseCost'].includes(activeId)) { addExpense(); document.getElementById('expenseName').focus(); } if (activeId === 'menuSearchInput') { document.activeElement.blur(); } if (['shopNameInput', 'shopAddressInput', 'fssaiInput', 'gstinInput', 'tableCountInput', 'startInvoiceInput', 'adminPinSetup', 'openAiKeyInput'].includes(activeId)) { saveSettings(); document.activeElement.blur(); } } });
