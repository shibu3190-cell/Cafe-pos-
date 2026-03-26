document.getElementById('topbarDate').innerText = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const ALERT_THRESHOLD_MS = 15 * 60 * 1000; 

if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; }

function getLocalISODate(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear(); const mm = String(dateObj.getMonth() + 1).padStart(2, '0'); const dd = String(dateObj.getDate()).padStart(2, '0'); return `${yyyy}-${mm}-${dd}`;
}

function hashString(str) {
    let hash = 0; for (let i = 0; i < str.length; i++) { let char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash = hash & hash; } return hash.toString(16); 
}

const defaultPinHash = hashString("1234");
let shopProfile = { name: "The bong bhoj Terminal", address: "", fssai: "", gstin: "", tableCount: 10, logo: "", adminPinHash: defaultPinHash, startInvoiceNo: 1001, openAiKey: "", upiId: "", showQr: false };

let menuItems = [ 
    { id: 1, name: "Espresso", price: 80.00, category: "Tea/Coffee", gstRate: 5, trackStock: true, stockQty: 28, image: "" }, 
    { id: 2, name: "Chicken Sandwich", price: 150.00, category: "Food", gstRate: 5, trackStock: false, stockQty: 0, badge: "Popular", image: "" },
    { id: 3, name: "Gold flake", price: 8.00, category: "Cigarettes", gstRate: 0, trackStock: true, stockQty: 28, image: "" },
    { id: 4, name: "Black Coffee", price: 80.00, category: "Tea/Coffee", gstRate: 5, trackStock: true, stockQty: 100, image: "" },
    { id: 5, name: "Veg Biryani", price: 150.00, category: "Food", gstRate: 5, trackStock: true, stockQty: 10, image: "" }
];

let orderHistory = []; let dailyExpenses = []; let tablesInfo = {}; let menuCategories = ["All", "Tea/Coffee", "Food", "Cigarettes", "Other"];

const myClientID = localStorage.getItem('cafeLicenseKey') || 'unregistered';
let currentRole = null; let activeTable = 1; let activeCategory = "All"; let editingMenuItemId = null; let editingExpenseId = null; let syncQueue = [];
let currentItemImageBase64 = "";

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
        await this.init(); return new Promise((resolve) => { const tx = this.db.transaction('store', 'readonly'); const req = tx.objectStore('store').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });
    },
    set: async function(key, val) {
        await this.init(); const tx = this.db.transaction('store', 'readwrite'); tx.objectStore('store').put(val, key);
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
    updateProfileVisuals(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); renderTables(); renderMenuUI();
    if(document.getElementById('pos').classList.contains('active')) updateCartUI();
    if(document.getElementById('reports').classList.contains('active')) renderStatements();
    if(document.getElementById('expenses').classList.contains('active')) renderExpensesUI();
    
    document.getElementById('shopNameInput').value = shopProfile.name || ''; document.getElementById('shopAddressInput').value = shopProfile.address || '';
    document.getElementById('fssaiInput').value = shopProfile.fssai || ''; document.getElementById('gstinInput').value = shopProfile.gstin || '';
    document.getElementById('tableCountInput').value = shopProfile.tableCount || 10; document.getElementById('startInvoiceInput').value = shopProfile.startInvoiceNo || 1001; 
    document.getElementById('openAiKeyInput').value = shopProfile.openAiKey || '';
    
    if(document.getElementById('upiIdInput')) document.getElementById('upiIdInput').value = shopProfile.upiId || '';
    if(document.getElementById('enableQrCodeInput')) document.getElementById('enableQrCodeInput').checked = shopProfile.showQr || false;
    
    generateSettingsQRPreview(); 
}

// ✨ LIVE QR PREVIEW ENGINE ✨
function generateSettingsQRPreview() {
    if (!document.getElementById('upiIdInput')) return;
    const upiId = document.getElementById('upiIdInput').value.trim();
    const shopName = document.getElementById('shopNameInput').value.trim() || shopProfile.name;
    const isEnabled = document.getElementById('enableQrCodeInput').checked;
    const container = document.getElementById('settingsQrPreview');
    const textLabel = document.getElementById('settingsQrText');
    
    container.innerHTML = '';
    
    if (isEnabled && upiId) {
        const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(shopName)}&am=100.00&cu=INR`;
        new QRCode(container, { text: upiString, width: 100, height: 100, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.M });
        textLabel.innerText = "Test ₹100"; textLabel.style.color = "var(--success)";
    } else {
        container.innerHTML = `<span style="font-size: 32px; opacity: 0.2;">📱</span>`;
        textLabel.innerText = "Disabled"; textLabel.style.color = "var(--text-muted)";
    }
}
window.generateSettingsQRPreview = generateSettingsQRPreview;

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
function persistTables() { saveToLocal(); if(navigator.onLine && window.firebaseUpdate) { let updates = {}; updates[`clients/${myClientID}/tables/${activeTable}`] = tablesInfo[activeTable]; window.firebaseUpdate(window.firebaseRef(window.firebaseDB), updates); } }
function persistMenu() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/menu`), menuItems); }
function persistCategories() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/categories`), menuCategories); }
function persistProfile() { saveToLocal(); if(navigator.onLine && window.firebaseSet) window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/profile`), shopProfile); }

function persistHistoryFirebase(newOrder = null) { 
    saveToLocal(); 
    if(!navigator.onLine) return;
    if (newOrder && window.firebaseUpdate) { let updates = {}; updates[`clients/${myClientID}/history/${newOrder.id}`] = newOrder; window.firebaseUpdate(window.firebaseRef(window.firebaseDB), updates); } 
    else if (window.firebaseSet) { let histObj = {}; orderHistory.forEach(o => histObj[o.id] = o); window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/history`), histObj); }
}
function persistExpensesFirebase(newExp = null) { 
    saveToLocal(); 
    if(!navigator.onLine) return;
    if (newExp && window.firebaseUpdate) { let updates = {}; updates[`clients/${myClientID}/expenses/${newExp.id}`] = newExp; window.firebaseUpdate(window.firebaseRef(window.firebaseDB), updates); } 
    else if (window.firebaseSet) { let expObj = {}; dailyExpenses.forEach(e => expObj[e.id] = e); window.firebaseSet(window.firebaseRef(window.firebaseDB, `clients/${myClientID}/expenses`), expObj); }
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

async function performRemoteLicenseCheck() {
    const savedKey = localStorage.getItem('cafeLicenseKey'); if(!savedKey || !navigator.onLine) return;
    const deviceId = getOrCreateDeviceId(); const scriptURL = 'https://script.google.com/macros/s/AKfycbyZiNTkt5uHGhAy9efNz-6bKYw41YrMbM4CBnuAFTTxJU_ubGpF4VnDuj6zS73NlA3S2w/exec';
    try { const response = await fetch(`${scriptURL}?action=verifyKey&key=${savedKey}&deviceId=${deviceId}`); const data = await response.json(); if (!data.valid) { localStorage.removeItem('cafeSoftwareActivated'); localStorage.removeItem('cafeActivationDate'); localStorage.removeItem('cafeLicenseKey'); alert("⚠️ SECURITY ALERT ⚠️\n\n" + data.message); location.reload(); } } catch (e) { console.log("Background check skipped."); }
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

function switchTab(tabId) { 
    if (currentRole === 'staff' && tabId !== 'pos') return showToast("Admin access required."); 
    document.querySelectorAll('.sidebar .nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-' + tabId).classList.add('active');
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); 
    document.getElementById(tabId).classList.add('active'); 
    if(tabId === 'reports') renderStatements(); 
}

function updateProfileVisuals() {
    document.getElementById('displayShopName').innerText = shopProfile.name; document.getElementById('topbarShopName').innerText = shopProfile.name;
    document.getElementById('printShopName').innerText = shopProfile.name; document.getElementById('printShopAddress').innerText = shopProfile.address;
    document.getElementById('printFssai').innerText = shopProfile.fssai ? `FSSAI: ${shopProfile.fssai}` : ""; document.getElementById('printGstin').innerText = shopProfile.gstin ? `GSTIN: ${shopProfile.gstin}` : "";
    if (shopProfile.logo) { document.getElementById('sidebarLogo').src = shopProfile.logo; document.getElementById('sidebarLogo').style.display = 'block'; document.getElementById('printLogo').src = shopProfile.logo; document.getElementById('printLogo').style.display = 'block'; }
}

function loadLogo(event) { 
    const file = event.target.files[0]; 
    if (!file) return;
    const reader = new FileReader(); 
    reader.onload = (e) => { 
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_DIM = 250; let w = img.width, h = img.height;
            if (w > h && w > MAX_DIM) { h *= MAX_DIM / w; w = MAX_DIM; } else if (h > MAX_DIM) { w *= MAX_DIM / h; h = MAX_DIM; }
            canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
            shopProfile.logo = canvas.toDataURL('image/jpeg', 0.8); 
            updateProfileVisuals(); persistProfile(); showToast("Logo Updated.");
        };
        img.src = e.target.result;
    }; 
    reader.readAsDataURL(file); 
}

function saveSettings() {
    shopProfile.name = document.getElementById('shopNameInput').value; shopProfile.address = document.getElementById('shopAddressInput').value; shopProfile.fssai = document.getElementById('fssaiInput').value; shopProfile.gstin = document.getElementById('gstinInput').value; shopProfile.tableCount = parseInt(document.getElementById('tableCountInput').value); const newStartNo = parseInt(document.getElementById('startInvoiceInput').value); if(newStartNo) shopProfile.startInvoiceNo = newStartNo;
    if(document.getElementById('adminPinSetup').value.length >= 4) { shopProfile.adminPinHash = hashString(document.getElementById('adminPinSetup').value); document.getElementById('adminPinSetup').value = ''; }
    shopProfile.openAiKey = document.getElementById('openAiKeyInput').value;
    
    if(document.getElementById('upiIdInput')) shopProfile.upiId = document.getElementById('upiIdInput').value.trim();
    if(document.getElementById('enableQrCodeInput')) shopProfile.showQr = document.getElementById('enableQrCodeInput').checked;
    
    for(let i = 1; i <= shopProfile.tableCount; i++) if(!tablesInfo[i]) tablesInfo[i] = { items: [], status: 'empty', savedTime: null, lastReminder: null };
    persistProfile(); persistTables(); showToast("Settings Saved!"); updateProfileVisuals();
}

function renderCategoryDropdown() { const select = document.getElementById('newItemCategory'); select.innerHTML = menuCategories.map(c => `<option value="${c}">${c}</option>`).join(''); }
function renderCategoryFilters() { document.getElementById('categoryFiltersUI').innerHTML = ''; menuCategories.forEach(cat => { document.getElementById('categoryFiltersUI').innerHTML += `<div class="cat-chip ${cat === activeCategory ? 'active' : ''}" onclick="filterMenu('${cat}')">${cat}</div>`; }); }
function renderCategoryListUI() { const container = document.getElementById('categoryListUI'); container.innerHTML = menuCategories.map(c => `<span class="cat-chip" style="display:inline-flex; align-items:center; gap:8px;">${c} <b style="color:var(--danger); cursor:pointer; font-size:16px;" onclick="deleteCategory('${c}')">×</b></span>`).join(''); }

function addCategory() {
    const cat = document.getElementById('newCategoryName').value.trim();
    if(cat && !menuCategories.includes(cat)) { menuCategories.push(cat); document.getElementById('newCategoryName').value = ''; persistCategories(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); showToast("Category added!"); } 
    else if (menuCategories.includes(cat)) { showToast("Category already exists."); }
}
function deleteCategory(cat) { if(confirm(`Delete category "${cat}"?`)) { menuCategories = menuCategories.filter(c => c !== cat); if(activeCategory === cat) activeCategory = "All"; persistCategories(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); renderMenuUI(); showToast("Category deleted."); } }
function filterMenu(category) { activeCategory = category; renderCategoryFilters(); renderMenuUI(); }

function renderTables() {
    const grid = document.getElementById('tableGridUI'); grid.innerHTML = '';
    for(let i = 1; i <= shopProfile.tableCount; i++) {
        const tInfo = tablesInfo[i]; let classes = 'table-btn';
        if (tInfo.status !== 'empty') classes += ` ${tInfo.status}`;
        if (i === activeTable) classes += ' selected';
        grid.innerHTML += `<div id="table-btn-${i}" class="${classes}" onclick="selectTable(${i})"><div class="table-status-dot"></div>T-${i}</div>`;
    }
}

function syncTableUI() {
    for(let i = 1; i <= shopProfile.tableCount; i++) {
        const tInfo = tablesInfo[i];
        const tBtn = document.getElementById(`table-btn-${i}`);
        if(tBtn) {
            let classes = 'table-btn';
            if (tInfo.status !== 'empty') classes += ` ${tInfo.status}`;
            if (i === activeTable) classes += ' selected';
            if (tBtn.className !== classes) tBtn.className = classes;
        }
    }
    document.getElementById('activeTableUI').innerText = activeTable; document.getElementById('kotTableNoDisplay').innerText = activeTable; document.getElementById('checkoutTableNoDisplay').innerText = activeTable;
}

function selectTable(num) { activeTable = num; syncTableUI(); updateCartUI(); syncMenuUIQuantities(); }
function bookTable() { let tInfo = tablesInfo[activeTable]; if(tInfo.items.length > 0) return showToast("Cannot reserve active table!"); tInfo.status = tInfo.status === 'booked' ? 'empty' : 'booked'; persistTables(); syncTableUI(); }

function addToCart(itemId, event) {
    if (event) event.stopPropagation();
    let tInfo = tablesInfo[activeTable]; const menuItem = menuItems.find(m => m.id === itemId); if(!menuItem) return;
    const existing = tInfo.items.find(i => i.id === itemId);
    if (menuItem.trackStock && (existing ? existing.qty + 1 : 1) > menuItem.stockQty) return showToast(`Only ${menuItem.stockQty} left!`);
    if(existing) existing.qty++; else tInfo.items.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, gstRate: menuItem.gstRate, qty: 1 });
    if(tInfo.status === 'empty' || tInfo.status === 'booked') tInfo.status = 'occupied'; 
    persistTables(); syncTableUI(); updateCartUI(); syncMenuUIQuantities();
}

function modifyQty(itemId, delta, event) {
    if (event) event.stopPropagation();
    let tInfo = tablesInfo[activeTable]; const item = tInfo.items.find(i => i.id === itemId); const menuItem = menuItems.find(m => m.id === itemId);
    if (item) {
        if (delta > 0 && menuItem && menuItem.trackStock && (item.qty + delta) > menuItem.stockQty) return showToast(`Only ${menuItem.stockQty} left!`);
        item.qty += delta; if(item.qty <= 0) tInfo.items = tInfo.items.filter(i => i.id !== itemId); 
        if(tInfo.items.length === 0 && tInfo.status !== 'booked') { tInfo.status = 'empty'; tInfo.savedTime = null; tInfo.lastReminder = null; }
        persistTables(); syncTableUI(); updateCartUI(); syncMenuUIQuantities();
    }
}

function clearTable() { if(confirm("Clear this entire order?")) { tablesInfo[activeTable] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; persistTables(); syncTableUI(); updateCartUI(); syncMenuUIQuantities(); document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('cartDrawerOverlay').classList.remove('show'); } }

function renderMenuUI() {
    const posGrid = document.getElementById('menuGridUI'); posGrid.innerHTML = '';
    const searchText = (document.getElementById('menuSearchInput').value || '').toLowerCase();
    let filteredMenu = activeCategory === "All" ? menuItems : menuItems.filter(i => i.category === activeCategory);
    if (searchText) filteredMenu = filteredMenu.filter(i => i.name.toLowerCase().includes(searchText));

    filteredMenu.forEach(item => {
        let popularBadge = item.badge ? `<div class="badge-popular">${item.badge}</div>` : '';
        let stockIndicator = '';
        if(item.trackStock) {
            stockIndicator = item.stockQty > 0 ? `<span class="stock-indicator green"><i></i> In Stock</span>` : `<span class="stock-indicator red"><i></i> Out of Stock</span>`;
        }

        let imageHtml = item.image ? `<img src="${item.image}" class="card-img">` : `<div class="card-img-placeholder">${item.name.charAt(0).toUpperCase()}</div>`;

        posGrid.innerHTML += `
        <div class="menu-card" onclick="addToCart(${item.id}, event)">
            <div class="card-img-wrapper">
                ${imageHtml}
                ${popularBadge}
                ${item.trackStock && item.stockQty <= 5 && item.stockQty > 0 ? `<div class="stock-badge low">${item.stockQty} left</div>` : (item.trackStock && item.stockQty > 5 ? `<div class="stock-badge">${item.stockQty} left</div>` : '')}
            </div>
            <div class="card-content">
                <div class="card-top-row">
                    <span class="cat-label">${item.category}</span>
                    ${item.trackStock && item.stockQty > 0 ? `<span class="stock-pill">+${item.stockQty}pc</span>` : ''}
                </div>
                <div class="name">${item.name}</div>
                <div class="card-bottom-row">
                    <div class="card-price-col">
                        <span class="price">₹ ${item.price}</span>
                        ${stockIndicator}
                    </div>
                    <div id="menu-action-wrap-${item.id}"></div>
                </div>
            </div>
        </div>`;
    });
    syncMenuUIQuantities(); 
    document.getElementById('menuTableBody').innerHTML = menuItems.map(item => `<tr><td>${item.image ? '🖼️' : '📄'}</td><td>${item.name}</td><td>${item.category}</td><td>₹${item.price.toFixed(2)}</td><td>${item.gstRate}%</td><td>${item.trackStock ? item.stockQty : '∞'}</td><td><button class="btn btn-outline" style="padding: 6px 10px; font-size: 13px;" onclick="editMenuItem(${item.id})">Edit</button><button class="btn btn-danger" style="padding: 6px 10px; font-size: 13px;" onclick="deleteMenuItem(${item.id})">Del</button></td></tr>`).join('');
}

function syncMenuUIQuantities() {
    let currentCart = tablesInfo[activeTable]?.items || [];
    menuItems.forEach(item => {
        const wrapper = document.getElementById(`menu-action-wrap-${item.id}`);
        if(!wrapper) return;
        let qtyInCart = 0; const existing = currentCart.find(i => i.id === item.id); if(existing) qtyInCart = existing.qty;

        let buttonHtml = '';
        if (item.trackStock && item.stockQty <= 0) {
            buttonHtml = `<button class="add-btn" style="background:var(--border); color:var(--text-muted);">OUT</button>`;
        } else if (qtyInCart > 0) {
            buttonHtml = `<div class="item-qty-control" onclick="event.stopPropagation()"><button onclick="modifyQty(${item.id}, -1, event)">−</button><span>${qtyInCart}</span><button onclick="addToCart(${item.id}, event)">+</button></div>`;
        } else {
            buttonHtml = `<button class="add-btn" onclick="addToCart(${item.id}, event)">+ ADD</button>`;
        }
        if (wrapper.innerHTML !== buttonHtml) { wrapper.innerHTML = buttonHtml; }
    });
}

function handleItemImageUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_DIM = 300; let w = img.width, h = img.height;
            if (w > h && w > MAX_DIM) { h *= MAX_DIM / w; w = MAX_DIM; } else if (h > MAX_DIM) { w *= MAX_DIM / h; h = MAX_DIM; }
            canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
            currentItemImageBase64 = canvas.toDataURL('image/jpeg', 0.7);
            document.getElementById('newItemImagePreview').src = currentItemImageBase64;
            document.getElementById('newItemImagePreview').style.display = "block";
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ✨ FIXED AI IMAGE ENGINE (DIRECT FETCH WITH BLOB) ✨
async function generateAIImage() {
    const name = document.getElementById('newItemName').value.trim();
    if (!name) return showToast("⚠️ Enter an Item Name first to generate image!");
    
    const btn = document.getElementById('btnGenerateAI');
    const preview = document.getElementById('newItemImagePreview');
    
    btn.innerText = "⏳ Generating..."; btn.disabled = true;
    preview.style.display = "block";
    preview.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%23f4efeA'/><text x='40' y='45' font-family='sans-serif' font-size='10' font-weight='bold' text-anchor='middle' fill='%238d5b4c'>Wait...</text></svg>";

    try {
        const prompt = encodeURIComponent(`Delicious highly professional food photography of ${name}, bright studio lighting, top down view, white plate, minimalist background, 4k resolution`);
        // Using direct fetch to blob bypasses strict canvas CORS issues
        const url = `https://image.pollinations.ai/prompt/${prompt}?width=400&height=300&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
        
        const response = await fetch(url);
        if(!response.ok) throw new Error("Network error fetching image.");
        
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            currentItemImageBase64 = reader.result;
            preview.src = currentItemImageBase64;
            btn.innerText = "✨ AI Generate"; btn.disabled = false;
            showToast("✅ Image Generated!");
        };
        reader.readAsDataURL(blob);
    } catch (error) { 
        console.error(error); 
        preview.style.display = "none";
        showToast("❌ Failed to generate image."); 
        btn.innerText = "✨ AI Generate"; btn.disabled = false; 
    }
}


function openAddMenuItemModal() {
    editingMenuItemId = null; renderCategoryDropdown();
    document.getElementById('menuFormTitle').innerText = "Add New Menu Item"; document.getElementById('addMenuBtn').innerText = "💾 Save Item";
    document.getElementById('newItemName').value = ''; document.getElementById('newItemPrice').value = ''; document.getElementById('newItemGst').value = '0';
    document.getElementById('newItemTrackStock').checked = false; document.getElementById('newItemStock').style.display = 'none'; document.getElementById('newItemStock').value = '';
    
    currentItemImageBase64 = ""; 
    document.getElementById('newItemImagePreview').src = ""; 
    document.getElementById('newItemImagePreview').style.display = "none";
    
    document.getElementById('menuItemModal').style.display = 'flex'; setTimeout(() => { document.getElementById('newItemName').focus(); }, 100);
}

function editMenuItem(id) {
    const item = menuItems.find(i => i.id === id);
    if(item) {
        renderCategoryDropdown();
        document.getElementById('newItemName').value = item.name; document.getElementById('newItemCategory').value = item.category;
        document.getElementById('newItemPrice').value = item.price; document.getElementById('newItemGst').value = item.gstRate || 0;
        document.getElementById('newItemTrackStock').checked = item.trackStock || false; document.getElementById('newItemStock').style.display = item.trackStock ? 'block' : 'none'; document.getElementById('newItemStock').value = item.stockQty || '';
        
        currentItemImageBase64 = item.image || "";
        if(currentItemImageBase64) { document.getElementById('newItemImagePreview').src = currentItemImageBase64; document.getElementById('newItemImagePreview').style.display = "block"; } 
        else { document.getElementById('newItemImagePreview').style.display = "none"; }
        
        editingMenuItemId = id; document.getElementById('menuFormTitle').innerText = "Edit Menu Item"; document.getElementById('addMenuBtn').innerText = "💾 Update Item"; document.getElementById('menuItemModal').style.display = 'flex';
    }
}

function addMenuItem() {
    const name = document.getElementById('newItemName').value; const price = parseFloat(document.getElementById('newItemPrice').value); const category = document.getElementById('newItemCategory').value; 
    const gstRate = parseFloat(document.getElementById('newItemGst').value) || 0; const trackStock = document.getElementById('newItemTrackStock').checked; const stockQty = parseInt(document.getElementById('newItemStock').value) || 0;

    if(name && !isNaN(price)) { 
        if (editingMenuItemId) {
            const index = menuItems.findIndex(i => i.id === editingMenuItemId);
            if(index > -1) { menuItems[index] = { id: editingMenuItemId, name, category, price, gstRate, trackStock, stockQty, image: currentItemImageBase64 }; }
            showToast("✅ Item updated!");
        } else { menuItems.push({ id: Date.now(), name, category, price, gstRate, trackStock, stockQty, image: currentItemImageBase64 }); showToast("✅ Item added!"); }
        persistMenu(); renderMenuUI(); document.getElementById('menuItemModal').style.display = 'none';
    } else { showToast("⚠️ Name and Price required."); }
}

function deleteMenuItem(id) { if(confirm("Delete this item permanently?")) { menuItems = menuItems.filter(item => item.id !== id); persistMenu(); renderMenuUI(); showToast("Deleted."); } }

// ✨ AI SMART MENU ENGINE (WITH AUTO-IMAGE FETCH) ✨
async function processAIMenu(event) {
    const file = event.target.files[0]; if (!file) return;
    const apiKey = shopProfile.openAiKey ? shopProfile.openAiKey.trim() : ""; if (!apiKey) { showToast("⚠️ Please enter your Gemini API Key in Settings first."); return; }

    const btn = document.getElementById('aiMenuBtn'); btn.disabled = true; btn.innerText = "⏳ Compressing & Analyzing..."; showToast("🤖 Processing image. Please wait...");

    try {
        let base64Data = ""; let mimeType = 'image/jpeg';

        if (file.type === "application/pdf") {
            if (!window.pdfjsLib) throw new Error("PDF reader library failed to load.");
            const fileReader = new FileReader();
            base64Data = await new Promise((resolve, reject) => {
                fileReader.onload = async function() {
                    try {
                        const typedarray = new Uint8Array(this.result); const pdf = await pdfjsLib.getDocument(typedarray).promise; const page = await pdf.getPage(1); 
                        const viewport = page.getViewport({scale: 1.5}); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
                        canvas.height = viewport.height; canvas.width = viewport.width; await page.render({canvasContext: ctx, viewport: viewport}).promise;
                        resolve(canvas.toDataURL('image/jpeg', 0.8));
                    } catch(e) { reject(new Error("PDF parsing failed.")); }
                }; fileReader.readAsArrayBuffer(file);
            });
        } else {
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas'); const MAX_DIM = 1200; let w = img.width, h = img.height;
                        if (w > h && w > MAX_DIM) { h *= MAX_DIM / w; w = MAX_DIM; } else if (h > MAX_DIM) { w *= MAX_DIM / h; h = MAX_DIM; }
                        canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', 0.7));
                    }; img.onerror = () => reject(new Error("Image load failed.")); img.src = e.target.result;
                }; reader.onerror = () => reject(new Error("File reading failed.")); reader.readAsDataURL(file);
            });
        }

        const base64Clean = base64Data.split(',')[1];
        
        // Update prompt to ask for image_prompt
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [ { text: `Extract Categories, Items, Prices, and GST percentages (output 0 if missing). For each item, write a 5-word photography prompt. Output strictly as a JSON object: { "categories": [ { "name": "CategoryName", "items": [ { "name": "ItemName", "price": 120, "gst": 0, "image_prompt": "delicious ItemName, high quality photography" } ] } ] }` }, { inline_data: { mime_type: mimeType, data: base64Clean } } ] }], generationConfig: { response_mime_type: "application/json" } })
        });

        const data = await response.json();
        if (data.error) throw new Error("API Error: " + data.error.message);
        if (!data.candidates || data.candidates.length === 0) throw new Error("AI returned empty data.");

        let rawResponse = data.candidates[0].content.parts[0].text.trim();
        rawResponse = rawResponse.replace(/^```(json)?|```$/gi, '').trim();

        try { pendingAiMenu = JSON.parse(rawResponse); } catch (parseError) { console.error("Raw AI Output:", rawResponse); throw new Error("AI output was invalid JSON."); }
        if (!pendingAiMenu || !pendingAiMenu.categories || pendingAiMenu.categories.length === 0) throw new Error("No menu items detected.");

        let treeHtml = "";
        pendingAiMenu.categories.forEach(cat => {
            treeHtml += `<div style="color: var(--primary); font-size: 16px; margin-top: 10px;">${cat.name}</div>`;
            cat.items.forEach((item, index) => {
                let branch = (index === cat.items.length - 1) ? "└" : "├";
                treeHtml += `<div style="padding-left: 10px; color: #555;"> ${branch} ${item.name} – ₹${item.price} (GST: ${item.gst || 0}%)</div>`;
            });
        });
        document.getElementById('aiPreviewTree').innerHTML = treeHtml; document.getElementById('aiPreviewModal').style.display = 'flex';

    } catch (error) { console.error(error); showToast("❌ " + error.message); } finally { btn.disabled = false; btn.innerText = "📁 Upload File"; document.getElementById('aiMenuUploader').value = ''; }
}

async function confirmAiImport() {
    const btn = document.querySelector('#aiPreviewModal .btn-success');
    try {
        btn.disabled = true; btn.innerText = "⏳ Importing Data...";
        if (!pendingAiMenu || !pendingAiMenu.categories) throw new Error("No data found.");
        let itemsAdded = 0; let newCategoriesAdded = 0;
        let itemsToFetchImagesFor = [];

        pendingAiMenu.categories.forEach((cat, catIndex) => {
            let catName = String(cat.name || cat.category || "Uncategorized").trim();
            let existingCat = menuCategories.find(c => c.toLowerCase() === catName.toLowerCase());
            if (!existingCat) { menuCategories.push(catName); newCategoriesAdded++; } else { catName = existingCat; }
            
            if(cat.items && Array.isArray(cat.items)) {
                cat.items.forEach((item, itemIndex) => {
                    let rawName = item.name || item.title || item.ItemName || item.itemName;
                    let rawPrice = item.price !== undefined ? item.price : (item.Price !== undefined ? item.Price : 0);
                    let rawGst = item.gst !== undefined ? item.gst : (item.GST !== undefined ? item.GST : 0);

                    if (rawName) {
                        const newItem = { id: Date.now() + (catIndex * 100) + itemIndex + Math.floor(Math.random() * 1000), name: String(rawName).trim(), category: catName, price: parseFloat(rawPrice) || 0, gstRate: parseFloat(rawGst) || 0, trackStock: false, stockQty: 0, image: "" };
                        menuItems.push(newItem);
                        itemsAdded++;
                        
                        if (item.image_prompt) {
                            itemsToFetchImagesFor.push({ id: newItem.id, prompt: item.image_prompt });
                        }
                    }
                });
            }
        });

        persistCategories(); persistMenu(); renderCategoryDropdown(); renderCategoryFilters(); renderCategoryListUI(); renderMenuUI();
        document.getElementById('aiPreviewModal').style.display = 'none'; pendingAiMenu = null;
        showToast(`✅ Imported ${itemsAdded} items & Auto-Created ${newCategoriesAdded} categories!`);
        
        // Background Image Fetching
        if (itemsToFetchImagesFor.length > 0) {
            showToast(`🤖 Downloading ${itemsToFetchImagesFor.length} images in background...`);
            for (let info of itemsToFetchImagesFor) {
                try {
                    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(info.prompt)}?width=400&height=300&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
                    const res = await fetch(url);
                    const blob = await res.blob();
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const targetItem = menuItems.find(m => m.id === info.id);
                        if (targetItem) {
                            targetItem.image = reader.result;
                            persistMenu();
                            renderMenuUI(); // Refresh UI dynamically as images load
                        }
                    };
                    reader.readAsDataURL(blob);
                    await new Promise(r => setTimeout(r, 1000)); // Rate limit to avoid bans
                } catch(e) { console.error("Silent image fetch failed", e); }
            }
        }

    } catch (error) { console.error(error); showToast("❌ Import failed: " + error.message); } finally { if (btn) { btn.disabled = false; btn.innerText = "✅ Confirm & Import"; } }
}

function addExpense() {
    const name = document.getElementById('expenseName').value; const cost = parseFloat(document.getElementById('expenseCost').value); 
    if(name && cost) { 
        const newExpense = { id: Date.now(), date: new Date().toLocaleDateString(), filterDate: getLocalISODate(), time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), name: name, cost: cost };
        if (editingExpenseId) { const index = dailyExpenses.findIndex(e => e.id === editingExpenseId); if(index > -1) { dailyExpenses[index].name = name; dailyExpenses[index].cost = cost; } editingExpenseId = null; document.getElementById('addExpenseBtn').innerText = "- Record"; showToast("Expense updated."); persistExpensesFirebase(); } 
        else { dailyExpenses.unshift(newExpense); pushToGoogleSheetsQueue('addExpense', newExpense); persistExpensesFirebase(newExpense); showToast("Expense recorded."); }
        document.getElementById('expenseName').value = ''; document.getElementById('expenseCost').value = ''; renderExpensesUI(); 
    } else { showToast("Please enter Item Name and Cost."); }
}

function editExpense(id) { const exp = dailyExpenses.find(e => e.id === id); if(exp) { document.getElementById('expenseName').value = exp.name; document.getElementById('expenseCost').value = exp.cost; editingExpenseId = id; document.getElementById('addExpenseBtn').innerText = "💾 Update"; window.scrollTo(0,0); } }
function deleteExpense(id) { if(confirm("Delete this expense?")) { dailyExpenses = dailyExpenses.filter(e => e.id !== id); persistExpensesFirebase(); renderExpensesUI(); showToast("Expense deleted."); } }

function renderExpensesUI() { 
    document.getElementById('expensesTableBody').innerHTML = dailyExpenses.map((exp, index) => { if(!exp.id) exp.id = Date.now() + index; return `<tr><td style="color: var(--text-muted);">${exp.time}</td><td style="font-weight: 600; color: var(--text-dark);">${exp.name}</td><td style="color: var(--danger); font-weight: 800;">-₹${exp.cost.toFixed(2)}</td><td><button class="btn btn-outline" style="padding: 6px 10px; font-size: 12px; margin-right: 5px;" onclick="editExpense(${exp.id})">Edit</button><button class="btn btn-danger" style="padding: 6px 10px; font-size: 12px;" onclick="deleteExpense(${exp.id})">Del</button></td></tr>`; }).join(''); 
}

function renderStatements() {
    const dateInput = document.getElementById('reportDateSelect').value; if (!dateInput) return; 
    const fallbackDateStr = new Date(dateInput.split('-')[0], dateInput.split('-')[1] - 1, dateInput.split('-')[2]).toLocaleDateString();

    const filteredOrders = orderHistory.filter(order => order.filterDate === dateInput || order.filterDate === fallbackDateStr || (order.date && order.date.split(',')[0] === fallbackDateStr) || (order.date && order.date.startsWith(fallbackDateStr)));
    const filteredExpenses = dailyExpenses.filter(exp => exp.filterDate === dateInput || exp.date === fallbackDateStr || !exp.date);

    const totalSales = filteredOrders.reduce((sum, order) => sum + order.amount, 0); const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.cost, 0); const netProfit = totalSales - totalExpenses;
    
    document.getElementById('statSales').innerText = `₹${totalSales.toFixed(2)}`; document.getElementById('statExpenses').innerText = `₹${totalExpenses.toFixed(2)}`; 
    document.getElementById('statProfit').innerText = `₹${netProfit.toFixed(2)}`; document.getElementById('statProfit').style.color = (netProfit < 0) ? '#ffcccb' : 'white';
    
    document.getElementById('historyTableBody').innerHTML = filteredOrders.map(order => {
        let tableStr = String(order.table); let badge = tableStr === 'Takeaway' ? '🛍️ Takeaway' : (tableStr.includes('Table') ? tableStr.replace('Table ', 'T-') : 'T-' + tableStr);
        let payBadge = order.paymentMode ? `<br><span style="font-size:10px; color:var(--text-muted);">${order.paymentMode}</span>` : '';
        return `<tr><td style="font-size: 13px; color: var(--text-muted);">${order.date.split(',')[1] || order.date}</td><td style="font-weight: 800; color: var(--primary);">${order.billNo || '-'}</td><td><strong>${badge}</strong>${payBadge}</td><td style="font-size: 13px;">${order.items || '-'}</td><td style="color: var(--success); font-weight: 800;">+₹${order.amount.toFixed(2)}</td><td><button class="btn btn-outline" style="padding: 6px 12px; font-size: 12px; margin-right: 5px;" onclick="openEditOrderModal(${order.id})">Edit</button><button class="btn" style="padding: 6px 12px; font-size: 12px; background: #64748b;" onclick="reprintReceipt(${order.id})">Print</button></td></tr>`;
    }).join('');
    if (dateInput === getLocalISODate()) renderExpensesUI();
}

function openEditOrderModal(id) {
    const order = orderHistory.find(o => o.id === id); if(!order) return;
    document.getElementById('editOrderId').value = id; document.getElementById('editBillNoDisplay').innerText = order.billNo || 'N/A';
    document.getElementById('editOrderType').value = order.orderType || (order.table === 'Takeaway' ? 'Takeaway' : 'Dine-In'); selectPayment(order.paymentMode || 'Cash', 'edit'); document.getElementById('editCustomerName').value = order.customer || ''; document.getElementById('editBillerName').value = order.biller || ''; document.getElementById('editOrderModal').style.display = 'flex';
}

function saveEditedOrder() {
    const id = parseInt(document.getElementById('editOrderId').value); const order = orderHistory.find(o => o.id === id);
    if(order) {
        order.orderType = document.getElementById('editOrderType').value; order.paymentMode = document.getElementById('editSelectedPaymentMode').value;
        order.customer = document.getElementById('editCustomerName').value.trim(); order.biller = document.getElementById('editBillerName').value.trim();
        if(order.orderType === 'Takeaway') order.table = 'Takeaway'; persistHistoryFirebase(); renderStatements(); showToast("Bill updated."); document.getElementById('editOrderModal').style.display = 'none';
    }
}

function exportHistoryToExcel() {
    if(orderHistory.length === 0) return showToast("No sales data to export!");
    const dateInput = document.getElementById('reportDateSelect').value; const fallbackDateStr = new Date(dateInput.split('-')[0], dateInput.split('-')[1] - 1, dateInput.split('-')[2]).toLocaleDateString();
    const filteredOrders = orderHistory.filter(order => order.filterDate === dateInput || order.filterDate === fallbackDateStr || (order.date && order.date.split(',')[0] === fallbackDateStr) || (order.date && order.date.startsWith(fallbackDateStr)));
    if(filteredOrders.length === 0) return showToast("No data for this date.");

    let csvContent = "Date,Bill No,Table/Type,Payment,Customer,Biller,Items Ordered,Amount (INR)\n";
    filteredOrders.forEach(order => {
        let itemsEscaped = `"${(order.items || '').replace(/"/g, '""')}"`; let tableStr = String(order.table); let tableType = tableStr === 'Takeaway' ? 'Takeaway' : (tableStr.includes('Table') ? tableStr : `Table ${tableStr}`);
        csvContent += `"${order.date}","${order.billNo || ''}","${tableType}","${order.paymentMode || 'Cash'}","${order.customer || ''}","${order.biller || ''}",${itemsEscaped},${order.amount.toFixed(2)}\n`;
    });
    const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }))); link.setAttribute("download", `Sales_${dateInput}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function updateCartUI() {
    const cartDiv = document.getElementById('cartUI'); cartDiv.innerHTML = '';
    let total = 0; let totalGstAmt = 0; let currentCart = tablesInfo[activeTable]?.items || [];
    if (currentCart.length === 0) {
        cartDiv.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 40px; font-weight: 600;">Select items from the menu to start an order.</div>`;
    } else {
        currentCart.forEach((item) => {
            let itemTotal = item.price * item.qty; total += itemTotal; let gst = item.gstRate || 0;
            if (gst > 0) { let basePrice = itemTotal / (1 + (gst / 100)); totalGstAmt += (itemTotal - basePrice); }
            cartDiv.innerHTML += `<div class="cart-item"><div class="cart-item-top"><span class="cart-item-name">${item.name}</span><span class="cart-item-price">₹${itemTotal.toFixed(2)}</span></div><div class="cart-item-bottom"><span class="cart-item-math">₹${item.price.toFixed(2)} each</span><div class="qty-pill"><button onclick="modifyQty(${item.id}, -1)">-</button><span>${item.qty}</span><button onclick="modifyQty(${item.id}, 1)">+</button></div></div></div>`;
        });
    }
    
    document.getElementById('totalUI').innerText = total.toFixed(2); 
    document.getElementById('gstBreakdownUI').innerText = totalGstAmt > 0 ? `Includes ₹${totalGstAmt.toFixed(2)} GST` : "No GST Applied";
    
    let totalItems = currentCart.reduce((sum, item) => sum + item.qty, 0);
    const fc = document.getElementById('floatingCart');
    
    if (fc) {
        if (totalItems > 0) {
            fc.style.display = 'flex';
            document.getElementById('fc-count').innerText = `${totalItems} ITEMS`;
            document.getElementById('fc-total').innerText = `${total.toFixed(2)}`;
        } else {
            fc.style.display = 'none';
            document.getElementById('cartDrawer').classList.remove('open');
            document.getElementById('cartDrawerOverlay').classList.remove('show');
        }
    }
    cartDiv.scrollTop = cartDiv.scrollHeight;
}

function toggleCartDrawer() { 
    const drawer = document.getElementById('cartDrawer'); const overlay = document.getElementById('cartDrawerOverlay');
    drawer.classList.toggle('open'); 
    if (drawer.classList.contains('open')) overlay.classList.add('show'); else overlay.classList.remove('show');
}

function markServed() { let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast("Table empty!"); tInfo.status = 'served'; tInfo.lastReminder = Date.now(); persistTables(); syncTableUI(); document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('cartDrawerOverlay').classList.remove('show'); showToast(`Table ${activeTable} served. Timer started.`); }
setInterval(() => { const now = Date.now(); let needsSync = false; for(let i = 1; i <= shopProfile.tableCount; i++) { let tInfo = tablesInfo[i]; if(tInfo.status === 'served' || tInfo.status === 'alert') { if(tInfo.lastReminder && (now - tInfo.lastReminder) >= ALERT_THRESHOLD_MS) { tInfo.status = 'alert'; tInfo.lastReminder = now; needsSync = true; showToast(`⚠️ Table ${i} unpaid!`); } } } if(needsSync) { persistTables(); syncTableUI(); } }, 5000); 

function sendToKitchen() { 
    let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast("Nothing to send!"); 
    tInfo.status = 'saved'; persistTables(); syncTableUI(); document.getElementById('kotTableNoDisplay').innerText = activeTable; document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('cartDrawerOverlay').classList.remove('show'); document.getElementById('kotModal').style.display = 'flex';
}

function selectPayment(mode, context) {
    if(context === 'checkout') { document.getElementById('selectedPaymentMode').value = mode; document.querySelectorAll('#checkoutModal .pay-btn').forEach(b => b.classList.remove('selected')); document.getElementById('btnPay' + mode).classList.add('selected'); } 
    else if (context === 'edit') { document.getElementById('editSelectedPaymentMode').value = mode; document.querySelectorAll('#editOrderModal .pay-btn').forEach(b => b.classList.remove('selected')); document.getElementById('editBtnPay' + mode).classList.add('selected'); }
}

function openCheckoutModal() {
    let tInfo = tablesInfo[activeTable]; if(tInfo.items.length === 0) return showToast(`Table ${activeTable} is empty!`);
    let total = tInfo.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById('checkoutTotal').innerText = total.toFixed(2); document.getElementById('checkoutTableNoDisplay').innerText = activeTable; document.getElementById('checkoutTotalItems').innerText = tInfo.items.length;
    document.getElementById('checkoutOrderType').value = "Dine-In"; selectPayment('Cash', 'checkout');
    document.getElementById('checkoutCustomerName').value = ''; document.getElementById('checkoutBillerName').value = '';
    
    document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('cartDrawerOverlay').classList.remove('show');
    document.getElementById('checkoutModal').style.display = 'flex';
}

// ✨ HTML INVISIBLE IFRAME PRINT (LARGER CRISP QR ENABLED) ✨
function executeHtmlPrint(divId) {
    return new Promise(resolve => {
        let iframe = document.getElementById('print-iframe');
        if (!iframe) { iframe = document.createElement('iframe'); iframe.id = 'print-iframe'; iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0'; document.body.appendChild(iframe); }
        
        let qrScript = '';
        const qrCanvas = document.querySelector('#printQrCode canvas');
        if (qrCanvas && shopProfile.showQr && shopProfile.upiId) {
            // Crisp CSS rendering applied
            qrScript = `<div style="text-align:center; margin-top:15px;"><div style="font-weight:bold;font-size:14px;margin-bottom:5px;">SCAN TO PAY</div><img src="${qrCanvas.toDataURL('image/png')}" style="margin:0 auto; display:block; width:180px; height:180px; image-rendering: pixelated;"></div>`;
        }
        
        const content = document.getElementById(divId).innerHTML; const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`<html><head><title>Receipt</title><style>body{font-family:'Courier New',Courier,monospace;font-size:12px;color:#000;margin:0;padding:10px;width:300px;}.print-center{text-align:center;}.print-row{display:flex;justify-content:space-between;margin-bottom:5px;}.print-line{border-bottom:1px dashed #000;margin:8px 0;}img{max-width:50px;filter:grayscale(100%) contrast(200%);margin-bottom:5px;}</style></head><body>${content} ${qrScript}</body></html>`);
        doc.close();
        setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); resolve(); }, 500);
    });
}

async function confirmCheckout() {
    let tInfo = tablesInfo[activeTable]; 
    if(!tInfo || tInfo.items.length === 0) return showToast(`Table ${activeTable} is empty!`);
    
    const payBtn = document.querySelector('#checkoutModal .btn-success');
    payBtn.disabled = true; payBtn.innerText = printCharacteristic ? "⏳ Printing Receipt..." : "📄 Generating PDF...";
    document.getElementById('checkoutModal').style.display = 'none';
    
    try {
        let total = 0; const itemNames = tInfo.items.map(i => `${i.name} (x${i.qty})`).join(', ');
        tInfo.items.forEach(item => { total += (item.price * item.qty); });

        const oType = document.getElementById('checkoutOrderType').value; const pMode = document.getElementById('selectedPaymentMode').value;
        const cName = document.getElementById('checkoutCustomerName').value.trim(); const bName = document.getElementById('checkoutBillerName').value.trim();
        const fullDateStr = new Date().toLocaleString(); const safeFilterDate = getLocalISODate(); const finalTableStr = oType === 'Takeaway' ? 'Takeaway' : `Table ${activeTable}`;

        const currentStartNo = shopProfile.startInvoiceNo || 1001; const highestExistingBill = orderHistory.length > 0 ? Math.max(...orderHistory.map(o => o.billNo || 0)) : 0;
        const generatedBillNo = Math.max(currentStartNo, highestExistingBill + 1);

        const newOrder = { id: Date.now(), billNo: generatedBillNo, date: fullDateStr, filterDate: safeFilterDate, table: finalTableStr, orderType: oType, paymentMode: pMode, customer: cName, biller: bName, items: itemNames, rawItems: JSON.parse(JSON.stringify(tInfo.items)), amount: total };
        
        tInfo.items.forEach(cartItem => { const mItem = menuItems.find(m => m.id === cartItem.id); if (mItem && mItem.trackStock) { mItem.stockQty -= cartItem.qty; if (mItem.stockQty < 0) mItem.stockQty = 0; } });
        persistMenu(); orderHistory.unshift(newOrder); persistHistoryFirebase(newOrder); 
        tablesInfo[activeTable] = { items: [], status: 'empty', savedTime: null, lastReminder: null }; persistTables(); 
        pushToGoogleSheetsQueue('addOrder', newOrder); syncTableUI(); updateCartUI(); syncMenuUIQuantities();
        
        showToast("✅ Payment recorded & Table cleared.");

        await sendEscPosToPrinter(newOrder);

    } catch (e) { console.error(e); showToast("❌ Error processing checkout."); } 
    finally { payBtn.disabled = false; payBtn.innerText = "🖨️ Pay & Print"; }
}

async function getLogoBytes(base64Image) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const maxWidth = 200; let width = img.width; let height = img.height;
            if (width > maxWidth) { const ratio = maxWidth / width; width = maxWidth; height = height * ratio; }
            width = Math.floor(width / 8) * 8; height = Math.floor(height);
            canvas.width = width; canvas.height = height;
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, width, height); 
            
            ctx.imageSmoothingEnabled = false; // ✨ Ensured crisp block edges for QR codes! ✨
            ctx.drawImage(img, 0, 0, width, height);
            
            const imgData = ctx.getImageData(0, 0, width, height).data; const widthBytes = width / 8;
            const data = new Uint8Array(8 + (widthBytes * height));
            data[0] = 0x1D; data[1] = 0x76; data[2] = 0x30; data[3] = 0x00;
            data[4] = widthBytes & 0xFF; data[5] = (widthBytes >> 8) & 0xFF;
            data[6] = height & 0xFF; data[7] = (height >> 8) & 0xFF;
            let offset = 8;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x += 8) {
                    let byte = 0;
                    for (let b = 0; b < 8; b++) {
                        const idx = ((y * width) + x + b) * 4;
                        const brightness = (imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114);
                        if (brightness < 128) byte |= (1 << (7 - b)); 
                    }
                    data[offset++] = byte;
                }
            }
            resolve(data);
        };
        img.onerror = () => resolve(null); img.src = base64Image;
    });
}

let bleDevice = null; let bleServer = null; let printCharacteristic = null;

async function connectBluetoothPrinter() {
    const btn = document.getElementById('btnBleStatus'); const originalText = btn.innerHTML;
    try {
        if (!navigator.bluetooth) { alert("❌ BLUETOOTH NOT SUPPORTED!\n\nApple iOS (iPhone/iPad) blocks Web Bluetooth. You must use Android Chrome, Windows Chrome, or Mac Chrome."); return; }
        if (!window.isSecureContext) { alert("❌ INSECURE CONNECTION!\n\nWeb Bluetooth ONLY works on 'https://' websites. Please deploy to Netlify/Vercel."); return; }
        btn.innerHTML = "⏳ Searching..."; showToast("Looking for printers...");
        bleDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [ '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000fee7-0000-1000-8000-00805f9b34fb' ] });
        bleDevice.addEventListener('gattserverdisconnected', () => { alert("⚠️ Printer Disconnected!"); printCharacteristic = null; btn.innerHTML = "📡 Pair BLE Printer"; btn.style.background = "transparent"; btn.style.color = "var(--accent)"; });
        bleServer = await bleDevice.gatt.connect(); const services = await bleServer.getPrimaryServices();
        for (let service of services) {
            const characteristics = await service.getCharacteristics();
            for (let characteristic of characteristics) {
                if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
                    printCharacteristic = characteristic; showToast("🖨️ Printer Connected Successfully!"); btn.innerHTML = "✅ Connected"; btn.style.background = "var(--success)"; btn.style.color = "#fff"; return;
                }
            }
        }
        alert("❌ Printer paired, but it does not support standard text printing."); btn.innerHTML = originalText; bleDevice.gatt.disconnect();
    } catch (error) { 
        console.error(error); btn.innerHTML = originalText;
        if(error.name === 'NotFoundError') { showToast("❌ Pairing cancelled by user."); } else if (error.name === 'SecurityError') { alert("❌ SECURITY ERROR: Browser blocked Bluetooth access. Make sure you are using HTTPS."); } else if (error.name === 'NotAllowedError') { alert("❌ PERMISSION DENIED: Make sure you granted Bluetooth/Nearby Devices permissions to your browser in your phone settings."); } else { alert("❌ BLUETOOTH ERROR:\n" + error.message); }
    }
}

async function sendEscPosToPrinter(order) {
    let gstSummary = {}; 

    // Generate QR First (Multiple of 8 for pristine ESC/POS printing: 200x200)
    const qrCodeDiv = document.getElementById('printQrCode');
    qrCodeDiv.innerHTML = '';
    if (shopProfile.showQr && shopProfile.upiId) {
        const upiString = `upi://pay?pa=${shopProfile.upiId}&pn=${encodeURIComponent(shopProfile.name)}&am=${order.amount.toFixed(2)}&cu=INR`;
        new QRCode(qrCodeDiv, { text: upiString, width: 200, height: 200, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.M });
        await new Promise(r => setTimeout(r, 50)); 
    }

    if (!printCharacteristic) {
        document.getElementById('printBillNo').innerText = order.billNo; document.getElementById('printDate').innerText = order.date;
        if(order.orderType === 'Takeaway') { document.getElementById('printTableNoRow').style.display = 'none'; } else { document.getElementById('printTableNoRow').style.display = 'block'; document.getElementById('printTableNo').innerText = String(order.table).replace('Table ', ''); }
        document.getElementById('printOrderType').innerText = order.orderType; document.getElementById('printPayMode').innerText = order.paymentMode;
        if(order.customer) { document.getElementById('printCustomerRow').style.display = 'block'; document.getElementById('printCustomer').innerText = order.customer; } else { document.getElementById('printCustomerRow').style.display = 'none'; }
        if(order.biller) { document.getElementById('printBillerRow').style.display = 'block'; document.getElementById('printBiller').innerText = order.biller; } else { document.getElementById('printBillerRow').style.display = 'none'; }
        
        document.getElementById('printItems').innerHTML = ''; 
        order.rawItems.forEach(item => { 
            let itemTotal = item.price * item.qty; let gst = item.gstRate || 0; 
            if (gst > 0) { let basePrice = itemTotal / (1 + (gst / 100)); let taxAmt = itemTotal - basePrice; if(!gstSummary[gst]) gstSummary[gst] = { base: 0, tax: 0 }; gstSummary[gst].base = Math.round((gstSummary[gst].base + basePrice) * 100) / 100; gstSummary[gst].tax = Math.round((gstSummary[gst].tax + taxAmt) * 100) / 100; }
            document.getElementById('printItems').innerHTML += `<div class="print-row"><span>${item.name} x${item.qty}</span><span>${itemTotal.toFixed(2)}</span></div>`; 
        });

        if(Object.keys(gstSummary).length > 0) {
            let htmlGstContent = '<div class="print-line"></div><div style="font-weight:600; font-size:12px; margin-bottom:5px;">--- GST Breakdown ---</div>';
            for(let rate in gstSummary) {
                let base = gstSummary[rate].base.toFixed(2); let half = (gstSummary[rate].tax / 2).toFixed(2);
                htmlGstContent += `<div style="font-size:11px; color:#444; margin-bottom:6px;"><div style="display:flex; justify-content:space-between;"><span>Taxable Value (${rate}%)</span><span>₹${base}</span></div><div style="display:flex; justify-content:space-between;"><span>CGST @ ${rate/2}%</span><span>₹${half}</span></div><div style="display:flex; justify-content:space-between;"><span>SGST @ ${rate/2}%</span><span>₹${half}</span></div></div>`;
            }
            document.getElementById('printItems').innerHTML += htmlGstContent;
        }
        document.getElementById('printTotal').innerText = `₹${order.amount.toFixed(2)}`;
        
        await executeHtmlPrint('print-receipt');
        return;
    }

    const ESC = '\x1B'; const GS = '\x1D'; const INIT = ESC + '@'; 
    const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00'; const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00'; const DOUBLE_SIZE = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00';

    let receiptText = INIT;
    receiptText += ALIGN_CENTER + DOUBLE_SIZE + BOLD_ON + shopProfile.name + '\n' + NORMAL_SIZE + BOLD_OFF;
    if(shopProfile.address) receiptText += shopProfile.address + '\n';
    if(shopProfile.fssai) receiptText += 'FSSAI: ' + shopProfile.fssai + '\n';
    if(shopProfile.gstin) receiptText += 'GSTIN: ' + shopProfile.gstin + '\n';
    receiptText += '--------------------------------\n'; 
    receiptText += ALIGN_LEFT;
    receiptText += BOLD_ON + 'Invoice: #' + (order.billNo || 'TEST') + '\n' + BOLD_OFF;
    if(order.orderType !== 'Takeaway') receiptText += 'Table: ' + String(order.table).replace('Table ', '') + '\n';
    receiptText += 'Date: ' + order.date + '\n';
    receiptText += 'Type: ' + (order.orderType || 'Dine-In') + '\n';
    receiptText += 'Payment: ' + (order.paymentMode || 'Cash') + '\n';
    if(order.customer) receiptText += 'Customer: ' + order.customer + '\n';
    if(order.biller) receiptText += 'Staff: ' + order.biller + '\n';
    receiptText += '--------------------------------\n';

    order.rawItems.forEach(item => {
        let qtyName = `${item.qty}x ${item.name}`; let priceStr = (item.price * item.qty).toFixed(2);
        if (qtyName.length + priceStr.length > 31) { receiptText += qtyName.substring(0, 32) + '\n'; receiptText += priceStr.padStart(32, ' ') + '\n'; } else { receiptText += qtyName.padEnd(32 - priceStr.length, ' ') + priceStr + '\n'; }
        
        let itemTotal = item.price * item.qty; let gst = item.gstRate || 0; 
        if (gst > 0) { let basePrice = itemTotal / (1 + (gst / 100)); let taxAmt = itemTotal - basePrice; if(!gstSummary[gst]) gstSummary[gst] = { base: 0, tax: 0 }; gstSummary[gst].base = Math.round((gstSummary[gst].base + basePrice) * 100) / 100; gstSummary[gst].tax = Math.round((gstSummary[gst].tax + taxAmt) * 100) / 100; }
    });

    receiptText += '--------------------------------\n';
    if (Object.keys(gstSummary).length > 0) {
        receiptText += ALIGN_CENTER + '--- GST BREAKDOWN ---\n' + ALIGN_LEFT;
        for(let rate in gstSummary) {
            let base = gstSummary[rate].base.toFixed(2); let halfGst = (gstSummary[rate].tax / 2).toFixed(2);
            receiptText += `Taxable Value (${rate}%)`.padEnd(22, ' ') + base.padStart(10, ' ') + '\n';
            receiptText += `CGST @ ${rate/2}%`.padEnd(22, ' ') + halfGst.padStart(10, ' ') + '\n';
            receiptText += `SGST @ ${rate/2}%`.padEnd(22, ' ') + halfGst.padStart(10, ' ') + '\n';
            receiptText += '\n';
        }
        receiptText += '--------------------------------\n';
    }

    receiptText += ALIGN_CENTER + DOUBLE_SIZE + BOLD_ON + `TOTAL: Rs.${order.amount.toFixed(2)}\n` + NORMAL_SIZE + BOLD_OFF;
    receiptText += '--------------------------------\n';

    let payloads = [];
    
    // 1. Logo
    if (shopProfile.logo) {
        const logoBytes = await getLogoBytes(shopProfile.logo);
        if (logoBytes) { payloads.push(new Uint8Array([0x1B, 0x61, 0x01])); payloads.push(logoBytes); payloads.push(new Uint8Array([0x0A])); }
    }

    // 2. Text
    payloads.push(new TextEncoder().encode(receiptText));

    // 3. Hardware QR Injection
    if (shopProfile.showQr && shopProfile.upiId) {
        const qrCanvas = qrCodeDiv.querySelector('canvas');
        if (qrCanvas) {
            const qrBytes = await getLogoBytes(qrCanvas.toDataURL('image/jpeg', 1.0));
            if (qrBytes) {
                payloads.push(new Uint8Array([0x1B, 0x61, 0x01]));
                payloads.push(new TextEncoder().encode("\nScan to Pay\n"));
                payloads.push(qrBytes);
                payloads.push(new Uint8Array([0x0A]));
            }
        }
    }

    // 4. Thank You & Cut
    payloads.push(new TextEncoder().encode(ALIGN_CENTER + 'Thank You! Visit Again\n\x0A\x0A\x0A\x0A\x1B\x6D'));

    let totalLength = payloads.reduce((sum, p) => sum + p.length, 0);
    let finalPayload = new Uint8Array(totalLength);
    let offset = 0; for (let p of payloads) { finalPayload.set(p, offset); offset += p.length; }

    const CHUNK_SIZE = 100; 
    try { for (let i = 0; i < finalPayload.length; i += CHUNK_SIZE) { const chunk = finalPayload.slice(i, i + CHUNK_SIZE); await printCharacteristic.writeValue(chunk); await new Promise(resolve => setTimeout(resolve, 40)); } } catch(e) { console.error(e); showToast("❌ Print Failed. Printer might be off."); }
}

async function sendKotToPrinter(tableNo, items) {
    if (!printCharacteristic) {
        document.getElementById('printKotTableNo').innerText = tableNo; document.getElementById('printKotTime').innerText = new Date().toLocaleTimeString();
        let itemsHtml = ''; items.forEach(item => { itemsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px dashed #ccc; padding-bottom: 4px;"><span>${item.name}</span><span style="font-size:18px;">x${item.qty}</span></div>`; });
        document.getElementById('printKotItems').innerHTML = itemsHtml;
        await executeHtmlPrint('print-kot'); return;
    }

    const ESC = '\x1B'; const GS = '\x1D'; const INIT = ESC + '@'; const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00'; const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00'; const DOUBLE_SIZE = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00'; const FEED_AND_CUT = '\x0A\x0A\x0A\x0A' + ESC + 'm'; 

    let kotText = INIT; kotText += ALIGN_CENTER + BOLD_ON + "KITCHEN TICKET\n" + BOLD_OFF; kotText += "--------------------------------\n"; kotText += DOUBLE_SIZE + BOLD_ON + `TABLE: ${tableNo}\n` + NORMAL_SIZE + BOLD_OFF; kotText += `Time: ${new Date().toLocaleTimeString()}\n`; kotText += "--------------------------------\n"; kotText += ALIGN_LEFT;
    items.forEach(item => { kotText += DOUBLE_SIZE + `${item.qty}x ${item.name}\n` + NORMAL_SIZE; kotText += "--------------------------------\n"; });
    kotText += ALIGN_CENTER + "*** END OF KOT ***\n" + FEED_AND_CUT;
    const encoder = new TextEncoder(); const payload = encoder.encode(kotText); const CHUNK_SIZE = 100; 
    try { for (let i = 0; i < payload.length; i += CHUNK_SIZE) { const chunk = payload.slice(i, i + CHUNK_SIZE); await printCharacteristic.writeValue(chunk); await new Promise(resolve => setTimeout(resolve, 40)); } } catch(e) { console.error(e); showToast("❌ KOT Print Failed."); }
}

async function printKitchenTicket() {
    const btn = document.querySelector('#kotModal .btn-warning'); btn.disabled = true; btn.innerText = printCharacteristic ? "⏳ Printing KOT..." : "📄 Generating PDF KOT...";
    let tInfo = tablesInfo[activeTable];
    try { await sendKotToPrinter(activeTable, tInfo.items); document.getElementById('kotModal').style.display = 'none'; showToast(`👨‍🍳 Table ${activeTable} KOT Processed.`); } 
    catch(e) { console.error(e); showToast("❌ KOT Error."); } finally { btn.disabled = false; btn.innerText = "🖨️ Print KOT"; }
}

function reprintReceipt(orderId) { const order = orderHistory.find(o => o.id === orderId); if (!order || !order.rawItems) return showToast("Cannot print old order details."); sendEscPosToPrinter(order); }
function testThermalPrinter() { const dummyOrder = { billNo: 'TEST-999', date: new Date().toLocaleString(), orderType: 'Dine-In', paymentMode: 'Cash', amount: 270, rawItems: [ {name: "Standard Espresso", qty: 1, price: 80, gstRate: 5}, {name: "Water Bottle", qty: 2, price: 20, gstRate: 0} ] }; sendEscPosToPrinter(dummyOrder); }

function showToast(message) { 
    const container = document.getElementById('toast-container'); if (!container) return;
    const toast = document.createElement('div'); toast.className = 'toast'; toast.innerHTML = `<span>🔔</span> ${message}`; container.appendChild(toast); 
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-10px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3000); 
}
window.showToast = showToast;

document.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        const activeId = document.activeElement.id;
        if (!activeId) return;
        if (activeId === 'activationKeyInput') { activateSoftware(); document.activeElement.blur(); }
        if (activeId === 'adminPinInput') { loginAsAdmin(); document.activeElement.blur(); }
        if (activeId === 'newCategoryName') { addCategory(); }
        if (['newItemName', 'newItemPrice', 'newItemGst', 'newItemStock'].includes(activeId)) { addMenuItem(); document.getElementById('newItemName').focus(); }
        if (['expenseName', 'expenseCost'].includes(activeId)) { addExpense(); document.getElementById('expenseName').focus(); }
        if (['checkoutCustomerName', 'checkoutBillerName'].includes(activeId)) { if (document.getElementById('checkoutModal').style.display !== 'none') confirmCheckout(); }
        if (['editCustomerName', 'editBillerName'].includes(activeId)) { if (document.getElementById('editOrderModal').style.display !== 'none') saveEditedOrder(); }
        if (activeId === 'menuSearchInput') { document.activeElement.blur(); }
        if (['shopNameInput', 'shopAddressInput', 'fssaiInput', 'gstinInput', 'tableCountInput', 'startInvoiceInput', 'adminPinSetup', 'openAiKeyInput', 'upiIdInput'].includes(activeId)) { saveSettings(); document.activeElement.blur(); }
    }
});

window.activateSoftware = activateSoftware; window.loginAsStaff = loginAsStaff; window.loginAsAdmin = loginAsAdmin; window.selectPayment = selectPayment; window.confirmCheckout = confirmCheckout; window.saveEditedOrder = saveEditedOrder; window.switchTab = switchTab; window.installApp = installApp; window.lockSystem = lockSystem; window.renderMenuUI = renderMenuUI; window.bookTable = bookTable; window.sendToKitchen = sendToKitchen; window.markServed = markServed; window.openCheckoutModal = openCheckoutModal; window.clearTable = clearTable; window.addMenuItem = addMenuItem; window.addExpense = addExpense; window.editExpense = editExpense; window.deleteExpense = deleteExpense; window.renderStatements = renderStatements; window.exportHistoryToExcel = exportHistoryToExcel; window.loadLogo = loadLogo; window.saveSettings = saveSettings; window.testThermalPrinter = testThermalPrinter; window.factoryReset = factoryReset; window.filterMenu = filterMenu; window.addToCart = addToCart; window.editMenuItem = editMenuItem; window.deleteMenuItem = deleteMenuItem; window.openEditOrderModal = openEditOrderModal; window.reprintReceipt = reprintReceipt; window.selectTable = selectTable; window.modifyQty = modifyQty; window.connectBluetoothPrinter = connectBluetoothPrinter; window.printKitchenTicket = printKitchenTicket; window.addCategory = addCategory; window.deleteCategory = deleteCategory; window.processAIMenu = processAIMenu; window.confirmAiImport = confirmAiImport; window.openAddMenuItemModal = openAddMenuItemModal; window.toggleCartDrawer = toggleCartDrawer; window.generateAIImage = generateAIImage; window.handleItemImageUpload = handleItemImageUpload; window.generateSettingsQRPreview = generateSettingsQRPreview;
