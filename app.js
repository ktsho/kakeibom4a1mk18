// ==========================================
// アプリの状態管理とAPI設定
// ==========================================
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDateString = null;
let dbTransactions = []; 

// ★ここをご自身のRenderのURLに書き換えてください！★
const API_BASE_URL = 'https://kakeibo-93mp.onrender.com/api/transactions'; 
//const FC_API_URL = 'https://kakeibo-93mp.onrender.com/api/fixed_costs';

// ==========================================
// カテゴリ・予算・固定収支設定の管理
// ==========================================
const DEFAULT_SETTINGS = {
    expenseCategories: ["食費", "趣味", "交通費", "服飾", "交際費", "その他"],
    incomeCategories: ["給料", "臨時収入", "その他"],
    defaultExpense: "食費",
    defaultIncome: "給料",
    defaultBudgets: {}, 
    monthlyBudgets: {},
    fixedTemplates: [] 
};

let appSettings = JSON.parse(localStorage.getItem('kakeibo_custom_settings')) || DEFAULT_SETTINGS;

if (!appSettings.defaultBudgets) appSettings.defaultBudgets = {};
if (!appSettings.monthlyBudgets) appSettings.monthlyBudgets = {};
if (!appSettings.fixedTemplates) appSettings.fixedTemplates = [];

function saveSettings() {
    localStorage.setItem('kakeibo_custom_settings', JSON.stringify(appSettings));
    renderSettingsView(); 
}

// ==========================================
// メモ欄を使った現金・口座の自動振り分け
// ==========================================
function decodeMemo(rawMemo) {
    if (!rawMemo) return { accountType: 'cash', cleanMemo: '' };
    if (rawMemo.startsWith('[現金] ')) return { accountType: 'cash', cleanMemo: rawMemo.replace('[現金] ', '') };
    if (rawMemo.startsWith('[口座] ')) return { accountType: 'bank', cleanMemo: rawMemo.replace('[口座] ', '') };
    if (rawMemo.startsWith('[現金]')) return { accountType: 'cash', cleanMemo: rawMemo.replace('[現金]', '') };
    if (rawMemo.startsWith('[口座]')) return { accountType: 'bank', cleanMemo: rawMemo.replace('[口座]', '') };
    return { accountType: 'cash', cleanMemo: rawMemo };
}

// ==========================================
// データベース通信 ＆ 固定収支の自動入力処理
// ==========================================
async function applyFixedTransactions() {
    const currentYearNum = new Date().getFullYear();
    const currentMonthNum = new Date().getMonth() + 1;
    const currentMonthKey = `${currentYearNum}-${String(currentMonthNum).padStart(2, '0')}`;
    const lastDayOfMonth = new Date(currentYearNum, currentMonthNum, 0).getDate();
    let appliedAny = false;

    for (let i = 0; i < appSettings.fixedTemplates.length; i++) {
        const template = appSettings.fixedTemplates[i];
        if (template.lastAppliedMonth !== currentMonthKey) {
            let applyDay = template.day;
            if (applyDay > lastDayOfMonth) applyDay = lastDayOfMonth;
            
            const dateStr = `${currentMonthKey}-${String(applyDay).padStart(2, '0')}`;
            const prefix = template.accountType === 'cash' ? '[現金]' : '[口座]';
            const finalMemo = template.memo ? `${prefix} ${template.memo}` : prefix;

            const payload = { date: dateStr, category: template.category, amount: template.amount, memo: finalMemo, type: template.type };

            try {
                const res = await fetch(API_BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) {
                    template.lastAppliedMonth = currentMonthKey;
                    appliedAny = true;
                }
            } catch (e) { console.error("固定収支の自動入力に失敗:", e); }
        }
    }
    if (appliedAny) saveSettings();
    return appliedAny;
}

async function loadAllData() {
    try {
        const response = await fetch(API_BASE_URL);
        if (response.ok) {
            const rawTxs = await response.json();
            dbTransactions = rawTxs.map(tx => {
                const decoded = decodeMemo(tx.memo);
                return { ...tx, accountType: decoded.accountType, cleanMemo: decoded.cleanMemo };
            });
            renderCalendar(currentYear, currentMonth);
        }
    } catch (error) { 
        console.error("データ取得エラー:", error); 
    }
}

window.onload = async () => {
    await applyFixedTransactions();
    loadAllData();
};

// ==========================================
// 画面切り替え関数
// ==========================================
function switchView(viewId) {
    document.querySelectorAll('.app-view').forEach(view => view.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    window.scrollTo(0, 0); 
    if (viewId === 'view-settings') renderSettingsView(); 
}

document.querySelectorAll('.btn-back-to-calendar').forEach(btn => btn.addEventListener('click', () => switchView('view-calendar')));
document.getElementById('btn-to-settings').addEventListener('click', () => switchView('view-settings'));
document.getElementById('btn-back-to-detail').addEventListener('click', () => {
    if (selectedDateString === null) { switchView('view-calendar'); } else { openDailyDetail(selectedDateString); }
});
document.getElementById('fab-add').addEventListener('click', () => {
    selectedDateString = null;
    openInputForm(new Date().toISOString().split('T')[0], null); 
});

// ==========================================
// 【新設】過去の月からの予算・繰り越し・超過の連続シミュレーションエンジン
// ==========================================
function calculateBudgetsAndCarryover(targetYear, targetMonth) {
    const finalResult = {};
    appSettings.expenseCategories.forEach(cat => {
        finalResult[cat] = { spent: 0, monthlyBudget: 0, totalBudget: 0, isIncomeAdded: false };
    });

    if (dbTransactions.length === 0) return finalResult;

    // ★修正ポイント1：計算のスタート地点を「常に2026年5月」に強制固定する
    // これにより、4月以前に入力された初期データが「予算繰り越し」に悪影響を及ぼさなくなります
    let y = 2026;
    let m = 4; // 5月（JavaScriptでは4）

    // もしターゲットの月が2026年5月より前（例：4月）を表示している場合は、繰り越しなしでそのまま返す
    if (targetYear < 2026 || (targetYear === 2026 && targetMonth < 4)) {
        return finalResult;
    }

    const carryoverStore = {};
    appSettings.expenseCategories.forEach(cat => carryoverStore[cat] = 0);

    // 2026年5月から、現在のターゲット月まで1ヶ月ずつ順番に計算
    while (true) {
        const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
        const spentThisMonth = {};
        const incomeThisMonth = {};
        appSettings.expenseCategories.forEach(cat => { spentThisMonth[cat] = 0; incomeThisMonth[cat] = 0; });

        // この月のデータを集計（★総資産の計算ではなく、あくまで予算用の集計）
        dbTransactions.forEach(tx => {
            if (tx.date.startsWith(monthKey)) {
                if (tx.type === 'expense' && spentThisMonth[tx.category] !== undefined) {
                    spentThisMonth[tx.category] += tx.amount;
                }
                if (tx.type === 'income' && appSettings.expenseCategories.includes(tx.category)) {
                    incomeThisMonth[tx.category] += tx.amount;
                }
            }
        });

        appSettings.expenseCategories.forEach(cat => {
            let baseBudget = appSettings.defaultBudgets[cat] || 0;
            if (appSettings.monthlyBudgets[monthKey] && appSettings.monthlyBudgets[monthKey][cat] !== undefined) {
                baseBudget = appSettings.monthlyBudgets[monthKey][cat];
            }

            const addedIncome = incomeThisMonth[cat] || 0;
            const monthlyBudget = baseBudget + addedIncome;
            const isIncomeAdded = addedIncome > 0;

            const prevCarryover = carryoverStore[cat];
            // 今月の合計予算 ＝ 今月の予算 ＋ 前月からの繰り越し残金（不足ならマイナス）
            const totalBudget = monthlyBudget + prevCarryover; 

            const spent = spentThisMonth[cat];

            // 翌月への繰り越し ＝ 今月の合計予算 － 今月使った金額
            carryoverStore[cat] = totalBudget - spent;

            if (y === targetYear && m === targetMonth) {
                finalResult[cat] = { spent, monthlyBudget, totalBudget, isIncomeAdded };
            }
        });

        if (y === targetYear && m === targetMonth) break;

        m++;
        if (m > 11) { m = 0; y++; }
        if (y > targetYear + 2) break; // 安全弁
    }

    return finalResult;
}
// ==========================================
// カレンダー＆サマリー描画処理
// ==========================================
function renderCalendar(year, month) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = ''; 
    document.getElementById('current-month-display').textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    let totalIncome = 0; let totalExpense = 0;
    let cashIncome = 0; let cashExpense = 0;
    let bankIncome = 0; let bankExpense = 0;
    let monthIncome = 0; let monthExpense = 0;
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    dbTransactions.forEach(tx => {
        if (tx.type === 'income') {
            totalIncome += tx.amount;
            if (tx.accountType === 'cash') cashIncome += tx.amount; else bankIncome += tx.amount;
        }
        if (tx.type === 'expense') {
            totalExpense += tx.amount;
            if (tx.accountType === 'cash') cashExpense += tx.amount; else bankExpense += tx.amount;
        }
        if (tx.date.startsWith(monthKey)) {
            if (tx.type === 'income') monthIncome += tx.amount;
            if (tx.type === 'expense') monthExpense += tx.amount;
        }
    });

    document.getElementById('total-net-worth').textContent = `${(totalIncome - totalExpense).toLocaleString()}円`;
    document.getElementById('cash-net-worth').textContent = `${(cashIncome - cashExpense).toLocaleString()}円`;
    document.getElementById('bank-net-worth').textContent = `${(bankIncome - bankExpense).toLocaleString()}円`;
    document.getElementById('monthly-income').textContent = `+${monthIncome.toLocaleString()}円`;
    document.getElementById('monthly-expense').textContent = `-${monthExpense.toLocaleString()}円`;

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-cell empty';
        grid.appendChild(emptyCell);
    }

    for (let i = 1; i <= lastDate; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        cell.innerHTML = `<div>${i}</div>`;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayTxs = dbTransactions.filter(tx => tx.date === dateStr);
        let dayIncome = 0; let dayExpense = 0;

        dayTxs.forEach(tx => {
            if (tx.type === 'income') dayIncome += tx.amount;
            if (tx.type === 'expense') dayExpense += tx.amount;
        });

        if (dayExpense > 0) cell.innerHTML += `<div class="expense-mini">-${dayExpense.toLocaleString()}</div>`;
        if (dayIncome > 0) cell.innerHTML += `<div class="income-mini">+${dayIncome.toLocaleString()}</div>`; 
        cell.addEventListener('click', () => openDailyDetail(dateStr));
        grid.appendChild(cell);
    }

    // シミュレーションエンジンから高度な予算データを取得
    const budgetData = calculateBudgetsAndCarryover(year, month);

    const budgetListContainer = document.getElementById('category-budgets-list');
    budgetListContainer.innerHTML = '';

    // === 【追加】全カテゴリの合計を計算 ===
    let sumSpent = 0;
    let sumMonthly = 0;
    let sumTotal = 0;

    appSettings.expenseCategories.forEach(cat => {
        const data = budgetData[cat];
        sumSpent += data.spent;
        sumMonthly += data.monthlyBudget;
        sumTotal += data.totalBudget;
    });

    // === 【追加】一番上に全体の合計行を表示 ===
    const totalDiv = document.createElement('div');
    totalDiv.className = 'budget-item';
    totalDiv.style.background = '#f2f2f7'; // 合計と分かりやすいように薄いグレーに
    totalDiv.style.fontWeight = 'bold';
    totalDiv.innerHTML = `
        <span class="budget-label">合計</span>
        <span class="budget-values">
            <span>${sumSpent.toLocaleString()}円</span> / 
            <span>${sumMonthly.toLocaleString()}円</span> / 
            <span>${sumTotal.toLocaleString()}円</span>
        </span>
    `;
    budgetListContainer.appendChild(totalDiv);

    // === 各カテゴリの描画（ここから既存のループ処理） ===
    appSettings.expenseCategories.forEach(cat => {
        const data = budgetData[cat];
        
        // 色の条件分岐
        let spentClass = '';
        if (data.spent > data.totalBudget) {
            spentClass = 'over-total-budget'; // 合計予算オーバー：赤文字
        } else if (data.spent > data.monthlyBudget) {
            spentClass = 'over-month-budget'; // 月予算オーバー：オレンジ文字
        }

        const budgetClass = data.isIncomeAdded ? 'income-added-budget' : ''; // 収入加算あり：緑文字

        const div = document.createElement('div');
        div.className = 'budget-item';
        div.innerHTML = `
            <span class="budget-label">${cat}</span>
            <span class="budget-values">
                <span class="${spentClass}">${data.spent.toLocaleString()}円</span> / 
                <span class="${budgetClass}">${data.monthlyBudget.toLocaleString()}円</span> / 
                <span>${data.totalBudget.toLocaleString()}円</span>
            </span>
        `;
        
        div.addEventListener('click', () => openCategoryModal(cat, year, month, data));
        budgetListContainer.appendChild(div);
    });
} // renderCalendar関数の閉じカッコ

document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar(currentYear, currentMonth);
});
document.getElementById('next-month').addEventListener('click', () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar(currentYear, currentMonth);
});

// ==========================================
// 【新設】カテゴリ詳細ポップアップモーダルの制御
// ==========================================
let activeModalCat = null;
let activeModalYear = null;
let activeModalMonth = null;

function openCategoryModal(cat, year, month, data) {
    activeModalCat = cat; activeModalYear = year; activeModalMonth = month;
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    document.getElementById('modal-category-title').textContent = `${month + 1}月 【${cat}】 詳細`;
    
    // 現在の月個別予算をインプットに初期値として入れる（無ければデフォルト）
    const currentBase = appSettings.monthlyBudgets[monthKey] && appSettings.monthlyBudgets[monthKey][cat] !== undefined 
                        ? appSettings.monthlyBudgets[monthKey][cat] 
                        : (appSettings.defaultBudgets[cat] || 0);
    document.getElementById('modal-budget-input').value = currentBase;

    // 明細リストの抽出
    const modalList = document.getElementById('modal-expense-list');
    modalList.innerHTML = '';
    
    const matchedTxs = dbTransactions.filter(tx => tx.date.startsWith(monthKey) && tx.type === 'expense' && tx.category === cat);
    
    if (matchedTxs.length === 0) {
        modalList.innerHTML = '<p style="text-align:center; font-size:12px; color:#888; padding:10px;">今月の支出明細はありません</p>';
    } else {
        matchedTxs.forEach(tx => {
            const dDiv = document.createElement('div');
            dDiv.className = 'transaction-item tx-expense-item';
            dDiv.style.padding = '8px';
            dDiv.style.fontSize = '12px';
            const accIcon = tx.accountType === 'cash' ? '💴' : '🏦';
            const dayNum = tx.date.split('-')[2];
            dDiv.innerHTML = `<div class="tx-info"><span>${dayNum}日: ${accIcon} ${tx.cleanMemo || 'メモなし'}</span></div><div class="tx-amount expense">-${tx.amount.toLocaleString()}円</div>`;
            modalList.appendChild(dDiv);
        });
    }

    document.getElementById('category-modal').style.display = 'flex';
}

// ポップアップ内の変更ボタン処理
document.getElementById('modal-budget-save-btn').addEventListener('click', () => {
    const newVal = parseInt(document.getElementById('modal-budget-input').value, 10) || 0;
    const monthKey = `${activeModalYear}-${String(activeModalMonth + 1).padStart(2, '0')}`;
    
    if (!appSettings.monthlyBudgets[monthKey]) appSettings.monthlyBudgets[monthKey] = {};
    appSettings.monthlyBudgets[monthKey][activeModalCat] = newVal;
    
    saveSettings();
    document.getElementById('category-modal').style.display = 'none';
    renderCalendar(activeModalYear, activeModalMonth);
});

document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('category-modal').style.display = 'none';
});

// ==========================================
// 日別詳細画面
// ==========================================
function openDailyDetail(dateStr) {
    selectedDateString = dateStr;
    const [y, m, d] = dateStr.split('-');
    document.getElementById('detail-date-title').textContent = `${y}年${Number(m)}月${Number(d)}日`;
    const listContainer = document.getElementById('daily-transaction-list');
    listContainer.innerHTML = ''; 

    const dayTxs = dbTransactions.filter(tx => tx.date === dateStr);
    let dayIncome = 0, dayExpense = 0;

    if (dayTxs.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 14px; color: #888; text-align: center;">データがありません</p>';
    } else {
        dayTxs.forEach(tx => {
            if (tx.type === 'income') dayIncome += tx.amount;
            if (tx.type === 'expense') dayExpense += tx.amount;
            const itemDiv = document.createElement('div');
            itemDiv.className = `transaction-item ${tx.type === 'income' ? 'tx-income-item' : 'tx-expense-item'}`;
            const accIcon = tx.accountType === 'cash' ? '💴' : '🏦';
            itemDiv.innerHTML = `<div class="tx-info"><span class="tx-cat">${accIcon} ${tx.category}</span><span class="tx-memo">${tx.cleanMemo || 'メモなし'}</span></div><div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString()}円</div>`;
            itemDiv.addEventListener('click', () => openInputForm(dateStr, tx));
            listContainer.appendChild(itemDiv);
        });
    }
    document.getElementById('detail-total-income').textContent = `+${dayIncome.toLocaleString()}円`;
    document.getElementById('detail-total-expense').textContent = `-${dayExpense.toLocaleString()}円`;
    switchView('view-daily-detail');
}

document.getElementById('btn-to-new-input').addEventListener('click', () => { openInputForm(selectedDateString, null); });

// ==========================================
// 入力・編集画面
// ==========================================
function updateCategoryDropdown(selectedType, defaultSelectValue = null) {
    const select = document.getElementById('category');
    select.innerHTML = ''; 
    const categories = selectedType === 'expense' ? appSettings.expenseCategories : appSettings.incomeCategories;
    const defaultCat = selectedType === 'expense' ? appSettings.defaultExpense : appSettings.defaultIncome;

    if (defaultSelectValue && !categories.includes(defaultSelectValue)) {
        const opt = document.createElement('option'); opt.value = defaultSelectValue; opt.textContent = defaultSelectValue; select.appendChild(opt);
    }
    categories.forEach(cat => {
        const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; select.appendChild(opt);
    });
    if (defaultSelectValue) { select.value = defaultSelectValue; } else if (categories.includes(defaultCat)) { select.value = defaultCat; }
}

document.querySelectorAll('input[name="tx-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => { updateCategoryDropdown(e.target.value); });
});

function openInputForm(dateStr, txData) {
    document.getElementById('date').value = dateStr;
    document.getElementById('amount').value = '';
    document.getElementById('memo').value = '';

    if (txData) {
        document.getElementById('input-view-title').textContent = "編集する";
        document.getElementById('edit-id').value = txData.id;
        document.querySelector(`input[name="tx-type"][value="${txData.type}"]`).checked = true;
        document.querySelector(`input[name="account-type"][value="${txData.accountType}"]`).checked = true;
        updateCategoryDropdown(txData.type, txData.category); 
        document.getElementById('amount').value = txData.amount;
        document.getElementById('memo').value = txData.cleanMemo; 
        document.getElementById('delete-btn').style.display = 'block'; 
    } else {
        document.getElementById('input-view-title').textContent = "記帳する";
        document.getElementById('edit-id').value = ""; 
        document.querySelector('input[name="tx-type"][value="expense"]').checked = true;
        document.querySelector('input[name="account-type"][value="bank"]').checked = true; // デフォルトを口座に修正
        updateCategoryDropdown('expense'); 
        document.getElementById('delete-btn').style.display = 'none'; 
    }
    switchView('view-input');
}

document.getElementById('save-btn').addEventListener('click', async () => {
    const editId = document.getElementById('edit-id').value;
    const amount = parseInt(document.getElementById('amount').value, 10);
    const date = document.getElementById('date').value;
    const category = document.getElementById('category').value;
    const cleanMemo = document.getElementById('memo').value;
    const type = document.querySelector('input[name="tx-type"]:checked').value;
    const accountType = document.querySelector('input[name="account-type"]:checked').value;

    if (!amount) { alert("金額を入力してください"); return; }
    const prefix = accountType === 'cash' ? '[現金]' : '[口座]';
    const finalMemo = cleanMemo ? `${prefix} ${cleanMemo}` : prefix;
    const payload = { date, category, amount, memo: finalMemo, type };

    try {
        let url = API_BASE_URL; let method = 'POST';
        if (editId) { url = `${API_BASE_URL}/${editId}`; method = 'PUT'; }
        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.ok) {
            await loadAllData();
            if (selectedDateString) { openDailyDetail(selectedDateString); } else { switchView('view-calendar'); }
        } else { alert("保存に失敗しました。"); }
    } catch (error) { console.error("通信エラー:", error); }
});

document.getElementById('delete-btn').addEventListener('click', async () => {
    if (!confirm("本当にこのデータを削除しますか？")) return;
    const editId = document.getElementById('edit-id').value;
    try {
        const response = await fetch(`${API_BASE_URL}/${editId}`, { method: 'DELETE' });
        if (response.ok) { await loadAllData(); openDailyDetail(selectedDateString); }
    } catch (error) { console.error("通信エラー:", error); }
});

// ==========================================
// 設定画面（固定収支・予算）の制御
// ==========================================
document.getElementById('toggle-fixed-settings-btn').addEventListener('click', () => {
    const area = document.getElementById('fixed-settings-area');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
});

function updateFixedCategoryDropdown(selectedType) {
    const select = document.getElementById('fixed-category');
    select.innerHTML = ''; 
    const categories = selectedType === 'expense' ? appSettings.expenseCategories : appSettings.incomeCategories;
    categories.forEach(cat => {
        const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; select.appendChild(opt);
    });
}
document.querySelectorAll('input[name="fixed-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => { updateFixedCategoryDropdown(e.target.value); });
});

function renderSettingsView() {
    document.getElementById('settings-expense-list').innerHTML = appSettings.expenseCategories.map((cat, index) => {
        const defaultBudget = appSettings.defaultBudgets[cat] || 0;
        return `<div class="category-item" style="flex-wrap: wrap;"><span style="width: 40%; font-weight:bold;">${cat}</span><div style="width: 60%; display:flex; justify-content:flex-end; align-items:center; gap:5px;"><input type="number" value="${defaultBudget}" placeholder="予算(円)" style="width:80px; padding:4px;" onchange="updateDefaultBudget('${cat}', this.value)"><button class="btn-small-del" onclick="deleteCategory('expense', ${index})">削除</button></div></div>`;
    }).join('');

    document.getElementById('settings-income-list').innerHTML = appSettings.incomeCategories.map((cat, index) => `<div class="category-item"><span>${cat}</span><button class="btn-small-del" onclick="deleteCategory('income', ${index})">削除</button></div>`).join('');

    const expSelect = document.getElementById('default-expense-select');
    expSelect.innerHTML = appSettings.expenseCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if(appSettings.expenseCategories.includes(appSettings.defaultExpense)) expSelect.value = appSettings.defaultExpense;

    const incSelect = document.getElementById('default-income-select');
    incSelect.innerHTML = appSettings.incomeCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if(appSettings.incomeCategories.includes(appSettings.defaultIncome)) incSelect.value = appSettings.defaultIncome;

    const currentFixedType = document.querySelector('input[name="fixed-type"]:checked').value;
    updateFixedCategoryDropdown(currentFixedType);

    const fixedListContainer = document.getElementById('fixed-templates-list');
    fixedListContainer.innerHTML = '';
    if (appSettings.fixedTemplates.length === 0) {
        fixedListContainer.innerHTML = '<p style="text-align:center; font-size:14px; color:#888;">登録されていません</p>';
    } else {
        appSettings.fixedTemplates.forEach((tmp, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = `transaction-item ${tmp.type === 'income' ? 'tx-income-item' : 'tx-expense-item'}`;
            const accIcon = tmp.accountType === 'cash' ? '💴' : '🏦';
            const typeSign = tmp.type === 'income' ? '+' : '-';
            itemDiv.innerHTML = `<div class="tx-info"><span class="tx-cat">毎月 ${tmp.day}日: ${accIcon} ${tmp.category}</span><span class="tx-memo">${tmp.memo || 'メモなし'}</span></div><div style="display: flex; align-items: center;"><div class="tx-amount ${tmp.type}" style="margin-right: 15px;">${typeSign}${tmp.amount.toLocaleString()}円</div><button class="delete-fixed-btn" data-index="${index}" style="background: #ff3b30; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">削除</button></div>`;
            fixedListContainer.appendChild(itemDiv);
        });

        document.querySelectorAll('.delete-fixed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!confirm("この自動入力を削除しますか？")) return;
                appSettings.fixedTemplates.splice(e.target.getAttribute('data-index'), 1);
                saveSettings();
            });
        });
    }
}

document.getElementById('add-fixed-btn').addEventListener('click', async () => {
    const type = document.querySelector('input[name="fixed-type"]:checked').value;
    const accountType = document.querySelector('input[name="fixed-account"]:checked').value;
    const day = parseInt(document.getElementById('fixed-day').value, 10);
    const category = document.getElementById('fixed-category').value;
    const amount = parseInt(document.getElementById('fixed-amount').value, 10);
    const memo = document.getElementById('fixed-memo').value;

    if (!day || day < 1 || day > 31 || !amount) { alert("日付と金額を正しく入力してください"); return; }

    const newTemplate = { id: Date.now(), type, accountType, day, category, amount, memo, lastAppliedMonth: "" };
    appSettings.fixedTemplates.push(newTemplate);
    saveSettings();

    document.getElementById('fixed-amount').value = '';
    document.getElementById('fixed-memo').value = '';

    const applied = await applyFixedTransactions();
    if (applied) await loadAllData();
    alert("固定収支を登録しました！");
});

window.updateDefaultBudget = function(cat, val) { appSettings.defaultBudgets[cat] = parseInt(val, 10) || 0; saveSettings(); };

document.getElementById('add-expense-cat-btn').addEventListener('click', () => {
    const val = document.getElementById('new-expense-cat-input').value.trim();
    if (val && !appSettings.expenseCategories.includes(val)) { appSettings.expenseCategories.push(val); document.getElementById('new-expense-cat-input').value = ''; saveSettings(); }
});
document.getElementById('add-income-cat-btn').addEventListener('click', () => {
    const val = document.getElementById('new-income-cat-input').value.trim();
    if (val && !appSettings.incomeCategories.includes(val)) { appSettings.incomeCategories.push(val); document.getElementById('new-income-cat-input').value = ''; saveSettings(); }
});
window.deleteCategory = function(type, index) {
    if (!confirm("このカテゴリを削除しますか？\n（※過去の入力データは消えません）")) return;
    if (type === 'expense') {
        const removedCat = appSettings.expenseCategories[index];
        appSettings.expenseCategories.splice(index, 1); delete appSettings.defaultBudgets[removedCat];
        if(!appSettings.expenseCategories.includes(appSettings.defaultExpense)) appSettings.defaultExpense = appSettings.expenseCategories[0] || "";
    } else {
        appSettings.incomeCategories.splice(index, 1);
        if(!appSettings.incomeCategories.includes(appSettings.defaultIncome)) appSettings.defaultIncome = appSettings.incomeCategories[0] || "";
    }
    saveSettings();
};
document.getElementById('default-expense-select').addEventListener('change', (e) => { appSettings.defaultExpense = e.target.value; saveSettings(); });
document.getElementById('default-income-select').addEventListener('change', (e) => { appSettings.defaultIncome = e.target.value; saveSettings(); });
